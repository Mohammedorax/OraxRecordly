import { getLocalMediaServerPath } from "@/lib/localMediaUrl";
import { formatLocaleDateTime } from "./localeFormatUtils";

/**
 * The recorder writes `recording-<epochMs>.mp4` (and matching companion stems).
 * The capture start time is therefore recoverable from the file name, which is
 * more accurate than the file mtime (the stop time).
 */
const RECORDING_FILE_PATTERN = /^recording-(\d{10,})(?:-webcam)?$/i;

/**
 * Values that are still a URL, a query string or a percent-escape after they were
 * meant to become a file name.
 *
 * The label is burned into the exported frames, so a value that only *looks*
 * like a name must never be painted: a media URL reaching this code once put the
 * whole loopback address of a clip on screen, inside the video, for its whole
 * duration.
 */
function looksUnresolvedName(value: string): boolean {
	return /:\/\//.test(value) || value.includes("?") || /%[0-9a-f]{2}/i.test(value);
}

/**
 * The local file path behind whatever the editor is holding.
 *
 * The editor stores a preview URL in some flows and a plain path in others, so
 * the media-server URL is resolved back to its file (the shared resolver
 * understands both the opaque handle and the older `?path=` form) before anything
 * tries to read a name out of it.
 */
export function resolveLabelSourcePath(pathOrName: string): string {
	const value = pathOrName.trim();
	if (!value) {
		return "";
	}

	const localPath = getLocalMediaServerPath(value);
	if (localPath) {
		return localPath;
	}

	if (/^file:\/\//i.test(value)) {
		try {
			const url = new URL(value);
			const pathname = decodeURIComponent(url.pathname);
			// Windows file URLs carry a leading slash before the drive letter.
			return pathname.replace(/^\/(?=[A-Za-z]:)/, "");
		} catch {
			return value;
		}
	}

	return value;
}

function getFileStem(pathOrName: string): string {
	const normalized = pathOrName.replace(/\\/g, "/");
	const baseName = normalized.slice(normalized.lastIndexOf("/") + 1);
	const dotIndex = baseName.lastIndexOf(".");
	return dotIndex > 0 ? baseName.slice(0, dotIndex) : baseName;
}

/** Capture start time in epoch ms, or `fallbackMs` when the name is not a recording. */
export function getRecordingStartTimeMs(pathOrName: string, fallbackMs = 0): number {
	const match = RECORDING_FILE_PATTERN.exec(getFileStem(resolveLabelSourcePath(pathOrName)));
	if (!match) {
		return fallbackMs;
	}
	const parsed = Number.parseInt(match[1], 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
}

/**
 * Human-readable clip name: the rename override, else the file stem.
 *
 * Returns an empty string rather than an unresolved URL or query fragment, which
 * the painters treat as "draw no label".
 */
export function getRecordingDisplayName(pathOrName: string, nameOverride?: string | null): string {
	const override = nameOverride?.trim();
	if (override) {
		return override;
	}

	const source = resolveLabelSourcePath(pathOrName);
	const stem = getFileStem(source);
	if (!stem || looksUnresolvedName(stem)) {
		return "";
	}

	return stem;
}

/**
 * Builds the burned-in label text, e.g. `recording-1730000000000 · 30 Oct 2025, 14:32`.
 * Falls back to just the name when no capture timestamp can be recovered, and to
 * no label at all when the clip name cannot be established safely.
 */
export function buildRecordingLabelText(options: {
	pathOrName: string;
	nameOverride?: string | null;
	locale: string;
	fallbackStartMs?: number;
}): string {
	const name = getRecordingDisplayName(options.pathOrName, options.nameOverride);
	if (!name) {
		return "";
	}

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
