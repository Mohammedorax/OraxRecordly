import fs from "node:fs/promises";
import path from "node:path";
import type { BrowserWindow, DesktopCapturerSource, Display, NativeImage } from "electron";
import { clipboard, desktopCapturer, dialog, ipcMain, nativeImage } from "electron";
import { buildScreenshotFileName } from "../../../src/utils/screenshotFileName";
import {
	SCREENSHOT_CAPTURE_FULL_SCREEN_CHANNEL,
	SCREENSHOT_CAPTURE_REGION_CHANNEL,
	SCREENSHOT_CAPTURE_SELECTED_SOURCE_CHANNEL,
	SCREENSHOT_OPEN_IMAGE_EDITOR_CHANNEL,
	SCREENSHOT_READ_IMAGE_FILE_CHANNEL,
	SCREENSHOT_WRITE_IMAGE_FILE_CHANNEL,
} from "../../screenshotEvents";
import { openImageEditorWindow, selectRegionOnDisplay } from "../../screenshotWindows";
import { beginHudCaptureProtectionForScreenshot, createCountdownWindow } from "../../windows";
import {
	buildScreenshotWritePath,
	readScreenshotPreferencesSafe,
	type ScreenshotsFolderResolution,
	writeScreenshotFileExclusive,
} from "../screenshotStorage";
import {
	readScreenshotPreferences,
	type ScreenshotCaptureMode,
	updateScreenshotPreferences,
} from "../settings/screenshotPreferencesStore";
import { selectedSource, setCountdownInProgress, setCountdownRemaining } from "../state";
import type { SelectedSource } from "../types";
import { getScreen } from "../utils";
import { resolveWindowsCaptureDisplay } from "../windowsCaptureSelection";

export { buildScreenshotFileName };

/**
 * Content protection is applied natively; give the compositor a moment before
 * grabbing pixels so the HUD is already excluded from the capture.
 */
const HUD_CAPTURE_PROTECTION_SETTLE_MS = 120;
// The countdown overlay paints its first frame shortly after the document loads;
// re-publishing the current value after this settle window covers the gap before
// the renderer subscribes to `countdown-tick`.
const COUNTDOWN_WINDOW_SETTLE_MS = 200;
const COUNTDOWN_TICK_CHANNEL = "countdown-tick";
const IMAGE_DATA_URL_PATTERN = /^data:([^;,]*);base64,(.*)$/s;
const DATA_URL_MIME_TYPES: Record<string, string> = {
	png: "image/png",
	jpeg: "image/jpeg",
	jpg: "image/jpeg",
	webp: "image/webp",
};

export type ScreenshotResult = {
	success: boolean;
	path?: string;
	width?: number;
	height?: number;
	error?: string;
	fallback?: boolean;
	message?: string;
	canceled?: boolean;
	/** Set when a custom screenshots folder was unusable and the default was used. */
	folderFallback?: boolean;
};

/** Backwards-compatible alias used by the existing HUD screenshot button. */
export type CaptureScreenshotResult = ScreenshotResult;

export type ScreenshotWriteFormat = "png" | "jpeg";

export type ScreenshotWriteOptions = {
	format?: ScreenshotWriteFormat;
	quality?: number;
	saveAs?: boolean;
};

export type ScreenshotCaptureOptions = {
	displayId?: string;
};

export type ScreenshotReadResult = { success: boolean; dataUrl?: string; error?: string };
export type ScreenshotWriteResult = { success: boolean; path?: string; error?: string };

/** Image files opened (or saved) through the editor are approved for later reads. */
const approvedImagePaths = new Set<string>();

function getNativePixelSize(display: Display) {
	const scaleFactor =
		Number.isFinite(display.scaleFactor) && display.scaleFactor > 0 ? display.scaleFactor : 1;
	return {
		width: Math.max(1, Math.round(display.size.width * scaleFactor)),
		height: Math.max(1, Math.round(display.size.height * scaleFactor)),
	};
}

function isWindowSource(source: SelectedSource | null) {
	return source?.sourceType === "window" || source?.id?.startsWith("window:") === true;
}

/**
 * Request a thumbnail at least as large as the source's real pixels so
 * desktopCapturer cannot silently downscale the capture.
 */
function getThumbnailSize(
	targetDisplay: Display,
	allDisplays: Display[],
	source: SelectedSource | null,
) {
	const nativeSize = getNativePixelSize(targetDisplay);
	if (!isWindowSource(source)) {
		return nativeSize;
	}

	// A window's real size is unknown before enumeration, so request the largest
	// native display size available rather than the selected display's.
	let width = nativeSize.width;
	let height = nativeSize.height;
	for (const display of allDisplays) {
		const displaySize = getNativePixelSize(display);
		width = Math.max(width, displaySize.width);
		height = Math.max(height, displaySize.height);
	}
	return { width, height };
}

function findScreenSource(sources: DesktopCapturerSource[], displayId: string) {
	return sources.find(
		(candidate) =>
			candidate.id.startsWith("screen:") &&
			String(candidate.display_id ?? "") === String(displayId),
	);
}

/**
 * Resolve the source the recorder is using. Screen ids may be synthetic
 * (`screen:fallback:<displayId>` or the Linux portal id) so remember the display
 * as a second chance; if nothing matches, report that the primary display is
 * being captured instead of failing the screenshot.
 */
function findCaptureSource(
	sources: DesktopCapturerSource[],
	source: SelectedSource | null,
	primaryDisplayId: string,
) {
	if (source?.id) {
		const exactMatch = sources.find((candidate) => candidate.id === source.id);
		if (exactMatch) {
			return { source: exactMatch, fallback: false };
		}
	}

	if (!isWindowSource(source) && source?.display_id) {
		const displayMatch = findScreenSource(sources, source.display_id);
		if (displayMatch) {
			return { source: displayMatch, fallback: false };
		}
	}

	const primaryMatch = findScreenSource(sources, primaryDisplayId);
	if (primaryMatch) {
		return { source: primaryMatch, fallback: true };
	}

	const anyScreenSource = sources.find((candidate) => candidate.id.startsWith("screen:"));
	if (anyScreenSource) {
		return { source: anyScreenSource, fallback: true };
	}

	return { source: null, fallback: false };
}

async function getDesktopSources(thumbnailSize: { width: number; height: number }) {
	return await desktopCapturer.getSources({
		types: ["screen", "window"],
		thumbnailSize,
		fetchWindowIcons: false,
	});
}

/**
 * Screen-only enumeration used by full-screen and region capture: those modes
 * never need window sources, and the explicit `types` list keeps the request
 * cheap. `desktopCapturer.getSources` is called with a thumbnail size of at
 * least the display's physical pixels so nothing is silently downscaled.
 */
export async function getScreenOnlySources(thumbnailSize: { width: number; height: number }) {
	return await desktopCapturer.getSources({
		types: ["screen"],
		thumbnailSize,
		fetchWindowIcons: false,
	});
}

/**
 * Writes a PNG buffer using the shared name template + folder resolution, and
 * reports the file path together with the resolved folder (which may be the
 * fallback default when a custom folder was unusable).
 */
async function writeScreenshotFile(
	pngBuffer: Buffer,
	options: { fileNameTemplate?: string; appName?: string | null } = {},
) {
	const { filePath, folder } = await buildScreenshotWritePath(new Date(), {
		fileNameTemplate: options.fileNameTemplate,
		appName: options.appName ?? null,
		extension: "png",
	});
	const writtenPath = await writeScreenshotFileExclusive(filePath, pngBuffer);
	return { filePath: writtenPath, folder };
}

/** Copies a folder fallback report onto a capture result for the caller/UI. */
function reportFolderFallback(result: ScreenshotResult, folder: ScreenshotsFolderResolution) {
	if (!folder.fallback) {
		return result;
	}

	result.folderFallback = true;
	if (folder.fallbackReason) {
		result.message = result.message
			? `${result.message} ${folder.fallbackReason}`
			: folder.fallbackReason;
	}
	return result;
}

/**
 * Pick the display a standalone screenshot should target: the explicit
 * `displayId` when it matches, otherwise the display the cursor is on, and the
 * primary display as the last resort.
 */
export function resolveScreenshotDisplay(
	displayId: string | null | undefined,
	allDisplays: Display[],
	primaryDisplay: Display,
	cursorPoint: Electron.Point | null,
): Display {
	if (displayId) {
		const requested = allDisplays.find((display) => String(display.id) === String(displayId));
		if (requested) {
			return requested;
		}
	}

	if (cursorPoint) {
		const cursorDisplay = allDisplays.find((display) => {
			const { bounds } = display;
			return (
				cursorPoint.x >= bounds.x &&
				cursorPoint.x < bounds.x + bounds.width &&
				cursorPoint.y >= bounds.y &&
				cursorPoint.y < bounds.y + bounds.height
			);
		});
		if (cursorDisplay) {
			return cursorDisplay;
		}
	}

	return primaryDisplay;
}

/**
 * Convert a DIP selection rectangle (relative to the display) into a physical
 * pixel crop rect for `NativeImage.crop`.
 *
 * display.size is the display size in DIP, and captured images are
 * display.size * scaleFactor, so every edge is scaled and then clamped to the
 * captured image so the crop can never go out of bounds.
 */
export function toPhysicalCropRect(
	rect: { x: number; y: number; width: number; height: number },
	scaleFactor: number,
	imageSize: { width: number; height: number },
) {
	const imageWidth = Math.max(1, Math.round(imageSize.width));
	const imageHeight = Math.max(1, Math.round(imageSize.height));
	const factor = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;

	const left = Math.round(rect.x * factor);
	const top = Math.round(rect.y * factor);
	const right = Math.round((rect.x + rect.width) * factor);
	const bottom = Math.round((rect.y + rect.height) * factor);

	const x = Math.min(Math.max(0, left), Math.max(0, imageWidth - 1));
	const y = Math.min(Math.max(0, top), Math.max(0, imageHeight - 1));
	const clampedRight = Math.min(Math.max(right, x + 1), imageWidth);
	const clampedBottom = Math.min(Math.max(bottom, y + 1), imageHeight);

	return {
		x,
		y,
		width: Math.max(1, clampedRight - x),
		height: Math.max(1, clampedBottom - y),
	};
}

function scaleRectToNativeImage(thumbnail: NativeImage, targetDisplay: Display): NativeImage {
	const size = thumbnail.getSize();
	const requested = getNativePixelSize(targetDisplay);
	if (size.width === requested.width && size.height === requested.height) {
		return thumbnail;
	}

	// The compositor may hand back a thumbnail whose pixel size is the display's
	// native size scaled by a different factor (mixed-DPI setups). Resize on the
	// way in so the crop rect math stays in true physical pixels.
	if (size.width > 0 && size.height > 0) {
		return thumbnail.resize({ width: requested.width, height: requested.height });
	}

	return thumbnail;
}

async function captureDisplayImage(
	targetDisplay: Display,
): Promise<{ image: NativeImage; source: DesktopCapturerSource } | { error: string }> {
	const nativeSize = getNativePixelSize(targetDisplay);
	const sources = await getScreenOnlySources(nativeSize);
	const source = findScreenSource(sources, String(targetDisplay.id));

	if (!source) {
		return {
			error: `No capturable screen source is available for display ${targetDisplay.id}.`,
		};
	}

	const thumbnail = source.thumbnail;
	const size = thumbnail?.getSize();
	if (!size || size.width <= 0 || size.height <= 0) {
		return { error: `Desktop capture returned an empty image for "${source.name}".` };
	}

	return { image: scaleRectToNativeImage(thumbnail, targetDisplay), source };
}

function encodeCapturedImage(
	image: NativeImage,
	format: ScreenshotWriteFormat,
	quality: number,
): { buffer: Buffer; extension: string } {
	if (format === "jpeg") {
		return { buffer: image.toJPEG(quality), extension: "jpg" };
	}

	return { buffer: image.toPNG(), extension: "png" };
}

async function writeCapturedImage(
	image: NativeImage,
	format: ScreenshotWriteFormat,
	quality: number,
	options: { fileNameTemplate?: string; appName?: string | null } = {},
) {
	const { buffer, extension } = encodeCapturedImage(image, format, quality);
	if (!buffer || buffer.length === 0) {
		throw new Error("Image encoding produced no bytes.");
	}

	const { filePath, folder } = await buildScreenshotWritePath(new Date(), {
		fileNameTemplate: options.fileNameTemplate,
		appName: options.appName ?? null,
		extension,
	});
	const writtenPath = await writeScreenshotFileExclusive(filePath, buffer);
	return { filePath: writtenPath, folder };
}

async function applyPostCaptureActions(
	filePath: string,
	image: NativeImage,
	width: number,
	height: number,
) {
	let preferences: Awaited<ReturnType<typeof readScreenshotPreferences>>;
	try {
		preferences = await readScreenshotPreferences();
	} catch {
		return;
	}

	if (preferences.copyToClipboard) {
		try {
			clipboard.writeImage(image);
		} catch (error) {
			console.warn("Failed to copy the screenshot to the clipboard:", error);
		}
	}

	if (preferences.openEditorAfterCapture) {
		try {
			openImageEditorWindow(filePath);
		} catch (error) {
			console.warn("Failed to open the image editor after the capture:", error);
		}
	}

	console.log(`Screenshot saved: ${filePath} (${width}x${height})`);
}

function getDisplayOrPrimary(displayId: string | null | undefined) {
	const allDisplays = getScreen().getAllDisplays();
	const primaryDisplay = getScreen().getPrimaryDisplay();
	let cursorPoint: Electron.Point | null = null;
	try {
		cursorPoint = getScreen().getCursorScreenPoint();
	} catch {
		cursorPoint = null;
	}

	return {
		display: resolveScreenshotDisplay(displayId, allDisplays, primaryDisplay, cursorPoint),
	};
}

/**
 * Full-screen capture of the display under the cursor (or `options.displayId`),
 * at the display's native pixels. Requires no selected recording source.
 */
export async function captureScreenshotFullScreen(
	options?: ScreenshotCaptureOptions,
): Promise<ScreenshotResult> {
	const restoreHudCaptureProtection = beginHudCaptureProtectionForScreenshot();
	try {
		await applyCaptureDelayFromPreferences();
		await new Promise((resolve) => setTimeout(resolve, HUD_CAPTURE_PROTECTION_SETTLE_MS));

		const { display } = getDisplayOrPrimary(options?.displayId);
		const captured = await captureDisplayImage(display);
		if ("error" in captured) {
			return { success: false, error: captured.error };
		}

		const image = captured.image;
		const size = image.getSize();
		const preferences = await readScreenshotPreferencesSafe();
		const { filePath, folder } = await writeCapturedImage(
			image,
			preferences.format,
			preferences.jpegQuality,
			{
				fileNameTemplate: preferences.fileNameTemplate,
				appName: captured.source.name,
			},
		);
		await applyPostCaptureActions(filePath, image, size.width, size.height);
		await rememberLastCaptureMode("fullscreen");

		return reportFolderFallback(
			{
				success: true,
				path: filePath,
				width: size.width,
				height: size.height,
			},
			folder,
		);
	} catch (error) {
		console.error("Failed to capture the full screen:", error);
		return { success: false, error: error instanceof Error ? error.message : String(error) };
	} finally {
		restoreHudCaptureProtection();
	}
}

function wait(ms: number) {
	return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Visible pre-capture countdown, shared by every capture entry point (including
 * the system-wide shortcut). It reuses the countdown overlay window and its
 * `countdown-tick` channel, and publishes the remaining seconds through the
 * global countdown state so the window renders the current value even if it
 * subscribes after the first tick.
 */
async function applyScreenshotCaptureDelay(delayMs: number): Promise<void> {
	const seconds = Math.round(delayMs / 1000);
	if (!Number.isFinite(seconds) || seconds <= 0) {
		return;
	}

	let countdownWindow: BrowserWindow | null = null;
	try {
		countdownWindow = createCountdownWindow();
	} catch (error) {
		console.warn("Failed to open the screenshot countdown window:", error);
	}

	const publish = (remaining: number) => {
		setCountdownRemaining(remaining);
		if (!countdownWindow || countdownWindow.isDestroyed()) {
			return;
		}
		try {
			countdownWindow.webContents.send(COUNTDOWN_TICK_CHANNEL, remaining);
		} catch {
			// The window may be tearing down; the delay still elapses.
		}
	};

	setCountdownInProgress(true);
	setCountdownRemaining(seconds);
	if (countdownWindow) {
		const republish = () => publish(seconds);
		if (countdownWindow.webContents.isLoadingMainFrame()) {
			countdownWindow.webContents.once("did-finish-load", () => {
				void wait(COUNTDOWN_WINDOW_SETTLE_MS).then(republish);
			});
		} else {
			void wait(COUNTDOWN_WINDOW_SETTLE_MS).then(republish);
		}
	}

	try {
		for (let remaining = seconds; remaining > 0; remaining--) {
			publish(remaining);
			await wait(1000);
		}
	} finally {
		setCountdownRemaining(null);
		setCountdownInProgress(false);
		if (countdownWindow && !countdownWindow.isDestroyed()) {
			try {
				// Destroy synchronously so the overlay is gone before the capture
				// grabs pixels (a plain close is asynchronous).
				countdownWindow.destroy();
			} catch {
				// Already closing.
			}
		}
	}
}

/** Applies the stored capture delay before the capture starts. */
async function applyCaptureDelayFromPreferences(): Promise<void> {
	const preferences = await readScreenshotPreferencesSafe();
	if (preferences.captureDelayMs > 0) {
		await applyScreenshotCaptureDelay(preferences.captureDelayMs);
	}
}

/** Remembers the mode of the last successful capture so the HUD can repeat it. */
async function rememberLastCaptureMode(mode: ScreenshotCaptureMode): Promise<void> {
	try {
		await updateScreenshotPreferences({ lastCaptureMode: mode });
	} catch (error) {
		console.warn("Failed to remember the last screenshot capture mode:", error);
	}
}

/**
 * Region capture: show the selection overlay over the target display, then
 * capture that display in full and crop to the drawn rectangle in physical
 * pixels. Cancelling resolves `{ success: false, canceled: true }` without
 * writing a file.
 */
export async function captureScreenshotRegion(
	options?: ScreenshotCaptureOptions,
): Promise<ScreenshotResult> {
	const restoreHudCaptureProtection = beginHudCaptureProtectionForScreenshot();
	try {
		await applyCaptureDelayFromPreferences();
		const { display } = getDisplayOrPrimary(options?.displayId);
		const selection = await selectRegionOnDisplay(display);
		if (!selection) {
			return { success: false, canceled: true };
		}

		// The overlay has been destroyed by the time the selection resolves; give
		// the compositor the same settle window the HUD protection uses so the
		// overlay is fully gone from the captured pixels.
		await new Promise((resolve) => setTimeout(resolve, HUD_CAPTURE_PROTECTION_SETTLE_MS));

		const captured = await captureDisplayImage(display);
		if ("error" in captured) {
			return { success: false, error: captured.error };
		}

		const fullImage = captured.image;
		const fullSize = fullImage.getSize();
		const cropRect = toPhysicalCropRect(selection, display.scaleFactor, fullSize);
		const cropped = fullImage.crop(cropRect);
		const size = cropped.getSize();
		const preferences = await readScreenshotPreferencesSafe();
		const { filePath, folder } = await writeCapturedImage(
			cropped,
			preferences.format,
			preferences.jpegQuality,
			{
				fileNameTemplate: preferences.fileNameTemplate,
				appName: captured.source.name,
			},
		);
		await applyPostCaptureActions(filePath, cropped, size.width, size.height);
		await rememberLastCaptureMode("region");

		return reportFolderFallback(
			{
				success: true,
				path: filePath,
				width: size.width,
				height: size.height,
			},
			folder,
		);
	} catch (error) {
		console.error("Failed to capture the screen region:", error);
		return { success: false, error: error instanceof Error ? error.message : String(error) };
	} finally {
		restoreHudCaptureProtection();
	}
}

/** Entry point for the system-wide shortcut: a region ("snip") capture. */
export async function captureScreenshotFromGlobalShortcut(): Promise<ScreenshotResult> {
	const result = await captureScreenshotRegion();
	if (!result.success && !result.canceled) {
		console.warn("Screenshot shortcut capture failed:", result.error);
	}
	return result;
}

async function captureSelectedSourceScreenshot(): Promise<ScreenshotResult> {
	try {
		const allDisplays = getScreen().getAllDisplays();
		const primaryDisplay = getScreen().getPrimaryDisplay();
		const primaryDisplayId = String(primaryDisplay.id);
		const { displayId } = resolveWindowsCaptureDisplay(
			selectedSource,
			allDisplays,
			primaryDisplay,
		);
		const targetDisplay =
			allDisplays.find((display) => String(display.id) === String(displayId)) ??
			primaryDisplay;

		const thumbnailSize = getThumbnailSize(targetDisplay, allDisplays, selectedSource);
		const sources = await getDesktopSources(thumbnailSize);
		let { source: captureSource, fallback } = findCaptureSource(
			sources,
			selectedSource,
			primaryDisplayId,
		);

		if (fallback) {
			// Re-request at the primary display's native pixels when it is larger than
			// the selected display, so the fallback capture is not downscaled either.
			const primaryNativeSize = getNativePixelSize(primaryDisplay);
			if (
				primaryNativeSize.width > thumbnailSize.width ||
				primaryNativeSize.height > thumbnailSize.height
			) {
				const fallbackSources = await getDesktopSources(primaryNativeSize);
				captureSource = findCaptureSource(fallbackSources, null, primaryDisplayId).source;
			}
		}

		if (!captureSource) {
			return { success: false, error: "No capturable screen or window source is available." };
		}

		const thumbnail = captureSource.thumbnail;
		const size = thumbnail?.getSize();
		if (!size || size.width <= 0 || size.height <= 0) {
			return {
				success: false,
				error: `Desktop capture returned an empty image for "${captureSource.name}".`,
			};
		}

		const pngBuffer = thumbnail.toPNG();
		if (!pngBuffer || pngBuffer.length === 0) {
			return {
				success: false,
				error: `Desktop capture produced an empty PNG for "${captureSource.name}".`,
			};
		}

		const preferences = await readScreenshotPreferencesSafe();
		const { filePath, folder } = await writeScreenshotFile(pngBuffer, {
			fileNameTemplate: preferences.fileNameTemplate,
			appName: captureSource.name,
		});
		console.log(`Screenshot saved: ${filePath} (${size.width}x${size.height})`);
		await rememberLastCaptureMode("source");

		const result: ScreenshotResult = {
			success: true,
			path: filePath,
			width: size.width,
			height: size.height,
		};

		if (fallback) {
			result.fallback = true;
			result.message = `The selected source${
				selectedSource?.name ? ` "${selectedSource.name}"` : ""
			} is no longer available; captured the primary display instead.`;
		}

		return reportFolderFallback(result, folder);
	} catch (error) {
		console.error("Failed to capture screenshot:", error);
		return { success: false, error: error instanceof Error ? error.message : String(error) };
	}
}

export async function captureScreenshot(): Promise<ScreenshotResult> {
	// The Recordly HUD must never end up in the screenshot. Reuse the HUD capture
	// protection mechanism for the duration of the capture and restore the
	// previous state afterwards, including when the capture fails.
	const restoreHudCaptureProtection = beginHudCaptureProtectionForScreenshot();
	try {
		await applyCaptureDelayFromPreferences();
		await new Promise((resolve) => setTimeout(resolve, HUD_CAPTURE_PROTECTION_SETTLE_MS));
		return await captureSelectedSourceScreenshot();
	} finally {
		restoreHudCaptureProtection();
	}
}

/** Approves an image path for later reads by the image editor. */
export function approveImagePath(filePath: string) {
	const resolved = path.resolve(filePath);
	approvedImagePaths.add(resolved);
	return resolved;
}

/** True when the path was opened/saved through the editor before. */
export function isApprovedImagePath(filePath: string) {
	return approvedImagePaths.has(path.resolve(filePath));
}

/**
 * Editor callers pass JPEG quality either as a 0-1 ratio (canvas
 * `toDataURL` conventions) or as a 1-100 percentage; both are accepted.
 */
export function resolveJpegQuality(quality: number | undefined, fallback = 92): number {
	if (typeof quality !== "number" || !Number.isFinite(quality)) {
		return fallback;
	}

	if (quality > 0 && quality <= 1) {
		return Math.min(100, Math.max(1, Math.round(quality * 100)));
	}

	return Math.min(100, Math.max(1, Math.round(quality)));
}

function decodeImageDataUrl(
	dataUrl: string,
): { buffer: Buffer; format: ScreenshotWriteFormat } | { error: string } {
	const match = IMAGE_DATA_URL_PATTERN.exec(dataUrl);
	if (!match) {
		return {
			error: "The image data URL is not a supported base64 image/png or image/jpeg URL.",
		};
	}

	const mimeType = match[1] ?? "image/png";
	const base64 = match[2] ?? "";
	let buffer: Buffer;
	try {
		buffer = Buffer.from(base64, "base64");
	} catch {
		return { error: "The image data URL could not be decoded." };
	}

	if (buffer.length === 0) {
		return { error: "The image data URL decoded to an empty buffer." };
	}

	return { buffer, format: mimeType === "image/jpeg" ? "jpeg" : "png" };
}

/** Reads an image file and returns it as a base64 data URL. */
export async function readImageFileAsDataUrl(filePath: string): Promise<ScreenshotReadResult> {
	try {
		const resolved = path.resolve(filePath);
		const buffer = await fs.readFile(resolved);
		if (buffer.length === 0) {
			return { success: false, error: `Image file is empty: ${resolved}` };
		}

		const extension = path.extname(resolved).slice(1).toLowerCase();
		const mimeType = DATA_URL_MIME_TYPES[extension] ?? "image/png";
		approveImagePath(resolved);
		return { success: true, dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}` };
	} catch (error) {
		return { success: false, error: error instanceof Error ? error.message : String(error) };
	}
}

/** Writes (or re-encodes) an image file from a base64 data URL. */
export async function writeImageFile(
	filePath: string,
	dataUrl: string,
	options?: ScreenshotWriteOptions,
): Promise<ScreenshotWriteResult> {
	try {
		if (typeof dataUrl !== "string") {
			return { success: false, error: "An image data URL is required." };
		}

		const decoded = decodeImageDataUrl(dataUrl);
		if ("error" in decoded) {
			return { success: false, error: decoded.error };
		}

		const requestedFormat = options?.format;
		const format: ScreenshotWriteFormat =
			requestedFormat === "jpeg" || requestedFormat === "png"
				? requestedFormat
				: decoded.format;
		const image = nativeImage.createFromBuffer(decoded.buffer);
		if (image.isEmpty()) {
			return { success: false, error: "The image data URL did not decode into an image." };
		}

		let targetPath = path.resolve(filePath);
		if (options?.saveAs) {
			const result = await dialog.showSaveDialog({
				title: "Save Image",
				defaultPath: targetPath,
				filters:
					format === "jpeg"
						? [{ name: "JPEG Image", extensions: ["jpg", "jpeg"] }]
						: [{ name: "PNG Image", extensions: ["png"] }],
			});
			if (result.canceled || !result.filePath) {
				return { success: false, error: "Save cancelled." };
			}
			targetPath = result.filePath;
		}

		const requestedExtension = format === "jpeg" ? ".jpg" : ".png";
		if (path.extname(targetPath).toLowerCase() !== requestedExtension) {
			targetPath = `${targetPath}${requestedExtension}`;
		}

		const buffer =
			format === "jpeg" ? image.toJPEG(resolveJpegQuality(options?.quality)) : image.toPNG();
		if (!buffer || buffer.length === 0) {
			return { success: false, error: "Image encoding produced no bytes." };
		}

		await fs.mkdir(path.dirname(targetPath), { recursive: true });
		await fs.writeFile(targetPath, buffer);
		approveImagePath(targetPath);
		return { success: true, path: targetPath };
	} catch (error) {
		console.error("Failed to write the image file:", error);
		return { success: false, error: error instanceof Error ? error.message : String(error) };
	}
}

export async function openImageEditor(
	filePath: string,
): Promise<{ success: boolean; error?: string }> {
	try {
		if (typeof filePath !== "string" || filePath.trim().length === 0) {
			return { success: false, error: "An image path is required." };
		}

		const resolved = path.resolve(filePath);
		try {
			await fs.access(resolved);
		} catch {
			return { success: false, error: `Image file not found: ${resolved}` };
		}

		approveImagePath(resolved);
		openImageEditorWindow(resolved);
		return { success: true };
	} catch (error) {
		console.error("Failed to open the image editor:", error);
		return { success: false, error: error instanceof Error ? error.message : String(error) };
	}
}

/** Paths the renderer is allowed to re-read through the image editor IPC. */
export { isApprovedImagePath as wasImagePathApproved };

export function registerScreenshotHandlers() {
	ipcMain.handle(SCREENSHOT_CAPTURE_SELECTED_SOURCE_CHANNEL, () => captureScreenshot());
	ipcMain.handle(
		SCREENSHOT_CAPTURE_FULL_SCREEN_CHANNEL,
		(_event, options?: ScreenshotCaptureOptions) => captureScreenshotFullScreen(options),
	);
	ipcMain.handle(
		SCREENSHOT_CAPTURE_REGION_CHANNEL,
		(_event, options?: ScreenshotCaptureOptions) => captureScreenshotRegion(options),
	);
	ipcMain.handle(SCREENSHOT_OPEN_IMAGE_EDITOR_CHANNEL, (_event, filePath: string) =>
		openImageEditor(filePath),
	);
	ipcMain.handle(SCREENSHOT_READ_IMAGE_FILE_CHANNEL, (_event, filePath: string) =>
		readImageFileAsDataUrl(filePath),
	);
	ipcMain.handle(
		SCREENSHOT_WRITE_IMAGE_FILE_CHANNEL,
		(_event, filePath: string, dataUrl: string, options?: ScreenshotWriteOptions) =>
			writeImageFile(filePath, dataUrl, options),
	);
}
