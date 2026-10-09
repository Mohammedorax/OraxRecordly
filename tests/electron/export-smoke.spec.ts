import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, expect, test } from "@playwright/test";
import {
	ensureSampleVideo,
	pickFreePort,
	probeMedia,
	repoRoot,
	resolveElectronBinary,
	waitForCdpEndpoint,
	waitForJson,
} from "./helpers";

/**
 * What this covers that nothing else does.
 *
 * `tests/ui` drives the renderer in a browser, and the vitest suites mock the
 * bridge, so neither proves that the shipped application can boot, decode,
 * encode, mux and write a real file. This spec launches `dist-electron/main.cjs`
 * through the app's own automation entry point (`RECORDLY_SMOKE_EXPORT`) and
 * checks the artifact on disk with ffprobe.
 *
 * The app is spawned directly instead of with Playwright's `_electron.launch()`:
 * that helper passes `--remote-debugging-port=0` on the command line, which
 * Chromium 132+ (Electron 42+) refuses, so `main.ts` registers the switch from
 * `ELECTRON_CDP_PORT` and the test connects over CDP.
 *
 * Known limit: a native console window (the bug behind `childProcess.ts`) is not
 * a BrowserWindow, so it is invisible to CDP. That class of regression is guarded
 * by `electron/childProcessWindowsHide.test.ts`; this spec guards the pipeline it
 * used to be attached to.
 */
type SmokeExportReport = {
	success?: boolean;
	phase?: string;
	error?: string;
	outputPath?: string;
	elapsedMs?: number;
	format?: string;
	pipelineModel?: string;
	backendPreference?: string;
	metrics?: {
		frameCount?: number;
		renderBackend?: string;
		encodeBackend?: string;
		encoderName?: string;
		effectiveDurationSec?: number;
	};
};

const MAIN_ENTRY = path.join(repoRoot, "dist-electron", "main.cjs");

test.describe("Electron end-to-end export", () => {
	test.skip(
		!existsSync(MAIN_ENTRY),
		`Missing ${MAIN_ENTRY}. Run \`npm run build:app\` (or \`npm run test:e2e\`) first.`,
	);

	test("boots the app, renders, and writes a playable MP4", async () => {
		const workDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-e2e-"));
		const samplePath = await ensureSampleVideo(workDirectory);
		const outputPath = path.join(workDirectory, "e2e-export.mp4");
		const reportPath = `${outputPath}.report.json`;
		const cdpPort = await pickFreePort();

		// Playwright's runner marks Electron as a Node process; inheriting that
		// makes the spawned app boot as Node and never open a window.
		const childEnv: NodeJS.ProcessEnv = { ...process.env };
		delete childEnv.ELECTRON_RUN_AS_NODE;

		const appProcess: ChildProcess = spawn(resolveElectronBinary(), [repoRoot], {
			cwd: repoRoot,
			env: {
				...childEnv,
				ELECTRON_CDP_PORT: String(cdpPort),
				RECORDLY_SMOKE_EXPORT: "1",
				RECORDLY_SMOKE_EXPORT_INPUT: samplePath,
				RECORDLY_SMOKE_EXPORT_OUTPUT: outputPath,
				RECORDLY_SMOKE_EXPORT_QUALITY: "medium",
				RECORDLY_SMOKE_EXPORT_FPS: "24",
			},
			stdio: ["ignore", "pipe", "pipe"],
		});

		const mainLog: string[] = [];
		appProcess.stdout?.on("data", (chunk) => mainLog.push(String(chunk)));
		appProcess.stderr?.on("data", (chunk) => mainLog.push(String(chunk)));

		let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null;
		try {
			await waitForCdpEndpoint(cdpPort, 120_000);
			browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);

			const context = browser.contexts()[0];
			expect(context, "the app should expose a browser context over CDP").toBeTruthy();
			const page = context.pages()[0] ?? (await context.waitForEvent("page"));
			await page.waitForLoadState("domcontentloaded");

			let report: SmokeExportReport;
			try {
				report = await waitForJson<SmokeExportReport>(reportPath, 240_000);
			} catch (error) {
				throw new Error(
					`${String(error)}\n--- main process output ---\n${mainLog.join("")}`,
				);
			}

			expect(report.success, JSON.stringify(report)).toBe(true);
			expect(report.phase).toBe("saved");
			// A copy of the input would satisfy the file checks below; these prove an
			// encoder actually ran and produced the frames.
			expect(report.format).toBe("mp4");
			expect(report.metrics?.frameCount ?? 0).toBeGreaterThan(0);
			expect(report.metrics?.encodeBackend ?? "").not.toBe("");
			expect(report.metrics?.effectiveDurationSec ?? 0).toBeGreaterThan(1);

			const stats = await fs.stat(outputPath);
			expect(stats.size).toBeGreaterThan(10_000);

			// The artifact must be a real, playable file — not just bytes on disk.
			const probe = await probeMedia(outputPath);
			const videoStream = probe.streams.find((stream) => stream.codec_type === "video");
			expect(videoStream, JSON.stringify(probe.streams)).toBeTruthy();
			expect(videoStream?.width ?? 0).toBeGreaterThan(0);
			expect(videoStream?.height ?? 0).toBeGreaterThan(0);
			expect(probe.streams.some((stream) => stream.codec_type === "audio")).toBe(true);
			const durationSeconds = Number(probe.format.duration);
			expect(durationSeconds).toBeGreaterThan(1);
			expect(durationSeconds).toBeLessThan(4);
		} finally {
			await browser?.close().catch(() => undefined);
			appProcess.kill();
			// The smoke run closes its own window, but never leave a stray process.
			await new Promise((resolve) => setTimeout(resolve, 500));
			if (!appProcess.killed) {
				appProcess.kill("SIGKILL");
			}
			await fs.rm(workDirectory, { recursive: true, force: true }).catch(() => undefined);
		}
	});
});
