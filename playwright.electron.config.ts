import { defineConfig } from "@playwright/test";

/**
 * Electron end-to-end configuration.
 *
 * `tests/ui` drives the renderer in a browser (`RECORDLY_RENDERER_ONLY=1`), so
 * nothing there exercises the main process: window creation, IPC, the native
 * encoders, or the real file layout on disk. These specs launch the actual
 * application binary instead.
 *
 * Run with `npm run test:e2e`, which builds `dist-electron/main.cjs` first; the
 * specs skip themselves with a clear message when that build is missing.
 */
export default defineConfig({
	testDir: "./tests/electron",
	// A cold app boot plus a real encode: the UI suite's budgets are too tight
	// here, and a fixed clip keeps the work predictable.
	timeout: 300_000,
	expect: { timeout: 30_000 },
	// Each worker owns a full Electron app with GPU processes; one at a time
	// keeps memory and encoder sessions predictable.
	workers: 1,
	fullyParallel: false,
	/**
	 * One retry. Every spec boots its own Electron app, and a machine that is still
	 * shutting one down can hand the next one a renderer without WebCodecs yet
	 * ("VideoEncoder is not defined"), which fails the export for environmental
	 * reasons. A retry is cheap next to publishing from a flaky signal, and a real
	 * regression fails both attempts.
	 */
	retries: 1,
	reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
	use: {
		trace: "retain-on-failure",
	},
});
