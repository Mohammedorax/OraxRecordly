import { loadAppSetting, saveAppSetting } from "../appSettings";
import {
	DEFAULT_KEYCAST_SETTINGS,
	deserializeKeycastSettings,
	type KeycastSettings,
	normalizeKeycastSettings,
	serializeKeycastSettings,
} from "./keycastModel";

/**
 * App-level storage key for the keystroke overlay. Like the other editor
 * preferences it lives in the main process `app-settings.json` with a
 * `localStorage` mirror so a browser dev server still round-trips.
 */
export const KEYCAST_SETTINGS_STORAGE_KEY = "recordly.keycast.settings";

function loadFromLocalStorage(): KeycastSettings | null {
	try {
		if (typeof globalThis.localStorage === "undefined") {
			return null;
		}

		const stored = globalThis.localStorage.getItem(KEYCAST_SETTINGS_STORAGE_KEY);
		if (!stored) {
			return null;
		}

		return deserializeKeycastSettings(stored);
	} catch {
		return null;
	}
}

function saveToLocalStorage(settings: KeycastSettings): boolean {
	try {
		if (typeof globalThis.localStorage === "undefined") {
			return false;
		}

		globalThis.localStorage.setItem(
			KEYCAST_SETTINGS_STORAGE_KEY,
			serializeKeycastSettings(settings),
		);
		return true;
	} catch {
		return false;
	}
}

export function loadKeycastSettings(): KeycastSettings {
	const persisted = loadAppSetting<unknown>(KEYCAST_SETTINGS_STORAGE_KEY);
	if (persisted !== null && persisted !== undefined) {
		return normalizeKeycastSettings(persisted);
	}

	return loadFromLocalStorage() ?? { ...DEFAULT_KEYCAST_SETTINGS };
}

export function saveKeycastSettings(settings: KeycastSettings): KeycastSettings {
	const normalized = normalizeKeycastSettings(settings);
	saveAppSetting(KEYCAST_SETTINGS_STORAGE_KEY, normalized);
	saveToLocalStorage(normalized);
	return normalized;
}
