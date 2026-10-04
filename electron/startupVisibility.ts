/**
 * Cold-launch visibility policy.
 *
 * Recordly's only cold-launch surface is the HUD overlay: a small, transparent,
 * always-on-top bar. If that window is never presented — a renderer that never
 * produces a frame, an accelerator that fails to bind, a compositor that cannot
 * present a transparent surface — the process keeps running with an entry in the
 * taskbar and *nothing at all on screen*. The user's report is exactly that:
 * "launched the latest installer and saw only a hidden screen".
 *
 * This module owns the decision "is there something the user can see, and if not
 * what should we do about it?" as a pure function so it can be unit-tested
 * without Electron. `electron/main.ts` only performs the side effects.
 */

/** Window query parameter, e.g. `index.html?windowType=hud-overlay`. */
const WINDOW_TYPE_PARAM = "windowType";

export const HUD_OVERLAY_WINDOW_TYPE = "hud-overlay";
export const EDITOR_WINDOW_TYPE = "editor";

/**
 * How long a cold launch may spend with nothing on screen before the watchdog
 * asks the HUD overlay to show itself. This has to sit comfortably after the
 * HUD's own `renderer-ready`/`did-finish-load` fallbacks (which fire within
 * ~2s) so the watchdog is a safety net and not a second show path.
 */
export const STARTUP_VISIBILITY_PROBE_MS = 4000;

/**
 * How long the launch may spend with nothing visible before Recordly stops
 * trying to present the transparent overlay and opens the editor window, which
 * is a normal opaque window. Reaching this point means the HUD is unusable on
 * this machine, and an invisible app is worse than an unexpectedly open editor.
 */
export const STARTUP_VISIBILITY_EDITOR_FALLBACK_MS = 10000;

export type StartupVisibilityAction = "none" | "wait" | "show-hud" | "open-editor";

export interface StartupWindowSnapshot {
	/** Value of the `windowType` query parameter for the window's document. */
	windowType: string;
	visible: boolean;
	destroyed: boolean;
	/**
	 * `false` only when the early frame probe positively proved the window never
	 * presented a frame (`electron/hudFrameProbe.ts`). Left `undefined` while the
	 * probe has not run yet or was inconclusive, because "unknown" must not be
	 * treated as "broken" — that would downgrade a healthy HUD.
	 */
	framePresented?: boolean;
}

export interface StartupVisibilityInput {
	/** Every top-level window the main process currently owns. */
	windows: readonly StartupWindowSnapshot[];
	/** Milliseconds since the cold-launch window was created. */
	elapsedMs: number;
	/** True once the watchdog has already asked the HUD overlay to show itself. */
	hudShowAttempted: boolean;
}

/**
 * Reads the `windowType` query parameter out of a window URL.
 *
 * Windows loaded with `file://` or the packaged renderer URL carry it as a
 * query parameter; anything else (an unexpected URL, a test double) yields the
 * empty string, which the policy treats as "not the HUD".
 */
export function getWindowTypeFromUrl(url: string): string {
	const match = new RegExp(`[?&]${WINDOW_TYPE_PARAM}=([^&#]*)`).exec(url ?? "");
	if (!match) {
		return "";
	}

	try {
		return decodeURIComponent(match[1]);
	} catch {
		return match[1];
	}
}

/** The first live, visible window whose frame was actually presented, or `null`. */
export function findVisibleWindow(
	windows: readonly StartupWindowSnapshot[],
): StartupWindowSnapshot | null {
	return (
		windows.find(
			(window) => window.visible && !window.destroyed && window.framePresented !== false,
		) ?? null
	);
}

/**
 * Decides what the cold-launch watchdog should do next.
 *
 * - `none` — a window is already visible; the launch succeeded, stop watching.
 * - `wait` — still inside a grace period, or a recovery step is in flight.
 * - `show-hud` — nothing is visible and the HUD exists: ask it to show itself.
 * - `open-editor` — the HUD cannot be presented (or does not exist), so open the
 *   opaque editor window instead of leaving the user with a blank desktop.
 */
export function decideStartupVisibility(input: StartupVisibilityInput): StartupVisibilityAction {
	const live = input.windows.filter((window) => !window.destroyed);

	// A window that reports itself visible but whose frame was never presented is
	// not "something the user can see" — that is exactly the owner's bug. The
	// early probe in `electron/hudFrameProbe.ts` proves it and recovers the HUD
	// itself; until it has, this watchdog keeps treating the launch as not yet
	// visible so the editor fallback still fires if recovery does not happen.
	const visible = live.find((window) => window.visible && window.framePresented !== false);
	if (visible) {
		return "none";
	}

	if (input.elapsedMs < STARTUP_VISIBILITY_PROBE_MS) {
		return "wait";
	}

	const hud = live.find((window) => window.windowType === HUD_OVERLAY_WINDOW_TYPE);
	if (!hud) {
		// There is no overlay to reveal, so waiting longer cannot help.
		return "open-editor";
	}

	if (!input.hudShowAttempted) {
		return "show-hud";
	}

	if (input.elapsedMs >= STARTUP_VISIBILITY_EDITOR_FALLBACK_MS) {
		return "open-editor";
	}

	return "wait";
}

/** One-line human explanation for the startup log. */
export function describeStartupVisibility(
	action: StartupVisibilityAction,
	input: StartupVisibilityInput,
): string {
	const visible = findVisibleWindow(input.windows);
	const summary =
		input.windows.length === 0
			? "no windows exist"
			: input.windows
					.map(
						(window) =>
							`${window.windowType || "unknown"}${window.visible ? "(visible)" : "(hidden)"}`,
					)
					.join(", ");

	switch (action) {
		case "none":
			return `a window is visible after ${input.elapsedMs}ms: ${visible?.windowType ?? "unknown"}`;
		case "show-hud":
			return `nothing visible after ${input.elapsedMs}ms (${summary}); showing the HUD overlay`;
		case "open-editor":
			return `nothing visible after ${input.elapsedMs}ms (${summary}); opening the editor window`;
		default:
			return `waiting for a visible window at ${input.elapsedMs}ms (${summary})`;
	}
}
