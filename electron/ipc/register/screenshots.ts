import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { dialog, ipcMain, shell } from "electron";
import {
	SCREENSHOT_CHOOSE_FOLDER_CHANNEL,
	SCREENSHOT_GET_FOLDER_CHANNEL,
	SCREENSHOT_OPEN_FOLDER_CHANNEL,
	SCREENSHOT_PREFERENCES_GET_CHANNEL,
	SCREENSHOT_PREFERENCES_SET_CHANNEL,
} from "../../screenshotEvents";
import { registerScreenshotGlobalShortcut } from "../../screenshotShortcut";
import { resolveScreenshotsFolder } from "../screenshotStorage";
import {
	readScreenshotPreferences,
	type ScreenshotPreferencesPatch,
	updateScreenshotPreferences,
} from "../settings/screenshotPreferencesStore";
import { captureScreenshotFromGlobalShortcut } from "./screenshot";

/** Re-reads the stored accelerator and (re)registers it. Safe to call anytime. */
export async function notifyScreenshotPreferencesChanged(): Promise<boolean> {
	try {
		const preferences = await readScreenshotPreferences();
		return registerScreenshotGlobalShortcut(preferences.globalShortcut, () => {
			void captureScreenshotFromGlobalShortcut();
		});
	} catch (error) {
		console.warn("Failed to refresh the screenshot global shortcut:", error);
		return false;
	}
}

/**
 * Screenshot preferences IPC. These reuse the recordings-settings style of
 * `{ success, ... }` results so the renderer can treat them uniformly.
 */
export function registerScreenshotSettingsHandlers() {
	ipcMain.handle(SCREENSHOT_PREFERENCES_GET_CHANNEL, async () => {
		try {
			return { success: true, preferences: await readScreenshotPreferences() };
		} catch (error) {
			console.error("Failed to read screenshot preferences:", error);
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle(
		SCREENSHOT_PREFERENCES_SET_CHANNEL,
		async (_event, patch: ScreenshotPreferencesPatch) => {
			try {
				const preferences = await updateScreenshotPreferences(patch ?? {});
				// The accelerator may have changed (or been disabled), so re-register.
				// `shortcutRegistered` is null when the shortcut is intentionally off,
				// and false when the OS refused the accelerator, so the settings UI can
				// show an inline error instead of silently dropping it.
				const registered = await notifyScreenshotPreferencesChanged();
				return {
					success: true,
					preferences,
					shortcutRegistered: preferences.globalShortcut ? registered : null,
				};
			} catch (error) {
				console.error("Failed to save screenshot preferences:", error);
				return { success: false, error: String(error) };
			}
		},
	);

	ipcMain.handle(SCREENSHOT_GET_FOLDER_CHANNEL, async () => {
		try {
			const folder = await resolveScreenshotsFolder();
			return {
				success: true,
				path: folder.path,
				isCustom: folder.isCustom,
				fallback: folder.fallback,
				error: folder.fallbackReason,
			};
		} catch (error) {
			console.error("Failed to resolve the screenshots folder:", error);
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle(SCREENSHOT_CHOOSE_FOLDER_CHANNEL, async () => {
		try {
			const current = (await resolveScreenshotsFolder()).path;
			const result = await dialog.showOpenDialog({
				title: "Choose screenshots folder",
				defaultPath: current,
				properties: ["openDirectory", "createDirectory", "promptToCreate"],
			});

			if (result.canceled || result.filePaths.length === 0) {
				return { success: false, canceled: true, path: current };
			}

			const selectedPath = path.resolve(result.filePaths[0]);
			await fs.mkdir(selectedPath, { recursive: true });
			await fs.access(selectedPath, fsConstants.W_OK);
			const preferences = await updateScreenshotPreferences({ folder: selectedPath });

			return {
				success: true,
				path: selectedPath,
				isCustom: true,
				preferences,
			};
		} catch (error) {
			console.error("Failed to change the screenshots folder:", error);
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle(SCREENSHOT_OPEN_FOLDER_CHANNEL, async () => {
		try {
			const { path: folder } = await resolveScreenshotsFolder();
			// The folder exists by the time it resolves, but keep the mkdir so the OS
			// file manager always has somewhere to go.
			await fs.mkdir(folder, { recursive: true });
			const openPathError = await shell.openPath(folder);
			if (openPathError) {
				return { success: false, error: openPathError, path: folder };
			}

			return { success: true, path: folder };
		} catch (error) {
			console.error("Failed to open the screenshots folder:", error);
			return { success: false, error: String(error) };
		}
	});
}
