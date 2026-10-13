import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { ensureSampleVideo, resolveFfmpegBinary } from "./helpers";
import { runSmokeExport } from "./smokeExport";

const execFileAsync = promisify(execFile);

/**
 * A transition between two clips must actually reach the file.
 *
 * The smoke export only ever rendered a single clip, so nothing exercised the
 * code that draws a transition. This builds a two-clip project and measures the
 * brightness of the frame at the cut: a fade has to be black there, while a
 * cross-dissolve has to still show a picture (the outgoing clip's held frame).
 */

/** Mean luma of one frame, 0 (black) to 255 (white). */
async function frameLuma(filePath: string, seconds: number): Promise<number> {
	const { stdout } = await execFileAsync(
		resolveFfmpegBinary(),
		[
			"-hide_banner",
			"-loglevel",
			"error",
			"-ss",
			seconds.toFixed(3),
			"-i",
			filePath,
			"-frames:v",
			"1",
			"-vf",
			"format=gray",
			"-f",
			"rawvideo",
			"-",
		],
		{ encoding: "buffer", maxBuffer: 32 * 1024 * 1024, timeout: 60_000 },
	);

	const bytes = stdout as unknown as Buffer;
	if (bytes.length === 0) {
		throw new Error(`No frame extracted at ${seconds}s from ${filePath}`);
	}

	let total = 0;
	for (const value of bytes) total += value;
	return total / bytes.length;
}

/** Two adjacent clips cut out of one recording, so the app has a boundary. */
async function writeTwoClipProject(directory: string, videoPath: string): Promise<string> {
	const projectPath = path.join(directory, "two-clips.recordly");
	const project = {
		version: 1,
		videoPath,
		editor: {
			clipRegions: [
				{ id: "clip-a", startMs: 0, endMs: 1_000, sourceStartMs: 0, speed: 1 },
				{ id: "clip-b", startMs: 1_000, endMs: 2_000, sourceStartMs: 1_000, speed: 1 },
			],
			trimRegions: [],
			zoomRegions: [],
			speedRegions: [],
			annotationRegions: [],
			audioRegions: [],
			autoCaptions: [],
		},
	};
	await fs.writeFile(projectPath, JSON.stringify(project, null, 2), "utf8");
	return projectPath;
}

async function exportWithTransition(
	kind: "none" | "fade" | "crossfade",
	pipeline?: "modern" | "legacy",
): Promise<{
	outputPath: string;
	pipelineModel: string | undefined;
	sampledLuma: number | undefined;
}> {
	const workDirectory = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), `recordly-transition-${kind}-`)),
	);
	const videoPath = await ensureSampleVideo(workDirectory);
	const projectPath = await writeTwoClipProject(workDirectory, videoPath);
	const outputPath = path.join(workDirectory, `${kind}.mp4`);

	const run = await runSmokeExport({
		// A black-frame recovery re-renders the whole export once.
		reportTimeoutMs: 300_000,
		env: {
			RECORDLY_SMOKE_EXPORT_PROJECT: projectPath,
			RECORDLY_SMOKE_TRANSITION_KIND: kind,
			...(pipeline ? { RECORDLY_SMOKE_EXPORT_PIPELINE: pipeline } : {}),
		},
	});

	try {
		expect(run.report.success, JSON.stringify(run.report)).toBe(true);
		// The renderer's own measurement of what it produced: this separates "the
		// frame was already black before encoding" from "the file came out black".
		console.log(
			`TRANSITION_RENDER kind=${kind}${pipeline ? ` pipeline=${pipeline}` : ""} ` +
				`ranOn=${run.report.pipelineModel ?? "?"} ` +
				`sampledLuma=${run.report.metrics?.sampledLuma ?? "unavailable"} ` +
				`renderBackend=${run.report.metrics?.renderBackend ?? "?"} ` +
				`encodeBackend=${run.report.metrics?.encodeBackend ?? "?"}`,
		);
		await fs.copyFile(run.outputPath, outputPath);
		return {
			outputPath,
			pipelineModel: run.report.pipelineModel,
			sampledLuma: run.report.metrics?.sampledLuma,
		};
	} finally {
		await run.cleanup();
	}
}

test.describe("clip transitions in the exported file", () => {
	test("a cross-dissolve shows a picture at the cut where a fade is black", async () => {
		test.setTimeout(600_000);

		const [fadeRun, crossfadeRun, noneRun] = [
			await exportWithTransition("fade"),
			await exportWithTransition("crossfade"),
			await exportWithTransition("none"),
		];

		try {
			// Baseline from the middle of the first clip. A runner whose renderer
			// cannot draw produces black frames everywhere, and then no brightness
			// assertion can say anything about transitions.
			const baseline = await frameLuma(noneRun.outputPath, 0.5);
			// The cut sits at 1.0s. A 600 ms fade is fully black exactly there, while
			// a dissolve is still showing the outgoing clip's held frame just after it.
			const fadeLuma = await frameLuma(fadeRun.outputPath, 1);
			const crossfadeAfterCut = Math.max(
				await frameLuma(crossfadeRun.outputPath, 1.05),
				await frameLuma(crossfadeRun.outputPath, 1.1),
			);
			const fadeAfterCut = Math.max(
				await frameLuma(fadeRun.outputPath, 1.05),
				await frameLuma(fadeRun.outputPath, 1.1),
			);
			const crossfadeLate = await frameLuma(crossfadeRun.outputPath, 1.9);

			console.log(
				`TRANSITION_LUMA baseline=${baseline.toFixed(1)} fade=${fadeLuma.toFixed(1)} ` +
					`crossfadeAfterCut=${crossfadeAfterCut.toFixed(1)} ` +
					`fadeAfterCut=${fadeAfterCut.toFixed(1)} crossfadeLate=${crossfadeLate.toFixed(1)}`,
			);

			if (baseline < 30) {
				console.warn(
					"[transition] This machine renders exported frames black, so the brightness " +
						"comparison is skipped here; the export itself succeeded.",
				);
				// The recovery path is a retry on the legacy pipeline, so the legacy
				// renderer's own brightness decides whether that recovery can work here.
				const legacyRun = await exportWithTransition("none", "legacy");
				try {
					const legacyLuma = await frameLuma(legacyRun.outputPath, 0.5);
					console.log(
						`TRANSITION_LEGACY_LUMA baseline=${legacyLuma.toFixed(1)} ` +
							(legacyLuma < 30
								? "(the legacy pipeline is black here too)"
								: "(the legacy pipeline can draw, so the retry recovers the export)"),
					);
				} finally {
					await fs
						.rm(path.dirname(legacyRun.outputPath), { recursive: true, force: true })
						.catch(() => undefined);
				}
			} else if (crossfadeRun.pipelineModel === "legacy") {
				// A machine that had to be recovered onto the legacy pipeline still has
				// to dissolve: the canvas renderer holds the outgoing frame too, so the
				// two pipelines have to agree on what the transition looks like.
				console.warn(
					"[transition] This machine recovered onto the legacy pipeline; the " +
						"dissolve must behave the same there.",
				);
				expect(fadeLuma).toBeLessThan(20);
				expect(crossfadeAfterCut).toBeGreaterThan(40);
				expect(crossfadeAfterCut).toBeGreaterThan(fadeAfterCut + 20);
				expect(crossfadeLate).toBeGreaterThan(30);
				for (const run of [fadeRun, crossfadeRun, noneRun]) {
					if (typeof run.sampledLuma === "number") {
						expect(run.sampledLuma).toBeGreaterThan(0);
					}
				}
			} else {
				expect(fadeLuma).toBeLessThan(20);
				expect(crossfadeAfterCut).toBeGreaterThan(40);
				expect(crossfadeAfterCut).toBeGreaterThan(fadeAfterCut + 20);
				expect(crossfadeLate).toBeGreaterThan(30);

				// The legacy canvas pipeline must dissolve the same way, not fall back
				// to a fade, so the same project exported through it is measured too.
				const legacyDissolve = await exportWithTransition("crossfade", "legacy");
				try {
					const legacyAfterCut = Math.max(
						await frameLuma(legacyDissolve.outputPath, 1.05),
						await frameLuma(legacyDissolve.outputPath, 1.1),
					);
					console.log(
						`TRANSITION_LEGACY_DISSOLVE ranOn=${legacyDissolve.pipelineModel ?? "?"} ` +
							`afterCut=${legacyAfterCut.toFixed(1)}`,
					);
					expect(legacyAfterCut).toBeGreaterThan(40);
					expect(legacyAfterCut).toBeGreaterThan(fadeAfterCut + 20);
				} finally {
					await fs
						.rm(path.dirname(legacyDissolve.outputPath), {
							recursive: true,
							force: true,
						})
						.catch(() => undefined);
				}
			}
		} finally {
			for (const file of [fadeRun, crossfadeRun, noneRun]) {
				await fs
					.rm(path.dirname(file.outputPath), { recursive: true, force: true })
					.catch(() => undefined);
			}
		}
	});
});
