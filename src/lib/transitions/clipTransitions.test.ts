import { describe, expect, it } from "vitest";
import {
	clipTransitionBlackAlpha,
	DEFAULT_CLIP_TRANSITION_SETTINGS,
	MAX_CLIP_TRANSITION_DURATION_MS,
	MIN_CLIP_TRANSITION_DURATION_MS,
	normalizeClipTransitionSettings,
	resolveClipTransitionWindows,
} from "./clipTransitions";

const fade = (durationMs: number) => normalizeClipTransitionSettings({ kind: "fade", durationMs });

describe("clip transition settings", () => {
	it("defaults to a fade and keeps a stored value", () => {
		expect(DEFAULT_CLIP_TRANSITION_SETTINGS).toEqual({ kind: "fade", durationMs: 320 });
		expect(normalizeClipTransitionSettings({ durationMs: 500 })).toEqual({
			kind: "fade",
			durationMs: 500,
		});
	});

	it("clamps the duration and falls back for corrupt input", () => {
		expect(normalizeClipTransitionSettings({ durationMs: 5 }).durationMs).toBe(
			MIN_CLIP_TRANSITION_DURATION_MS,
		);
		expect(normalizeClipTransitionSettings({ durationMs: 99_999 }).durationMs).toBe(
			MAX_CLIP_TRANSITION_DURATION_MS,
		);
		expect(normalizeClipTransitionSettings({ kind: "wipe", durationMs: "x" })).toEqual(
			DEFAULT_CLIP_TRANSITION_SETTINGS,
		);
	});
});

describe("clip transition windows", () => {
	it("places one fade on every cut between touching clips", () => {
		const windows = resolveClipTransitionWindows(
			[
				{ startMs: 0, endMs: 4_000 },
				{ startMs: 4_000, endMs: 8_000 },
				{ startMs: 8_000, endMs: 12_000 },
			],
			fade(400),
		);

		expect(windows).toEqual([
			{ boundaryMs: 4_000, startMs: 3_800, endMs: 4_200 },
			{ boundaryMs: 8_000, startMs: 7_800, endMs: 8_200 },
		]);
	});

	it("ignores gaps, the first clip and a disabled setting", () => {
		const clips = [
			{ startMs: 0, endMs: 2_000 },
			{ startMs: 3_000, endMs: 5_000 },
		];
		expect(resolveClipTransitionWindows(clips, fade(400))).toEqual([]);
		expect(
			resolveClipTransitionWindows(clips, normalizeClipTransitionSettings({ kind: "none" })),
		).toEqual([]);
	});

	it("shortens a fade so it fits a very short clip instead of overlapping", () => {
		const windows = resolveClipTransitionWindows(
			[
				{ startMs: 0, endMs: 1_000 },
				{ startMs: 1_000, endMs: 1_200 },
				{ startMs: 1_200, endMs: 3_000 },
			],
			fade(800),
		);

		// The 200 ms middle clip halves both of its fades: 100 ms to each side.
		expect(windows[0]).toEqual({ boundaryMs: 1_000, startMs: 900, endMs: 1_100 });
		expect(windows[1]).toEqual({ boundaryMs: 1_200, startMs: 1_100, endMs: 1_300 });
	});
});

describe("fade coverage", () => {
	const windows = resolveClipTransitionWindows(
		[
			{ startMs: 0, endMs: 2_000 },
			{ startMs: 2_000, endMs: 4_000 },
		],
		fade(400),
	);

	it("is black at the cut and clear away from it", () => {
		expect(clipTransitionBlackAlpha(1_000, windows)).toBe(0);
		expect(clipTransitionBlackAlpha(2_000, windows)).toBe(1);
	});

	it("ramps in before the cut and out after it", () => {
		expect(clipTransitionBlackAlpha(1_900, windows)).toBeCloseTo(0.5, 4);
		expect(clipTransitionBlackAlpha(2_100, windows)).toBeCloseTo(0.5, 4);
		expect(clipTransitionBlackAlpha(1_800, windows)).toBe(0);
		expect(clipTransitionBlackAlpha(2_200, windows)).toBe(0);
	});
});
