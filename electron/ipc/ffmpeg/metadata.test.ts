import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	execFile: vi.fn(),
}));

vi.mock("node:child_process", () => ({ execFile: mocks.execFile }));

const FFMPEG_OUTPUT = [
	"ffmpeg version 6.0",
	"  Duration: 00:00:02.00, start: 0.000000, bitrate: 100 kb/s",
	"  Stream #0:0: Video: h264 (High), yuv420p, 1920x1080, 30 fps, 30 tbr, 15360 tbn",
].join("\n");

const tempDirs: string[] = [];

async function makeVideoFile(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-metadata-"));
	tempDirs.push(dir);
	const filePath = path.join(dir, "recording.mp4");
	await fs.writeFile(filePath, "fake-video-bytes");
	return filePath;
}

describe("native video metadata probe cache", () => {
	beforeEach(() => {
		vi.resetModules();
		mocks.execFile.mockReset();
		mocks.execFile.mockImplementation(
			(
				_command: string,
				_args: string[],
				_options: unknown,
				callback: (error: unknown, result: unknown) => void,
			) => {
				callback(null, { stdout: "", stderr: FFMPEG_OUTPUT });
			},
		);
	});

	afterEach(async () => {
		await Promise.all(
			tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
		);
		vi.resetModules();
	});

	it("probes ffmpeg once for repeated reads of the same unchanged file", async () => {
		const { probeNativeVideoMetadata } = await import("./metadata");
		const filePath = await makeVideoFile();

		const first = await probeNativeVideoMetadata("ffmpeg.exe", filePath);
		const second = await probeNativeVideoMetadata("ffmpeg.exe", filePath);

		expect(first).toEqual(second);
		expect(first.width).toBe(1920);
		expect(first.duration).toBe(2);
		expect(mocks.execFile).toHaveBeenCalledTimes(1);
	});

	it("re-probes after the file changes on disk", async () => {
		const { probeNativeVideoMetadata } = await import("./metadata");
		const filePath = await makeVideoFile();

		await probeNativeVideoMetadata("ffmpeg.exe", filePath);
		await fs.writeFile(filePath, "different-bytes-entirely");
		await fs.utimes(filePath, new Date(), new Date(Date.now() + 5_000));

		await probeNativeVideoMetadata("ffmpeg.exe", filePath);
		expect(mocks.execFile).toHaveBeenCalledTimes(2);
	});

	it("can be cleared explicitly", async () => {
		const { probeNativeVideoMetadata, clearNativeVideoMetadataCache } = await import(
			"./metadata"
		);
		const filePath = await makeVideoFile();

		await probeNativeVideoMetadata("ffmpeg.exe", filePath);
		clearNativeVideoMetadataCache();
		await probeNativeVideoMetadata("ffmpeg.exe", filePath);

		expect(mocks.execFile).toHaveBeenCalledTimes(2);
	});
});
