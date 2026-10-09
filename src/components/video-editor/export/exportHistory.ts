/**
 * Small local log of finished exports so the user can get back to a file after
 * the success toast is gone. Paths only — nothing is copied.
 */
export interface ExportHistoryEntry {
	path: string;
	name: string;
	at: number;
	format: "mp4" | "gif";
}

const STORAGE_KEY = "recordly.export-history.v1";
const MAX_ENTRIES = 8;

/** Keeps only well-formed entries and caps the list; safe on corrupted storage. */
export function normalizeExportHistory(value: unknown): ExportHistoryEntry[] {
	if (!Array.isArray(value)) {
		return [];
	}

	const entries: ExportHistoryEntry[] = [];
	for (const candidate of value) {
		if (!candidate || typeof candidate !== "object") continue;
		const record = candidate as Partial<ExportHistoryEntry>;
		if (typeof record.path !== "string" || record.path.length === 0) continue;
		entries.push({
			path: record.path,
			name:
				typeof record.name === "string" && record.name.length > 0
					? record.name
					: record.path.split(/[\\/]/).pop() || record.path,
			at: typeof record.at === "number" && Number.isFinite(record.at) ? record.at : 0,
			format: record.format === "gif" ? "gif" : "mp4",
		});
	}

	return entries.sort((left, right) => right.at - left.at).slice(0, MAX_ENTRIES);
}

/** Newest first, one entry per path, capped. */
export function prependExportHistoryEntry(
	entries: ExportHistoryEntry[],
	entry: Omit<ExportHistoryEntry, "at"> & { at?: number },
): ExportHistoryEntry[] {
	const next: ExportHistoryEntry = {
		path: entry.path,
		name: entry.name,
		format: entry.format,
		at: entry.at ?? Date.now(),
	};
	return [next, ...entries.filter((existing) => existing.path !== next.path)].slice(
		0,
		MAX_ENTRIES,
	);
}

export function readExportHistory(): ExportHistoryEntry[] {
	if (typeof localStorage === "undefined") {
		return [];
	}
	try {
		return normalizeExportHistory(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"));
	} catch {
		return [];
	}
}

export function recordExportHistory(
	entry: Omit<ExportHistoryEntry, "at"> & { at?: number },
): ExportHistoryEntry[] {
	const next = prependExportHistoryEntry(readExportHistory(), entry);
	if (typeof localStorage !== "undefined") {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
		} catch {
			// Storage may be full or unavailable; the in-memory list still works.
		}
	}
	return next;
}
