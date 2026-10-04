/**
 * Early "is the HUD actually presenting a frame?" probe.
 *
 * `electron/startupVisibility.ts` answers "is a window *visible*?", which on
 * Windows is not the same question. A window can report `isVisible: true` while
 * its surface is never composited — the owner's bug: Electron said
 * `isVisible: true`, bounds were correct, the DOM was fully built, and yet
 * `webContents.capturePage()` rejected with `UnknownVizError` and nothing was
 * ever drawn.
 *
 * The old watchdog could only detect that failure indirectly, after
 * {@link STARTUP_VISIBILITY_EDITOR_FALLBACK_MS} (10 s), by giving up on the HUD
 * entirely and opening the opaque editor window. This module detects it early —
 * a single non-blocking `capturePage()` probe — so the fallback can be an opaque
 * *HUD* (the same bar, on a solid background) almost immediately, instead of an
 * unrelated editor window ten seconds later.
 *
 * The decision function is pure so the policy is unit-testable without Electron.
 */

/**
 * How long after the HUD is asked to show itself the probe runs. The renderer
 * needs a moment to produce its first frame; probing at 0 ms would report a
 * false failure on a healthy machine.
 */
export const HUD_FRAME_PROBE_DELAY_MS = 1200;

/** How long `capturePage()` may take before the probe is treated as failed. */
export const HUD_FRAME_PROBE_TIMEOUT_MS = 4000;

export type HudFrameProbeOutcome = "presented" | "not-presented" | "inconclusive";

/**
 * Classifies a `capturePage()` result.
 *
 * A capture with real pixels proves presentation. The two distinct failure
 * shapes both mean "no frame":
 *  - a rejection (the `UnknownVizError` the owner sees), and
 *  - a zero-sized image, which is what Electron returns when the surface exists
 *    but has never been composited.
 *
 * A `null` result means the probe could not run at all (the window was already
 * gone, or `capturePage` hung and was abandoned). That is reported as
 * `inconclusive` rather than `not-presented`: an inconclusive probe must never
 * downgrade a HUD that is in fact fine.
 */
export function classifyHudFrameProbe(result: {
	threw: boolean;
	width?: number;
	height?: number;
}): HudFrameProbeOutcome {
	if (result.threw) {
		return "not-presented";
	}

	if (result.width === undefined || result.height === undefined) {
		return "inconclusive";
	}

	if (result.width <= 0 || result.height <= 0) {
		return "not-presented";
	}

	return "presented";
}

export interface HudFallbackInput {
	outcome: HudFrameProbeOutcome;
	/** The window is gone or was never created: nothing to downgrade. */
	windowAlive: boolean;
	/** True once the opaque fallback has already been applied. */
	fallbackApplied: boolean;
	/** True while the user has deliberately hidden the HUD (start-minimized). */
	hudIntentionallyHidden: boolean;
}

export type HudFallbackAction = "none" | "recover-with-opaque-hud";

/**
 * Decides whether a failed frame probe should trigger the opaque HUD fallback.
 *
 * Only a *positive* failure (`not-presented`) with a live window that the user
 * did not deliberately hide triggers recovery. `presented` is the healthy case;
 * `inconclusive` deliberately does nothing, because acting on it would replace a
 * working transparent HUD with an opaque one for no reason.
 */
export function decideHudFallback(input: HudFallbackInput): HudFallbackAction {
	if (input.fallbackApplied || !input.windowAlive || input.hudIntentionallyHidden) {
		return "none";
	}

	return input.outcome === "not-presented" ? "recover-with-opaque-hud" : "none";
}

/** One-line explanation for the startup log (stderr survives the shipped build). */
export function describeHudFallback(action: HudFallbackAction, input: HudFallbackInput): string {
	if (action === "none") {
		return `HUD frame probe: ${input.outcome}; no recovery needed`;
	}

	return `HUD frame probe: ${input.outcome} — the compositor never presented the transparent HUD, reopening it as an opaque bar`;
}
