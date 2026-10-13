import { type DiskSpaceVerdict, evaluateDiskSpace } from "./diskSpace";

/**
 * Asks the main process for free space before an operation that writes a large
 * file, and reports what the caller should do about it.
 *
 * Never throws and never blocks: a bridge that is missing, an unsupported volume
 * or a failed call all come back as `"ok"`, because refusing to record on a
 * failed measurement would be worse than the failure it guards against.
 */
export async function checkCaptureDiskSpace(targetPath?: string): Promise<{
	verdict: DiskSpaceVerdict;
	availableBytes: number | null;
}> {
	try {
		const result = await window.electronAPI?.getAvailableDiskSpace?.(targetPath);
		if (!result?.success || typeof result.availableBytes !== "number") {
			return { verdict: "ok", availableBytes: null };
		}

		return {
			verdict: evaluateDiskSpace(result.availableBytes),
			availableBytes: result.availableBytes,
		};
	} catch {
		return { verdict: "ok", availableBytes: null };
	}
}
