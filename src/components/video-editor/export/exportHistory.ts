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

function writeExportHistory(entries: ExportHistoryEntry[]): void {
	if (typeof localStorage === "undefined") {
		return;
	}
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
	} catch {
		// Storage may be full or unavailable; the caller keeps its own copy.
	}
}

/**
 * Drops entries whose files are gone.
 *
 * The list is history, not a guarantee: an export can be moved, deleted, or live
 * in a temporary folder that was cleaned up, and offering "show in folder" for a
 * file that no longer exists is worse than not listing it.
 */
export function removeExportHistoryEntries(projectPaths: readonly string[]): ExportHistoryEntry[] {
	if (projectPaths.length === 0) {
		return readExportHistory();
	}
	const missing = new Set(projectPaths);
	const remaining = readExportHistory().filter((entry) => !missing.has(entry.path));
	writeExportHistory(remaining);
	return remaining;
}

export function recordExportHistory(
	entry: Omit<ExportHistoryEntry, "at"> & { at?: number },
): ExportHistoryEntry[] {
	const next = prependExportHistoryEntry(readExportHistory(), entry);
	writeExportHistory(next);
	return next;
}
