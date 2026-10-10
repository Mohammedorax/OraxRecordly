import { type ChildProcess, spawn } from "node:child_process";
import { closeSync, existsSync, openSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import {
	ensureSampleVideo,
	pickFreePort,
	repoRoot,
	resolveElectronBinary,
	waitForCdpEndpoint,
	waitForJson,
} from "./helpers";

/**
 * One automated export through the shipped application.
 *
 * Shared by the smoke and fallback specs so both drive the app the same way: a
 * generated clip goes in, the app runs its own `RECORDLY_SMOKE_EXPORT` flow, and
 * the report it writes is the result. The app is spawned directly because
 * Playwright's `_electron.launch()` cannot attach any more (Chromium 132+
 * rejects `--remote-debugging-port` on the command line).
 */
export type SmokeExportReport = {
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

export type SmokeExportRun = {
	report: SmokeExportReport;
	outputPath: string;
	inputPath: string;
	workDirectory: string;
	rendererLog: string[];
	readMainLog: () => Promise<string>;
	cleanup: () => Promise<void>;
};

export type SmokeExportOptions = {
	/** Extra environment for the app, on top of the smoke-export contract. */
	env?: Record<string, string>;
	/** Extra Electron command-line arguments (for example `--disable-gpu`). */
	electronArgs?: string[];
	/** How long to wait for the report before failing. */
	reportTimeoutMs?: number;
};

async function summarizePage(page: import("@playwright/test").Page): Promise<string> {
	const url = page.url();
	const title = await page.title().catch(() => "<title unavailable>");
	const bodyText = await page
		.evaluate(() => document.body?.innerText?.slice(0, 600) ?? "")
		.catch(() => "<body unavailable>");
	return `--- page ---\nurl: ${url}\ntitle: ${title}\nbody: ${bodyText.replace(/\s+/g, " ").trim()}`;
}

/**
 * The smoke-export window: CDP can expose an early blank page next to the real
 * one, so the page is selected by URL rather than by index.
 */
async function waitForSmokeExportPage(
	context: import("@playwright/test").BrowserContext,
	timeoutMs: number,
): Promise<import("@playwright/test").Page> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		for (const candidate of context.pages()) {
			if (candidate.url().includes("smokeExport=1")) {
				return candidate;
			}
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(
		`No smoke-export window appeared. Open pages: ${context
			.pages()
			.map((candidate) => candidate.url())
			.join(", ")}`,
	);
}

export async function runSmokeExport(options: SmokeExportOptions = {}): Promise<SmokeExportRun> {
	// Canonicalize: `os.tmpdir()` returns the 8.3 short form on some Windows hosts
	// (`C:\Users\RUNNER~1\...`), and the app judges readability by the real path.
	const workDirectory = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "recordly-e2e-")),
	);
	const inputPath = await ensureSampleVideo(workDirectory);
	const outputPath = path.join(workDirectory, "e2e-export.mp4");
	const reportPath = `${outputPath}.report.json`;
	const cdpPort = await pickFreePort();

	// Electron's stdout is a pipe here and can stay empty even when the app
	// fails, so the log goes to a real file and is read back on failure.
	const mainLogPath = path.join(workDirectory, "main-process.log");
	const mainLogFd = openSync(mainLogPath, "a");

	// Playwright's runner marks Electron as a Node process; inheriting that makes
	// the spawned app boot as Node and never open a window.
	const childEnv: NodeJS.ProcessEnv = { ...process.env };
	delete childEnv.ELECTRON_RUN_AS_NODE;

	const appProcess: ChildProcess = spawn(
		resolveElectronBinary(),
		[repoRoot, ...(options.electronArgs ?? [])],
		{
			cwd: repoRoot,
			env: {
				...childEnv,
				ELECTRON_ENABLE_LOGGING: "1",
				ELECTRON_CDP_PORT: String(cdpPort),
				RECORDLY_SMOKE_EXPORT: "1",
				RECORDLY_SMOKE_EXPORT_INPUT: inputPath,
				RECORDLY_SMOKE_EXPORT_OUTPUT: outputPath,
				RECORDLY_SMOKE_EXPORT_QUALITY: "medium",
				RECORDLY_SMOKE_EXPORT_FPS: "24",
				...(options.env ?? {}),
			},
			stdio: ["ignore", mainLogFd, mainLogFd],
		},
	);

	const readMainLog = async () => {
		const text = await fs.readFile(mainLogPath, "utf8").catch(() => "");
		return text.split(/\r?\n/).slice(-60).join("\n");
	};

	let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null;
	let cleanedUp = false;
	const cleanup = async () => {
		if (cleanedUp) return;
		cleanedUp = true;
		await browser?.close().catch(() => undefined);
		appProcess.kill();
		await new Promise((resolve) => setTimeout(resolve, 500));
		if (!appProcess.killed) {
			appProcess.kill("SIGKILL");
		}
		closeSync(mainLogFd);
		await fs.rm(workDirectory, { recursive: true, force: true }).catch(() => undefined);
	};

	try {
		await waitForCdpEndpoint(cdpPort, 120_000);
		browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);

		const context = browser.contexts()[0];
		if (!context) {
			throw new Error("The app exposed no browser context over CDP.");
		}
		const page = await waitForSmokeExportPage(context, 120_000);

		const rendererLog: string[] = [];
		page.on("console", (message) => rendererLog.push(`[${message.type()}] ${message.text()}`));
		page.on("pageerror", (error) => rendererLog.push(`[pageerror] ${error.message}`));
		await page.waitForLoadState("domcontentloaded");

		// The app reloads itself once when a renderer starts without the preload
		// bridge, so this polls instead of failing on the first look.
		const preloadPath = path.join(repoRoot, "dist-electron", "preload.mjs");
		let hasBridge = false;
		const bridgeDeadline = Date.now() + 30_000;
		while (Date.now() < bridgeDeadline) {
			hasBridge = await page
				.evaluate(
					() =>
						typeof (globalThis as { electronAPI?: unknown }).electronAPI !==
						"undefined",
				)
				.catch(() => false);
			if (hasBridge) {
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
		if (!hasBridge) {
			throw new Error(
				`The preload bridge never reached the renderer.\npreload exists: ${existsSync(preloadPath)} (${preloadPath})\n${await summarizePage(page)}\n--- renderer log ---\n${rendererLog.slice(-40).join("\n")}\n--- main process output ---\n${await readMainLog()}`,
			);
		}

		let report: SmokeExportReport;
		try {
			report = await waitForJson<SmokeExportReport>(
				reportPath,
				options.reportTimeoutMs ?? 240_000,
			);
		} catch (error) {
			throw new Error(
				`${String(error)}\n${await summarizePage(page)}\n--- renderer log ---\n${rendererLog.slice(-40).join("\n")}\n--- main process output ---\n${await readMainLog()}`,
			);
		}

		return { report, outputPath, inputPath, workDirectory, rendererLog, readMainLog, cleanup };
	} catch (error) {
		await cleanup();
		throw error;
	}
}
