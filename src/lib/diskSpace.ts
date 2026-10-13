/**
 * Free-space preflight for the two operations that write large files.
 *
 * Both used to fail only once the disk was full: a recording lost everything it
 * had written, and an export failed after minutes of rendering. Checking first
 * turns that into an immediate, explainable refusal.
 *
 * The threshold is deliberately conservative rather than clever: encoding rates
 * depend on resolution, frame rate and content, and being wrong in the cautious
 * direction only costs a warning.
 */

/** Below this the app refuses to start a new capture or export. */
export const MIN_FREE_BYTES_FOR_CAPTURE = 750 * 1024 * 1024;

/** Below this the app warns but still proceeds. */
export const LOW_FREE_BYTES_WARNING = 2 * 1024 * 1024 * 1024;

export type DiskSpaceVerdict = "ok" | "low" | "insufficient";

/** Classify the free space of the volume a capture or export will write to. */
export function evaluateDiskSpace(availableBytes: number | null | undefined): DiskSpaceVerdict {
	if (typeof availableBytes !== "number" || !Number.isFinite(availableBytes)) {
		// An unreadable volume is not a reason to block the user; the write itself
		// still reports a real failure.
		return "ok";
	}

	if (availableBytes < MIN_FREE_BYTES_FOR_CAPTURE) {
		return "insufficient";
	}

	return availableBytes < LOW_FREE_BYTES_WARNING ? "low" : "ok";
}

/** Human-readable size for the message shown to the user. */
export function formatBytesForMessage(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) {
		return "0 MB";
	}

	const gigabytes = bytes / (1024 * 1024 * 1024);
	if (gigabytes >= 1) {
		return `${gigabytes.toFixed(1)} GB`;
	}

	return `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;
}
