/**
 * Which platforms can record a drawn region.
 *
 * "Record a region" crops every captured frame to a rectangle the user draws.
 *
 *   - Windows: the capture helper (Windows Graphics Capture) crops the monitor
 *     capture to the rectangle.
 *   - macOS: ScreenCaptureKit sends the full display and the recorder cuts each
 *     frame with the same cropper it uses for a tracked window.
 *   - Linux: the portal/browser capture path cannot crop, so the option is not
 *     offered there rather than silently recording the whole screen.
 */
export const REGION_RECORDING_PLATFORMS = ["win32", "darwin"] as const;

export function isRegionRecordingSupported(platform: string | undefined | null): boolean {
	return platform === "win32" || platform === "darwin";
}
