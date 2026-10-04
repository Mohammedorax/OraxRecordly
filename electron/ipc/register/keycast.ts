import { BrowserWindow, ipcMain } from "electron";
import {
	DEFAULT_KEYCAST_SETTINGS,
	type KeycastSettings,
	normalizeKeycastSettings,
} from "../../../src/lib/keycast/keycastModel";
import { setKeycastSuppressedAccelerator } from "../cursor/keycast";
import { readScreenshotPreferences } from "../settings/screenshotPreferencesStore";
import { setKeycastCaptureEnabled } from "../state";

/**
 * IPC surface for the keystroke overlay.
 *
 * These channels are intentionally tiny and separate from `main.ts`:
 *  - `set-keycast-settings` mirrors the renderer's opt-in choice into the main
 *    process so the existing uiohook capture knows whether it may record keys,
 *    and re-broadcasts the value so the always-on HUD window can render a live
 *    badge without polling.
 *  - `get-keycast-settings` lets a freshly opened window start from the
 *    current value.
 *
 * The keystroke stream itself is a push-only channel (`keycast-keystroke`)
 * emitted from the cursor capture module; nothing here persists keystrokes.
 */
let keycastSettings: KeycastSettings = { ...DEFAULT_KEYCAST_SETTINGS };

function broadcastKeycastSettings(settings: KeycastSettings) {
	BrowserWindow.getAllWindows().forEach((window) => {
		if (!window.isDestroyed()) {
			window.webContents.send("keycast-settings-changed", settings);
		}
	});
}

export function applyKeycastSettings(candidate: unknown): KeycastSettings {
	const normalized = normalizeKeycastSettings(candidate);
	keycastSettings = normalized;
	setKeycastCaptureEnabled(normalized.enabled);
	void refreshSuppressedShortcut();
	return normalized;
}

/**
 * Keep the app's own system-wide screenshot accelerator out of the badge.
 * Reading the preferences is async and can fail; the overlay simply shows
 * everything until it succeeds, which is the pre-existing behaviour.
 */
async function refreshSuppressedShortcut(): Promise<void> {
	try {
		const preferences = await readScreenshotPreferences();
		setKeycastSuppressedAccelerator(preferences.globalShortcut);
	} catch {
		setKeycastSuppressedAccelerator(null);
	}
}

export function getKeycastSettings(): KeycastSettings {
	return keycastSettings;
}

export function registerKeycastHandlers() {
	ipcMain.handle("get-keycast-settings", () => ({
		success: true,
		settings: keycastSettings,
	}));

	ipcMain.handle("set-keycast-settings", (_, candidate: unknown) => {
		const settings = applyKeycastSettings(candidate);
		broadcastKeycastSettings(settings);
		return { success: true, settings };
	});
}
