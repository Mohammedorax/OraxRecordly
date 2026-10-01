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

	app.setPath("userData", path.join(app.getPath("appData"), "Recordly"));

	if (process.env["VITE_DEV_SERVER_URL"]) {
		const devUserDataPath = path.join(app.getPath("appData"), "Recordly-dev");
		app.setPath("userData", devUserDataPath);
		app.setPath("sessionData", path.join(devUserDataPath, "session"));
	}
}

pinUserDataPath();

export const USER_DATA_PATH = app.getPath("userData");
export const RECORDINGS_DIR = path.join(USER_DATA_PATH, "recordings");
