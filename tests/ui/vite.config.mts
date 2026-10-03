import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig, type UserConfig } from "vite";
import baseConfig from "../../vite.config";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Vite config used only by the Playwright `webServer` (see playwright.config.ts).
 *
 * The UI suite runs against the renderer served by `vite dev`. That server's HMR
 * client reloads the page whenever a watched module changes. That is correct
 * while developing, but it is fatal for a browser suite: any edit to `src/**`
 * that happens while a test is running - another agent, a formatter, a file
 * watcher - tears the page down mid-test and produces shifting, unreproducible
 * failures. Turning HMR off leaves the dev server's module graph, transforms and
 * static handling identical while making a run immune to on-disk churn: a page
 * always renders the source revision that exists when the test navigates, and
 * nothing reloads it afterwards.
 *
 * Everything else is inherited from the project's own vite.config.ts, so the
 * suite keeps exercising the same app configuration as `npm run dev`.
 */
export default defineConfig((env) =>
	mergeConfig(typeof baseConfig === "function" ? baseConfig(env) : baseConfig, {
		root: projectRoot,
		server: { hmr: false },
	} satisfies UserConfig),
);
