/**
 * Recovery policy for a crashed renderer process.
 *
 * The main process outlives the renderer, and it keeps the active project path,
 * so reloading a crashed window brings the user straight back to their project.
 * What must never happen is a reload loop: a window that crashes on every load
 * would otherwise spin forever and make the app unusable. Reloads are therefore
 * counted inside a sliding window, and once the budget is spent the window is
 * left alone so the user can still see and use the app.
 */

export interface RendererCrashRecord {
	at: number;
}

export const MAX_CRASH_RECOVERIES = 2;
export const CRASH_RECOVERY_WINDOW_MS = 5 * 60 * 1000;

/** Reasons that mean the process did not die on its own. */
const NON_CRASH_REASONS = new Set(["clean-exit"]);

export function isRendererCrashReason(reason: string | undefined): boolean {
	return typeof reason === "string" && reason.length > 0 && !NON_CRASH_REASONS.has(reason);
}

/**
 * Whether a crashed window should be reloaded, and the (trimmed) crash history to
 * keep. The history only holds crashes inside the sliding window.
 */
export function decideRendererCrashRecovery(options: {
	history: readonly RendererCrashRecord[];
	now: number;
	reason: string | undefined;
}): { reload: boolean; history: RendererCrashRecord[] } {
	const { now, reason } = options;
	const recent = options.history.filter(
		(record) => now - record.at <= CRASH_RECOVERY_WINDOW_MS && record.at <= now,
	);

	if (!isRendererCrashReason(reason)) {
		return { reload: false, history: recent };
	}

	const nextHistory = [...recent, { at: now }];
	return {
		reload: nextHistory.length <= MAX_CRASH_RECOVERIES,
		history: nextHistory,
	};
}
