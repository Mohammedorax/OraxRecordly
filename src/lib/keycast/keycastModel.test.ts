import { describe, expect, it } from "vitest";

import {
	acceleratorToKeycastKeys,
	buildKeycastBadgeMetrics,
	buildKeycastKeystroke,
	coalesceKeycastKeystrokes,
	composeKeycastKeys,
	DEFAULT_KEYCAST_COALESCE_MS,
	DEFAULT_KEYCAST_HOLD_MS,
	DEFAULT_KEYCAST_SETTINGS,
	deserializeKeycastSettings,
	formatKeycastKeys,
	formatKeycastToken,
	isSuppressedKeycastStroke,
	keycastKeyForKeycode,
	keycastModifierForKeycode,
	type KeycastKeystroke,
	normalizeKeycastKeystrokes,
	normalizeKeycastSettings,
	resolveKeycastBadge,
	resolveKeycastBadgeOrigin,
	serializeKeycastSettings,
	KEYCAST_FADE_MS,
} from "./keycastModel";

function stroke(timeMs: number, ...keys: string[]): KeycastKeystroke {
	return { timeMs, keys };
}

describe("composeKeycastKeys", () => {
	it("orders modifiers canonically and appends the real key", () => {
		expect(composeKeycastKeys(["Meta", "Shift", "Ctrl"], "A")).toEqual([
			"Ctrl",
			"Shift",
			"Meta",
			"A",
		]);
	});

	it("ignores duplicate modifiers and unknown modifier tokens", () => {
		expect(composeKeycastKeys(["Ctrl", "Ctrl", "Hyper"], "C")).toEqual(["Ctrl", "C"]);
	});
});

describe("buildKeycastKeystroke", () => {
	it("suppresses modifier-only presses", () => {
		expect(buildKeycastKeystroke(120, ["Ctrl"], null)).toBeNull();
		expect(buildKeycastKeystroke(120, ["Ctrl", "Shift"], "")).toBeNull();
		expect(buildKeycastKeystroke(120, ["Ctrl", "Shift"], "   ")).toBeNull();
	});

	it("captures the full combination for a real key", () => {
		expect(buildKeycastKeystroke(120, ["Ctrl"], "A")).toEqual({
			timeMs: 120,
			keys: ["Ctrl", "A"],
		});
	});

	it("clamps negative timestamps", () => {
		expect(buildKeycastKeystroke(-5, [], "A")?.timeMs).toBe(0);
	});
});

describe("coalesceKeycastKeystrokes", () => {
	it("merges auto-repeat of the same combination into one badge", () => {
		const coalesced = coalesceKeycastKeystrokes([
			stroke(0, "Ctrl", "A"),
			stroke(33, "Ctrl", "A"),
			stroke(66, "Ctrl", "A"),
		]);

		expect(coalesced).toEqual([stroke(66, "Ctrl", "A")]);
	});

	it("keeps deliberate repeats that are slower than the window", () => {
		const coalesced = coalesceKeycastKeystrokes([
			stroke(0, "Ctrl", "A"),
			stroke(DEFAULT_KEYCAST_COALESCE_MS + 50, "Ctrl", "A"),
		]);

		expect(coalesced).toHaveLength(2);
	});

	it("never merges a different combination or a combination in between", () => {
		const coalesced = coalesceKeycastKeystrokes([
			stroke(0, "Ctrl", "A"),
			stroke(20, "A"),
			stroke(40, "Ctrl", "A"),
		]);

		expect(coalesced).toEqual([
			stroke(0, "Ctrl", "A"),
			stroke(20, "A"),
			stroke(40, "Ctrl", "A"),
		]);
	});
});

describe("normalizeKeycastKeystrokes", () => {
	it("sorts, filters and coalesces stored telemetry", () => {
		const normalized = normalizeKeycastKeystrokes([
			{ timeMs: 80, keys: ["Ctrl", "V"] },
			{ timeMs: 40, keys: ["Ctrl", "A"] },
			{ timeMs: 45, keys: ["Ctrl", "A"] },
			{ timeMs: Number.NaN, keys: ["Ctrl", "B"] },
			{ timeMs: 10, keys: [] },
			{ timeMs: 12, keys: "Ctrl" },
			null,
			"nope",
		]);

		expect(normalized).toEqual([stroke(45, "Ctrl", "A"), stroke(80, "Ctrl", "V")]);
	});

	it("returns an empty list for non-array input", () => {
		expect(normalizeKeycastKeystrokes(undefined)).toEqual([]);
		expect(normalizeKeycastKeystrokes({ keys: ["A"] })).toEqual([]);
	});
});

describe("resolveKeycastBadge", () => {
	const events = [stroke(1_000, "Ctrl", "A"), stroke(5_000, "Ctrl", "Shift", "T")];

	it("returns null before the first press and after the fade", () => {
		expect(resolveKeycastBadge(events, 999)).toBeNull();
		expect(
			resolveKeycastBadge(events, 1_000 + DEFAULT_KEYCAST_HOLD_MS + KEYCAST_FADE_MS + 1),
		).toBeNull();
	});

	it("holds at full opacity then fades linearly", () => {
		expect(resolveKeycastBadge(events, 1_000)?.opacity).toBe(1);
		expect(resolveKeycastBadge(events, 1_000 + DEFAULT_KEYCAST_HOLD_MS)?.opacity).toBe(1);

		const fading = resolveKeycastBadge(
			events,
			1_000 + DEFAULT_KEYCAST_HOLD_MS + KEYCAST_FADE_MS / 2,
		);
		expect(fading?.opacity).toBeCloseTo(0.5, 5);
	});

	it("replaces the badge as soon as a newer combination is pressed", () => {
		expect(resolveKeycastBadge(events, 5_100)?.keys).toEqual(["Ctrl", "Shift", "T"]);
	});

	it("honours a custom hold duration and seeking backwards", () => {
		expect(resolveKeycastBadge(events, 5_100, { holdMs: 100 })?.opacity).toBe(1);
		expect(resolveKeycastBadge(events, 1_330, { holdMs: 100 })).toBeNull();
		expect(resolveKeycastBadge(events, 1_050)?.keys).toEqual(["Ctrl", "A"]);
	});

	it("returns null without telemetry", () => {
		expect(resolveKeycastBadge([], 1_000)).toBeNull();
	});
});

describe("KeycastSettings", () => {
	it("is opt-in and off by default", () => {
		expect(DEFAULT_KEYCAST_SETTINGS.enabled).toBe(false);
		expect(normalizeKeycastSettings(undefined)).toEqual(DEFAULT_KEYCAST_SETTINGS);
		expect(normalizeKeycastSettings("garbage")).toEqual(DEFAULT_KEYCAST_SETTINGS);
	});

	it("clamps size, opacity and hold duration", () => {
		expect(
			normalizeKeycastSettings({ size: 99, opacity: 5, holdMs: 99_999, position: "nope" }),
		).toEqual({
			enabled: false,
			position: DEFAULT_KEYCAST_SETTINGS.position,
			size: 3,
			opacity: 1,
			holdMs: 6_000,
		});

		expect(normalizeKeycastSettings({ size: -1, opacity: -1, holdMs: 0 })).toMatchObject({
			size: 0.5,
			opacity: 0,
			holdMs: 400,
		});
	});

	it("keeps valid values", () => {
		expect(
			normalizeKeycastSettings({
				enabled: true,
				position: "top-center",
				size: 1.25,
				opacity: 0.6,
				holdMs: 2_000,
			}),
		).toEqual({
			enabled: true,
			position: "top-center",
			size: 1.25,
			opacity: 0.6,
			holdMs: 2_000,
		});
	});

	it("round-trips through serialisation twice", () => {
		const settings = normalizeKeycastSettings({
			enabled: true,
			position: "top-right",
			size: 1.5,
			opacity: 0.75,
			holdMs: 2_500,
		});
		const once = deserializeKeycastSettings(serializeKeycastSettings(settings));
		const twice = deserializeKeycastSettings(serializeKeycastSettings(once));

		expect(once).toEqual(settings);
		expect(twice).toEqual(settings);
	});

	it("falls back to defaults for corrupt serialised input", () => {
		expect(deserializeKeycastSettings("{not json")).toEqual(DEFAULT_KEYCAST_SETTINGS);
	});
});

describe("keycode mapping", () => {
	it("maps modifiers on both sides of the keyboard", () => {
		expect(keycastModifierForKeycode(0x001d)).toBe("Ctrl");
		expect(keycastModifierForKeycode(0x0e1d)).toBe("Ctrl");
		expect(keycastModifierForKeycode(0x0038)).toBe("Alt");
		expect(keycastModifierForKeycode(0x0036)).toBe("Shift");
		expect(keycastModifierForKeycode(0x0e5b)).toBe("Meta");
	});

	it("maps letter, digit, function and navigation keys", () => {
		expect(keycastKeyForKeycode(0x001e)).toBe("A");
		expect(keycastKeyForKeycode(0x0002)).toBe("1");
		expect(keycastKeyForKeycode(0x003b)).toBe("F1");
		expect(keycastKeyForKeycode(0x0048)).toBe("ArrowUp");
		expect(keycastKeyForKeycode(0x0039)).toBe("Space");
	});

	it("returns null for modifiers and unmapped codes", () => {
		expect(keycastKeyForKeycode(0x001d)).toBeNull();
		expect(keycastKeyForKeycode(0x7fff)).toBeNull();
	});
});

describe("formatKeycastToken", () => {
	it("uses macOS glyphs for modifiers and Windows words elsewhere", () => {
		expect(formatKeycastKeys(["Ctrl", "Alt", "Shift", "Meta", "A"], true)).toEqual([
			"⌃",
			"⌥",
			"⇧",
			"⌘",
			"A",
		]);
		expect(formatKeycastKeys(["Ctrl", "Meta", "A"], false)).toEqual(["Ctrl", "Win", "A"]);
	});

	it("expands named keys and uppercases single characters", () => {
		expect(formatKeycastToken(" ", true)).toBe("Space");
		expect(formatKeycastToken("Escape", true)).toBe("Esc");
		expect(formatKeycastToken("ArrowUp", true)).toBe("↑");
		expect(formatKeycastToken("a", true)).toBe("A");
		expect(formatKeycastToken("F5", true)).toBe("F5");
	});
});

describe("accelerator suppression", () => {
	it("maps Electron accelerators onto canonical keystroke tokens", () => {
		expect(acceleratorToKeycastKeys("CommandOrControl+Alt+A", true)).toEqual([
			"Alt",
			"Meta",
			"A",
		]);
		expect(acceleratorToKeycastKeys("CommandOrControl+Alt+A", false)).toEqual([
			"Ctrl",
			"Alt",
			"A",
		]);
		expect(acceleratorToKeycastKeys("Control+Shift+F5", false)).toEqual([
			"Ctrl",
			"Shift",
			"F5",
		]);
	});

	it("ignores empty or modifier-only accelerators", () => {
		expect(acceleratorToKeycastKeys("", false)).toBeNull();
		expect(acceleratorToKeycastKeys("CommandOrControl", false)).toBeNull();
	});

	it("matches a suppressed combination regardless of token order", () => {
		const suppressed = [["Ctrl", "Alt", "A"]];

		expect(isSuppressedKeycastStroke(["Ctrl", "Alt", "A"], suppressed)).toBe(true);
		expect(isSuppressedKeycastStroke(["Alt", "Ctrl", "A"], suppressed)).toBe(true);
		expect(isSuppressedKeycastStroke(["Ctrl", "A"], suppressed)).toBe(false);
		expect(isSuppressedKeycastStroke(["Ctrl", "Alt", "A"], [])).toBe(false);
	});
});

describe("layout helpers", () => {
	it("scales badge metrics with the output width and size multiplier", () => {
		const base = buildKeycastBadgeMetrics(1920, { size: 1 });
		const doubled = buildKeycastBadgeMetrics(3840, { size: 1 });
		const bigger = buildKeycastBadgeMetrics(1920, { size: 2 });

		expect(doubled.capHeight).toBe(base.capHeight * 2);
		expect(bigger.capHeight).toBe(base.capHeight * 2);
		expect(base.capHeight).toBeGreaterThan(0);
	});

	it("anchors the badge in every corner without overflowing the frame", () => {
		const frame = { width: 1920, height: 1080 };
		const badge = { width: 300, height: 80 };
		const margin = 20;

		expect(
			resolveKeycastBadgeOrigin(
				"top-left",
				frame.width,
				frame.height,
				badge.width,
				badge.height,
				margin,
			),
		).toEqual({ x: 20, y: 20 });
		expect(
			resolveKeycastBadgeOrigin(
				"top-right",
				frame.width,
				frame.height,
				badge.width,
				badge.height,
				margin,
			),
		).toEqual({ x: 1600, y: 20 });
		expect(
			resolveKeycastBadgeOrigin(
				"bottom-left",
				frame.width,
				frame.height,
				badge.width,
				badge.height,
				margin,
			),
		).toEqual({ x: 20, y: 980 });
		expect(
			resolveKeycastBadgeOrigin(
				"bottom-right",
				frame.width,
				frame.height,
				badge.width,
				badge.height,
				margin,
			),
		).toEqual({ x: 1600, y: 980 });
		expect(
			resolveKeycastBadgeOrigin(
				"top-center",
				frame.width,
				frame.height,
				badge.width,
				badge.height,
				margin,
			),
		).toEqual({ x: 810, y: 20 });
		expect(
			resolveKeycastBadgeOrigin(
				"bottom-center",
				frame.width,
				frame.height,
				badge.width,
				badge.height,
				margin,
			),
		).toEqual({ x: 810, y: 980 });
	});
});
