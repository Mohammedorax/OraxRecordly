import path from "node:path";
import { app } from "electron";

/**
 * DELIBERATE DATA-CONTINUITY ANCHOR — do not "tidy" this up.
 *
 * The product was renamed "Recordly" -> "OraxRecordly", but Electron derives the
 * userData directory from the product name. Without this pin the rename would
 * silently orphan the existing %APPDATA%\Recordly folder, so recordings,
 * screenshots, settings files and recent projects would look lost after an
 * update. The folder name must therefore stay "Recordly" forever and must never
 * be changed to match the product name.
 *
 * It lives here (and is repeated at the top of electron/main.ts) because modules
 * such as this one capture `app.getPath("userData")` at import time, before
 * main.ts's body executes. The guard keeps module import from throwing under the
 * partial `electron` mocks the unit tests use; in a real Electron process both
 * functions always exist.
 */
function pinUserDataPath(): void {
	if (typeof app?.setPath !== "function" || typeof app?.getPath !== "function") {
		return;
	}

	// Test seam: the end-to-end suite must never touch a real profile. `APPDATA`
	// and Chromium's `--user-data-dir` are both ignored here (the path comes from
	// the OS known-folder API and this pin respectively), so the suite sets this
	// variable instead. Unpackaged builds only: a shipped app keeps its profile.
	const overrideUserDataPath = process.env["RECORDLY_USER_DATA_DIR"];
	if (overrideUserDataPath && !app.isPackaged) {
		app.setPath("userData", overrideUserDataPath);
		app.setPath("sessionData", path.join(overrideUserDataPath, "session"));
		return;
	}

	app.setPath("userData", path.join(app.getPath("appData"), "Recordly"));

	if (process.env["VITE_DEV_SERVER_URL"]) {
		const devUserDataPath = path.join(app.getPath("appData"), "Recordly-dev");
		app.setPath("userData", devUserDataPath);
		app.setPath("sessionData", path.join(devUserDataPath, "session"));
	}
}

pinUserDataPath();

/**
 * `app.getPath` is unavailable when this module is imported outside a real
 * Electron main process — the unit-test electron mocks, and (reproducibly) a
 * packaged launch whose environment carries `ELECTRON_RUN_AS_NODE=1`, where
 * `require("electron")` resolves to the npm shim and `app` is `undefined`.
 *
 * Calling it unguarded threw `TypeError: Cannot read properties of undefined
 * (reading 'getPath')` at import time. Electron then exited with code 0, no
 * window and no diagnostic, which is indistinguishable from "the app didn't
 * launch". Fall back to the same pinned directory the real process uses so the
 * import can never be the thing that kills a launch.
 */
function readUserDataPath(): string {
	try {
		if (typeof app?.getPath === "function") {
			return app.getPath("userData");
		}
	} catch {
		// Fall through to the pinned path below.
	}

	const appDataRoot = process.env.APPDATA ?? process.env.HOME ?? process.cwd();
	return path.join(appDataRoot, "Recordly");
}

export const USER_DATA_PATH = readUserDataPath();
/** Legacy recordings location, hidden inside the app's AppData folder. */
export const RECORDINGS_DIR = path.join(USER_DATA_PATH, "recordings");

/**
 * Default recordings/export root: the user's visible Videos folder
 * (`Videos\OraxRecordly` on Windows, `~/Movies/OraxRecordly` on macOS) instead of
 * the hidden AppData folder, so recordings and exports are easy to find.
 *
 * `RECORDINGS_DIR` is kept as the legacy location and is the one-time migration
 * source; see `electron/ipc/recordingDirMigration.ts`.
 */
export function getDefaultRecordingsDir(): string {
	// Test seam, mirroring `RECORDLY_USER_DATA_DIR`: the end-to-end suite must not
	// write projects or exports into the developer's real Videos folder, which is
	// an OS known folder and therefore unaffected by environment redirection.
	const overrideRecordingsDir = process.env["RECORDLY_TEST_RECORDINGS_DIR"];
	if (overrideRecordingsDir && !app?.isPackaged) {
		return overrideRecordingsDir;
	}

	try {
		if (typeof app?.getPath === "function") {
			const videosPath = app.getPath("videos");
			if (videosPath) {
				return path.join(videosPath, "OraxRecordly");
			}
		}
	} catch {
		// Fall through to the legacy location when the platform has no videos dir.
	}

	return RECORDINGS_DIR;
}

/** Exports live in a subfolder so they never show up in the recordings library. */
export function getDefaultExportDir(recordingsDir: string): string {
	return path.join(recordingsDir, "Exports");
}
