import fs from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { probeMedia } from "./helpers";
import { runSmokeExport } from "./smokeExport";

/**
 * Stability of the two renderer paths.
 *
 * Both pipelines draw through Pixi (WebGL/WebGPU), and a machine without a
 * usable context used to fail the whole export with
 * "No supported Pixi modern renderer was available" — which is what a CI runner
 * and any virtual machine reported. Three cases are pinned here:
 *
 *  1. software rendering (`--disable-gpu`, what a VM or a blocklisted driver
 *     looks like): the app must still export, because Chromium is allowed to
 *     fall back to SwiftShader;
 *  2. a machine where the modern renderer cannot start: the export must downgrade
 *     to the legacy pipeline by itself instead of failing;
 *  3. the legacy pipeline chosen by the user: it must work on its own.
 *
 * Each case asserts the artifact is a real playable file, so a "success" that
 * produced nothing cannot pass.
 */
async function expectPlayableExport(outputPath: string) {
	const stats = await fs.stat(outputPath);
	expect(stats.size).toBeGreaterThan(10_000);

	const probe = await probeMedia(outputPath);
	const videoStream = probe.streams.find((stream) => stream.codec_type === "video");
	expect(videoStream, JSON.stringify(probe.streams)).toBeTruthy();
	expect(videoStream?.width ?? 0).toBeGreaterThan(0);
	expect(probe.streams.some((stream) => stream.codec_type === "audio")).toBe(true);
	const durationSeconds = Number(probe.format.duration);
	expect(durationSeconds).toBeGreaterThan(1);
	expect(durationSeconds).toBeLessThan(4);
}

test.describe("export renderer fallbacks", () => {
	test("keeps exporting when only software rendering is available", async () => {
		const run = await runSmokeExport({ electronArgs: ["--disable-gpu"] });

		try {
			expect(run.report.success, JSON.stringify(run.report)).toBe(true);
			expect(run.report.metrics?.frameCount ?? 0).toBeGreaterThan(0);
			await expectPlayableExport(run.outputPath);
		} finally {
			await run.cleanup();
		}
	});

	test("downgrades to the legacy pipeline when no modern renderer starts", async () => {
		const run = await runSmokeExport({
			env: { RECORDLY_SMOKE_EXPORT_FAIL_RENDERER: "1" },
		});

		try {
			expect(run.report.success, JSON.stringify(run.report)).toBe(true);
			// The report names the pipeline that actually produced the file, so this
			// asserts the downgrade really happened rather than a lucky first try.
			expect(run.report.pipelineModel).toBe("legacy");
			expect(run.report.phase).toBe("saved");
			expect(run.report.metrics?.frameCount ?? 0).toBeGreaterThan(0);
			await expectPlayableExport(run.outputPath);
		} finally {
			await run.cleanup();
		}
	});

	test("exports through the legacy pipeline when it is selected", async () => {
		const run = await runSmokeExport({
			env: { RECORDLY_SMOKE_EXPORT_PIPELINE: "legacy" },
		});

		try {
			expect(run.report.success, JSON.stringify(run.report)).toBe(true);
			expect(run.report.pipelineModel).toBe("legacy");
			await expectPlayableExport(run.outputPath);
		} finally {
			await run.cleanup();
		}
	});
});
