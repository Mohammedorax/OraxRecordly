import { app, globalShortcut } from "electron";
import { readScreenshotPreferences } from "./ipc/settings/screenshotPreferencesStore";

let registeredAccelerator: string | null = null;

function canRegisterShortcuts(): boolean {
	return app.isReady();
}

export function getRegisteredScreenshotShortcut(): string | null {
	return registeredAccelerator;
}

export function unregisterScreenshotGlobalShortcut(): void {
	if (!registeredAccelerator) {
		return;
	}

	try {
		globalShortcut.unregister(registeredAccelerator);
	} catch (error) {
		console.warn("Failed to unregister the screenshot global shortcut:", error);
	}
	registeredAccelerator = null;
}

/**
 * Registers (or re-registers) the system-wide region-capture shortcut.
 *
 * Registration failures are expected when another application already owns the
 * accelerator, so they are logged and swallowed: the app keeps running without
 * a global shortcut instead of crashing.
 */
export function registerScreenshotGlobalShortcut(
	accelerator: string | null,
	handler: () => void,
): boolean {
	unregisterScreenshotGlobalShortcut();

	if (!accelerator) {
		return false;
	}

	if (!canRegisterShortcuts()) {
		// Called before `app.whenReady()`: Electron would throw, so report failure
		// and let the startup path re-run this once the app is ready.
		return false;
	}

	try {
		const registered = globalShortcut.register(accelerator, handler);
		if (!registered) {
			console.warn(
				`Screenshot global shortcut "${accelerator}" is already taken by another application; continuing without it.`,
			);
			return false;
		}

		registeredAccelerator = accelerator;
		console.log(`Screenshot global shortcut registered: ${accelerator}`);
		return true;
	} catch (error) {
		console.warn(`Failed to register screenshot global shortcut "${accelerator}":`, error);
		return false;
	}
}

/** Reads the stored accelerator and (re)registers it. Never throws. */
export async function syncScreenshotGlobalShortcut(handler: () => void): Promise<boolean> {
	try {
		const preferences = await readScreenshotPreferences();
		return registerScreenshotGlobalShortcut(preferences.globalShortcut, handler);
	} catch (error) {
		console.warn("Failed to sync the screenshot global shortcut:", error);
		return false;
	}
}
