/**
 * Which platforms can record a drawn region.
 *
 * "Record a region" crops every captured frame to a rectangle the user draws. That
 * crop is implemented in the Windows capture helper (Windows Graphics Capture),
 * so it is honest there and nowhere else:
 *
 *   - macOS records with ScreenCaptureKit, which tracks a *window* crop but has no
 *     source rectangle wired up for a drawn area
 *   - the browser/portal capture path used on Linux cannot crop at all
 *
 * The option used to be offered on every platform except Linux, so on macOS a user
 * who drew an area got a full-screen recording and no warning. Until the Swift
 * recorder takes a source rect, the option is shown only where it is real.
 */
export const REGION_RECORDING_PLATFORM = "win32";

export function isRegionRecordingSupported(platform: string | undefined | null): boolean {
	return platform === REGION_RECORDING_PLATFORM;
}
