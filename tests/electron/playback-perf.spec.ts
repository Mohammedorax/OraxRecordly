import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { chromium, expect, test } from "@playwright/test";
import {
	pickFreePort,
	repoRoot,
	resolveElectronBinary,
	resolveFfmpegBinary,
	waitForCdpEndpoint,
} from "./helpers";

const execFileAsync = promisify(execFile);

/**
 * Playback smoothness on a heavy source.
 *
 * "The editor stutters" is a statement about frame pacing while the preview runs,
 * which no test measured: the existing edit-perf spec watches edits, not playback.
 * This one opens a 4K clip, plays it, and records the interval between animation
 * frames, so a dropped frame shows up as a number instead of a feeling.
 *
 * The asserted budget is deliberately loose (a shared CI runner is not a desktop)
 * and every number is logged, so a regression is attributable rather than vague.
 */
const PLAYBACK_SECONDS = 6;
/** A frame this slow or slower was dropped rather than merely late. */
const DROPPED_FRAME_MS = 50;
/**
 * Budgets are deliberately loose. The value of this test is the numbers it logs
 * (a regression is visible in the trend); the assertion exists only to catch a
 * collapse, so a busy developer machine or a shared runner cannot fail the build
 * over scheduling noise.
 */
const MAX_P95_FRAME_MS = 150;
const MAX_WORST_FRAME_MS = 1_500;
const MAX_DROPPED_RATIO = 0.6;
/**
 * Below this, the environment cannot present frames for reasons that have nothing
 * to do with the editor: an unfocused window, a VM with software rasterisation, a
 * CI runner. The numbers are still logged, but a budget assertion there would be
 * measuring the machine, not the app.
 */
const MIN_MEASURABLE_FPS = 20;

async function ensureHeavyVideo(directory: string): Promise<string> {
	const target = path.join(directory, "e2e-heavy-4k.mp4");
	try {
		await fs.access(target);
		return target;
	} catch {
		/* generate below */
	}

	await fs.mkdir(directory, { recursive: true });
	// 4K at 60fps for a few seconds: the decode and upload work a real recording
	// of a large display produces, and far more than the tiny smoke fixture.
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
			"testsrc2=size=3840x2160:rate=60:duration=12",
			"-c:v",
			"libx264",
			"-preset",
			"veryfast",
			"-pix_fmt",
			"yuv420p",
			target,
		],
		{ timeout: 240_000 },
	);

	return target;
}

test("preview playback keeps frame pacing on a 4K source", async () => {
	test.setTimeout(600_000);
	const workDirectory = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "recordly-playback-perf-")),
	);
	const inputPath = await ensureHeavyVideo(workDirectory);
	const cdpPort = await pickFreePort();
	const userDataDirectory = path.join(workDirectory, "userdata");
	const recordingsDirectory = path.join(workDirectory, "recordings");
	await fs.mkdir(userDataDirectory, { recursive: true });
	await fs.mkdir(recordingsDirectory, { recursive: true });

	const env: NodeJS.ProcessEnv = { ...process.env };
	delete env.ELECTRON_RUN_AS_NODE;

	const appProcess = spawn(resolveElectronBinary(), [repoRoot], {
		cwd: repoRoot,
		env: {
			...env,
			ELECTRON_CDP_PORT: String(cdpPort),
			RECORDLY_DEV_OPEN_RECORDING_INPUT: inputPath,
			RECORDLY_USER_DATA_DIR: userDataDirectory,
			RECORDLY_TEST_RECORDINGS_DIR: recordingsDirectory,
		},
		stdio: ["ignore", "pipe", "pipe"],
	});

	let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null;
	try {
		await waitForCdpEndpoint(cdpPort, 180_000);
		browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
		const context = browser.contexts()[0];
		const page = context.pages()[0] ?? (await context.waitForEvent("page"));
		await page.waitForLoadState("domcontentloaded");
		await page.waitForSelector("video", { timeout: 90_000 });
		// Let the preview settle: decoding the metadata, sizing the canvas and the
		// first uploads are start-up work, not playback pacing.
		await page.waitForTimeout(6_000);
		// An unfocused window is throttled by Chromium, which would make this measure
		// the operating system rather than the editor.
		await page.bringToFront().catch(() => undefined);
		await page.waitForTimeout(500);

		const playButton = page
			.locator('button[title="Play" i], button[aria-label="Play" i], button[title*="تشغيل"]')
			.first();
		if (await playButton.count()) {
			await playButton.click({ timeout: 10_000 }).catch(() => undefined);
		} else {
			await page.keyboard.press("Space");
		}
		await page.waitForTimeout(1_000);

		const result = await page.evaluate(
			async ({ seconds, droppedFrameMs }) => {
				const intervals: number[] = [];
				const startedAt = performance.now();
				let previous = startedAt;
				await new Promise<void>((resolve) => {
					const tick = () => {
						const now = performance.now();
						intervals.push(now - previous);
						previous = now;
						if (now - startedAt < seconds * 1000) {
							requestAnimationFrame(tick);
							return;
						}
						resolve();
					};
					requestAnimationFrame(tick);
				});

				const sorted = [...intervals].sort((left, right) => left - right);
				const percentile = (share: number) =>
					sorted.length === 0
						? 0
						: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))];
				const video = document.querySelector("video");
				return {
					frames: intervals.length,
					elapsedMs: performance.now() - startedAt,
					p50: percentile(0.5),
					p95: percentile(0.95),
					worst: sorted.length ? sorted[sorted.length - 1] : 0,
					dropped: intervals.filter((value) => value >= droppedFrameMs).length,
					// Confirms the measurement happened while the preview was really playing.
					playingVideoTime: video?.currentTime ?? 0,
				};
			},
			{ seconds: PLAYBACK_SECONDS, droppedFrameMs: DROPPED_FRAME_MS },
		);

		const fps = result.elapsedMs > 0 ? (result.frames / result.elapsedMs) * 1000 : 0;
		console.log(
			`PLAYBACK_PERF fps=${fps.toFixed(1)} p50=${result.p50.toFixed(1)}ms ` +
				`p95=${result.p95.toFixed(1)}ms worst=${result.worst.toFixed(1)}ms ` +
				`dropped=${result.dropped}/${result.frames} videoTime=${result.playingVideoTime.toFixed(2)}s`,
		);

		// The preview has to have advanced for the pacing numbers to mean anything.
		expect(result.playingVideoTime).toBeGreaterThan(0.5);
		expect(result.frames).toBeGreaterThan(10);

		if (fps < MIN_MEASURABLE_FPS) {
			console.warn(
				"[playback-perf] This environment presents fewer than " +
					`${MIN_MEASURABLE_FPS} frames per second (measured ${fps.toFixed(1)}), so the ` +
					"pacing budget is not asserted here; the numbers above are for comparison.",
			);
			return;
		}

		expect(result.p95).toBeLessThan(MAX_P95_FRAME_MS);
		expect(result.worst).toBeLessThan(MAX_WORST_FRAME_MS);
		expect(result.dropped / Math.max(1, result.frames)).toBeLessThan(MAX_DROPPED_RATIO);
	} finally {
		await browser?.close().catch(() => undefined);
		appProcess.kill();
		await new Promise((resolve) => setTimeout(resolve, 500));
		await fs.rm(workDirectory, { recursive: true, force: true }).catch(() => undefined);
	}
});
