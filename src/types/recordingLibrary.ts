export interface RecordingLibraryEntry {
	path: string;
	name: string;
	createdAt: number;
	/** Capture start time (from the file name), falling back to mtime. */
	recordedAt?: number;
	bytes: number;
	url: string;
}
export interface RecordingImportResult {
	path: string;
	url: string;
	sourceStartMs: number;
	durationMs: number;
	totalDurationMs: number;
}
export type LibraryResult<T> = { success: true; value: T } | { success: false; error: string };
export const RECORDING_DRAG_TYPE = "application/x-recordly-recording";
