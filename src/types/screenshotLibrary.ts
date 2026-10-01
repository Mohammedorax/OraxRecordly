/** A PNG stored in the recordings directory's `Screenshots` folder. */
export interface ScreenshotLibraryEntry {
	path: string;
	name: string;
	/** File modification time in milliseconds since the epoch. */
	modifiedMs: number;
	sizeBytes: number;
	/** Loopback media-server URL; empty while the media server is not ready. */
	url: string;
}
