import { ipcMain } from "electron";
import {
	getStartupPreferences,
	isAutoLaunchSupported,
	updateStartupPreferences,
} from "../../autoLaunch";
import type { StartupPreferencesPatch } from "../settings/startupPreferencesStore";

function normalizePatch(payload: unknown): StartupPreferencesPatch {
	const patch: StartupPreferencesPatch = {};
	if (!payload || typeof payload !== "object") {
		return patch;
	}

	const candidate = payload as Record<string, unknown>;
	if (typeof candidate.openAtLogin === "boolean") {
		patch.openAtLogin = candidate.openAtLogin;
	}
	if (typeof candidate.startMinimized === "boolean") {
		patch.startMinimized = candidate.startMinimized;
	}

	return patch;
}

export function registerStartupHandlers() {
	ipcMain.handle("get-startup-preferences", () => getStartupPreferences());

	ipcMain.handle("set-startup-preferences", async (_event, payload: unknown) => {
		try {
			return await updateStartupPreferences(normalizePatch(payload));
		} catch (error) {
			console.error("Failed to save startup preferences:", error);
			const stored = await getStartupPreferences();
			return {
				...stored,
				success: false,
				supported: isAutoLaunchSupported(),
				error: String(error),
			};
		}
	});
}
