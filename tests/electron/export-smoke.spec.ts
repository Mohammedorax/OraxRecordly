import fs from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { probeMedia } from "./helpers";
import { runSmokeExport } from "./smokeExport";

/**
 * What this covers that nothing else does.
 *
 * `tests/ui` drives the renderer in a browser, and the vitest suites mock the
 * bridge, so neither proves that the shipped application can boot, decode,
 * encode, mux and write a real file. This spec launches `dist-electron/main.cjs`
 * through the app's own automation entry point (`RECORDLY_SMOKE_EXPORT`) and
 * checks the artifact on disk with ffprobe.
 *
 * Known limit: a native console window (the bug behind `childProcess.ts`) is not
 * a BrowserWindow, so it is invisible over CDP. That class of regression is
 * guarded by `electron/childProcessWindowsHide.test.ts`; this spec guards the
 * pipeline it used to be attached to.
 */
test.describe("Electron end-to-end export", () => {
	test("boots the app, renders, and writes a playable MP4", async () => {
		const run = await runSmokeExport();

		try {
			expect(run.report.success, JSON.stringify(run.report)).toBe(true);
			expect(run.report.phase).toBe("saved");
			// A copy of the input would satisfy the file checks below; these prove an
			// encoder actually ran and produced the frames.
			expect(run.report.format).toBe("mp4");
			expect(run.report.pipelineModel).toBe("modern");
			expect(run.report.metrics?.frameCount ?? 0).toBeGreaterThan(0);
			expect(run.report.metrics?.encodeBackend ?? "").not.toBe("");
			expect(run.report.metrics?.effectiveDurationSec ?? 0).toBeGreaterThan(1);

			const stats = await fs.stat(run.outputPath);
			expect(stats.size).toBeGreaterThan(10_000);

			// The artifact must be a real, playable file — not just bytes on disk.
			const probe = await probeMedia(run.outputPath);
			const videoStream = probe.streams.find((stream) => stream.codec_type === "video");
			expect(videoStream, JSON.stringify(probe.streams)).toBeTruthy();
			expect(videoStream?.width ?? 0).toBeGreaterThan(0);
			expect(videoStream?.height ?? 0).toBeGreaterThan(0);
			expect(probe.streams.some((stream) => stream.codec_type === "audio")).toBe(true);
			const durationSeconds = Number(probe.format.duration);
			expect(durationSeconds).toBeGreaterThan(1);
			expect(durationSeconds).toBeLessThan(4);
		} finally {
			await run.cleanup();
		}
	});
});
