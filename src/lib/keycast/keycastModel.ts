/**
 * Pure logic for the "keycast" overlay: the on-screen key badge that shows the
 * combination the presenter just pressed (for example `Ctrl` `A`).
 *
 * The module is intentionally free of Electron, DOM and React imports so the
 * main-process recorder and the renderer share exactly one definition of when a
 * badge appears, how long it stays and which keys it contains. Everything that
 * depends on text measurement (cap widths) stays in the two renderers; this file
 * only produces structural metrics.
 */

/** Canonical modifier tokens stored in telemetry. */
export type KeycastModifier = "Ctrl" | "Alt" | "Shift" | "Meta";

/**
 * Canonical order of the modifier caps. Matches the order used by the existing
 * `formatBinding` helper so a badge reads the same way as the shortcuts dialog.
 */
export const KEYCAST_MODIFIER_ORDER: readonly KeycastModifier[] = ["Ctrl", "Alt", "Shift", "Meta"];

const KEYCAST_MODIFIERS = new Set<string>(KEYCAST_MODIFIER_ORDER);

export function isKeycastModifier(token: string): token is KeycastModifier {
	return KEYCAST_MODIFIERS.has(token);
}

/**
 * A single badge: the keys that were held when a real (non-modifier) key was
 * pressed. `keys` is already ordered (modifiers first, then the key) and does
 * not contain duplicates.
 */
export interface KeycastKeystroke {
	/** Offset from the start of the recording, in milliseconds. */
	timeMs: number;
	keys: string[];
}

/** Auto-hide timing. `holdMs` is user-configurable; the fade is fixed. */
export const DEFAULT_KEYCAST_HOLD_MS = 1600;
export const KEYCAST_FADE_MS = 220;
export const MIN_KEYCAST_HOLD_MS = 400;
export const MAX_KEYCAST_HOLD_MS = 6000;

/**
 * Consecutive identical combinations closer than this collapse into one badge.
 * It absorbs OS key auto-repeat (a held key re-fires every ~30 ms) without
 * hiding deliberate repeats, which are far slower than this window.
 */
export const DEFAULT_KEYCAST_COALESCE_MS = 350;

/** Safety cap on stored keystrokes (1 hour at ~10 keystrokes/second). */
export const MAX_KEYCAST_EVENTS = 60 * 60 * 10;

export const KEYCAST_POSITIONS = [
	"top-left",
	"top-center",
	"top-right",
	"bottom-left",
	"bottom-center",
	"bottom-right",
] as const;

export type KeycastPosition = (typeof KEYCAST_POSITIONS)[number];

/**
 * How the badge is drawn.
 *
 * - `pill`: today's rounded plate (legible over any footage).
 * - `bar`: a full-width strip along the chosen edge, for tutorials that want the
 *   shortcut to read as a caption line.
 * - `minimal`: keys only, no plate, for a clean look on simple footage.
 */
export const KEYCAST_STYLES = ["pill", "bar", "minimal"] as const;
export type KeycastStyle = (typeof KEYCAST_STYLES)[number];

/** One or two lines: the second shows the shortcuts pressed just before. */
export const KEYCAST_LINE_COUNTS = [1, 2] as const;
export type KeycastLineCount = (typeof KEYCAST_LINE_COUNTS)[number];

export interface KeycastSettings {
	enabled: boolean;
	position: KeycastPosition;
	/** Badge height multiplier relative to the reference output width. */
	size: number;
	opacity: number;
	/** How long a badge stays at full opacity after the keystroke. */
	holdMs: number;
	style: KeycastStyle;
	/** 1 = the current combination only, 2 = plus the previous ones. */
	lines: KeycastLineCount;
	/** Optional accent for the caps/bar edge; `null` keeps the default theme. */
	accentColor: string | null;
}

export const DEFAULT_KEYCAST_SETTINGS: KeycastSettings = {
	// Opt-in: the overlay captures keystrokes, so it must never be a surprise.
	enabled: false,
	position: "bottom-left",
	size: 1,
	opacity: 1,
	holdMs: DEFAULT_KEYCAST_HOLD_MS,
	style: "pill",
	lines: 1,
	accentColor: null,
};

/** How many earlier shortcuts the second line can show. */
export const MAX_KEYCAST_HISTORY_ENTRIES = 3;

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export function isKeycastStyle(value: unknown): value is KeycastStyle {
	return typeof value === "string" && (KEYCAST_STYLES as readonly string[]).includes(value);
}

export function isKeycastLineCount(value: unknown): value is KeycastLineCount {
	return typeof value === "number" && (KEYCAST_LINE_COUNTS as readonly number[]).includes(value);
}

/** Accepts `#rrggbb` only; anything else falls back to the default theme. */
export function normalizeKeycastAccent(value: unknown): string | null {
	return typeof value === "string" && HEX_COLOR_PATTERN.test(value.trim())
		? value.trim().toLowerCase()
		: null;
}

export const KEYCAST_SIZE_MIN = 0.5;
export const KEYCAST_SIZE_MAX = 3;

/** Reference frame width the badge scale is derived from (1080p output). */
export const KEYCAST_REFERENCE_WIDTH = 1920;

/** Distance from the frame edge, as a fraction of the output width. */
export const KEYCAST_MARGIN_RATIO = 0.02;

function clampNumber(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function roundTo(value: number, decimals: number): number {
	const factor = 10 ** decimals;
	return Math.round(value * factor) / factor;
}

export function isKeycastPosition(value: unknown): value is KeycastPosition {
	return typeof value === "string" && (KEYCAST_POSITIONS as readonly string[]).includes(value);
}

/**
 * Coerce arbitrary stored input into a valid settings object. Mirrors the
 * defensive normalisation the other overlay settings use (`cursorSway`,
 * `cursorClickEffect…`): bad values fall back instead of throwing.
 */
export function normalizeKeycastSettings(candidate: unknown): KeycastSettings {
	const raw =
		candidate && typeof candidate === "object"
			? (candidate as Partial<Record<keyof KeycastSettings, unknown>>)
			: {};

	return {
		enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_KEYCAST_SETTINGS.enabled,
		position: isKeycastPosition(raw.position)
			? raw.position
			: DEFAULT_KEYCAST_SETTINGS.position,
		size:
			typeof raw.size === "number" && Number.isFinite(raw.size)
				? roundTo(clampNumber(raw.size, KEYCAST_SIZE_MIN, KEYCAST_SIZE_MAX), 2)
				: DEFAULT_KEYCAST_SETTINGS.size,
		opacity:
			typeof raw.opacity === "number" && Number.isFinite(raw.opacity)
				? roundTo(clampNumber(raw.opacity, 0, 1), 2)
				: DEFAULT_KEYCAST_SETTINGS.opacity,
		holdMs:
			typeof raw.holdMs === "number" && Number.isFinite(raw.holdMs)
				? Math.round(clampNumber(raw.holdMs, MIN_KEYCAST_HOLD_MS, MAX_KEYCAST_HOLD_MS))
				: DEFAULT_KEYCAST_SETTINGS.holdMs,
		style: isKeycastStyle(raw.style) ? raw.style : DEFAULT_KEYCAST_SETTINGS.style,
		lines: isKeycastLineCount(raw.lines) ? raw.lines : DEFAULT_KEYCAST_SETTINGS.lines,
		accentColor: normalizeKeycastAccent(raw.accentColor),
	};
}

export function keycastSettingsEqual(left: KeycastSettings, right: KeycastSettings): boolean {
	return (
		left.enabled === right.enabled &&
		left.position === right.position &&
		left.size === right.size &&
		left.opacity === right.opacity &&
		left.holdMs === right.holdMs &&
		left.style === right.style &&
		left.lines === right.lines &&
		left.accentColor === right.accentColor
	);
}

/** Stable serialisation used for persistence round-trips and change detection. */
export function serializeKeycastSettings(settings: KeycastSettings): string {
	return JSON.stringify(normalizeKeycastSettings(settings));
}

export function deserializeKeycastSettings(serialized: unknown): KeycastSettings {
	if (typeof serialized !== "string") {
		return normalizeKeycastSettings(serialized);
	}

	try {
		return normalizeKeycastSettings(JSON.parse(serialized));
	} catch {
		return { ...DEFAULT_KEYCAST_SETTINGS };
	}
}

/**
 * Order the pressed tokens the way a badge reads them: modifiers in canonical
 * order first, then the real key, each token appearing once.
 */
export function composeKeycastKeys(modifiers: Iterable<string>, key: string): string[] {
	const held = new Set(modifiers);
	// Modifiers in canonical order first, then the real key that was pressed.
	const ordered = KEYCAST_MODIFIER_ORDER.filter((modifier) => held.has(modifier));

	return key.length > 0 ? [...ordered, key] : ordered;
}

/**
 * A keystroke is only worth showing when a real key was pressed: modifier-only
 * presses produce `null` so holding `Ctrl` never paints a badge.
 */
export function buildKeycastKeystroke(
	timeMs: number,
	modifiers: Iterable<string>,
	key: string | null,
): KeycastKeystroke | null {
	const trimmedKey = key?.trim() ?? "";
	if (trimmedKey.length === 0) {
		return null;
	}

	return { timeMs: Math.max(0, timeMs), keys: composeKeycastKeys(modifiers, trimmedKey) };
}

function isSameKeycastCombo(left: KeycastKeystroke, right: KeycastKeystroke): boolean {
	return (
		left.keys.length === right.keys.length &&
		left.keys.every((key, index) => key === right.keys[index])
	);
}

/**
 * Merge runs of the same combination that arrive within `coalesceMs` into one
 * badge anchored at the newest press, so OS auto-repeat keeps a single badge on
 * screen instead of restarting its timer for every repeat event.
 */
export function coalesceKeycastKeystrokes(
	events: readonly KeycastKeystroke[],
	coalesceMs: number = DEFAULT_KEYCAST_COALESCE_MS,
): KeycastKeystroke[] {
	const window = Math.max(0, coalesceMs);
	const coalesced: KeycastKeystroke[] = [];

	for (const event of events) {
		const keys = event.keys.filter((key) => key.length > 0);
		if (keys.length === 0) {
			continue;
		}

		const candidate: KeycastKeystroke = { timeMs: Math.max(0, event.timeMs), keys };
		const previous = coalesced[coalesced.length - 1];
		if (
			previous &&
			isSameKeycastCombo(previous, candidate) &&
			candidate.timeMs - previous.timeMs <= window
		) {
			previous.timeMs = candidate.timeMs;
			continue;
		}

		coalesced.push(candidate);
	}

	return coalesced;
}

/** Coerce stored telemetry into a sorted, coalesced, duplicate-free list. */
export function normalizeKeycastKeystrokes(
	raw: unknown,
	coalesceMs: number = DEFAULT_KEYCAST_COALESCE_MS,
): KeycastKeystroke[] {
	if (!Array.isArray(raw)) {
		return [];
	}

	const events: KeycastKeystroke[] = [];
	for (const entry of raw) {
		if (!entry || typeof entry !== "object") {
			continue;
		}

		const candidate = entry as { timeMs?: unknown; keys?: unknown };
		if (typeof candidate.timeMs !== "number" || !Number.isFinite(candidate.timeMs)) {
			continue;
		}

		const keys = Array.isArray(candidate.keys)
			? candidate.keys
					.filter((key): key is string => typeof key === "string")
					.map((key) => key.trim())
					.filter((key) => key.length > 0)
			: [];
		if (keys.length === 0) {
			continue;
		}

		events.push({ timeMs: Math.max(0, candidate.timeMs), keys });
	}

	events.sort((left, right) => left.timeMs - right.timeMs);
	return coalesceKeycastKeystrokes(events, coalesceMs);
}

export interface KeycastBadgeState {
	keys: string[];
	opacity: number;
	/** Time of the press that owns the badge. */
	timeMs: number;
}

/**
 * Badge visible at `timeMs`, or `null` when nothing is on screen.
 *
 * Behaviour: a badge is painted the moment a real key is pressed, stays at full
 * opacity for `holdMs` and then fades out linearly over `KEYCAST_FADE_MS`. Any
 * newer press replaces the badge immediately (no cross-fade), and seeking
 * backwards re-derives the badge from telemetry, so the overlay is deterministic
 * and identical in preview and export.
 */
export function resolveKeycastBadge(
	events: readonly KeycastKeystroke[],
	timeMs: number,
	options: { holdMs?: number; fadeMs?: number } = {},
): KeycastBadgeState | null {
	if (events.length === 0 || !Number.isFinite(timeMs)) {
		return null;
	}

	const holdMs = Math.max(0, options.holdMs ?? DEFAULT_KEYCAST_HOLD_MS);
	const fadeMs = Math.max(0, options.fadeMs ?? KEYCAST_FADE_MS);

	// Last event at or before `timeMs` (binary search keeps this cheap per frame).
	let low = 0;
	let high = events.length - 1;
	if (timeMs < events[0].timeMs) {
		return null;
	}

	while (low < high) {
		const mid = Math.ceil((low + high) / 2);
		if (events[mid].timeMs <= timeMs) {
			low = mid;
		} else {
			high = mid - 1;
		}
	}

	const event = events[low];
	const elapsed = timeMs - event.timeMs;
	if (elapsed > holdMs + fadeMs) {
		return null;
	}

	const opacity = fadeMs <= 0 || elapsed <= holdMs ? 1 : 1 - (elapsed - holdMs) / fadeMs;
	return { keys: event.keys, opacity: Math.max(0, Math.min(1, opacity)), timeMs: event.timeMs };
}

/**
 * Shortcuts for the badge's second line: the distinct combinations pressed
 * before the current one, newest first.
 *
 * Only combinations whose own badge would still be on screen are listed, so the
 * second line reads as "and just before that…" instead of resurfacing keystrokes
 * from a minute ago. Duplicates of the newest entry are collapsed, which is what
 * a held modifier plus repeated keys produces.
 */
export function resolveKeycastHistory(
	events: readonly KeycastKeystroke[],
	timeMs: number,
	options: { holdMs?: number; fadeMs?: number; max?: number } = {},
): string[][] {
	const max = Math.max(0, options.max ?? MAX_KEYCAST_HISTORY_ENTRIES);
	if (events.length === 0 || max === 0 || !Number.isFinite(timeMs)) {
		return [];
	}

	const window = options.holdMs ?? DEFAULT_KEYCAST_HOLD_MS;
	const fade = options.fadeMs ?? KEYCAST_FADE_MS;
	const grace = Math.max(0, window) + Math.max(0, fade);
	const history: string[][] = [];

	for (let index = events.length - 1; index >= 0 && history.length < max; index -= 1) {
		const event = events[index];
		if (event.timeMs > timeMs) {
			// Seeking backwards: events after "now" are not history yet.
			continue;
		}
		const elapsed = timeMs - event.timeMs;
		if (elapsed < 1) {
			// The badge currently on screen.
			continue;
		}
		if (elapsed > grace) {
			break;
		}

		const newest = history[0];
		const isDuplicate =
			newest &&
			newest.length === event.keys.length &&
			newest.every((key, keyIndex) => key === event.keys[keyIndex]);
		if (!isDuplicate) {
			history.push([...event.keys]);
		}
	}

	return history;
}

export interface KeycastBadgeMetrics {
	scale: number;
	capHeight: number;
	capRadius: number;
	capGap: number;
	/** Gap reserved for the `+` between caps. */
	separatorWidth: number;
	paddingX: number;
	paddingY: number;
	fontSize: number;
	margin: number;
}

/**
 * Structural badge metrics for one output size. `capWidth` is deliberately not
 * included: the two renderers measure their own text so the DOM preview and the
 * burned-in canvas badge use their own font metrics.
 */
export function buildKeycastBadgeMetrics(
	width: number,
	settings: Pick<KeycastSettings, "size">,
): KeycastBadgeMetrics {
	const safeWidth = Math.max(1, width);
	const scale = (safeWidth / KEYCAST_REFERENCE_WIDTH) * settings.size;
	const capHeight = Math.round(64 * scale);

	return {
		scale,
		capHeight,
		capRadius: Math.round(capHeight * 0.22),
		capGap: Math.round(capHeight * 0.2),
		separatorWidth: Math.round(capHeight * 0.36),
		paddingX: Math.round(capHeight * 0.34),
		paddingY: Math.round(capHeight * 0.22),
		fontSize: Math.max(1, Math.round(capHeight * 0.46)),
		margin: Math.round(safeWidth * KEYCAST_MARGIN_RATIO),
	};
}

/**
 * Top-left corner of the badge box for the configured position.
 * `badgeWidth`/`badgeHeight` come from the renderer's own measurement.
 */
export function resolveKeycastBadgeOrigin(
	position: KeycastPosition,
	frameWidth: number,
	frameHeight: number,
	badgeWidth: number,
	badgeHeight: number,
	margin: number,
): { x: number; y: number } {
	const safeMargin = Math.max(0, margin);
	const maxX = Math.max(safeMargin, frameWidth - badgeWidth - safeMargin);
	const maxY = Math.max(safeMargin, frameHeight - badgeHeight - safeMargin);

	switch (position) {
		case "top-left":
			return { x: safeMargin, y: safeMargin };
		case "top-center":
			return { x: (frameWidth - badgeWidth) / 2, y: safeMargin };
		case "top-right":
			return { x: maxX, y: safeMargin };
		case "bottom-left":
			return { x: safeMargin, y: maxY };
		case "bottom-center":
			return { x: (frameWidth - badgeWidth) / 2, y: maxY };
		case "bottom-right":
		default:
			return { x: maxX, y: maxY };
	}
}

const MAC_MODIFIER_LABELS: Record<string, string> = {
	Ctrl: "⌃",
	Alt: "⌥",
	Shift: "⇧",
	Meta: "⌘",
};

const WINDOWS_MODIFIER_LABELS: Record<string, string> = {
	Ctrl: "Ctrl",
	Alt: "Alt",
	Shift: "Shift",
	Meta: "Win",
};

const KEY_LABELS: Record<string, string> = {
	" ": "Space",
	Space: "Space",
	Enter: "Enter",
	Tab: "Tab",
	Escape: "Esc",
	Backspace: "⌫",
	Delete: "Del",
	ArrowUp: "↑",
	ArrowDown: "↓",
	ArrowLeft: "←",
	ArrowRight: "→",
	PageUp: "PgUp",
	PageDown: "PgDn",
	Home: "Home",
	End: "End",
	Insert: "Ins",
	ContextMenu: "Menu",
	CapsLock: "Caps",
};

/**
 * Display label for one canonical token. The badge is always rendered
 * left-to-right, so modifier glyphs follow the platform's own convention
 * (⌃⌥⇧⌘ on macOS) instead of the app's RTL text direction.
 */
export function formatKeycastToken(token: string, isMac: boolean): string {
	const modifierLabels = isMac ? MAC_MODIFIER_LABELS : WINDOWS_MODIFIER_LABELS;
	if (modifierLabels[token]) {
		return modifierLabels[token];
	}

	if (KEY_LABELS[token]) {
		return KEY_LABELS[token];
	}

	return token.length === 1 ? token.toUpperCase() : token;
}

export function formatKeycastKeys(keys: readonly string[], isMac: boolean): string[] {
	return keys.map((key) => formatKeycastToken(key, isMac));
}

/**
 * Canonical keystroke tokens for an Electron accelerator
 * (`CommandOrControl+Alt+A`), or `null` when the accelerator cannot be mapped.
 * Used to keep the app's own global shortcuts out of the badge.
 */
export function acceleratorToKeycastKeys(accelerator: string, isMac: boolean): string[] | null {
	if (typeof accelerator !== "string" || accelerator.trim().length === 0) {
		return null;
	}

	const parts = accelerator
		.split("+")
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
	if (parts.length === 0) {
		return null;
	}

	const modifiers: string[] = [];
	let key: string | null = null;

	for (const part of parts) {
		const lowered = part.toLowerCase();
		if (lowered === "commandorcontrol" || lowered === "cmdorctrl") {
			modifiers.push(isMac ? "Meta" : "Ctrl");
			continue;
		}
		if (lowered === "control" || lowered === "ctrl") {
			modifiers.push("Ctrl");
			continue;
		}
		if (lowered === "alt" || lowered === "option") {
			modifiers.push("Alt");
			continue;
		}
		if (lowered === "shift") {
			modifiers.push("Shift");
			continue;
		}
		if (
			lowered === "command" ||
			lowered === "cmd" ||
			lowered === "super" ||
			lowered === "meta"
		) {
			modifiers.push("Meta");
			continue;
		}

		key = KEY_LABELS[part] ?? (part.length === 1 ? part.toUpperCase() : part);
	}

	return key === null ? null : composeKeycastKeys(modifiers, key);
}

/** Whether a composed keystroke is one of the combinations to keep off screen. */
export function isSuppressedKeycastStroke(
	keys: readonly string[],
	suppressed: readonly (readonly string[])[],
): boolean {
	if (keys.length === 0 || suppressed.length === 0) {
		return false;
	}

	const candidate = [...keys].sort();
	return suppressed.some((combo) => {
		if (combo.length !== candidate.length) {
			return false;
		}
		const sorted = [...combo].sort();
		return sorted.every((token, index) => token === candidate[index]);
	});
}

/**
 * uiohook keycodes (`VC_*` in libuiohook, i.e. the Windows virtual-key layout)
 * mapped to canonical key tokens. Only the keys a presenter realistically shows
 * are listed: an unmapped code produces no badge rather than a garbage label.
 */
export const KEYCAST_KEYCODE_LABELS: Record<number, string> = {
	0x0001: "Escape",
	0x0002: "1",
	0x0003: "2",
	0x0004: "3",
	0x0005: "4",
	0x0006: "5",
	0x0007: "6",
	0x0008: "7",
	0x0009: "8",
	0x000a: "9",
	0x000b: "0",
	0x000c: "-",
	0x000d: "=",
	0x000e: "Backspace",
	0x000f: "Tab",
	0x0010: "Q",
	0x0011: "W",
	0x0012: "E",
	0x0013: "R",
	0x0014: "T",
	0x0015: "Y",
	0x0016: "U",
	0x0017: "I",
	0x0018: "O",
	0x0019: "P",
	0x001a: "[",
	0x001b: "]",
	0x001c: "Enter",
	0x001e: "A",
	0x001f: "S",
	0x0020: "D",
	0x0021: "F",
	0x0022: "G",
	0x0023: "H",
	0x0024: "J",
	0x0025: "K",
	0x0026: "L",
	0x0027: ";",
	0x0028: "'",
	0x0029: "`",
	0x002b: "\\",
	0x002c: "Z",
	0x002d: "X",
	0x002e: "C",
	0x002f: "V",
	0x0030: "B",
	0x0031: "N",
	0x0032: "M",
	0x0033: ",",
	0x0034: ".",
	0x0035: "/",
	0x0039: "Space",
	0x003a: "CapsLock",
	0x003b: "F1",
	0x003c: "F2",
	0x003d: "F3",
	0x003e: "F4",
	0x003f: "F5",
	0x0040: "F6",
	0x0041: "F7",
	0x0042: "F8",
	0x0043: "F9",
	0x0044: "F10",
	0x0057: "F11",
	0x0058: "F12",
	0x0045: "NumLock",
	0x0046: "ScrollLock",
	0x0047: "Home",
	0x0048: "ArrowUp",
	0x0049: "PageUp",
	0x004b: "ArrowLeft",
	0x004d: "ArrowRight",
	0x004f: "End",
	0x0050: "ArrowDown",
	0x0051: "PageDown",
	0x0052: "Insert",
	0x0053: "Delete",
};

const MODIFIER_KEYCODE_TOKENS: Record<number, KeycastModifier> = {
	0x001d: "Ctrl",
	0x002a: "Shift",
	0x0036: "Shift",
	0x0038: "Alt",
	0x005b: "Meta",
	0x005c: "Meta",
	0x0e1d: "Ctrl",
	0x0e2a: "Shift",
	0x0e36: "Shift",
	0x0e38: "Alt",
	0x0e5b: "Meta",
	0x0e5c: "Meta",
};

/** Canonical modifier token for a keycode, or `null` when it is a real key. */
export function keycastModifierForKeycode(keycode: number): KeycastModifier | null {
	return MODIFIER_KEYCODE_TOKENS[keycode] ?? null;
}

/** Canonical key token for a keycode, or `null` when the code is unmapped. */
export function keycastKeyForKeycode(keycode: number): string | null {
	if (keycastModifierForKeycode(keycode)) {
		return null;
	}

	return KEYCAST_KEYCODE_LABELS[keycode] ?? null;
}
