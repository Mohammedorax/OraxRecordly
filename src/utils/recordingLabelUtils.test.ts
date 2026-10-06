import { describe, expect, it } from "vitest";
import {
	buildRecordingLabelText,
	getRecordingDisplayName,
	getRecordingStartTimeMs,
} from "./recordingLabelUtils";

describe("recording label metadata", () => {
	it("recovers the capture start time from a recording file name", () => {
		const epochMs = 1_730_000_000_000;
		expect(getRecordingStartTimeMs(`C:\\videos\\recording-${epochMs}.mp4`)).toBe(epochMs);
		expect(getRecordingStartTimeMs(`/home/u/recording-${epochMs}-webcam.mp4`)).toBe(epochMs);
	});

	it("falls back when the file is not an app recording", () => {
		expect(getRecordingStartTimeMs("clip.mp4", 42)).toBe(42);
		expect(getRecordingStartTimeMs("recording-notanumber.mp4", 7)).toBe(7);
	});

	it("prefers a rename override for the display name", () => {
		expect(getRecordingDisplayName("C:\\v\\recording-123.mp4")).toBe("recording-123");
		expect(getRecordingDisplayName("C:\\v\\recording-123.mp4", "  My demo  ")).toBe("My demo");
	});

	it("builds a name + timestamp label for recordings", () => {
		const label = buildRecordingLabelText({
			pathOrName: "C:\\v\\recording-1730000000000.mp4",
			locale: "en-US",
			fallbackStartMs: 0,
		});
		expect(label.startsWith("recording-1730000000000 · ")).toBe(true);
		expect(label).toMatch(/\d{4}/);
	});

	it("omits the timestamp when it cannot be recovered", () => {
		expect(buildRecordingLabelText({ pathOrName: "imported.mp4", locale: "en-US" })).toBe(
			"imported",
		);
	});
});
