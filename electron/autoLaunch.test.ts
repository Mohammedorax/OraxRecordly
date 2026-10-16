import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const state = { openAtLogin: false, refuse: false };
	return {
		state,
		setLoginItemSettings: vi.fn((settings: { openAtLogin?: boolean }) => {
			if (!state.refuse) {
				state.openAtLogin = Boolean(settings.openAtLogin);
			}
		}),
	};
});

vi.mock("electron", () => ({
	app: {
		// `electron/appPaths.ts` reads userData at import time. These tests never
		// touch the settings file, so a throwaway directory is enough.
		getPath: () => os.tmpdir(),
		setPath: () => undefined,
		setLoginItemSettings: mocks.setLoginItemSettings,
		getLoginItemSettings: () => ({ openAtLogin: mocks.state.openAtLogin }),
	},
}));

import {
	applyAutoLaunchPreference,
	isAutoLaunchSupported,
	readLoginItemState,
	START_MINIMIZED_ARG,
	shouldStartMinimizedOnLaunch,
} from "./autoLaunch";
import * as linuxAutostart from "./linuxAutostart";

afterEach(() => {
	mocks.state.openAtLogin = false;
	mocks.state.refuse = false;
	mocks.setLoginItemSettings.mockClear();
});

describe("isAutoLaunchSupported", () => {
	it("supports all three desktop platforms", () => {
		// Linux implements it through ~/.config/autostart rather than Electron,
		// which has no login-item API there.
		expect(isAutoLaunchSupported("win32")).toBe(true);
		expect(isAutoLaunchSupported("darwin")).toBe(true);
		expect(isAutoLaunchSupported("linux")).toBe(true);
	});
});

describe("applyAutoLaunchPreference", () => {
	it("registers the running executable as a Windows login item", () => {
		const result = applyAutoLaunchPreference(true, "win32");

		expect(result).toEqual({ success: true, supported: true, openAtLogin: true });
		expect(mocks.setLoginItemSettings).toHaveBeenCalledWith({
			openAtLogin: true,
			path: process.execPath,
			args: [],
		});
	});

	it("removes the login item when the preference is turned off", () => {
		mocks.state.openAtLogin = true;

		const result = applyAutoLaunchPreference(false, "darwin");

		expect(result).toEqual({ success: true, supported: true, openAtLogin: false });
		expect(mocks.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: false });
	});

	it("reports an inline error instead of throwing when the OS refuses", () => {
		mocks.state.refuse = true;

		const result = applyAutoLaunchPreference(true, "win32");

		expect(result.success).toBe(false);
		expect(result.supported).toBe(true);
		expect(result.openAtLogin).toBe(false);
		expect(result.error).toContain("did not register");
	});

	it("writes a desktop entry on Linux instead of calling Electron", () => {
		const written: string[] = [];
		const linux = vi.spyOn(linuxAutostart, "applyLinuxAutostart").mockImplementation((open) => {
			written.push(String(open));
			return open;
		});

		try {
			const result = applyAutoLaunchPreference(true, "linux");

			expect(result).toEqual({ success: true, supported: true, openAtLogin: true });
			expect(written).toEqual(["true"]);
			// Electron itself cannot register a Linux login item.
			expect(mocks.setLoginItemSettings).not.toHaveBeenCalled();
		} finally {
			linux.mockRestore();
		}
	});
});

describe("readLoginItemState", () => {
	it("reports unsupported platforms without reading the OS login item", () => {
		expect(readLoginItemState("freebsd")).toEqual({ supported: false, openAtLogin: false });
	});

	it("reads the live login item on supported platforms", () => {
		mocks.state.openAtLogin = true;

		expect(readLoginItemState("win32")).toEqual({ supported: true, openAtLogin: true });
	});

	it("reads the Linux login item from the autostart file", () => {
		vi.spyOn(linuxAutostart, "readLinuxAutostartState").mockReturnValue(true);

		expect(readLoginItemState("linux")).toEqual({ supported: true, openAtLogin: true });
	});
});

describe("shouldStartMinimizedOnLaunch", () => {
	it("honors the stored preference", () => {
		expect(shouldStartMinimizedOnLaunch(true, [])).toBe(true);
		expect(shouldStartMinimizedOnLaunch(false, [])).toBe(false);
	});

	it("honors the --start-minimized argument", () => {
		expect(shouldStartMinimizedOnLaunch(false, [START_MINIMIZED_ARG])).toBe(true);
	});
});
