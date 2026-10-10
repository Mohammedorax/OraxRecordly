import { describe, expect, it, vi } from "vitest";
import {
	type ExportHistoryEntry,
	normalizeExportHistory,
	prependExportHistoryEntry,
} from "./exportHistory";

describe("export history", () => {
	it("drops malformed entries and sorts newest first", () => {
		const normalized = normalizeExportHistory([
			{ path: "/a.mp4", at: 1 },
			null,
			{ name: "no-path" },
			{ path: "/b.mp4", at: 5, format: "gif" },
			"nope",
		]);

		expect(normalized.map((item) => item.path)).toEqual(["/b.mp4", "/a.mp4"]);
		expect(normalized[0].format).toBe("gif");
		expect(normalized[1].name).toBe("a.mp4");
	});

	it("returns an empty list for corrupted storage values", () => {
		expect(normalizeExportHistory(undefined)).toEqual([]);
		expect(normalizeExportHistory({ path: "/a.mp4" })).toEqual([]);
	});

	it("prepends new entries, de-duplicates by path, and caps the list", () => {
		let history: ExportHistoryEntry[] = [];
		for (let index = 0; index < 12; index += 1) {
			history = prependExportHistoryEntry(history, {
				path: `/clip-${index}.mp4`,
				name: `clip-${index}.mp4`,
				format: "mp4",
				at: index,
			});
		}
		expect(history).toHaveLength(8);
		expect(history[0].path).toBe("/clip-11.mp4");

		const reExported = prependExportHistoryEntry(history, {
			path: "/clip-5.mp4",
			name: "clip-5.mp4",
			format: "mp4",
			at: 99,
		});
		expect(reExported).toHaveLength(8);
		expect(reExported[0].path).toBe("/clip-5.mp4");
		expect(reExported.filter((item) => item.path === "/clip-5.mp4")).toHaveLength(1);
	});

	it("drops entries whose file no longer exists and persists the change", async () => {
		const store = new Map<string, string>();
		const localStorageStub = {
			getItem: (key: string) => store.get(key) ?? null,
			setItem: (key: string, value: string) => {
				store.set(key, value);
			},
			removeItem: (key: string) => {
				store.delete(key);
			},
		};
		vi.stubGlobal("localStorage", localStorageStub);

		try {
			const { readExportHistory, recordExportHistory, removeExportHistoryEntries } =
				await import("./exportHistory");

			recordExportHistory({
				path: "/gone/export-1.mp4",
				name: "export-1.mp4",
				format: "mp4",
			});
			recordExportHistory({
				path: "/kept/export-2.mp4",
				name: "export-2.mp4",
				format: "mp4",
			});
			expect(readExportHistory()).toHaveLength(2);

			const remaining = removeExportHistoryEntries(["/gone/export-1.mp4"]);

			expect(remaining.map((entry) => entry.path)).toEqual(["/kept/export-2.mp4"]);
			expect(readExportHistory().map((entry) => entry.path)).toEqual(["/kept/export-2.mp4"]);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
