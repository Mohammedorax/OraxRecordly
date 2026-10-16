import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * "Start at login" on Linux.
 *
 * Electron has no `setLoginItemSettings` on Linux, so the feature used to be
 * declared unsupported there. The desktop environment's own mechanism is a file
 * in `~/.config/autostart`, which is what every Linux desktop reads, so Linux is a
 * first-class citizen here now.
 *
 * The entry and its contents are pure functions so the exact file a user will get
 * can be tested without touching a real home directory.
 */

export const AUTOSTART_FILE_NAME = "oraxrecordly.desktop";

export function getAutostartDirectory(homeDirectory = os.homedir()): string {
	return path.join(homeDirectory, ".config", "autostart");
}

export function getAutostartFilePath(homeDirectory = os.homedir()): string {
	return path.join(getAutostartDirectory(homeDirectory), AUTOSTART_FILE_NAME);
}

/**
 * The desktop entry. `Exec` points at the thing that is actually running: an
 * AppImage path when the app was launched from one, otherwise the installed
 * executable - launching the app through a path that no longer exists would make
 * the login item silently do nothing.
 */
export function buildAutostartEntry(options: {
	execPath: string;
	appImagePath?: string | null;
	startMinimized?: boolean;
}): string {
	const target = options.appImagePath?.trim() ? options.appImagePath.trim() : options.execPath;
	const args = options.startMinimized ? " --start-minimized" : "";
	// Quote the command: paths with spaces are the norm on desktops.
	const command = `"${target}"${args}`;

	return [
		"[Desktop Entry]",
		"Type=Application",
		"Version=1.0",
		"Name=OraxRecordly",
		"Comment=Screen recording and editing",
		`Exec=${command}`,
		"Terminal=false",
		"X-GNOME-Autostart-enabled=true",
		"StartupNotify=false",
		"",
	].join("\n");
}

/** True when the login item is present, which is how the UI reads the state. */
export function readLinuxAutostartState(homeDirectory = os.homedir()): boolean {
	return existsSync(getAutostartFilePath(homeDirectory));
}

/** The entry as it is on disk, or null when there is none. */
export function readLinuxAutostartEntry(homeDirectory = os.homedir()): string | null {
	try {
		return readFileSync(getAutostartFilePath(homeDirectory), "utf8");
	} catch {
		return null;
	}
}

/** Writes or removes the login item; returns whether the state now matches. */
export function applyLinuxAutostart(
	openAtLogin: boolean,
	options: { execPath: string; appImagePath?: string | null; startMinimized?: boolean },
	homeDirectory = os.homedir(),
): boolean {
	const filePath = getAutostartFilePath(homeDirectory);

	if (!openAtLogin) {
		rmSync(filePath, { force: true });
		return readLinuxAutostartState(homeDirectory);
	}

	mkdirSync(getAutostartDirectory(homeDirectory), { recursive: true });
	writeFileSync(filePath, buildAutostartEntry(options), "utf8");
	return readLinuxAutostartState(homeDirectory);
}
