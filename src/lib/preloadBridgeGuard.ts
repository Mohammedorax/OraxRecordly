/**
 * Recovers from a renderer that started without the preload bridge.
 *
 * The bridge (`window.electronAPI`) is normally exposed before any renderer
 * script runs, but a renderer can come up without it: Electron's sandbox
 * bootstrap occasionally runs against a document that has no startup data
 * ("sandboxed_renderer.bundle.js script failed to run: Cannot destructure
 * property 'preloadScripts' of 'binding.startupData' as it is null"). Observed
 * on a GPU-less Windows CI runner and intermittently on a normal desktop.
 *
 * Without the bridge the app dies on its first settings read and shows the
 * generic "something went wrong" screen. One reload recovers, and the attempt is
 * remembered in `sessionStorage` so a genuinely broken build cannot loop.
 */

export const PRELOAD_BRIDGE_RETRY_KEY = "recordly.preload-bridge-retry";

/** True when the preload exposed its API on the given global object. */
export function isBridgeAvailable(target: object = globalThis): boolean {
	return typeof (target as { electronAPI?: unknown }).electronAPI !== "undefined";
}

/** Whether a missing bridge warrants a single automatic reload. */
export function shouldRetryForMissingBridge(options: {
	bridgeAvailable: boolean;
	alreadyRetried: boolean;
}): boolean {
	return !options.bridgeAvailable && !options.alreadyRetried;
}

/**
 * Installs the guard in a renderer window. No-ops outside Electron so a plain
 * browser session (the UI test harness, `npm run dev:ui`) is never reloaded.
 */
export function installPreloadBridgeGuard(targetWindow: Window = window): void {
	if (!/electron/i.test(targetWindow.navigator.userAgent)) {
		return;
	}

	let alreadyRetried = false;
	try {
		alreadyRetried = targetWindow.sessionStorage.getItem(PRELOAD_BRIDGE_RETRY_KEY) === "1";
	} catch {
		// Storage can be unavailable; a retry is still safe without the memory.
	}

	if (
		!shouldRetryForMissingBridge({
			bridgeAvailable: isBridgeAvailable(targetWindow),
			alreadyRetried,
		})
	) {
		return;
	}

	try {
		targetWindow.sessionStorage.setItem(PRELOAD_BRIDGE_RETRY_KEY, "1");
	} catch {
		// Ignore: the reload below is what matters.
	}

	targetWindow.location.reload();
}
