import { defineConfig } from "@playwright/test";

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

export default defineConfig({
	testDir: "./tests/ui",
	timeout: 30000,
	use: {
		baseURL: "http://127.0.0.1:5178",
		viewport: { width: 1440, height: 1000 },
		trace: "retain-on-failure",
		storageState: ENGLISH_LOCALE_STORAGE_STATE,
	},
	webServer: {
		env: { RECORDLY_RENDERER_ONLY: "1" },
		command: "npx vite --host 127.0.0.1 --port 5178 --strictPort",
		url: "http://127.0.0.1:5178",
		reuseExistingServer: !process.env.CI,
	},
});
