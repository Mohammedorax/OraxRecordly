import { powerSaveBlocker } from "electron";

/**
 * Keeps the machine awake for the whole export, on every backend.
 *
 * A suspended app (sleep, or Windows Modern Standby) freezes the renderer's
 * decode/encode loop, which looks exactly like an export hang. Only the
 * static-layout path used to hold a blocker; WebCodecs/Lightning exports and the
 * Breeze stream encoder did not, so a long export could stall whenever the
 * machine idled.
 *
 * Activity is tracked by stable token, so callers never have to coordinate a
 * global count across modules: the blocker starts with the first token and stops
 * when the last one is released. A hard cap releases a token that was never
 * released (crashed export), and `releaseExportPowerGuard()` clears everything.
 */
const MAX_EXPORT_GUARD_MS = 12 * 60 * 60 * 1000;

const activeExportTokens = new Set<string>();
let activeBlockerId: number | null = null;
let guardTimeout: NodeJS.Timeout | null = null;

function startExportPowerGuard(): void {
	if (activeBlockerId !== null) {
		return;
	}

	try {
		activeBlockerId = powerSaveBlocker.start("prevent-app-suspension");
	} catch (error) {
		console.warn("[export-power-guard] Could not prevent app suspension", error);
		return;
	}

	if (guardTimeout) clearTimeout(guardTimeout);
	guardTimeout = setTimeout(() => {
		console.warn("[export-power-guard] Releasing after the maximum guard window");
		releaseExportPowerGuard();
	}, MAX_EXPORT_GUARD_MS);
	guardTimeout.unref?.();
}

function stopExportPowerGuard(): void {
	if (guardTimeout) {
		clearTimeout(guardTimeout);
		guardTimeout = null;
	}
	if (activeBlockerId === null) {
		return;
	}
	try {
		if (powerSaveBlocker.isStarted(activeBlockerId)) {
			powerSaveBlocker.stop(activeBlockerId);
		}
	} catch {
		// Blocker may already be gone; nothing else to do.
	}
	activeBlockerId = null;
}

/** Marks an export session as active; the machine will not suspend. */
export function acquireExportActivity(token: string): void {
	activeExportTokens.add(token);
	startExportPowerGuard();
}

/** Releases one session; the machine may suspend again once none remain. */
export function releaseExportActivity(token: string): void {
	activeExportTokens.delete(token);
	if (activeExportTokens.size === 0) {
		stopExportPowerGuard();
	}
}

/** Unconditional release for every token, used on quit. */
export function releaseExportPowerGuard(): void {
	activeExportTokens.clear();
	stopExportPowerGuard();
}

/** Test seam: how many export sessions currently hold the guard. */
export function getActiveExportActivityCount(): number {
	return activeExportTokens.size;
}
