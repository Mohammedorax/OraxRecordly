import { describe, expect, it } from "vitest";
import { isBenignPlaybackInterruption } from "./playbackErrors";

/** The exact rejection Chromium produced after an export finished. */
const CHROMIUM_INTERRUPTION =
	"The play() request was interrupted by a call to pause(). https://goo.gl/LdLk22";

describe("playback error classification", () => {
	it("treats an interrupted play() as control flow, not a failure", () => {
		expect(isBenignPlaybackInterruption(CHROMIUM_INTERRUPTION)).toBe(true);
		expect(isBenignPlaybackInterruption("Play request was interrupted by a call to seek")).toBe(
			true,
		);
		const abortError = new Error(CHROMIUM_INTERRUPTION);
		abortError.name = "AbortError";
		expect(isBenignPlaybackInterruption(abortError)).toBe(true);
	});

	it("still reports real failures", () => {
		expect(
			isBenignPlaybackInterruption(
				new Error("Failed to load because no supported source was found"),
			),
		).toBe(false);
		expect(isBenignPlaybackInterruption(new Error("MEDIA_ERR_DECODE"))).toBe(false);
		expect(isBenignPlaybackInterruption(undefined)).toBe(false);
	});
});
