import fs from "node:fs/promises";
import {
	DEFAULT_SCREENSHOT_FILE_NAME_TEMPLATE,
	SCREENSHOT_FILE_NAME_TEMPLATE_MAX_LENGTH,
} from "../../../src/utils/screenshotFileName";
import { SCREENSHOT_SETTINGS_FILE } from "../constants";
import { parseJsonWithByteOrderMark } from "../utils";

export type ScreenshotFormat = "png" | "jpeg";
export type ScreenshotCaptureMode = "fullscreen" | "region" | "source";
/** Preset delays offered by the settings UI, in milliseconds. */
export const SCREENSHOT_CAPTURE_DELAY_OPTIONS = [0, 3000, 5000] as const;
export type ScreenshotCaptureDelayMs = (typeof SCREENSHOT_CAPTURE_DELAY_OPTIONS)[number];

export interface ScreenshotPreferences {
	/** Stored screenshot/export image format. */
	format: ScreenshotFormat;
	/** JPEG quality, 1-100, clamped on read and write. */
	jpegQuality: number;
	/** Open the image editor window after a successful full-screen/region capture. */
	openEditorAfterCapture: boolean;
	/** System-wide accelerator that starts a region capture, or null when disabled. */
	globalShortcut: string | null;
	/** Copy the captured image to the system clipboard. */
	copyToClipboard: boolean;
	/** Countdown shown before the capture starts (0 disables it). */
	captureDelayMs: ScreenshotCaptureDelayMs;
	/** Last capture mode that finished successfully, or null before the first one. */
	lastCaptureMode: ScreenshotCaptureMode | null;
	/**
	 * Template for the saved file's base name. See
	 * `src/utils/screenshotFileName.ts` for the supported tokens.
	 */
	fileNameTemplate: string;
	/** Custom screenshots folder, or null for `<recordings dir>/Screenshots`. */
	folder: string | null;
}

export interface ScreenshotPreferencesPatch {
	format?: ScreenshotFormat;
	jpegQuality?: number;
	openEditorAfterCapture?: boolean;
	globalShortcut?: string | null;
	copyToClipboard?: boolean;
	captureDelayMs?: number;
	lastCaptureMode?: ScreenshotCaptureMode | null;
	fileNameTemplate?: string;
	folder?: string | null;
}

/**
 * Deliberately not `CommandOrControl+Shift+S`: the application menu already
 * binds that to "Save Project As…", and a menu accelerator wins over a global
 * shortcut while one of our windows is focused — the snip key would silently do
 * the wrong thing. `CommandOrControl+Alt+A` is free in the app.
 */
export const SCREENSHOT_DEFAULT_SHORTCUT = "CommandOrControl+Alt+A";
export const SCREENSHOT_JPEG_QUALITY_MIN = 1;
export const SCREENSHOT_JPEG_QUALITY_MAX = 100;

/**
 * Defaults preserve the behaviour an existing install already had: capture as a
 * lossless PNG, and only the new "open the editor" workflow is on by default.
 * `lastCaptureMode` deliberately has no default: the HUD only repeats a mode the
 * user has actually captured with before.
 */
export const DEFAULT_SCREENSHOT_PREFERENCES: ScreenshotPreferences = {
	format: "png",
	jpegQuality: 92,
	openEditorAfterCapture: true,
	globalShortcut: SCREENSHOT_DEFAULT_SHORTCUT,
	copyToClipboard: false,
	captureDelayMs: 0,
	lastCaptureMode: null,
	fileNameTemplate: DEFAULT_SCREENSHOT_FILE_NAME_TEMPLATE,
	folder: null,
};

export function clampJpegQuality(value: unknown, fallback: number): number {
	const numeric = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(numeric)) {
		return fallback;
	}

	return Math.min(
		SCREENSHOT_JPEG_QUALITY_MAX,
		Math.max(SCREENSHOT_JPEG_QUALITY_MIN, Math.round(numeric)),
	);
}

/**
 * Snap an arbitrary stored delay onto the closest offered preset, so a hand
 * edited or future value can never leave the delay picker without a selection.
 */
export function clampCaptureDelayMs(value: unknown, fallback: number): number {
	const numeric = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(numeric)) {
		return fallback;
	}

	let closest: number = SCREENSHOT_CAPTURE_DELAY_OPTIONS[0];
	for (const option of SCREENSHOT_CAPTURE_DELAY_OPTIONS) {
		if (Math.abs(option - numeric) < Math.abs(closest - numeric)) {
			closest = option;
		}
	}
	return closest;
}

function normalizeCaptureMode(value: unknown): ScreenshotCaptureMode | null {
	return value === "fullscreen" || value === "region" || value === "source" ? value : null;
}

/**
 * Clamps a stored file-name template: whitespace is collapsed onto single
 * spaces, the length is capped and a non-string/empty value falls back to the
 * default template.
 *
 * The template itself is deliberately *not* stripped of illegal characters
 * here; tokens are substituted and the rendered result sanitized at write time
 * (see `src/utils/screenshotFileName.ts`), so literal text in the template still
 * has to survive sanitization rather than being silently mangled on save.
 */
export function clampScreenshotFileNameTemplate(value: unknown, fallback: string): string {
	if (typeof value !== "string") {
		return fallback;
	}

	const collapsed = value.replace(/\s+/g, " ").trim();
	if (collapsed.length === 0) {
		return fallback;
	}

	const capped = collapsed.slice(0, SCREENSHOT_FILE_NAME_TEMPLATE_MAX_LENGTH).trim();
	return capped.length > 0 ? capped : fallback;
}

/**
 * A custom screenshots folder is a non-empty trimmed string; everything else
 * (including an empty string) means "use the default folder". Absoluteness and
 * usability are validated at capture time by `resolveScreenshotsFolder`, because
 * only the main process can create and probe directories.
 */
export function normalizeScreenshotFolder(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function normalizeScreenshotPreferences(
	raw: Record<string, unknown>,
): ScreenshotPreferences {
	const format: ScreenshotFormat = raw.format === "jpeg" ? "jpeg" : "png";
	const globalShortcut =
		typeof raw.globalShortcut === "string" && raw.globalShortcut.trim().length > 0
			? raw.globalShortcut.trim()
			: raw.globalShortcut === null
				? null
				: DEFAULT_SCREENSHOT_PREFERENCES.globalShortcut;

	return {
		format,
		jpegQuality: clampJpegQuality(raw.jpegQuality, DEFAULT_SCREENSHOT_PREFERENCES.jpegQuality),
		openEditorAfterCapture:
			typeof raw.openEditorAfterCapture === "boolean"
				? raw.openEditorAfterCapture
				: DEFAULT_SCREENSHOT_PREFERENCES.openEditorAfterCapture,
		globalShortcut,
		copyToClipboard:
			typeof raw.copyToClipboard === "boolean"
				? raw.copyToClipboard
				: DEFAULT_SCREENSHOT_PREFERENCES.copyToClipboard,
		captureDelayMs: clampCaptureDelayMs(
			raw.captureDelayMs,
			DEFAULT_SCREENSHOT_PREFERENCES.captureDelayMs,
		) as ScreenshotCaptureDelayMs,
		lastCaptureMode: normalizeCaptureMode(raw.lastCaptureMode),
		fileNameTemplate: clampScreenshotFileNameTemplate(
			raw.fileNameTemplate,
			DEFAULT_SCREENSHOT_PREFERENCES.fileNameTemplate,
		),
		folder: normalizeScreenshotFolder(raw.folder),
	};
}

function buildPatch(raw: ScreenshotPreferencesPatch): Record<string, unknown> {
	const patch: Record<string, unknown> = {};

	if (raw.format === "png" || raw.format === "jpeg") {
		patch.format = raw.format;
	}

	if (raw.jpegQuality !== undefined) {
		patch.jpegQuality = clampJpegQuality(
			raw.jpegQuality,
			DEFAULT_SCREENSHOT_PREFERENCES.jpegQuality,
		);
	}

	if (typeof raw.openEditorAfterCapture === "boolean") {
		patch.openEditorAfterCapture = raw.openEditorAfterCapture;
	}

	if (raw.globalShortcut === null) {
		patch.globalShortcut = null;
	} else if (typeof raw.globalShortcut === "string" && raw.globalShortcut.trim()) {
		patch.globalShortcut = raw.globalShortcut.trim();
	}

	if (typeof raw.copyToClipboard === "boolean") {
		patch.copyToClipboard = raw.copyToClipboard;
	}

	if (raw.captureDelayMs !== undefined) {
		patch.captureDelayMs = clampCaptureDelayMs(
			raw.captureDelayMs,
			DEFAULT_SCREENSHOT_PREFERENCES.captureDelayMs,
		);
	}

	if (raw.lastCaptureMode === null) {
		patch.lastCaptureMode = null;
	} else {
		const mode = normalizeCaptureMode(raw.lastCaptureMode);
		if (mode) {
			patch.lastCaptureMode = mode;
		}
	}

	if (raw.fileNameTemplate !== undefined) {
		patch.fileNameTemplate = clampScreenshotFileNameTemplate(
			raw.fileNameTemplate,
			DEFAULT_SCREENSHOT_PREFERENCES.fileNameTemplate,
		);
	}

	if (raw.folder === null) {
		patch.folder = null;
	} else if (raw.folder !== undefined) {
		patch.folder = normalizeScreenshotFolder(raw.folder);
	}

	return patch;
}

/**
 * Screenshot preferences live in their own userData JSON file so they can never
 * disturb (or be disturbed by) the recordings settings that share userData.
 */
export function createScreenshotPreferencesStore(filePath: string) {
	let operationQueue: Promise<void> = Promise.resolve();

	const readFile = async (): Promise<Record<string, unknown>> => {
		try {
			const content = await fs.readFile(filePath, "utf-8");
			const parsed = parseJsonWithByteOrderMark<unknown>(content);
			return parsed && typeof parsed === "object" && !Array.isArray(parsed)
				? (parsed as Record<string, unknown>)
				: {};
		} catch {
			return {};
		}
	};

	return {
		async read(): Promise<ScreenshotPreferences> {
			await operationQueue;
			return normalizeScreenshotPreferences(await readFile());
		},
		async update(patch: ScreenshotPreferencesPatch): Promise<ScreenshotPreferences> {
			const normalizedPatch = buildPatch(patch);
			const operation = operationQueue.then(async () => {
				const existing = await readFile();
				const next = { ...existing, ...normalizedPatch };
				await fs.writeFile(filePath, JSON.stringify(next, null, 2), "utf-8");
			});
			operationQueue = operation.catch(() => undefined);
			await operation;
			return normalizeScreenshotPreferences(await readFile());
		},
	};
}

export const screenshotPreferencesStore =
	createScreenshotPreferencesStore(SCREENSHOT_SETTINGS_FILE);

export async function readScreenshotPreferences(): Promise<ScreenshotPreferences> {
	return screenshotPreferencesStore.read();
}

export async function updateScreenshotPreferences(
	patch: ScreenshotPreferencesPatch,
): Promise<ScreenshotPreferences> {
	return screenshotPreferencesStore.update(patch);
}
