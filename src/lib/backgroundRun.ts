import { loadAppSetting, saveAppSetting } from "./appSettings";

/**
 * Shared key for the "keep running after the windows are closed" preference.
 *
 * The main process reads the same key straight from the app settings file, so the
 * choice applies to the very next window close and survives a restart.
 */
export const BACKGROUND_RUN_SETTING_KEY = "recordly.runInBackground";

/** Whether Recordly should stay in the notification area after closing its windows. */
export function loadBackgroundRunPreference(): boolean {
	return loadAppSetting(BACKGROUND_RUN_SETTING_KEY) === true;
}

export function saveBackgroundRunPreference(enabled: boolean): void {
	saveAppSetting(BACKGROUND_RUN_SETTING_KEY, enabled === true);
}
