import { formatLocaleDateTime } from "./localeFormatUtils";

/**
 * The recorder writes `recording-<epochMs>.mp4` (and matching companion stems).
 * The capture start time is therefore recoverable from the file name, which is
 * more accurate than the file mtime (the stop time).
 */
const RECORDING_FILE_PATTERN = /^recording-(\d{10,})(?:-webcam)?$/i;

function getFileStem(pathOrName: string): string {
	const normalized = pathOrName.replace(/\\/g, "/");
	const baseName = normalized.slice(normalized.lastIndexOf("/") + 1);
	const dotIndex = baseName.lastIndexOf(".");
	return dotIndex > 0 ? baseName.slice(0, dotIndex) : baseName;
}

/** Capture start time in epoch ms, or `fallbackMs` when the name is not a recording. */
export function getRecordingStartTimeMs(pathOrName: string, fallbackMs = 0): number {
	const match = RECORDING_FILE_PATTERN.exec(getFileStem(pathOrName));
	if (!match) {
		return fallbackMs;
	}
	const parsed = Number.parseInt(match[1], 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
}

/** Human-readable clip name: the rename override, else the file stem. */
export function getRecordingDisplayName(pathOrName: string, nameOverride?: string | null): string {
	const override = nameOverride?.trim();
	if (override) {
		return override;
	}
	return getFileStem(pathOrName) || pathOrName;
}

/**
 * Builds the burned-in label text, e.g. `recording-1730000000000 · 30 Oct 2025, 14:32`.
 * Falls back to just the name when no capture timestamp can be recovered.
 */
export function buildRecordingLabelText(options: {
	pathOrName: string;
	nameOverride?: string | null;
	locale: string;
	fallbackStartMs?: number;
}): string {
	const name = getRecordingDisplayName(options.pathOrName, options.nameOverride);
	const startMs = getRecordingStartTimeMs(options.pathOrName, options.fallbackStartMs ?? 0);
	if (!startMs) {
		return name;
	}
	const stamp = formatLocaleDateTime(startMs, options.locale, {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
	return `${name} · ${stamp}`;
}
