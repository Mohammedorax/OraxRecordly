import fs from "node:fs";
import { chromium, defineConfig } from "@playwright/test";

// The app boots in Arabic (DEFAULT_STARTUP_LOCALE in src/i18n/config.ts) when no
// language has been chosen yet, but the UI specs assert English copy. Seed an
// explicit English choice for every browser context so the suite keeps testing
// the English UI on purpose rather than by accident.
const ENGLISH_LOCALE_STORAGE_STATE = {
	cookies: [],
	origins: [
		{
			origin: "http://127.0.0.1:5178",
			localStorage: [{ name: "recordly.locale", value: "en" }],
		},
	],
};

/**
 * Browser selection.
 *
 * The suite is pinned to the Chromium build that the installed `@playwright/test`
 * ships with: `npx playwright install chromium` downloads it and the default
 * (channel-less) launch target is what every machine with that install uses.
 *
 * Some local machines cannot download it (blocked network) or only carry a
 * `ms-playwright` cache whose revision does not match the installed Playwright.
 * A mismatched revision is worse than a missing one: Playwright launches the
 * stale build and then hangs in actionability/`evaluate` calls instead of
 * failing fast. When the pinned executable is missing, fall back to the Google
 * Chrome already installed on the machine (`channel: "chrome"`), which
 * Playwright drives over the same protocol.
 *
 * Precedence:
 *   1. `RECORDLY_UI_BROWSER_CHANNEL` (for example `chrome`, `msedge`,
 *      `chrome-beta`). Set it to `chromium` to force the pinned build and
 *      disable the fallback.
 *   2. Pinned Chromium installed -> bundled Chromium (the unchanged default,
 *      and what a normal CI runner that ran `npx playwright install` gets).
 *   3. Pinned Chromium missing but a local Chrome found -> `chrome`.
 *   4. Nothing found -> bundled Chromium, so Playwright emits its normal
 *      "Executable doesn't exist ... run npx playwright install" error.
 */
const BROWSER_CHANNEL_ENV = "RECORDLY_UI_BROWSER_CHANNEL";
const BUNDLED_CHANNEL = "chromium";

function localChromeExecutables(): string[] {
	const programFiles = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(
		Boolean,
	) as string[];
	const localAppData = process.env.LOCALAPPDATA;
	return [
		programFiles.map((dir) => `${dir}\\Google\\Chrome\\Application\\chrome.exe`),
		localAppData ? [`${localAppData}\\Google\\Chrome\\Application\\chrome.exe`] : [],
		["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/opt/google/chrome/chrome"],
		["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
	].flat();
}

function hasBundledChromium(): boolean {
	try {
		return fs.existsSync(chromium.executablePath());
	} catch {
		return false;
	}
}

function resolveBrowserChannel(): { channel?: string; reason: string } {
	const requested = process.env[BROWSER_CHANNEL_ENV]?.trim();
	if (requested) {
		return requested === BUNDLED_CHANNEL
			? { reason: `${BROWSER_CHANNEL_ENV}=${requested} (fallback disabled)` }
			: { channel: requested, reason: `${BROWSER_CHANNEL_ENV}=${requested}` };
	}
	if (hasBundledChromium()) {
		return { reason: "pinned Playwright Chromium is installed" };
	}
	const localChrome = localChromeExecutables().find((candidate) => fs.existsSync(candidate));
	if (localChrome) {
		return { channel: "chrome", reason: `pinned Chromium missing, using ${localChrome}` };
	}
	return { reason: "pinned Playwright Chromium missing and no local Chrome found" };
}

const browser = resolveBrowserChannel();
console.log(
	`[playwright.config] browser: ${browser.channel ?? BUNDLED_CHANNEL} (${browser.reason})`,
);

export default defineConfig({
	testDir: "./tests/ui",
	// The specs run against `vite dev`, not a build, so a cold browser context has
	// to fetch and transform the whole module graph before React paints. Measured
	// on this machine: ~10s from `page.goto('/?windowType=editor')` to the first
	// editor assertion, with the filmstrip frames arriving a few seconds later.
	// Playwright's 5s assertion default and 30s test default were therefore
	// reporting "element(s) not found" and "Test timeout exceeded" for UI that
	// renders correctly, which is why so many specs looked flaky under load. The
	// budgets below only remove that environment noise: every assertion keeps its
	// own semantics, and a broken UI still fails (later, with the same message).
	// Specs that need more than 60s still call `test.setTimeout` themselves.
	timeout: 60000,
	expect: { timeout: 15000 },
	// On a loaded or shared machine, prefer one file at a time (`--workers=1`):
	// every worker owns a Chrome instance plus a Pixi renderer, and parallel
	// workers starve each other on this class of box. The default is unchanged so
	// a normal CI runner keeps its usual parallelism.
	use: {
		baseURL: "http://127.0.0.1:5178",
		viewport: { width: 1440, height: 1000 },
		trace: "retain-on-failure",
		storageState: ENGLISH_LOCALE_STORAGE_STATE,
		...(browser.channel ? { channel: browser.channel } : {}),
	},
	webServer: {
		env: { RECORDLY_RENDERER_ONLY: "1" },
		// `tests/ui/vite.config.mts` inherits vite.config.ts and only disables HMR,
		// so a suite run cannot be reloaded mid-test by concurrent edits to src/.
		command:
			"npx vite --config tests/ui/vite.config.mts --host 127.0.0.1 --port 5178 --strictPort",
		url: "http://127.0.0.1:5178",
		reuseExistingServer: !process.env.CI,
	},
});
