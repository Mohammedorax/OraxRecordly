import { loadAppSetting, saveAppSetting } from "@/lib/appSettings";
import { type ClipTransitionSettings, normalizeClipTransitionSettings } from "./clipTransitions";

/**
 * Persistence for the automatic transitions between clips.
 *
 * Stored with the other editor preferences so a fade chosen once applies to
 * every project opened afterwards, exactly like the keystroke badge options.
 */
export const CLIP_TRANSITION_SETTINGS_KEY = "recordly.clipTransitions";

export function loadClipTransitionSettings(): ClipTransitionSettings {
	return normalizeClipTransitionSettings(loadAppSetting(CLIP_TRANSITION_SETTINGS_KEY));
}

export function saveClipTransitionSettings(
	settings: ClipTransitionSettings,
): ClipTransitionSettings {
	const normalized = normalizeClipTransitionSettings(settings);
	saveAppSetting(CLIP_TRANSITION_SETTINGS_KEY, normalized);
	return normalized;
}
