import path from "node:path";
import type { Settings } from "electron";
import { app } from "electron";
import { USER_DATA_PATH } from "./appPaths";
import {
	createStartupPreferencesStore,
	type StartupPreferences,
	type StartupPreferencesPatch,
} from "./ipc/settings/startupPreferencesStore";

/**
 * Optional command-line flag that forces a hidden launch. Recordly does not add
 * it to the login item (the stored preference already covers that), but it lets
 * a shortcut or a test start the app minimized without touching the settings.
 */
export const START_MINIMIZED_ARG = "--start-minimized";

/**
 * Startup preferences get their own userData file, exactly like the other
 * preference stores. The path is declared here rather than in
 * `ipc/constants.ts` so this module stays self-contained.
 */
export const STARTUP_SETTINGS_FILE = path.join(USER_DATA_PATH, "startup-settings.json");

const startupPreferencesStore = createStartupPreferencesStore(STARTUP_SETTINGS_FILE);

export interface LoginItemState {
	supported: boolean;
	openAtLogin: boolean;
}

export interface AutoLaunchResult extends LoginItemState {
	success: boolean;
	error?: string;
}

export interface StartupPreferencesResult {
	success: boolean;
	supported: boolean;
	openAtLogin: boolean;
	startMinimized: boolean;
	error?: string;
}

/** Linux has no `setLoginItemSettings` support in Electron; the UI is told so. */
export function isAutoLaunchSupported(platform: NodeJS.Platform = process.platform) {
	return platform === "win32" || platform === "darwin";
}

export async function readStartupPreferences(): Promise<StartupPreferences> {
	return startupPreferencesStore.read();
}

export function readLoginItemState(platform: NodeJS.Platform = process.platform): LoginItemState {
	if (!isAutoLaunchSupported(platform)) {
		return { supported: false, openAtLogin: false };
	}

	try {
		return { supported: true, openAtLogin: app.getLoginItemSettings().openAtLogin };
	} catch (error) {
		console.warn("Failed to read the OS login item:", error);
		return { supported: true, openAtLogin: false };
	}
}

function buildLoginItemSettings(openAtLogin: boolean, platform: NodeJS.Platform): Settings {
	const settings: Settings = { openAtLogin };
	if (platform === "win32") {
		// Register the executable that is actually running rather than whatever
		// path the installer left in the registry.
		settings.path = process.execPath;
		settings.args = [];
	}

	return settings;
}

/**
 * Applies the login-item preference to the operating system. Throws nowhere:
 * unsupported platforms and a refusing OS both come back as a result object so
 * the renderer can surface them inline.
 */
export function applyAutoLaunchPreference(
	openAtLogin: boolean,
	platform: NodeJS.Platform = process.platform,
): AutoLaunchResult {
	if (!isAutoLaunchSupported(platform)) {
		return {
			success: false,
			supported: false,
			openAtLogin: false,
			error: "Launching Recordly at sign-in is not supported on this platform.",
		};
	}

	try {
		app.setLoginItemSettings(buildLoginItemSettings(openAtLogin, platform));
		const state = app.getLoginItemSettings();
		if (state.openAtLogin !== openAtLogin) {
			return {
				success: false,
				supported: true,
				openAtLogin: state.openAtLogin,
				error: "The operating system did not register Recordly as a login item.",
			};
		}

		return { success: true, supported: true, openAtLogin: state.openAtLogin };
	} catch (error) {
		return {
			success: false,
			supported: true,
			openAtLogin: readLoginItemState(platform).openAtLogin,
			error: String(error),
		};
	}
}

/** The stored preference, plus the live OS login-item state when available. */
export async function getStartupPreferences(): Promise<StartupPreferencesResult> {
	const stored = await readStartupPreferences();
	const loginItem = readLoginItemState();

	return {
		success: true,
		supported: loginItem.supported,
		// The OS is the source of truth: the user may have disabled the login item
		// from Task Manager or System Settings behind Recordly's back.
		openAtLogin: loginItem.supported ? loginItem.openAtLogin : stored.openAtLogin,
		startMinimized: stored.startMinimized,
	};
}

/**
 * Applies a partial patch. `openAtLogin` is registered with the OS first and
 * only persisted when the OS accepted it, so the stored value always matches
 * reality. `startMinimized` is a pure app preference and is always persisted.
 */
export async function updateStartupPreferences(
	patch: StartupPreferencesPatch,
): Promise<StartupPreferencesResult> {
	const stored = await readStartupPreferences();
	const nextPatch: StartupPreferencesPatch = {};
	let error: string | undefined;
	let supported = isAutoLaunchSupported();

	if (typeof patch.startMinimized === "boolean") {
		nextPatch.startMinimized = patch.startMinimized;
	}

	if (typeof patch.openAtLogin === "boolean") {
		const applied = applyAutoLaunchPreference(patch.openAtLogin);
		supported = applied.supported;
		if (applied.success) {
			nextPatch.openAtLogin = patch.openAtLogin;
		} else {
			error = applied.error;
		}
	}

	const persisted =
		Object.keys(nextPatch).length > 0
			? await startupPreferencesStore.update(nextPatch)
			: stored;
	const loginItem = readLoginItemState();

	return {
		success: error === undefined,
		supported,
		openAtLogin: loginItem.supported ? loginItem.openAtLogin : persisted.openAtLogin,
		startMinimized: persisted.startMinimized,
		error,
	};
}

export function shouldStartMinimizedOnLaunch(
	startMinimized: boolean,
	argv: readonly string[] = process.argv,
): boolean {
	return startMinimized || argv.includes(START_MINIMIZED_ARG);
}
