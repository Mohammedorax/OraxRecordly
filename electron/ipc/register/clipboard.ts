import { clipboard, ipcMain, nativeImage } from "electron";

/**
 * Renderer windows are frequently not focused (image editor, HUD, toasts
 * raised from background work) and Chromium refuses `navigator.clipboard`
 * writes there. These channels let the renderer write through Electron's
 * native clipboard instead, which has no such permission gate.
 */
export const WRITE_CLIPBOARD_TEXT_CHANNEL = "write-clipboard-text";
export const WRITE_CLIPBOARD_IMAGE_CHANNEL = "write-clipboard-image";

export type ClipboardWriteResult = { success: boolean; error?: string };

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Copies plain text to the OS clipboard; non-string input is refused. */
export function writeClipboardText(text: string): ClipboardWriteResult {
	if (typeof text !== "string") {
		return { success: false, error: "Clipboard text must be a string." };
	}

	try {
		clipboard.writeText(text);
		return { success: true };
	} catch (error) {
		console.error("Failed to write text to the clipboard:", error);
		return { success: false, error: describeError(error) };
	}
}

/**
 * Copies a base64 image data URL (normally `canvas.toDataURL("image/png")`) to
 * the OS clipboard. An empty or undecodable data URL is refused before the
 * clipboard is touched, so a failed copy never replaces the existing contents.
 */
export function writeClipboardImage(dataUrl: string): ClipboardWriteResult {
	if (typeof dataUrl !== "string" || dataUrl.trim().length === 0) {
		return { success: false, error: "An image data URL is required." };
	}

	try {
		const image = nativeImage.createFromDataURL(dataUrl);
		if (!image || image.isEmpty()) {
			return { success: false, error: "The image data URL did not decode into an image." };
		}

		clipboard.writeImage(image);
		return { success: true };
	} catch (error) {
		console.error("Failed to write an image to the clipboard:", error);
		return { success: false, error: describeError(error) };
	}
}

export function registerClipboardHandlers() {
	ipcMain.handle(WRITE_CLIPBOARD_TEXT_CHANNEL, (_event, text: string) =>
		writeClipboardText(text),
	);
	ipcMain.handle(WRITE_CLIPBOARD_IMAGE_CHANNEL, (_event, dataUrl: string) =>
		writeClipboardImage(dataUrl),
	);
}
