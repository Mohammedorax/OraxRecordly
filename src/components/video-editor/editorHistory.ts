import type {
	AnnotationRegion,
	AudioRegion,
	CaptionCue,
	ClipRegion,
	SpeedRegion,
	ZoomRegion,
} from "./types";

export type EditorHistorySnapshot = {
	zoomRegions: ZoomRegion[];
	clipRegions: ClipRegion[];
	speedRegions: SpeedRegion[];
	annotationRegions: AnnotationRegion[];
	audioRegions: AudioRegion[];
	autoCaptions: CaptionCue[];
	selectedZoomId: string | null;
	selectedClipId: string | null;
	selectedAnnotationId: string | null;
	selectedAudioId: string | null;
};

export type EditorHistoryStack = {
	past: EditorHistorySnapshot[];
	current: EditorHistorySnapshot | null;
	future: EditorHistorySnapshot[];
};

export type EditorHistoryRecordResult = "initialized" | "applied" | "recorded" | "unchanged";

export const MAX_EDITOR_HISTORY_ENTRIES = 100;

export function createEditorHistoryStack(): EditorHistoryStack {
	return {
		past: [],
		current: null,
		future: [],
	};
}

export function resetEditorHistoryStack(stack: EditorHistoryStack): void {
	stack.past = [];
	stack.current = null;
	stack.future = [];
}

export function cloneEditorHistorySnapshot(snapshot: EditorHistorySnapshot): EditorHistorySnapshot {
	return globalThis.structuredClone(snapshot);
}

function isComparableObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function areDeepEqual(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) {
		return true;
	}

	if (Array.isArray(left) || Array.isArray(right)) {
		if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
			return false;
		}

		return left.every((value, index) => areDeepEqual(value, right[index]));
	}

	if (!isComparableObject(left) || !isComparableObject(right)) {
		return false;
	}

	const leftKeys = Object.keys(left);
	const rightKeys = Object.keys(right);
	if (leftKeys.length !== rightKeys.length) {
		return false;
	}

	return leftKeys.every((key) => key in right && areDeepEqual(left[key], right[key]));
}

export function areEditorHistorySnapshotsEqual(
	left: EditorHistorySnapshot,
	right: EditorHistorySnapshot,
): boolean {
	return areDeepEqual(left, right);
}

/**
 * Record a snapshot in the undo stack.
 *
 * Callers must hand over a freshly built snapshot whose arrays/objects are
 * treated as immutable (every editor state setter replaces arrays instead of
 * mutating them). The stack therefore takes ownership of the object instead of
 * deep-cloning it: entries share unchanged region arrays, so a 100-deep history
 * no longer retains 100 full copies of e.g. every caption cue. Stored snapshots
 * are never mutated by this module — undo/redo copy on the way out.
 */
export function recordEditorHistorySnapshot(
	stack: EditorHistoryStack,
	snapshot: EditorHistorySnapshot,
	options: {
		applyingHistory?: boolean;
		maxEntries?: number;
	} = {},
): EditorHistoryRecordResult {
	if (!stack.current) {
		stack.current = snapshot;
		return "initialized";
	}

	if (options.applyingHistory) {
		stack.current = snapshot;
		return "applied";
	}

	if (areEditorHistorySnapshotsEqual(stack.current, snapshot)) {
		return "unchanged";
	}

	// `stack.current` is immutable and stops being the live entry the moment the
	// new snapshot replaces it, so it can be retained here without a copy.
	stack.past.push(stack.current);
	const maxEntries = options.maxEntries ?? MAX_EDITOR_HISTORY_ENTRIES;
	if (stack.past.length > maxEntries) {
		stack.past.shift();
	}

	stack.current = snapshot;
	stack.future = [];
	return "recorded";
}

export function undoEditorHistoryStack(
	stack: EditorHistoryStack,
	fallbackCurrent: EditorHistorySnapshot,
): EditorHistorySnapshot | null {
	if (stack.past.length === 0) {
		return null;
	}

	const current = stack.current ?? cloneEditorHistorySnapshot(fallbackCurrent);
	const previous = stack.past.pop();
	if (!previous) {
		return null;
	}

	stack.future.push(cloneEditorHistorySnapshot(current));
	stack.current = cloneEditorHistorySnapshot(previous);
	return cloneEditorHistorySnapshot(previous);
}

export function redoEditorHistoryStack(
	stack: EditorHistoryStack,
	fallbackCurrent: EditorHistorySnapshot,
): EditorHistorySnapshot | null {
	if (stack.future.length === 0) {
		return null;
	}

	const current = stack.current ?? cloneEditorHistorySnapshot(fallbackCurrent);
	const next = stack.future.pop();
	if (!next) {
		return null;
	}

	stack.past.push(cloneEditorHistorySnapshot(current));
	stack.current = cloneEditorHistorySnapshot(next);
	return cloneEditorHistorySnapshot(next);
}
