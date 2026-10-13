import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, expect, test } from "@playwright/test";
import {
	ensureSampleVideo,
	pickFreePort,
	repoRoot,
	resolveElectronBinary,
	waitForCdpEndpoint,
} from "./helpers";

/**
 * Editing responsiveness.
 *
 * The editor is expected to stay interactive while clips are cut, zooms are
 * added and the timeline changes: no multi-second blocking task, and frames keep
 * being produced. The numbers are logged so a regression can be attributed, and
 * only a catastrophic bound is asserted so a slow CI runner cannot fail the
 * build on timing noise.
 */
const MAX_SINGLE_LONG_TASK_MS = 3_000;
const EDIT_STEPS = 10;

test("editor stays responsive while editing", async () => {
	test.setTimeout(300_000);
	const workDirectory = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "recordly-perf-")),
	);
	const inputPath = await ensureSampleVideo(workDirectory);
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
		await waitForCdpEndpoint(cdpPort, 120_000);
		browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
		const context = browser.contexts()[0];
		const page = context.pages()[0] ?? (await context.waitForEvent("page"));
		await page.waitForLoadState("domcontentloaded");

		// Wait for the editor preview to be mounted before measuring.
		await page.waitForSelector("video", { timeout: 60_000 });
		await page.waitForTimeout(4_000);

		await page.evaluate(() => {
			const state: { longTasks: number[]; frames: number; startedAt: number } = {
				longTasks: [],
				frames: 0,
				startedAt: performance.now(),
			};
			(window as unknown as { __perf: typeof state }).__perf = state;
			try {
				const observer = new PerformanceObserver((list) => {
					for (const entry of list.getEntries()) {
						state.longTasks.push(entry.duration);
					}
				});
				observer.observe({ entryTypes: ["longtask"] });
			} catch {
				/* longtask is not supported on every Chromium build. */
			}
			const tick = () => {
				state.frames += 1;
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		});

		const measureStart = await page.evaluate(() => {
			const state = (
				window as unknown as { __perf?: { longTasks: number[]; frames: number } }
			).__perf;
			// The window starts here: frames and long tasks counted during the warm-up
			// must not be attributed to the edits being measured.
			if (state) {
				state.longTasks.length = 0;
				state.frames = 0;
			}
			return performance.now();
		});
		// Add zooms and split the clip through the editor's own toolbar buttons.
		for (let step = 0; step < EDIT_STEPS; step += 1) {
			const addZoom = page.locator('button[title*="zoom" i], button[title*="تكبير"]').first();
			const split = page.locator('button[title*="split" i], button[title*="تقسيم"]').first();
			if (await split.count()) {
				await split.click({ timeout: 5_000 }).catch(() => undefined);
			}
			if (await addZoom.count()) {
				await addZoom.click({ timeout: 5_000 }).catch(() => undefined);
			}
			await page.waitForTimeout(120);
		}
		const elapsedMs = (await page.evaluate(() => performance.now())) - measureStart;

		const perf = await page.evaluate(() => {
			const state = (
				window as unknown as { __perf?: { longTasks: number[]; frames: number } }
			).__perf;
			const tasks = state?.longTasks ?? [];
			return {
				longTaskCount: tasks.length,
				longestTaskMs: tasks.length ? Math.max(...tasks) : 0,
				totalBlockingMs: tasks.reduce((total, value) => total + value, 0),
				frames: state?.frames ?? 0,
			};
		});

		const fps = perf.frames > 0 ? (perf.frames / elapsedMs) * 1000 : 0;
		console.log(
			`EDIT_PERF elapsedMs=${Math.round(elapsedMs)} steps=${EDIT_STEPS} ` +
				`longTasks=${perf.longTaskCount} longestMs=${Math.round(perf.longestTaskMs)} ` +
				`totalBlockingMs=${Math.round(perf.totalBlockingMs)} fps=${fps.toFixed(1)}`,
		);

		expect(perf.longestTaskMs).toBeLessThan(MAX_SINGLE_LONG_TASK_MS);
	} finally {
		await browser?.close().catch(() => undefined);
		appProcess.kill();
		await new Promise((resolve) => setTimeout(resolve, 500));
		await fs.rm(workDirectory, { recursive: true, force: true }).catch(() => undefined);
	}
});
