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
	reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
	use: {
		trace: "retain-on-failure",
	},
});
