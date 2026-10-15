import { describe, expect, it } from "vitest";
import { isRegionRecordingSupported } from "./regionRecordingSupport";

describe("region recording support", () => {
	it("is offered on the platform whose capture helper crops", () => {
		expect(isRegionRecordingSupported("win32")).toBe(true);
	});

	it("is not offered where the crop cannot happen", () => {
		// macOS records through ScreenCaptureKit, which has no source rectangle
		// wired up for a drawn area; the browser capture path cannot crop at all.
		expect(isRegionRecordingSupported("darwin")).toBe(false);
		expect(isRegionRecordingSupported("linux")).toBe(false);
	});

	it("treats an unknown platform as unsupported", () => {
		expect(isRegionRecordingSupported(undefined)).toBe(false);
		expect(isRegionRecordingSupported(null)).toBe(false);
		expect(isRegionRecordingSupported("")).toBe(false);
	});
});
