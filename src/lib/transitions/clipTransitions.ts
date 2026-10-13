/**
 * Aesthetic transitions between clips that were cut apart during editing.
 *
 * The model is deliberately free of DOM, Pixi and Canvas imports: the editor
 * preview and the exporters all read it, so the transition the user sees while
 * editing is the transition that lands in the file.
 *
 * Two kinds are offered:
 *
 * - `fade` runs *through black*: the outgoing picture darkens into black and the
 *   incoming one brightens out of it. Single-pass, exact everywhere.
 * - `crossfade` dissolves one picture into the next. The outgoing side is the
 *   held last frame of the previous clip (a cut has no overlapping frames, and a
 *   second decoder would cost a full decode pass), so the incoming clip plays
 *   over it. The window therefore starts *at* the cut and runs forward.
 */

export const CLIP_TRANSITION_KINDS = ["none", "fade", "crossfade"] as const;
export type ClipTransitionKind = (typeof CLIP_TRANSITION_KINDS)[number];

export interface ClipTransitionSettings {
	kind: ClipTransitionKind;
	/** Total length of the fade, half of it on each side of the cut. */
	durationMs: number;
}

export const DEFAULT_CLIP_TRANSITION_DURATION_MS = 320;
export const MIN_CLIP_TRANSITION_DURATION_MS = 120;
export const MAX_CLIP_TRANSITION_DURATION_MS = 2_000;

/** Gaps larger than this are empty timeline space, not a cut between clips. */
export const CLIP_TRANSITION_ADJACENCY_TOLERANCE_MS = 40;

export const DEFAULT_CLIP_TRANSITION_SETTINGS: ClipTransitionSettings = {
	// Opt-in-friendly default: the user asked for automatic transitions, so the
	// fade is on, but a project can always turn it off or change its length.
	kind: "fade",
	durationMs: DEFAULT_CLIP_TRANSITION_DURATION_MS,
};

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export function isClipTransitionKind(value: unknown): value is ClipTransitionKind {
	return (
		typeof value === "string" && (CLIP_TRANSITION_KINDS as readonly string[]).includes(value)
	);
}

export function normalizeClipTransitionSettings(raw: unknown): ClipTransitionSettings {
	const source = (raw ?? {}) as Partial<Record<keyof ClipTransitionSettings, unknown>>;
	const duration = Number(source.durationMs);

	return {
		kind: isClipTransitionKind(source.kind)
			? source.kind
			: DEFAULT_CLIP_TRANSITION_SETTINGS.kind,
		durationMs: Number.isFinite(duration)
			? Math.round(
					clamp(
						duration,
						MIN_CLIP_TRANSITION_DURATION_MS,
						MAX_CLIP_TRANSITION_DURATION_MS,
					),
				)
			: DEFAULT_CLIP_TRANSITION_SETTINGS.durationMs,
	};
}

export function clipTransitionSettingsEqual(
	left: ClipTransitionSettings,
	right: ClipTransitionSettings,
): boolean {
	return left.kind === right.kind && left.durationMs === right.durationMs;
}

export interface ClipTransitionClipLike {
	startMs: number;
	endMs: number;
}

/** One fade, centred on the cut it belongs to, in timeline milliseconds. */
export interface ClipTransitionWindow {
	boundaryMs: number;
	startMs: number;
	endMs: number;
}

/**
 * The fades a timeline should render: one per cut between two clips that touch.
 *
 * Clips with empty space between them are left alone, the very first clip has
 * nothing to fade from, and a fade is shortened when either neighbouring clip is
 * too short to sit through it - so two fades can never overlap.
 */
export function resolveClipTransitionWindows(
	clips: readonly ClipTransitionClipLike[],
	settings: ClipTransitionSettings,
): ClipTransitionWindow[] {
	if (settings.kind === "none" || clips.length < 2 || settings.durationMs <= 0) {
		return [];
	}

	const ordered = [...clips]
		.filter(
			(clip) =>
				Number.isFinite(clip.startMs) &&
				Number.isFinite(clip.endMs) &&
				clip.endMs > clip.startMs,
		)
		.sort((left, right) => left.startMs - right.startMs);
	const windows: ClipTransitionWindow[] = [];

	for (let index = 1; index < ordered.length; index += 1) {
		const previous = ordered[index - 1];
		const current = ordered[index];
		if (Math.abs(current.startMs - previous.endMs) > CLIP_TRANSITION_ADJACENCY_TOLERANCE_MS) {
			continue;
		}

		const boundaryMs = current.startMs;
		if (boundaryMs <= 0) {
			continue;
		}

		if (settings.kind === "crossfade") {
			// A dissolve starts *at* the cut: the outgoing picture is held while the
			// incoming clip plays over it, so nothing of the incoming clip has to be
			// decoded before the boundary. It may not outlast the clip it sits in.
			const length = Math.min(settings.durationMs, current.endMs - current.startMs);
			if (length <= 0) {
				continue;
			}
			windows.push({ boundaryMs, startMs: boundaryMs, endMs: boundaryMs + length });
			continue;
		}

		// Half the fade may not eat more than the clip it sits in, and the whole
		// fade stays inside both clips, so neighbouring fades cannot overlap.
		const half = Math.min(
			settings.durationMs / 2,
			Math.max(1, (previous.endMs - previous.startMs) / 2),
			Math.max(1, (current.endMs - current.startMs) / 2),
		);
		windows.push({
			boundaryMs,
			startMs: boundaryMs - half,
			endMs: boundaryMs + half,
		});
	}

	return windows;
}

/**
 * Black coverage at `timeMs`: 0 away from a fade, ramping to 1 at the cut and
 * back to 0 after it. Renderers paint a black rectangle with this alpha.
 */
export function clipTransitionBlackAlpha(
	timeMs: number,
	windows: readonly ClipTransitionWindow[],
): number {
	for (const window of windows) {
		if (timeMs < window.startMs || timeMs > window.endMs) {
			continue;
		}

		const span = Math.max(1, window.endMs - window.startMs);
		const progress = (timeMs - window.startMs) / span;
		// 0 -> 1 up to the cut, then 1 -> 0.
		return progress <= 0.5 ? progress * 2 : (1 - progress) * 2;
	}

	return 0;
}

/** The window the playhead is inside, or null when no transition is running. */
export function findActiveTransitionWindow(
	timeMs: number,
	windows: readonly ClipTransitionWindow[],
): ClipTransitionWindow | null {
	for (const window of windows) {
		if (timeMs >= window.startMs && timeMs <= window.endMs) {
			return window;
		}
	}

	return null;
}

/**
 * How far a cross-dissolve has progressed: 0 shows only the held outgoing
 * picture, 1 shows only the incoming clip. Outside a window the incoming clip is
 * fully visible, which is what makes the dissolve end cleanly at the cut.
 */
export function clipTransitionMixProgress(
	timeMs: number,
	window: ClipTransitionWindow | null,
): number {
	if (!window) {
		return 1;
	}

	const span = Math.max(1, window.endMs - window.startMs);
	return Math.min(1, Math.max(0, (timeMs - window.startMs) / span));
}

/**
 * The clock the fade must be sampled on.
 *
 * Clip regions are expressed in **edited-timeline** milliseconds. The source
 * clock drifts from it the moment anything is trimmed, cut or sped up, so using
 * it puts the fade at the wrong moment - or removes it entirely. The legacy
 * exporter and the modern one both resolve the clock through this function, and
 * the unit test pins it, because getting it wrong is invisible until an export
 * has already been watched.
 */
export function resolveTransitionClockMs(options: {
	/** True when the renderer works on the edited timeline rather than the source. */
	timelineEffects: boolean;
	sourceTimestampUs: number;
	timelineTimestampUs: number;
}): number {
	return options.timelineEffects
		? options.timelineTimestampUs / 1000
		: options.sourceTimestampUs / 1000;
}

/** The 2D surface the coverage is painted onto; a canvas context satisfies it. */ export interface ClipTransitionPaintSurface {
	save(): void;
	restore(): void;
	fillRect(x: number, y: number, width: number, height: number): void;
	fillStyle: string | CanvasGradient | CanvasPattern;
	globalAlpha: number;
}

/**
 * Paints the fade's black coverage onto a 2D surface, returning whether anything
 * was drawn. It lives in the model rather than in one renderer so the legacy
 * exporter and its tests exercise exactly the same code path.
 */
export function paintClipTransitionCoverage(
	surface: ClipTransitionPaintSurface,
	options: {
		timeMs: number;
		windows: readonly ClipTransitionWindow[];
		width: number;
		height: number;
	},
): boolean {
	const alpha = clipTransitionBlackAlpha(options.timeMs, options.windows);
	if (alpha <= 0) {
		return false;
	}

	surface.save();
	surface.globalAlpha = Math.min(1, alpha);
	surface.fillStyle = "#000000";
	surface.fillRect(0, 0, options.width, options.height);
	surface.restore();
	return true;
}
