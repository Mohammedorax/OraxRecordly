/**
 * Renderer-side access to images that already live on the user's machine.
 *
 * The scan itself runs in the main process (`electron/ipc/register/systemWallpapers.ts`)
 * because only it can read the Windows wallpaper registry and walk the
 * wallpaper folders. Everything here is lazy: nothing runs until the picker's
 * "From this device" section is opened.
 */

export type DeviceWallpaperSource = "desktop" | "themes" | "system" | "pictures" | "browse";

export interface DeviceWallpaperImage {
	/** Absolute path on disk; this is what gets stored in the project. */
	path: string;
	/** Humanised file name. */
	name: string;
	source: DeviceWallpaperSource;
	/** Loopback media-server URL, or an empty string when the server is unavailable. */
	url: string;
}

export interface DeviceWallpaperScanResult {
	images: DeviceWallpaperImage[];
	/** True when a safety cap stopped the scan early. */
	truncated: boolean;
	error?: string;
}

export interface DeviceWallpaperPickResult {
	image?: DeviceWallpaperImage;
	canceled: boolean;
	error?: string;
}

function hasSystemWallpaperApi() {
	return (
		typeof window !== "undefined" &&
		typeof window.electronAPI?.listSystemWallpapers === "function"
	);
}

export async function listDeviceWallpaperImages(): Promise<DeviceWallpaperScanResult> {
	if (!hasSystemWallpaperApi()) {
		return { images: [], truncated: false };
	}

	try {
		const result = await window.electronAPI.listSystemWallpapers();
		if (!result?.success) {
			return { images: [], truncated: false, error: result?.error };
		}

		return {
			images: Array.isArray(result.images) ? result.images : [],
			truncated: result.truncated === true,
		};
	} catch (error) {
		return { images: [], truncated: false, error: String(error) };
	}
}

export async function pickDeviceWallpaperImage(): Promise<DeviceWallpaperPickResult> {
	if (
		typeof window === "undefined" ||
		typeof window.electronAPI?.pickSystemWallpaperImage !== "function"
	) {
		return { canceled: false, error: "Image picker is unavailable" };
	}

	try {
		const result = await window.electronAPI.pickSystemWallpaperImage();
		if (result?.canceled) {
			return { canceled: true };
		}

		if (!result?.success || !result.image) {
			return { canceled: false, error: result?.error ?? "Image picker failed" };
		}

		return { image: result.image, canceled: false };
	} catch (error) {
		return { canceled: false, error: String(error) };
	}
}

/**
 * Ensures the currently selected device image is present in the grid even when
 * the lazy scan did not return it (for example a project reopened from disk
 * whose image now lives outside the scanned folders).
 */
export function withSelectedDeviceWallpaper(
	images: DeviceWallpaperImage[],
	selectedPath: string,
): DeviceWallpaperImage[] {
	if (!selectedPath || images.some((image) => image.path === selectedPath)) {
		return images;
	}

	const fileName = selectedPath.split(/[\\/]/).filter(Boolean).pop() ?? selectedPath;
	const label = fileName
		.replace(/\.[^.]+$/, "")
		.replace(/[_-]+/g, " ")
		.trim();

	return [
		{
			path: selectedPath,
			name: label || "Wallpaper image",
			source: "browse",
			url: "",
		},
		...images,
	];
}
