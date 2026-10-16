import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	AUTOSTART_FILE_NAME,
	applyLinuxAutostart,
	buildAutostartEntry,
	getAutostartFilePath,
	readLinuxAutostartState,
} from "./linuxAutostart";

let home: string;

beforeEach(async () => {
	home = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-autostart-"));
});

afterEach(async () => {
	await fs.rm(home, { recursive: true, force: true });
});

describe("buildAutostartEntry", () => {
	it("starts the installed executable", () => {
		const entry = buildAutostartEntry({ execPath: "/opt/OraxRecordly/recordly" });

		expect(entry).toContain("[Desktop Entry]");
		expect(entry).toContain("Type=Application");
		expect(entry).toContain('Exec="/opt/OraxRecordly/recordly"');
		expect(entry).toContain("X-GNOME-Autostart-enabled=true");
	});

	it("prefers the AppImage that is actually running", () => {
		// Launching `process.execPath` for an AppImage points inside the mount that
		// disappears, so the image path is the one that survives a reboot.
		const entry = buildAutostartEntry({
			execPath: "/tmp/.mount_OraxRe/recordly",
			appImagePath: "/home/u/Apps/OraxRecordly-linux-x64.AppImage",
		});

		expect(entry).toContain('Exec="/home/u/Apps/OraxRecordly-linux-x64.AppImage"');
		expect(entry).not.toContain(".mount_");
	});

	it("passes the minimized flag when the user wants it", () => {
		const entry = buildAutostartEntry({
			execPath: "/usr/bin/recordly",
			startMinimized: true,
		});

		expect(entry).toContain('Exec="/usr/bin/recordly" --start-minimized');
	});

	it("quotes paths that contain spaces", () => {
		const entry = buildAutostartEntry({
			execPath: "/home/u/My Apps/OraxRecordly.AppImage",
		});

		expect(entry).toContain('Exec="/home/u/My Apps/OraxRecordly.AppImage"');
	});
});

describe("the login item on disk", () => {
	it("writes the entry under .config/autostart and removes it again", async () => {
		expect(readLinuxAutostartState(home)).toBe(false);

		expect(applyLinuxAutostart(true, { execPath: "/usr/bin/recordly" }, home)).toBe(true);
		expect(readLinuxAutostartState(home)).toBe(true);

		const filePath = getAutostartFilePath(home);
		expect(path.basename(filePath)).toBe(AUTOSTART_FILE_NAME);
		await expect(fs.readFile(filePath, "utf8")).resolves.toContain('Exec="/usr/bin/recordly"');

		expect(applyLinuxAutostart(false, { execPath: "/usr/bin/recordly" }, home)).toBe(false);
		expect(readLinuxAutostartState(home)).toBe(false);
	});

	it("does not fail when the entry is already absent", async () => {
		expect(applyLinuxAutostart(false, { execPath: "/usr/bin/recordly" }, home)).toBe(false);
	});
});
