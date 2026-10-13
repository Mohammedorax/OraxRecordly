/**
 * Notification-area menu, in the app's own language.
 *
 * The menu lives in the main process, which has no access to the renderer's
 * translations, so it used to be English whatever the app language was. The
 * renderer reports its language and the labels are built from the table below;
 * the menu is pure data so it can be tested without Electron.
 */

export type SupportedUiLanguage = "en" | "ar";

export type TrayMenuLabels = {
	tooltip: string;
	recordingTooltip: (source: string) => string;
	open: string;
	showControls: string;
	stopRecording: string;
	/** Stops the recording and then leaves, instead of losing it on quit. */
	stopAndQuit: string;
	quit: string;
	/** Shown while a recording continues in the background. */
	recordingInBackground: string;
};

const LABELS: Record<SupportedUiLanguage, TrayMenuLabels> = {
	en: {
		tooltip: "OraxRecordly",
		recordingTooltip: (source) => `Recording: ${source}`,
		open: "Open OraxRecordly",
		showControls: "Show controls",
		stopRecording: "Stop recording",
		stopAndQuit: "Stop recording and quit",
		quit: "Quit",
		recordingInBackground: "Recording continues in the background",
	},
	ar: {
		tooltip: "OraxRecordly",
		recordingTooltip: (source) => `جارٍ التسجيل: ${source}`,
		open: "افتح OraxRecordly",
		showControls: "إظهار أدوات التحكم",
		stopRecording: "إيقاف التسجيل",
		stopAndQuit: "إيقاف التسجيل والخروج",
		quit: "خروج",
		recordingInBackground: "التسجيل مستمر في الخلفية",
	},
};

/** Falls back to English for a missing or unknown language tag. */
export function normalizeUiLanguage(language: unknown): SupportedUiLanguage {
	const value = typeof language === "string" ? language.trim().toLowerCase() : "";
	return value.startsWith("ar") ? "ar" : "en";
}

export function trayLabels(language: unknown): TrayMenuLabels {
	return LABELS[normalizeUiLanguage(language)];
}

export type TrayMenuItem = {
	label?: string;
	type?: "separator";
	enabled?: boolean;
	click?: () => void;
};

export type TrayMenuActions = {
	open: () => void;
	showControls: () => void;
	stopRecording: () => void;
	stopAndQuit: () => void;
	quit: () => void;
};

/**
 * The menu shown in the notification area.
 *
 * While recording the entry becomes the recording's own controls: showing the
 * overlay, stopping, and stopping before quitting - quitting mid-recording used
 * to leave the user with no finished file at all.
 */
export function buildTrayMenuTemplate(options: {
	language: unknown;
	recording: boolean;
	/** True when the app stays resident after its windows are closed. */
	runsInBackground?: boolean;
	actions: TrayMenuActions;
}): TrayMenuItem[] {
	const labels = trayLabels(options.language);

	if (options.recording) {
		return [
			{ label: labels.recordingInBackground, enabled: false },
			{ type: "separator" },
			{ label: labels.showControls, click: options.actions.showControls },
			{ label: labels.stopRecording, click: options.actions.stopRecording },
			{ type: "separator" },
			{ label: labels.stopAndQuit, click: options.actions.stopAndQuit },
		];
	}

	const items: TrayMenuItem[] = [{ label: labels.open, click: options.actions.open }];
	if (options.runsInBackground) {
		items.push({ type: "separator" });
	}
	items.push({ label: labels.quit, click: options.actions.quit });
	return items;
}
