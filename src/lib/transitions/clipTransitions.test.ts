import { describe, expect, it } from "vitest";
import {
	clipTransitionBlackAlpha,
	clipTransitionMixProgress,
	DEFAULT_CLIP_TRANSITION_SETTINGS,
	findActiveTransitionWindow,
	MAX_CLIP_TRANSITION_DURATION_MS,
	MIN_CLIP_TRANSITION_DURATION_MS,
	normalizeClipTransitionSettings,
	paintClipTransitionCoverage,
	resolveClipTransitionWindows,
	resolveTransitionClockMs,
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

describe("the transition clock", () => {
	it("samples the fade on the edited timeline, never on the source clock", () => {
		// Recorded 20 s, split at 10 s, first 3 s trimmed: the cut sits at timeline
		// 7000 ms while the source is already at 10000 ms. Reading the source clock
		// here is what put the fade in the wrong place, or removed it entirely.
		expect(
			resolveTransitionClockMs({
				timelineEffects: true,
				sourceTimestampUs: 10_000_000,
				timelineTimestampUs: 7_000_000,
			}),
		).toBe(7_000);
	});

	it("falls back to the source clock only when there is no edited timeline", () => {
		expect(
			resolveTransitionClockMs({
				timelineEffects: false,
				sourceTimestampUs: 2_500_000,
				timelineTimestampUs: 9_000_000,
			}),
		).toBe(2_500);
	});
});

describe("cross-dissolve", () => {
	const clips = [
		{ startMs: 0, endMs: 2_000 },
		{ startMs: 2_000, endMs: 4_000 },
	];
	const crossfade = normalizeClipTransitionSettings({ kind: "crossfade", durationMs: 600 });

	it("starts at the cut and runs forward, because the outgoing side is held", () => {
		expect(resolveClipTransitionWindows(clips, crossfade)).toEqual([
			{ boundaryMs: 2_000, startMs: 2_000, endMs: 2_600 },
		]);
	});

	it("never outlasts the clip it dissolves into", () => {
		const windows = resolveClipTransitionWindows(
			[
				{ startMs: 0, endMs: 1_000 },
				{ startMs: 1_000, endMs: 1_300 },
			],
			normalizeClipTransitionSettings({ kind: "crossfade", durationMs: 2_000 }),
		);

		expect(windows).toEqual([{ boundaryMs: 1_000, startMs: 1_000, endMs: 1_300 }]);
	});

	it("moves the incoming picture from invisible to fully visible", () => {
		const window = resolveClipTransitionWindows(clips, crossfade)[0];

		expect(findActiveTransitionWindow(1_999, [window])).toBeNull();
		expect(findActiveTransitionWindow(2_000, [window])).toBe(window);
		expect(clipTransitionMixProgress(2_000, window)).toBe(0);
		expect(clipTransitionMixProgress(2_300, window)).toBeCloseTo(0.5, 4);
		expect(clipTransitionMixProgress(2_600, window)).toBe(1);
		// Outside a window the incoming clip is simply fully visible.
		expect(clipTransitionMixProgress(5_000, null)).toBe(1);
	});

	it("keeps the fade window symmetric, unlike a dissolve", () => {
		const fadeWindow = resolveClipTransitionWindows(
			clips,
			normalizeClipTransitionSettings({ kind: "fade", durationMs: 600 }),
		)[0];

		expect(fadeWindow).toEqual({ boundaryMs: 2_000, startMs: 1_700, endMs: 2_300 });
	});

	it("leaves a clip too short to hold a fade without its fades overlapping", () => {
		// Two cuts 1 ms apart: a fade on each side would overlap, so neither is drawn.
		const windows = resolveClipTransitionWindows(
			[
				{ startMs: 0, endMs: 1_000 },
				{ startMs: 1_000, endMs: 1_001 },
				{ startMs: 1_001, endMs: 2_000 },
			],
			fade(600),
		);

		expect(windows).toEqual([]);
	});

	it("stops a dissolve at the next cut instead of swallowing the next clip", () => {
		const windows = resolveClipTransitionWindows(
			[
				{ startMs: 0, endMs: 1_000 },
				{ startMs: 1_000, endMs: 1_400 },
				{ startMs: 1_400, endMs: 3_000 },
			],
			normalizeClipTransitionSettings({ kind: "crossfade", durationMs: 2_000 }),
		);

		expect(windows).toEqual([
			{ boundaryMs: 1_000, startMs: 1_000, endMs: 1_400 },
			{ boundaryMs: 1_400, startMs: 1_400, endMs: 3_000 },
		]);
		// No two windows share a millisecond, so the coverage never jumps between them.
		for (let index = 1; index < windows.length; index += 1) {
			expect(windows[index].startMs).toBeGreaterThanOrEqual(windows[index - 1].endMs);
		}
	});
});

describe("painting the fade", () => {
	/** Records what the renderer asked a 2D surface to do. */
	function createSurface() {
		const fills: Array<{ x: number; y: number; width: number; height: number }> = [];
		let saves = 0;
		let restores = 0;
		let savedAlpha = 1;
		let savedFillStyle = "";
		const surface = {
			save: () => {
				saves += 1;
				savedAlpha = surface.globalAlpha;
				savedFillStyle = surface.fillStyle;
			},
			restore: () => {
				restores += 1;
				// A real context restores both properties; the mock has to as well,
				// otherwise the test cannot notice a missing restore().
				surface.globalAlpha = savedAlpha;
				surface.fillStyle = savedFillStyle;
			},
			fillRect: (x: number, y: number, width: number, height: number) => {
				fills.push({ x, y, width, height });
			},
			fillStyle: "#123456" as string,
			globalAlpha: 0.5,
		};
		return {
			surface,
			fills,
			counts: () => ({ saves, restores }),
		};
	}

	const windows = resolveClipTransitionWindows(
		[
			{ startMs: 0, endMs: 2_000 },
			{ startMs: 2_000, endMs: 4_000 },
		],
		normalizeClipTransitionSettings({ kind: "fade", durationMs: 400 }),
	);

	it("paints the whole frame in black at the cut", () => {
		const harness = createSurface();
		const painted = paintClipTransitionCoverage(harness.surface, {
			timeMs: 2_000,
			windows,
			width: 1_920,
			height: 1_080,
		});

		expect(painted).toBe(true);
		expect(harness.fills).toEqual([{ x: 0, y: 0, width: 1_920, height: 1_080 }]);
		// The surface is left exactly as it was found: neither property may leak
		// into whatever the renderer paints next.
		expect(harness.surface.globalAlpha).toBe(0.5);
		expect(harness.surface.fillStyle).toBe("#123456");
		expect(harness.counts()).toEqual({ saves: 1, restores: 1 });
	});

	it("paints nothing away from a cut", () => {
		const harness = createSurface();
		const painted = paintClipTransitionCoverage(harness.surface, {
			timeMs: 500,
			windows,
			width: 1_920,
			height: 1_080,
		});

		expect(painted).toBe(false);
		expect(harness.fills).toEqual([]);
		expect(harness.counts()).toEqual({ saves: 0, restores: 0 });
	});
});
