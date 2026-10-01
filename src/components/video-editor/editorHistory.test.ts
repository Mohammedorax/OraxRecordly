import { describe, expect, it, vi } from "vitest";

import {
	areEditorHistorySnapshotsEqual,
	cloneEditorHistorySnapshot,
	createEditorHistoryStack,
	type EditorHistorySnapshot,
	recordEditorHistorySnapshot,
	redoEditorHistoryStack,
	resetEditorHistoryStack,
	undoEditorHistoryStack,
} from "./editorHistory";

function createSnapshot(id: string | null): EditorHistorySnapshot {
	return {
		zoomRegions: [],
		clipRegions: [],
		speedRegions: [],
		annotationRegions: [],
		audioRegions: [],
		autoCaptions: [],
		selectedZoomId: id,
		selectedClipId: id ? `clip-${id}` : null,
		selectedAnnotationId: null,
		selectedAudioId: null,
	};
}

describe("editorHistory", () => {
	it("initializes without adding undo history", () => {
		const stack = createEditorHistoryStack();
		const snapshot = createSnapshot("first");

		expect(recordEditorHistorySnapshot(stack, snapshot)).toBe("initialized");

		expect(stack.current).toEqual(snapshot);
		expect(stack.past).toEqual([]);
		expect(stack.future).toEqual([]);
	});

	it("does not record unchanged snapshots", () => {
		const stack = createEditorHistoryStack();
		const snapshot = createSnapshot("same");

		recordEditorHistorySnapshot(stack, snapshot);
		expect(recordEditorHistorySnapshot(stack, createSnapshot("same"))).toBe("unchanged");

		expect(stack.past).toEqual([]);
		expect(stack.future).toEqual([]);
	});

	it("does not clone or consume a history slot for an identical snapshot", () => {
		const stack = createEditorHistoryStack();

		recordEditorHistorySnapshot(stack, createSnapshot("same"));

		const cloneSpy = vi.spyOn(globalThis, "structuredClone");
		try {
			expect(recordEditorHistorySnapshot(stack, createSnapshot("same"))).toBe("unchanged");
			expect(cloneSpy).not.toHaveBeenCalled();
		} finally {
			cloneSpy.mockRestore();
		}

		expect(stack.past).toEqual([]);
		expect(stack.future).toEqual([]);
	});

	it("takes ownership of fresh snapshots instead of deep cloning them", () => {
		const stack = createEditorHistoryStack();
		const first = createSnapshot("first");
		const second = createSnapshot("second");

		expect(recordEditorHistorySnapshot(stack, first)).toBe("initialized");
		expect(stack.current).toBe(first);

		expect(recordEditorHistorySnapshot(stack, second)).toBe("recorded");
		expect(stack.current).toBe(second);
		expect(stack.past[0]).toBe(first);
	});

	it("records changes and clears redo history", () => {
		const stack = createEditorHistoryStack();

		recordEditorHistorySnapshot(stack, createSnapshot("first"));
		recordEditorHistorySnapshot(stack, createSnapshot("second"));
		stack.future.push(createSnapshot("future"));

		expect(recordEditorHistorySnapshot(stack, createSnapshot("third"))).toBe("recorded");

		expect(stack.past.map((snapshot) => snapshot.selectedZoomId)).toEqual(["first", "second"]);
		expect(stack.current?.selectedZoomId).toBe("third");
		expect(stack.future).toEqual([]);
	});

	it("moves snapshots through undo and redo stacks", () => {
		const stack = createEditorHistoryStack();
		const first = createSnapshot("first");
		const second = createSnapshot("second");

		recordEditorHistorySnapshot(stack, first);
		recordEditorHistorySnapshot(stack, second);

		expect(undoEditorHistoryStack(stack, second)?.selectedZoomId).toBe("first");
		expect(stack.current?.selectedZoomId).toBe("first");
		expect(stack.future.map((snapshot) => snapshot.selectedZoomId)).toEqual(["second"]);

		expect(redoEditorHistoryStack(stack, first)?.selectedZoomId).toBe("second");
		expect(stack.current?.selectedZoomId).toBe("second");
		expect(stack.past.map((snapshot) => snapshot.selectedZoomId)).toEqual(["first"]);
	});

	it("updates the current snapshot while applying history without recording a new entry", () => {
		const stack = createEditorHistoryStack();

		recordEditorHistorySnapshot(stack, createSnapshot("first"));
		expect(
			recordEditorHistorySnapshot(stack, createSnapshot("applied"), {
				applyingHistory: true,
			}),
		).toBe("applied");

		expect(stack.current?.selectedZoomId).toBe("applied");
		expect(stack.past).toEqual([]);
	});

	it("caps the past stack at the configured history depth", () => {
		const stack = createEditorHistoryStack();

		recordEditorHistorySnapshot(stack, createSnapshot("0"));
		recordEditorHistorySnapshot(stack, createSnapshot("1"), { maxEntries: 2 });
		recordEditorHistorySnapshot(stack, createSnapshot("2"), { maxEntries: 2 });
		recordEditorHistorySnapshot(stack, createSnapshot("3"), { maxEntries: 2 });

		expect(stack.past.map((snapshot) => snapshot.selectedZoomId)).toEqual(["1", "2"]);
	});

	it("resets all history stacks", () => {
		const stack = createEditorHistoryStack();

		recordEditorHistorySnapshot(stack, createSnapshot("first"));
		recordEditorHistorySnapshot(stack, createSnapshot("second"));
		undoEditorHistoryStack(stack, createSnapshot("second"));
		resetEditorHistoryStack(stack);

		expect(stack).toEqual(createEditorHistoryStack());
	});

	it("clones snapshots before storing them", () => {
		const snapshot = createSnapshot("first");
		const cloned = cloneEditorHistorySnapshot(snapshot);

		cloned.selectedZoomId = "changed";

		expect(snapshot.selectedZoomId).toBe("first");
		expect(areEditorHistorySnapshotsEqual(snapshot, createSnapshot("first"))).toBe(true);
	});
});
