import { describe, expect, it } from "vitest";
import {
	buildActiveCaptionLayout,
	createCaptionLayoutCache,
	flattenCaptionWords,
} from "./captionLayout";
import { type CaptionCue, DEFAULT_AUTO_CAPTION_SETTINGS } from "./types";

describe("flattenCaptionWords", () => {
	it("forces a break at every cue boundary so each phrase shows on its own", () => {
		const cues: CaptionCue[] = [
			{
				id: "a",
				startMs: 0,
				endMs: 1_000,
				text: "hello world",
				words: [
					{ text: "hello", startMs: 0, endMs: 500 },
					{ text: "world", startMs: 500, endMs: 1_000, leadingSpace: true },
				],
			},
			{
				// back-to-back with cue "a" (no gap) — would previously be re-packed by width
				id: "b",
				startMs: 1_000,
				endMs: 2_000,
				text: "next one",
				words: [
					{ text: "next", startMs: 1_000, endMs: 1_500 },
					{ text: "one", startMs: 1_500, endMs: 2_000, leadingSpace: true },
				],
			},
		];

		const flattened = flattenCaptionWords(cues);
		const firstWordOfSecondCue = flattened.find(
			(word) => word.cueId === "b" && word.cueWordIndex === 0,
		);

		expect(firstWordOfSecondCue?.forcedBreakBefore).toBe(true);
		expect(firstWordOfSecondCue?.leadingSpace).toBe(false);
		// the very first word of the first cue never forces a break
		expect(flattened[0].forcedBreakBefore).toBe(false);
	});
});

describe("buildActiveCaptionLayout caching", () => {
	const cues: CaptionCue[] = [
		{
			id: "a",
			startMs: 1_000,
			endMs: 2_000,
			text: "hello world",
			words: [
				{ text: "hello", startMs: 1_000, endMs: 1_500 },
				{ text: "world", startMs: 1_500, endMs: 2_000, leadingSpace: true },
			],
		},
		{
			id: "b",
			startMs: 2_000,
			endMs: 3_000,
			text: "next one here",
			words: [
				{ text: "next", startMs: 2_000, endMs: 2_400 },
				{ text: "one", startMs: 2_400, endMs: 2_700, leadingSpace: true },
				{ text: "here", startMs: 2_700, endMs: 3_000, leadingSpace: true },
			],
		},
	];
	const maxWidthPx = 800;
	const settings = DEFAULT_AUTO_CAPTION_SETTINGS;
	const measure = (counter: { calls: number }) => (text: string) => {
		counter.calls += 1;
		return text.length * 8;
	};

	it("matches the uncached layout and serves cached frames without re-measuring", () => {
		const uncachedCounter = { calls: 0 };
		const uncached = buildActiveCaptionLayout({
			cues,
			timeMs: 1_250,
			settings,
			maxWidthPx,
			measureText: measure(uncachedCounter),
		});
		expect(uncached).not.toBeNull();

		const cache = createCaptionLayoutCache();
		const firstCounter = { calls: 0 };
		const first = buildActiveCaptionLayout({
			cues,
			timeMs: 1_250,
			settings,
			maxWidthPx,
			measureText: measure(firstCounter),
			cache,
		});
		expect(first).toEqual(uncached);
		expect(firstCounter.calls).toBe(uncachedCounter.calls);
		expect(firstCounter.calls).toBeGreaterThan(0);

		// A later frame with the same cues/settings must reuse the geometry.
		const hitCounter = { calls: 0 };
		const second = buildActiveCaptionLayout({
			cues,
			timeMs: 1_600,
			settings,
			maxWidthPx,
			measureText: measure(hitCounter),
			cache,
		});
		expect(hitCounter.calls).toBe(0);
		expect(second).toEqual(
			buildActiveCaptionLayout({
				cues,
				timeMs: 1_600,
				settings,
				maxWidthPx,
				measureText: measure({ calls: 0 }),
			}),
		);
	});

	it("invalidates the cached geometry when cues or settings change", () => {
		const cache = createCaptionLayoutCache();
		buildActiveCaptionLayout({
			cues,
			timeMs: 1_250,
			settings,
			maxWidthPx,
			measureText: measure({ calls: 0 }),
			cache,
		});

		const editedCues = cues.map((cue) =>
			cue.id === "a" ? { ...cue, text: "hello brave wide world" } : cue,
		);
		const editedCounter = { calls: 0 };
		const edited = buildActiveCaptionLayout({
			cues: editedCues,
			timeMs: 1_250,
			settings,
			maxWidthPx,
			measureText: measure(editedCounter),
			cache,
		});
		expect(editedCounter.calls).toBeGreaterThan(0);
		expect(edited).toEqual(
			buildActiveCaptionLayout({
				cues: editedCues,
				timeMs: 1_250,
				settings,
				maxWidthPx,
				measureText: measure({ calls: 0 }),
			}),
		);

		const resizedSettings = { ...settings, fontSize: settings.fontSize + 8 };
		const resizedCounter = { calls: 0 };
		buildActiveCaptionLayout({
			cues: editedCues,
			timeMs: 1_250,
			settings: resizedSettings,
			maxWidthPx,
			measureText: measure(resizedCounter),
			cache,
		});
		expect(resizedCounter.calls).toBeGreaterThan(0);
	});

	it("returns null outside caption coverage even with a warm cache", () => {
		const cache = createCaptionLayoutCache();
		buildActiveCaptionLayout({
			cues,
			timeMs: 1_250,
			settings,
			maxWidthPx,
			measureText: measure({ calls: 0 }),
			cache,
		});
		expect(
			buildActiveCaptionLayout({
				cues,
				timeMs: 60_000,
				settings,
				maxWidthPx,
				measureText: measure({ calls: 0 }),
				cache,
			}),
		).toBeNull();
	});
});
