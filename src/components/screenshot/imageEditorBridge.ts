/**
 * Renderer-side bridge for the lightweight image editor window.
 *
 * `window.electronAPI` is declared in `electron/electron-env.d.ts`; the image
 * file and clipboard helpers are added to that surface separately, so this
 * module is the single place the editor talks to the main process. Keeping the access
 * here means the component never has to widen the global declaration, and a
 * missing helper produces a clear error instead of a TypeError.
 */

export type ImageFileFormat = "png" | "jpeg";

export type ReadImageFileResult = {
	success: boolean;
	dataUrl?: string;
	error?: string;
};

export type WriteImageFileOptions = {
	format?: ImageFileFormat;
	quality?: number;
	saveAs?: boolean;
};

export type WriteImageFileResult = {
	success: boolean;
	path?: string;
	canceled?: boolean;
	error?: string;
};

export type WriteClipboardImageResult = {
	success: boolean;
	error?: string;
};

export interface ImageEditorBridge {
	readImageFile?: (path: string) => Promise<ReadImageFileResult>;
	writeImageFile?: (
		path: string,
		dataUrl: string,
		options?: WriteImageFileOptions,
	) => Promise<WriteImageFileResult>;
	writeClipboardImage?: (dataUrl: string) => Promise<WriteClipboardImageResult>;
	revealInFolder?: (
		path: string,
	) => Promise<{ success: boolean; error?: string; message?: string }>;
	getWindowChrome?: () => Promise<{ trafficLightsVisible: boolean }>;
}

function bridge(): ImageEditorBridge | null {
	if (typeof window === "undefined") return null;
	const api = window.electronAPI as unknown as ImageEditorBridge | undefined;
	return api ?? null;
}

/** The window was opened with `?windowType=image-editor&path=<absolute path>`. */
export function readImagePathFromLocation(search: string): string | null {
	const params = new URLSearchParams(search);
	const path = params.get("path");
	return path && path.trim().length > 0 ? path : null;
}

export async function readImageFile(path: string): Promise<ReadImageFileResult> {
	const api = bridge();
	if (!api?.readImageFile) {
		return { success: false, error: "readImageFile is not available in this build" };
	}
	try {
		const result = await api.readImageFile(path);
		if (!result || typeof result !== "object") {
			return { success: false, error: "readImageFile returned no result" };
		}
		return result;
	} catch (error) {
		return { success: false, error: describeError(error) };
	}
}

export async function writeImageFile(
	path: string,
	dataUrl: string,
	options?: WriteImageFileOptions,
): Promise<WriteImageFileResult> {
	const api = bridge();
	if (!api?.writeImageFile) {
		return { success: false, error: "writeImageFile is not available in this build" };
	}
	try {
		const result = await api.writeImageFile(path, dataUrl, options);
		if (!result || typeof result !== "object") {
			return { success: false, error: "writeImageFile returned no result" };
		}
		return result;
	} catch (error) {
		return { success: false, error: describeError(error) };
	}
}

/** True when the native clipboard bridge is available (the Electron build). */
export function canWriteClipboardImage(): boolean {
	return typeof bridge()?.writeClipboardImage === "function";
}

export async function writeClipboardImage(dataUrl: string): Promise<WriteClipboardImageResult> {
	const api = bridge();
	if (!api?.writeClipboardImage) {
		return { success: false, error: "writeClipboardImage is not available in this build" };
	}
	try {
		const result = await api.writeClipboardImage(dataUrl);
		if (!result || typeof result !== "object") {
			return { success: false, error: "writeClipboardImage returned no result" };
		}
		return result;
	} catch (error) {
		return { success: false, error: describeError(error) };
	}
}

export async function revealInFolder(path: string): Promise<boolean> {
	const api = bridge();
	if (!api?.revealInFolder) return false;
	try {
		const result = await api.revealInFolder(path);
		return Boolean(result?.success);
	} catch {
		return false;
	}
}

/**
 * macOS draws its traffic lights over the window's top-left corner; the header
 * reserves room for them only when the platform actually shows them.
 */
export async function fetchTrafficLightsVisible(): Promise<boolean> {
	const api = bridge();
	if (!api?.getWindowChrome) return false;
	try {
		const chrome = await api.getWindowChrome();
		return Boolean(chrome?.trafficLightsVisible);
	} catch {
		return false;
	}
}

/** Format/quality used when the editor writes the edited image back. */
export function writeOptionsForPath(path: string, saveAs: boolean): WriteImageFileOptions {
	const extension = path.toLowerCase().split(".").pop() ?? "";
	const format: ImageFileFormat =
		extension === "jpg" || extension === "jpeg" || extension === "webp" ? "jpeg" : "png";
	return {
		format,
		quality: format === "jpeg" ? 0.92 : undefined,
		saveAs,
	};
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
