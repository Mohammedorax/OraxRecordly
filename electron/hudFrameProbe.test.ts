import { describe, expect, it } from "vitest";
import {
	classifyHudFrameProbe,
	decideHudFallback,
	describeHudFallback,
	type HudFallbackInput,
} from "./hudFrameProbe";

describe("classifyHudFrameProbe", () => {
	it("treats a rejection as a missing frame", () => {
		// `webContents.capturePage()` rejecting with UnknownVizError is the exact
		// shape of the owner's bug.
		expect(classifyHudFrameProbe({ threw: true })).toBe("not-presented");
	});

	it("treats a zero-sized capture as a missing frame", () => {
		// Electron resolves with a 0x0 NativeImage when the surface exists but was
		// never composited; that is still no frame.
		expect(classifyHudFrameProbe({ threw: false, width: 0, height: 0 })).toBe("not-presented");
		expect(classifyHudFrameProbe({ threw: false, width: 1290, height: 0 })).toBe(
			"not-presented",
		);
	});

	it("treats a non-empty capture as presented", () => {
		expect(classifyHudFrameProbe({ threw: false, width: 1290, height: 810 })).toBe("presented");
	});

	it("is inconclusive when dimensions are unavailable", () => {
		expect(classifyHudFrameProbe({ threw: false })).toBe("inconclusive");
	});

	it("prefers the thrown signal over missing dimensions", () => {
		expect(classifyHudFrameProbe({ threw: true, width: 100, height: 100 })).toBe(
			"not-presented",
		);
	});
});

describe("decideHudFallback", () => {
	const base: HudFallbackInput = {
		outcome: "not-presented",
		windowAlive: true,
		fallbackApplied: false,
		hudIntentionallyHidden: false,
	};

	it("recovers when the compositor never presented the HUD", () => {
		expect(decideHudFallback(base)).toBe("recover-with-opaque-hud");
	});

	it("does nothing when the frame was presented", () => {
		expect(decideHudFallback({ ...base, outcome: "presented" })).toBe("none");
	});

	it("does nothing when the probe was inconclusive", () => {
		// Acting on an inconclusive probe would replace a working transparent HUD
		// with an opaque one for no reason.
		expect(decideHudFallback({ ...base, outcome: "inconclusive" })).toBe("none");
	});

	it("does nothing when the window is already gone", () => {
		expect(decideHudFallback({ ...base, windowAlive: false })).toBe("none");
	});

	it("does not recover twice", () => {
		expect(decideHudFallback({ ...base, fallbackApplied: true })).toBe("none");
	});

	it("leaves a deliberately hidden HUD alone", () => {
		// "Start minimized" hides the HUD on purpose, so a failed probe there says
		// nothing about the compositor.
		expect(decideHudFallback({ ...base, hudIntentionallyHidden: true })).toBe("none");
	});

	it("is inert while the probe has no answer yet", () => {
		// The watchdog sees `framePresented: undefined` until the probe has run; an
		// un-run probe must never be mistaken for a failure.
		expect(decideHudFallback({ ...base, outcome: "inconclusive" })).toBe("none");
	});
});

describe("describeHudFallback", () => {
	it("explains a no-op outcome", () => {
		const text = describeHudFallback("none", {
			outcome: "presented",
			windowAlive: true,
			fallbackApplied: false,
			hudIntentionallyHidden: false,
		});
		expect(text).toContain("presented");
		expect(text).toContain("no recovery needed");
	});

	it("explains the recovery", () => {
		const text = describeHudFallback("recover-with-opaque-hud", {
			outcome: "not-presented",
			windowAlive: true,
			fallbackApplied: false,
			hudIntentionallyHidden: false,
		});
		expect(text).toContain("opaque");
	});
});
