import { afterEach, describe, expect, it, vi } from "vitest";
import {
	buildRecordingLabelText,
	getRecordingDisplayName,
	getRecordingStartTimeMs,
	resolveLabelSourcePath,
} from "./recordingLabelUtils";

afterEach(() => {
	vi.unstubAllGlobals();
});

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

describe("a preview URL is never burned in as the clip name", () => {
	const epochMs = 1_791_840_991_639;
	const filePath = `C:\\Users\\moham\\Videos\\OraxRecordly\\Cache\\recording-${epochMs}.mp4`;
	const legacyUrl = `http://127.0.0.1:54321/video?path=${encodeURIComponent(filePath)}`;

	it("resolves the file path behind a media URL", () => {
		vi.stubGlobal("window", {});
		expect(resolveLabelSourcePath(legacyUrl)).toBe(filePath);
		expect(getRecordingDisplayName(legacyUrl)).toBe(`recording-${epochMs}`);
		expect(getRecordingStartTimeMs(legacyUrl)).toBe(epochMs);
	});

	it("resolves the opaque handle form through the preload bridge", () => {
		vi.stubGlobal("window", {
			electronAPI: { resolveMediaTokenSync: () => filePath },
		});
		expect(getRecordingDisplayName("http://127.0.0.1:54321/video?i=abc")).toBe(
			`recording-${epochMs}`,
		);
	});

	it("reads a file URL as a path", () => {
		vi.stubGlobal("window", {});
		expect(resolveLabelSourcePath("file:///C:/Users/moham/My%20Clip.mp4")).toBe(
			"C:/Users/moham/My Clip.mp4",
		);
	});

	it("labels the clip with its name and date, not the address", () => {
		vi.stubGlobal("window", {});
		const label = buildRecordingLabelText({ pathOrName: legacyUrl, locale: "en-US" });

		expect(label.startsWith(`recording-${epochMs} · `)).toBe(true);
		for (const forbidden of ["video?", "path=", "%5C", "http:", "://"]) {
			expect(label).not.toContain(forbidden);
		}
	});

	it("draws no label at all when the value cannot be resolved into a name", () => {
		vi.stubGlobal("window", {});
		// A handle the bridge cannot resolve, and a query fragment that is not a path.
		expect(buildRecordingLabelText({ pathOrName: "http://127.0.0.1:1/video?i=stale" })).toBe(
			"",
		);
		expect(getRecordingDisplayName("video?path=C%3A%5Csecret.mp4")).toBe("");
	});
});
