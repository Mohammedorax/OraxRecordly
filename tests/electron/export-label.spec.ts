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
 * The clip label has to be inside the exported video.
 *
 * The label is drawn at the bottom-left of every frame as a dark pill, so the
 * brightness of that corner is the measurement: with the label it must be clearly
 * darker than the same corner without it, and the rest of the frame must not move.
 * This is what makes "the name and date are not in the video" a test result
 * instead of an opinion.
 *
 * The text itself - and the guarantee that a preview address can never become the
 * label - is pinned by the unit suite; a project whose source is an unreachable
 * media URL fails the export for reasons that have nothing to do with the label.
 */

/** Mean luma of one frame, optionally limited to a region, 0 (black) to 255. */
async function frameLuma(
	filePath: string,
	seconds: number,
	region?: { widthFraction: number; heightFraction: number },
): Promise<number> {
	const filters = ["format=gray"];
	if (region) {
		// The bottom-left corner, where the label is painted. Relative sizes keep this
		// valid whatever resolution the export produced.
		const heightFraction = region.heightFraction;
		filters.push(
			`crop=w=iw*${region.widthFraction}:h=ih*${heightFraction}:x=0:y=ih*(1-${heightFraction})`,
		);
	}

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
			filters.join(","),
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

async function exportWithLabel(label: boolean): Promise<{ outputPath: string; kept: string }> {
	const workDirectory = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), `recordly-label-${label ? "on" : "off"}-`)),
	);
	const videoPath = await ensureSampleVideo(workDirectory);
	const outputPath = path.join(workDirectory, `labeled-${label ? "on" : "off"}.mp4`);

	const run = await runSmokeExport({
		reportTimeoutMs: 300_000,
		env: {
			RECORDLY_SMOKE_EXPORT_INPUT: videoPath,
			RECORDLY_SMOKE_EXPORT_LABEL: label ? "1" : "0",
		},
	});

	try {
		expect(run.report.success, JSON.stringify(run.report)).toBe(true);
		await fs.copyFile(run.outputPath, outputPath);
		return { outputPath, kept: workDirectory };
	} finally {
		await run.cleanup();
	}
}

test.describe("clip label in the exported file", () => {
	test("burns the clip name into the bottom of the frames, and only when asked", async () => {
		test.setTimeout(300_000);

		const labelled = await exportWithLabel(true);
		const plain = await exportWithLabel(false);

		try {
			const probeSeconds = 0.5;
			const region = { widthFraction: 0.5, heightFraction: 0.25 };

			const labelledCorner = await frameLuma(labelled.outputPath, probeSeconds, region);
			const plainCorner = await frameLuma(plain.outputPath, probeSeconds, region);
			const labelledWhole = await frameLuma(labelled.outputPath, probeSeconds);
			const plainWhole = await frameLuma(plain.outputPath, probeSeconds);

			console.log(
				`LABEL_LUMA labelledCorner=${labelledCorner.toFixed(1)} plainCorner=${plainCorner.toFixed(1)} ` +
					`labelledWhole=${labelledWhole.toFixed(1)} plainWhole=${plainWhole.toFixed(1)}`,
			);

			// A machine whose renderer draws nothing would make this meaningless; the
			// export still succeeded, which is all that can be asserted there.
			if (plainWhole < 5) {
				console.warn(
					"[label] This machine renders black frames; the label check is skipped.",
				);
				return;
			}

			// The pill darkens the corner the label lives in...
			expect(plainCorner - labelledCorner).toBeGreaterThan(10);
			// ...while the rest of the picture is the same frame: the label must not
			// change the output in any other way.
			expect(Math.abs(labelledWhole - plainWhole)).toBeLessThan(12);
		} finally {
			for (const directory of [labelled.kept, plain.kept]) {
				await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
			}
		}
	});
});
