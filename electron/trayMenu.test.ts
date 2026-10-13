import { describe, expect, it, vi } from "vitest";
import { buildTrayMenuTemplate, normalizeUiLanguage, trayLabels } from "./trayMenu";

const actions = () => ({
	open: vi.fn(),
	showControls: vi.fn(),
	stopRecording: vi.fn(),
	stopAndQuit: vi.fn(),
	quit: vi.fn(),
});

describe("normalizeUiLanguage", () => {
	it("accepts Arabic tags in any form", () => {
		expect(normalizeUiLanguage("ar")).toBe("ar");
		expect(normalizeUiLanguage("ar-SA")).toBe("ar");
		expect(normalizeUiLanguage(" AR ")).toBe("ar");
	});

	it("falls back to English for anything else", () => {
		expect(normalizeUiLanguage("en-US")).toBe("en");
		expect(normalizeUiLanguage("fr")).toBe("en");
		expect(normalizeUiLanguage(undefined)).toBe("en");
		expect(normalizeUiLanguage(42)).toBe("en");
	});
});

describe("buildTrayMenuTemplate", () => {
	it("labels the idle menu in the app language", () => {
		const ar = buildTrayMenuTemplate({
			language: "ar",
			recording: false,
			actions: actions(),
		});
		expect(ar.map((item) => item.label ?? "-")).toEqual(["افتح OraxRecordly", "خروج"]);

		const en = buildTrayMenuTemplate({
			language: "en",
			recording: false,
			actions: actions(),
		});
		expect(en.map((item) => item.label ?? "-")).toEqual(["Open OraxRecordly", "Quit"]);
	});

	it("offers stopping and quitting while recording, never a bare quit", () => {
		const handlers = actions();
		const items = buildTrayMenuTemplate({
			language: "en",
			recording: true,
			actions: handlers,
		});

		expect(items.map((item) => item.label ?? "-")).toEqual([
			"Recording continues in the background",
			"-",
			"Show controls",
			"Stop recording",
			"-",
			"Stop recording and quit",
		]);
		// A line that only reports state is not clickable, and no item may quit the
		// app while a recording is running without stopping it first.
		expect(items[0].enabled).toBe(false);
		expect(items.every((item) => item.click !== handlers.quit)).toBe(true);

		items[5].click?.();
		expect(handlers.stopAndQuit).toHaveBeenCalledTimes(1);
	});

	it("adds a separator before Quit when the app stays resident", () => {
		const items = buildTrayMenuTemplate({
			language: "ar",
			recording: false,
			runsInBackground: true,
			actions: actions(),
		});

		expect(items.map((item) => item.type ?? item.label)).toEqual([
			"افتح OraxRecordly",
			"separator",
			"خروج",
		]);
	});

	it("describes a recording in the tooltip with the source name", () => {
		expect(trayLabels("ar").recordingTooltip("الشاشة 1")).toBe("جارٍ التسجيل: الشاشة 1");
		expect(trayLabels("en").recordingTooltip("Screen 1")).toBe("Recording: Screen 1");
	});
});
