/**
 * Fails fast when the Electron runtime is missing.
 *
 * `npm ci --ignore-scripts` (used in CI) does not run Electron's postinstall, so
 * `node_modules/electron/dist` can be empty and the end-to-end suite then fails
 * deep inside a test with a confusing message. Run this right after installing
 * to turn that into one clear error.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const executableName = process.platform === "win32" ? "electron.exe" : "electron";
const executablePath = path.join("node_modules", "electron", "dist", executableName);

if (!fs.existsSync(executablePath)) {
	console.error(
		[
			`[verify-electron-runtime] Electron runtime missing: ${executablePath}`,
			"Install it with `node node_modules/electron/install.js` (or a plain `npm install`).",
		].join("\n"),
	);
	process.exit(1);
}

console.log(`[verify-electron-runtime] Found ${executablePath}`);
