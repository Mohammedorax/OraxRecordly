import { describe, expect, it } from "vitest";
import { isRegionRecordingSupported } from "./regionRecordingSupport";

describe("region recording support", () => {
	it("is offered on the platforms whose recorder crops", () => {
		expect(isRegionRecordingSupported("win32")).toBe(true);
		// macOS sends the full display and crops each frame with the window cropper.
		expect(isRegionRecordingSupported("darwin")).toBe(true);
	});

	it("is not offered where the crop cannot happen", () => {
		// The portal/browser capture path used on Linux cannot crop at all, so a
		// drawn area would silently record the whole screen.
		expect(isRegionRecordingSupported("linux")).toBe(false);
	});

	it("treats an unknown platform as unsupported", () => {
		expect(isRegionRecordingSupported(undefined)).toBe(false);
		expect(isRegionRecordingSupported(null)).toBe(false);
		expect(isRegionRecordingSupported("")).toBe(false);
	});
});
