/**
 * Synchronous IPC bootstrap.
 *
 * The preload exposes two *synchronous* bridges — `getAppSetting` and
 * `setAppSetting` — because the renderer reads persisted preferences (theme,
 * keycast settings, editor preferences) during its first React render, before
 * any `await` could resolve. A synchronous `ipcRenderer.sendSync()` blocks the
 * renderer until the main process replies with `event.returnValue`.
 *
 * If that reply never comes — because the matching `ipcMain.on()` had not been
 * registered yet — Chromium records the channel as unhandled and the renderer
 * is left wedged. The window is then permanently unpresentable: Electron still
 * reports `isVisible: true`, but `webContents.capturePage()` rejects with
 * `UnknownVizError`, no `paint` event ever fires, and the user sees nothing.
 *
 * The race is easy to lose because the settings handlers are registered from an
 * async `app.whenReady()` body that awaits directory creation, the media server
 * and the packaged renderer server first, while the HUD window can finish
 * loading in the meantime.
 *
 * This module removes the race by registering the two synchronous channels
 * *synchronously at import time*, before `app.whenReady()` — and therefore
 * before any `BrowserWindow` can exist. `registerSettingsHandlers()` re-registering
 * them later is harmless: `ipcMain.on` appends a second listener, and the store
 * read is idempotent, so both listeners write the same `event.returnValue`.
 */

import { ipcMain } from "electron";
import { hasAppSetting, readAppSettingsStore, writeAppSettingsStore } from "./appSettingsStore";

export const APP_SETTING_GET_CHANNEL = "app-settings:get";
export const APP_SETTING_SET_CHANNEL = "app-settings:set";

let registered = false;

/**
 * True when `value` is a usable settings key. Kept separate from the handler so
 * the validation rule can be unit-tested without Electron.
 */
export function isValidAppSettingKey(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

/**
 * Reads one setting, answering in the shape the preload expects
 * (`{ success, value }`). Never throws: a settings read must not be able to
 * break the IPC reply, because a missing `event.returnValue` is what wedges the
 * renderer.
 */
export function resolveAppSettingGet(key: unknown): { success: boolean; value: unknown } {
	if (!isValidAppSettingKey(key)) {
		return { success: false, value: null };
	}

	try {
		const store = readAppSettingsStore();
		return { success: true, value: hasAppSetting(store, key) ? store[key] : null };
	} catch {
		return { success: false, value: null };
	}
}

/**
 * Writes one setting, answering `{ success }`. As above, the reply is always
 * produced even when the write fails, so a read-only or locked settings file
 * cannot turn into an unanswered synchronous IPC.
 */
export function resolveAppSettingSet(key: unknown, value: unknown): { success: boolean } {
	if (!isValidAppSettingKey(key)) {
		return { success: false };
	}

	try {
		const store = readAppSettingsStore();
		store[key] = value;
		writeAppSettingsStore(store);
		return { success: true };
	} catch {
		return { success: false };
	}
}

/**
 * Registers the synchronous settings channels. Safe to call more than once and
 * safe to call before `app.whenReady()` — `ipcMain` is usable as soon as the
 * module is imported.
 */
export function registerSynchronousAppSettingHandlers(): void {
	if (registered) {
		return;
	}
	registered = true;

	ipcMain.on(APP_SETTING_GET_CHANNEL, (event, key: unknown) => {
		event.returnValue = resolveAppSettingGet(key);
	});

	ipcMain.on(APP_SETTING_SET_CHANNEL, (event, key: unknown, value: unknown) => {
		event.returnValue = resolveAppSettingSet(key, value);
	});
}

/** Test seam: forget that the channels were registered. */
export function resetSynchronousAppSettingHandlersForTests(): void {
	registered = false;
}
