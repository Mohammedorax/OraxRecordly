import type { CaptionEditTarget } from "./captionEditing";
import type {
	AutoCaptionAnimation,
	AutoCaptionSettings,
	CaptionCue,
	CaptionCueWord,
} from "./types";

export type CaptionWordState = "spoken" | "active" | "upcoming";

export interface CaptionWordLayout {
	cueId: string;
	cueWordIndex: number;
	text: string;
	index: number;
	forcedBreakBefore: boolean;
	leadingSpace: boolean;
	startMs: number;
	endMs: number;
	hasRealTiming: boolean;
	state: CaptionWordState;
}

export interface CaptionLineLayout {
	words: CaptionWordLayout[];
	width: number;
	startWordIndex: number;
	endWordIndex: number;
}

interface CaptionPageLayout {
	lines: CaptionLineLayout[];
	startMs: number;
	endMs: number;
}

export interface ActiveCaptionLayout {
	cue: CaptionCue;
	blockKey: string;
	visibleLines: CaptionLineLayout[];
	hasWordTimings: boolean;
	activeWordIndex: number;
	activeWordProgress: number;
	editTarget: CaptionEditTarget;
	visiblePageIndex: number;
	opacity: number;
	translateY: number;
	scale: number;
}

/**
 * Holds the time-invariant half of a caption layout (flattened words, line
 * breaks, pages). Building it runs canvas `measureText` 2-3x per word across
 * every cue, which is far too expensive to repeat for each exported frame.
 * Callers that render many frames with the same cues/settings can own one of
 * these and pass it to `buildActiveCaptionLayout`; the cached geometry is
 * invalidated automatically when the cues or the layout settings change.
 */
export interface CaptionLayoutCache {
	signature: string;
	sortedCues: CaptionCue[];
	sourceWords: ReturnType<typeof flattenCaptionWords>;
	words: CaptionWordLayout[];
	lines: CaptionLineLayout[];
	pages: CaptionPageLayout[];
	maxRows: number;
}

export function createCaptionLayoutCache(): CaptionLayoutCache {
	return {
		signature: "",
		sortedCues: [],
		sourceWords: [],
		words: [],
		lines: [],
		pages: [],
		maxRows: 1,
	};
}

type CaptionSourceWord = {
	cueId: string;
	cueWordIndex: number;
	text: string;
	forcedBreakBefore: boolean;
	leadingSpace?: boolean;
	startMs?: number;
	endMs?: number;
};

export const CAPTION_ENTER_MS = 180;
// Keep the exit symmetric with the entrance so captions fade out with the
// same opacity/translateY/scale curve and duration they faded in with.
export const CAPTION_EXIT_MS = CAPTION_ENTER_MS;
const CAPTION_BLOCK_GAP_BREAK_MS = 500;

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function clamp01(value: number) {
	return clamp(value, 0, 1);
}

function splitCaptionWordsFromText(text: string) {
	const sourceLines = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	const words: CaptionSourceWord[] = [];

	sourceLines.forEach((line, lineIndex) => {
		line.split(/\s+/)
			.filter(Boolean)
			.forEach((word, wordIndex) => {
				words.push({
					cueId: "",
					cueWordIndex: words.length,
					text: word,
					forcedBreakBefore: lineIndex > 0 && wordIndex === 0,
				});
			});
	});

	return words;
}

function splitCaptionWords(cue: CaptionCue) {
	if (Array.isArray(cue.words) && cue.words.length > 0) {
		const words = cue.words
			.filter((word): word is CaptionCueWord =>
				Boolean(word && typeof word.text === "string"),
			)
			.map((word, cueWordIndex) => ({
				cueId: cue.id,
				cueWordIndex,
				text: word.text.trim(),
				forcedBreakBefore: false,
				leadingSpace: Boolean(word.leadingSpace),
				startMs: word.startMs,
				endMs: word.endMs,
			}))
			.filter((word) => word.text.length > 0);

		if (words.length > 0) {
			return words;
		}
	}

	return splitCaptionWordsFromText(cue.text).map((word) => ({
		...word,
		cueId: cue.id,
	}));
}

function getActiveCaptionCue(cues: CaptionCue[], timeMs: number) {
	for (const cue of cues) {
		if (timeMs >= cue.startMs && timeMs <= cue.endMs) {
			return cue;
		}
	}

	return null;
}

function sortCaptionCues(cues: CaptionCue[]) {
	return [...cues].sort((left, right) => left.startMs - right.startMs);
}

function isWithinSortedCaptionCoverage(sorted: CaptionCue[], timeMs: number) {
	for (let index = 0; index < sorted.length; index += 1) {
		const cue = sorted[index];
		if (timeMs < cue.startMs) {
			return false;
		}
		const next = sorted[index + 1];
		const bridgesGap =
			next !== undefined && next.startMs - cue.endMs < CAPTION_BLOCK_GAP_BREAK_MS;
		const effectiveEndMs = bridgesGap ? Math.max(cue.endMs, next.startMs) : cue.endMs;
		if (timeMs <= effectiveEndMs) {
			return true;
		}
	}

	return false;
}

function isWithinCaptionCoverage(cues: CaptionCue[], timeMs: number) {
	return isWithinSortedCaptionCoverage(sortCaptionCues(cues), timeMs);
}

function mixCaptionLayoutHash(hash: number, value: string): number {
	let next = hash;
	for (let index = 0; index < value.length; index += 1) {
		next ^= value.charCodeAt(index);
		next = Math.imul(next, 16777619);
	}
	next ^= 0x2c;
	return Math.imul(next, 16777619);
}

/**
 * FNV-1a over everything that changes the cached geometry. Text is hashed
 * character-wise so in-place cue edits are caught without allocating a large
 * signature string on every frame.
 */
function getCaptionLayoutSignature(
	cues: CaptionCue[],
	settings: AutoCaptionSettings,
	maxWidthPx: number,
): string {
	let hash = 2166136261;
	hash = mixCaptionLayoutHash(hash, `${maxWidthPx}`);
	hash = mixCaptionLayoutHash(hash, settings.fontFamily ?? "");
	hash = mixCaptionLayoutHash(hash, `${settings.fontSize}`);
	hash = mixCaptionLayoutHash(hash, `${settings.maxWidth}`);
	hash = mixCaptionLayoutHash(hash, `${settings.maxRows ?? ""}`);

	for (const cue of cues) {
		hash = mixCaptionLayoutHash(hash, cue.id);
		hash = mixCaptionLayoutHash(hash, `${cue.startMs}`);
		hash = mixCaptionLayoutHash(hash, `${cue.endMs}`);
		hash = mixCaptionLayoutHash(hash, cue.text ?? "");
		for (const word of cue.words ?? []) {
			hash = mixCaptionLayoutHash(hash, word.text ?? "");
			hash = mixCaptionLayoutHash(hash, `${word.startMs ?? ""}`);
			hash = mixCaptionLayoutHash(hash, `${word.endMs ?? ""}`);
			hash = mixCaptionLayoutHash(hash, word.leadingSpace ? "1" : "0");
		}
	}

	return `${cues.length}:${hash >>> 0}`;
}

function getCaptionWordState(index: number, activeWordIndex: number): CaptionWordState {
	if (index < activeWordIndex) {
		return "spoken";
	}
	return index === activeWordIndex ? "active" : "upcoming";
}

function updateCaptionWordStates(
	words: CaptionWordLayout[],
	lines: CaptionLineLayout[],
	activeWordIndex: number,
): void {
	for (let index = 0; index < words.length; index += 1) {
		words[index].state = getCaptionWordState(index, activeWordIndex);
	}
	// buildCaptionLines spreads each word into a new object, so the line copies
	// need the same per-frame state update.
	for (const line of lines) {
		for (const word of line.words) {
			word.state = getCaptionWordState(word.index, activeWordIndex);
		}
	}
}

export function flattenCaptionWords(cues: CaptionCue[]) {
	const flattened: Array<{
		cueId: string;
		cueWordIndex: number;
		text: string;
		forcedBreakBefore: boolean;
		leadingSpace: boolean;
		startMs: number;
		endMs: number;
		hasRealTiming: boolean;
	}> = [];

	cues.forEach((cue, cueIndex) => {
		const sourceWords = splitCaptionWords(cue);
		if (sourceWords.length === 0) {
			return;
		}

		const cueHasRealWordTimings = sourceWords.every(
			(word) =>
				isFiniteNumber(word.startMs) &&
				isFiniteNumber(word.endMs) &&
				word.endMs > word.startMs,
		);
		const cueDuration = Math.max(1, cue.endMs - cue.startMs);
		const fallbackWordDuration = cueDuration / sourceWords.length;
		const previousCue = cueIndex > 0 ? cues[cueIndex - 1] : null;
		// Each cue is its own phrase, so always start a new line/page at a cue boundary.
		// Otherwise back-to-back phrases (a small gap) get re-packed together by width and
		// their boundary disappears on screen — we want one phrase shown at a time.
		const shouldForceCueBreak = previousCue !== null;

		sourceWords.forEach((word, wordIndex) => {
			const fallbackStartMs = cue.startMs + fallbackWordDuration * wordIndex;
			const fallbackEndMs =
				wordIndex === sourceWords.length - 1
					? cue.endMs
					: cue.startMs + fallbackWordDuration * (wordIndex + 1);
			const startsMergedCue =
				wordIndex === 0 && !word.forcedBreakBefore && !shouldForceCueBreak;
			const leadingSpace =
				wordIndex === 0
					? flattened.length > 0 && startsMergedCue
					: (word.leadingSpace ?? true);

			flattened.push({
				cueId: cue.id,
				cueWordIndex: word.cueWordIndex,
				text: word.text,
				forcedBreakBefore:
					word.forcedBreakBefore || (wordIndex === 0 && shouldForceCueBreak),
				leadingSpace,
				startMs: cueHasRealWordTimings ? word.startMs! : fallbackStartMs,
				endMs: cueHasRealWordTimings
					? word.endMs!
					: Math.max(fallbackStartMs + 1, fallbackEndMs),
				hasRealTiming: cueHasRealWordTimings,
			});
		});
	});

	return flattened;
}

function getCaptionAnimationState(
	animationStyle: AutoCaptionAnimation,
	enterProgress: number,
	exitProgress: number,
) {
	const visibility = Math.min(enterProgress, exitProgress);

	switch (animationStyle) {
		case "none":
			return {
				opacity: 1,
				translateY: 0,
				scale: 1,
			};
		case "fade":
			return {
				opacity: 0.3 + visibility * 0.7,
				translateY: 0,
				scale: 1,
			};
		case "rise":
			return {
				opacity: 0.25 + visibility * 0.75,
				translateY: (1 - visibility) * 18,
				scale: 0.985 + visibility * 0.015,
			};
		case "pop":
		default:
			return {
				opacity: 0.35 + visibility * 0.65,
				translateY: (1 - visibility) * 8,
				scale: 0.94 + visibility * 0.06,
			};
	}
}

function buildCaptionPages(options: {
	lines: CaptionLineLayout[];
	words: CaptionWordLayout[];
	maxRows: number;
	hasWordTimings: boolean;
	cue: CaptionCue;
}) {
	const pages: CaptionPageLayout[] = [];
	const totalPages = Math.max(1, Math.ceil(options.lines.length / options.maxRows));
	let lineIndex = 0;
	let remainingLines = options.lines.length;

	for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
		const remainingPages = totalPages - pageIndex;
		const pageSize = Math.min(
			options.maxRows,
			Math.max(1, Math.ceil(remainingLines / remainingPages)),
		);
		const pageLines = options.lines.slice(lineIndex, lineIndex + pageSize);
		if (pageLines.length === 0) {
			continue;
		}

		lineIndex += pageLines.length;
		remainingLines -= pageLines.length;

		if (options.hasWordTimings) {
			const firstWord = options.words[pageLines[0].startWordIndex];
			const lastWord = options.words[pageLines[pageLines.length - 1].endWordIndex];
			pages.push({
				lines: pageLines,
				startMs: firstWord?.startMs ?? options.cue.startMs,
				endMs: lastWord?.endMs ?? options.cue.endMs,
			});
			continue;
		}

		pages.push({
			lines: pageLines,
			startMs: 0,
			endMs: 0,
		});
	}

	if (!options.hasWordTimings) {
		const totalWords = Math.max(1, options.words.length);
		const cueDuration = Math.max(1, options.cue.endMs - options.cue.startMs);
		let elapsedMs = options.cue.startMs;

		pages.forEach((page, pageIndex) => {
			const pageWordCount = page.lines.reduce((count, line) => count + line.words.length, 0);
			const proportionalDuration = Math.round((cueDuration * pageWordCount) / totalWords);
			const nextElapsed =
				pageIndex === pages.length - 1
					? options.cue.endMs
					: Math.min(options.cue.endMs, elapsedMs + Math.max(1, proportionalDuration));

			page.startMs = elapsedMs;
			page.endMs = Math.max(elapsedMs + 1, nextElapsed);
			elapsedMs = page.endMs;
		});
	}

	for (let index = 0; index < pages.length - 1; index += 1) {
		pages[index].endMs = Math.max(pages[index].startMs + 1, pages[index + 1].startMs);
	}

	if (pages.length > 0) {
		pages[pages.length - 1].endMs = Math.max(
			pages[pages.length - 1].startMs + 1,
			options.cue.endMs,
		);
	}

	return pages;
}

function buildCaptionLines(options: {
	words: CaptionWordLayout[];
	maxWidthPx: number;
	measureText: (text: string) => number;
}) {
	const wordCount = options.words.length;
	const segmentWidths = options.words.map((word, index) => {
		if (index === 0) {
			return options.measureText(word.text);
		}

		return options.measureText(`${word.leadingSpace ? " " : ""}${word.text}`);
	});
	const plainWordWidths = options.words.map((word) => options.measureText(word.text));
	const bestCost = new Array<number>(wordCount + 1).fill(Number.POSITIVE_INFINITY);
	const nextBreak = new Array<number>(wordCount).fill(wordCount);

	bestCost[wordCount] = 0;

	for (let startIndex = wordCount - 1; startIndex >= 0; startIndex -= 1) {
		let lineWidth = plainWordWidths[startIndex];

		for (let endIndex = startIndex; endIndex < wordCount; endIndex += 1) {
			if (endIndex > startIndex) {
				if (options.words[endIndex].forcedBreakBefore) {
					break;
				}

				lineWidth += segmentWidths[endIndex];
			}

			if (lineWidth > options.maxWidthPx && endIndex > startIndex) {
				break;
			}

			const slack = Math.max(0, options.maxWidthPx - lineWidth);
			const fullness = options.maxWidthPx <= 0 ? 1 : lineWidth / options.maxWidthPx;
			const isLastLine = endIndex === wordCount - 1;
			const linePenalty = isLastLine
				? slack * slack * 0.18
				: slack * slack + (fullness < 0.72 ? (0.72 - fullness) * 26000 : 0);
			const candidateCost = linePenalty + bestCost[endIndex + 1];

			if (candidateCost < bestCost[startIndex]) {
				bestCost[startIndex] = candidateCost;
				nextBreak[startIndex] = endIndex + 1;
			}
		}
	}

	const lines: CaptionLineLayout[] = [];
	let startIndex = 0;

	while (startIndex < wordCount) {
		const endIndexExclusive = Math.max(startIndex + 1, nextBreak[startIndex]);
		const lineWords = options.words.slice(startIndex, endIndexExclusive).map((word, index) => ({
			...word,
			leadingSpace: index === 0 ? false : word.leadingSpace,
		}));
		const width = lineWords.reduce(
			(total, word, index) =>
				total +
				options.measureText(
					`${index === 0 ? "" : word.leadingSpace ? " " : ""}${word.text}`,
				),
			0,
		);

		lines.push({
			words: lineWords,
			width,
			startWordIndex: lineWords[0].index,
			endWordIndex: lineWords[lineWords.length - 1].index,
		});

		startIndex = endIndexExclusive;
	}

	return lines;
}

function getVisibleCaptionPageIndex(pages: CaptionPageLayout[], timeMs: number) {
	for (let index = 0; index < pages.length; index += 1) {
		if (timeMs >= pages[index].startMs && timeMs <= pages[index].endMs) {
			return index;
		}
	}

	return -1;
}

function getVisibleCaptionText(lines: CaptionLineLayout[]) {
	return lines
		.map((line) =>
			line.words
				.map((word, index) => `${index > 0 && word.leadingSpace ? " " : ""}${word.text}`)
				.join("")
				.trim(),
		)
		.filter(Boolean)
		.join(" ");
}

export function buildActiveCaptionLayout(options: {
	cues: CaptionCue[];
	timeMs: number;
	settings: AutoCaptionSettings;
	maxWidthPx: number;
	measureText: (text: string) => number;
	cache?: CaptionLayoutCache;
}) {
	type CaptionLayoutGeometry = {
		sourceWords: ReturnType<typeof flattenCaptionWords>;
		sortedCues: CaptionCue[];
		words: CaptionWordLayout[];
		lines: CaptionLineLayout[];
		pages: CaptionPageLayout[];
		maxRows: number;
	};

	const buildGeometry = (): CaptionLayoutGeometry => {
		const sourceWords = flattenCaptionWords(options.cues);
		const sortedCues = sortCaptionCues(options.cues);
		const maxRows = clamp(Math.round(options.settings.maxRows || 1), 1, 4);
		if (sourceWords.length === 0) {
			return { sourceWords, sortedCues, words: [], lines: [], pages: [], maxRows };
		}
		const words: CaptionWordLayout[] = sourceWords.map((word, index) => ({
			cueId: word.cueId,
			cueWordIndex: word.cueWordIndex,
			text: word.text,
			index,
			forcedBreakBefore: word.forcedBreakBefore,
			leadingSpace: word.leadingSpace,
			startMs: word.startMs,
			endMs: word.endMs,
			hasRealTiming: word.hasRealTiming,
			state: "upcoming",
		}));
		const lines = buildCaptionLines({
			words,
			maxWidthPx: options.maxWidthPx,
			measureText: options.measureText,
		});
		const pages = buildCaptionPages({
			lines,
			words,
			maxRows,
			hasWordTimings: true,
			cue: {
				id: sourceWords[0].cueId,
				startMs: sourceWords[0].startMs,
				endMs: sourceWords[sourceWords.length - 1].endMs,
				text: "",
			},
		});
		return { sourceWords, sortedCues, words, lines, pages, maxRows };
	};

	const cache = options.cache;
	let geometry: CaptionLayoutGeometry;
	if (cache) {
		const signature = getCaptionLayoutSignature(
			options.cues,
			options.settings,
			options.maxWidthPx,
		);
		if (cache.signature === signature) {
			geometry = cache;
		} else {
			geometry = buildGeometry();
			cache.signature = signature;
			cache.sortedCues = geometry.sortedCues;
			cache.sourceWords = geometry.sourceWords;
			cache.words = geometry.words;
			cache.lines = geometry.lines;
			cache.pages = geometry.pages;
			cache.maxRows = geometry.maxRows;
		}
	} else {
		geometry = buildGeometry();
	}

	const { sourceWords, sortedCues, words, lines, pages, maxRows } = geometry;

	if (sourceWords.length === 0) {
		return null;
	}

	if (!isWithinSortedCaptionCoverage(sortedCues, options.timeMs)) {
		return null;
	}

	let activeWordIndex = -1;
	activeWordIndex = sourceWords.findIndex(
		(word) => options.timeMs >= word.startMs && options.timeMs < word.endMs,
	);
	if (activeWordIndex < 0) {
		activeWordIndex = sourceWords.findIndex((word) => options.timeMs < word.startMs);
		activeWordIndex =
			activeWordIndex < 0
				? sourceWords.length - 1
				: clamp(activeWordIndex - 1, 0, sourceWords.length - 1);
	}
	// Cached word objects are reused across frames, so apply the per-frame state
	// in place instead of rebuilding the arrays.
	updateCaptionWordStates(words!, lines!, activeWordIndex);

	const visiblePageIndex = getVisibleCaptionPageIndex(pages!, options.timeMs);
	if (visiblePageIndex < 0) {
		return null;
	}
	const visiblePage = pages[visiblePageIndex] ?? null;
	const visibleLines = visiblePage?.lines ?? lines.slice(0, maxRows);
	const activeWord = activeWordIndex >= 0 ? words[activeWordIndex] : null;
	const activeWordProgress = activeWord
		? clamp01(
				(options.timeMs - activeWord.startMs) /
					Math.max(1, activeWord.endMs - activeWord.startMs),
			)
		: 0;
	const animationStartMs = visiblePage?.startMs ?? sourceWords[0].startMs;
	const animationEndMs = visiblePage?.endMs ?? sourceWords[sourceWords.length - 1].endMs;
	const pageStartWordIndex = visibleLines[0]?.startWordIndex ?? 0;
	const visibleWords = visibleLines.flatMap((line) => line.words);
	const visibleHasWordTimings = visibleWords.every((word) => word.hasRealTiming);
	const pageCueId = sourceWords[pageStartWordIndex]?.cueId ?? sourceWords[0].cueId;
	const activeCue =
		getActiveCaptionCue(options.cues, options.timeMs) ??
		options.cues.find((candidate) => candidate.id === pageCueId) ??
		options.cues[0];
	// `animationEndMs` is stretched to the next page's start (see buildCaptionPages)
	// so consecutive pages stay on screen with no gap. That's right for continuous
	// speech, but pages are built from every cue flattened together — so when a
	// caption component (cue) is the last before a pause, its stitched end points
	// across the silence into the next cue. exitProgress would then stay pinned at
	// 1 and the caption would vanish with no fade. Anchor the exit to the real end
	// of the visible words instead, and only when nothing follows within the
	// gap-break window (otherwise keep the stitched end so continuous page swaps
	// don't flicker).
	const visibleContentEndMs = visibleWords.reduce(
		(latest, word) => Math.max(latest, word.endMs),
		animationStartMs,
	);
	const willDisappear =
		options.settings.animationStyle !== "none" &&
		!isWithinCaptionCoverage(options.cues, visibleContentEndMs + 1);
	const exitAnchorMs = willDisappear ? visibleContentEndMs : animationEndMs;
	const enterProgress = clamp01((options.timeMs - animationStartMs) / CAPTION_ENTER_MS);
	const exitProgress = clamp01((exitAnchorMs - options.timeMs) / CAPTION_EXIT_MS);
	const animation = getCaptionAnimationState(
		options.settings.animationStyle,
		enterProgress,
		exitProgress,
	);
	// On a real disappearance the per-style opacity only eases to its readability
	// floor (~0.3) before the element unmounts, which reads as a snap. Fade fully
	// to 0 across the exit window so the caption leaves smoothly.
	const opacity = willDisappear ? animation.opacity * exitProgress : animation.opacity;

	return {
		cue: activeCue,
		blockKey: `${Math.round(animationStartMs)}-${Math.round(animationEndMs)}`,
		visibleLines,
		hasWordTimings: visibleHasWordTimings,
		activeWordIndex,
		activeWordProgress,
		editTarget: {
			id: `${Math.round(animationStartMs)}-${Math.round(animationEndMs)}:${visibleWords
				.map((word) => `${word.cueId}:${word.cueWordIndex}`)
				.join("|")}`,
			startMs: animationStartMs,
			endMs: animationEndMs,
			text: getVisibleCaptionText(visibleLines),
			words: visibleWords.map((word) => ({
				cueId: word.cueId,
				cueWordIndex: word.cueWordIndex,
				startMs: word.startMs,
				endMs: word.endMs,
				text: word.text,
				leadingSpace: word.leadingSpace,
			})),
		},
		visiblePageIndex,
		opacity,
		translateY: animation.translateY,
		scale: animation.scale,
	} satisfies ActiveCaptionLayout;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}
