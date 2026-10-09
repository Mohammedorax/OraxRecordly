import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Windows needs the console window hidden; the app's own rule applies here too. */
const HIDDEN_WINDOW = { windowsHide: true } as const;

const EXECUTABLE_SUFFIX = process.platform === "win32" ? ".exe" : "";

/**
 * Finds a binary inside an installed package without importing it.
 *
 * `ffmpeg-static` exports a path string, but importing it from an ESM test file
 * means going through `createRequire`; probing the well-known layouts is simpler
 * and also works when the package layout differs per platform.
 */
function findBinaryInModule(moduleName: string, binaryName: string): string | null {
	const packageDir = path.join(repoRoot, "node_modules", moduleName);
	if (!existsSync(packageDir)) {
		return null;
	}

	const candidates = [
		path.join(packageDir, binaryName + EXECUTABLE_SUFFIX),
		path.join(
			packageDir,
			"bin",
			process.platform,
			process.arch,
			binaryName + EXECUTABLE_SUFFIX,
		),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	return null;
}

/** The same ffmpeg the app bundles; falls back to PATH for unusual setups. */
export function resolveFfmpegBinary(): string {
	return findBinaryInModule("ffmpeg-static", "ffmpeg") ?? "ffmpeg";
}

export function resolveFfprobeBinary(): string {
	return findBinaryInModule("ffprobe-static", "ffprobe") ?? "ffprobe";
}

/**
 * Builds a tiny deterministic clip once per run.
 *
 * A generated fixture keeps the repository free of committed binaries and gives
 * every run the same duration/resolution, so the assertions below can be exact.
 * The clip carries an audio track on purpose: exports must exercise muxing, not
 * just the video path.
 */
export async function ensureSampleVideo(directory: string): Promise<string> {
	const target = path.join(directory, "e2e-sample.mp4");
	if (existsSync(target)) {
		return target;
	}

	await fs.mkdir(directory, { recursive: true });
	await execFileAsync(
		resolveFfmpegBinary(),
		[
			"-hide_banner",
			"-loglevel",
			"error",
			"-y",
			"-f",
			"lavfi",
			"-i",
			"testsrc2=size=320x180:rate=24",
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=440:sample_rate=48000",
			"-t",
			"2",
			"-c:v",
			"libx264",
			"-pix_fmt",
			"yuv420p",
			"-c:a",
			"aac",
			"-shortest",
			target,
		],
		{ ...HIDDEN_WINDOW, timeout: 120_000 },
	);
	return target;
}

export type FfprobeResult = {
	streams: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number }>;
	format: { duration?: string; size?: string; format_name?: string };
};

export async function probeMedia(filePath: string): Promise<FfprobeResult> {
	const { stdout } = await execFileAsync(
		resolveFfprobeBinary(),
		["-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath],
		{ ...HIDDEN_WINDOW, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
	);
	return JSON.parse(stdout) as FfprobeResult;
}

export async function waitForJson<T>(
	filePath: string,
	timeoutMs: number,
	intervalMs = 500,
): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	let lastError: unknown = null;
	while (Date.now() < deadline) {
		try {
			return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
		} catch (error) {
			lastError = error;
		}
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}
	throw new Error(`Timed out after ${timeoutMs}ms waiting for ${filePath}: ${String(lastError)}`);
}

/**
 * The Electron binary to spawn.
 *
 * `_electron.launch()` is not used: it passes `--remote-debugging-port=0` on the
 * command line, which Chromium 132+ rejects (Electron 42 and newer), so the app
 * is started directly and attached to over CDP.
 */
export function resolveElectronBinary(): string {
	const distDirectory = path.join(repoRoot, "node_modules", "electron", "dist");
	const candidates =
		process.platform === "darwin"
			? [path.join(distDirectory, "Electron.app", "Contents", "MacOS", "Electron")]
			: [
					path.join(
						distDirectory,
						process.platform === "win32" ? "electron.exe" : "electron",
					),
				];

	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	throw new Error(`Electron binary not found under ${distDirectory}. Run \`npm install\` first.`);
}

/** A free local port, so parallel runs never collide on the debug endpoint. */
export async function pickFreePort(): Promise<number> {
	const net = await import("node:net");
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.unref();
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : 0;
			server.close(() => (port ? resolve(port) : reject(new Error("No free port found"))));
		});
	});
}

export async function waitForCdpEndpoint(port: number, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	let lastError: unknown = null;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`http://127.0.0.1:${port}/json/version`);
			if (response.ok) {
				return;
			}
			lastError = new Error(`HTTP ${response.status}`);
		} catch (error) {
			lastError = error;
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`CDP endpoint on port ${port} never became ready: ${String(lastError)}`);
}
