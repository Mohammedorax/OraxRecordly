import { describe, expect, it } from "vitest";
import {
	decideStartupVisibility,
	describeStartupVisibility,
	EDITOR_WINDOW_TYPE,
	findVisibleWindow,
	getWindowTypeFromUrl,
	HUD_OVERLAY_WINDOW_TYPE,
	STARTUP_VISIBILITY_EDITOR_FALLBACK_MS,
	STARTUP_VISIBILITY_PROBE_MS,
	type StartupVisibilityInput,
	type StartupWindowSnapshot,
} from "./startupVisibility";

const hud = (visible: boolean, destroyed = false): StartupWindowSnapshot => ({
	windowType: HUD_OVERLAY_WINDOW_TYPE,
	visible,
	destroyed,
});

const editor = (visible: boolean): StartupWindowSnapshot => ({
	windowType: EDITOR_WINDOW_TYPE,
	visible,
	destroyed: false,
});

const decide = (overrides: Partial<StartupVisibilityInput>) =>
	decideStartupVisibility({
		windows: [hud(false)],
		elapsedMs: 0,
		hudShowAttempted: false,
		...overrides,
	});

describe("getWindowTypeFromUrl", () => {
	it("reads the windowType query parameter from a packaged file URL", () => {
		expect(
			getWindowTypeFromUrl(
				"file:///C:/app/resources/app.asar/dist/index.html?windowType=hud-overlay",
			),
		).toBe("hud-overlay");
	});

	it("reads the windowType query parameter from the dev server URL", () => {
		expect(getWindowTypeFromUrl("http://localhost:5173/?windowType=hud-overlay")).toBe(
			"hud-overlay",
		);
	});

	it("reads windowType when it is not the first parameter", () => {
		expect(getWindowTypeFromUrl("http://localhost:5173/?a=1&windowType=editor")).toBe("editor");
	});

	it("decodes an encoded value", () => {
		expect(getWindowTypeFromUrl("http://localhost:5173/?windowType=update%2Dtoast")).toBe(
			"update-toast",
		);
	});

	it("returns an empty string when the parameter is absent or the URL is unusable", () => {
		expect(getWindowTypeFromUrl("file:///C:/app/index.html")).toBe("");
		expect(getWindowTypeFromUrl("")).toBe("");
		expect(getWindowTypeFromUrl(undefined as unknown as string)).toBe("");
	});
});

describe("decideStartupVisibility", () => {
	it("reports nothing to do as soon as any window is visible", () => {
		expect(decide({ windows: [hud(false), editor(true)], elapsedMs: 10 })).toBe("none");
		expect(decide({ windows: [hud(true)], elapsedMs: 10 })).toBe("none");
	});

	it("ignores destroyed windows when looking for a visible surface", () => {
		expect(decide({ windows: [hud(true, true)], elapsedMs: 0 })).toBe("wait");
		// A destroyed HUD cannot be shown, so the editor is the only way left to
		// guarantee that the launch ends with something the user can see.
		expect(decide({ windows: [hud(true, true)], elapsedMs: STARTUP_VISIBILITY_PROBE_MS })).toBe(
			"open-editor",
		);
	});

	it("waits through the grace period before touching the HUD", () => {
		expect(decide({ elapsedMs: STARTUP_VISIBILITY_PROBE_MS - 1 })).toBe("wait");
	});

	it("asks the hidden HUD to show itself once the grace period elapses", () => {
		expect(decide({ elapsedMs: STARTUP_VISIBILITY_PROBE_MS })).toBe("show-hud");
	});

	it("does not ask the HUD twice", () => {
		expect(decide({ elapsedMs: STARTUP_VISIBILITY_PROBE_MS, hudShowAttempted: true })).toBe(
			"wait",
		);
	});

	it("opens the editor when the HUD still cannot be presented", () => {
		expect(
			decide({
				elapsedMs: STARTUP_VISIBILITY_EDITOR_FALLBACK_MS,
				hudShowAttempted: true,
			}),
		).toBe("open-editor");
	});

	it("opens the editor immediately when there is no HUD window to reveal", () => {
		expect(decide({ windows: [], elapsedMs: STARTUP_VISIBILITY_PROBE_MS })).toBe("open-editor");
		expect(decide({ windows: [editor(false)], elapsedMs: STARTUP_VISIBILITY_PROBE_MS })).toBe(
			"open-editor",
		);
	});

	it("keeps waiting with no windows at all until the probe elapses", () => {
		expect(decide({ windows: [], elapsedMs: 0 })).toBe("wait");
	});

	it("never returns a recovery action while a window is visible", () => {
		expect(
			decide({
				windows: [hud(true)],
				elapsedMs: STARTUP_VISIBILITY_EDITOR_FALLBACK_MS * 10,
				hudShowAttempted: true,
			}),
		).toBe("none");
	});

	it("keeps the editor fallback strictly after the HUD reveal", () => {
		expect(STARTUP_VISIBILITY_EDITOR_FALLBACK_MS).toBeGreaterThan(STARTUP_VISIBILITY_PROBE_MS);
	});

	it("keeps watching when the HUD is visible but its frame was never presented", () => {
		// The early probe recovers this case in-product; the watchdog must not
		// declare victory in the meantime, or a failed recovery would leave the
		// user with nothing on screen.
		const unpresented = { ...hud(true), framePresented: false };
		expect(decide({ windows: [unpresented], elapsedMs: 0 })).toBe("wait");
		expect(decide({ windows: [unpresented], elapsedMs: STARTUP_VISIBILITY_PROBE_MS })).toBe(
			"show-hud",
		);
		expect(
			decide({
				windows: [unpresented],
				elapsedMs: STARTUP_VISIBILITY_EDITOR_FALLBACK_MS,
				hudShowAttempted: true,
			}),
		).toBe("open-editor");
	});

	it("stops watching once the probe confirms a presented frame", () => {
		expect(
			decide({
				windows: [{ ...hud(true), framePresented: true }],
				elapsedMs: STARTUP_VISIBILITY_EDITOR_FALLBACK_MS,
			}),
		).toBe("none");
	});
});

describe("findVisibleWindow", () => {
	it("returns null when every window is hidden or destroyed", () => {
		expect(findVisibleWindow([])).toBeNull();
		expect(findVisibleWindow([hud(false), hud(true, true)])).toBeNull();
	});

	it("prefers the first visible, non-destroyed window", () => {
		expect(findVisibleWindow([hud(false), editor(true)])?.windowType).toBe(EDITOR_WINDOW_TYPE);
	});

	it("rejects a visible window whose frame was never presented", () => {
		// This is the owner's bug: Electron reports the HUD visible while the
		// compositor never produced a frame, so it is not something the user sees.
		expect(findVisibleWindow([{ ...hud(true), framePresented: false }])).toBeNull();
	});

	it("accepts a window whose frame was presented", () => {
		expect(findVisibleWindow([{ ...hud(true), framePresented: true }])?.windowType).toBe(
			HUD_OVERLAY_WINDOW_TYPE,
		);
	});

	it("treats an unprobed window as visible", () => {
		// `undefined` means the probe has not run; treating that as failure would
		// downgrade a perfectly healthy HUD.
		expect(findVisibleWindow([{ ...hud(true), framePresented: undefined }])?.windowType).toBe(
			HUD_OVERLAY_WINDOW_TYPE,
		);
	});
});

describe("describeStartupVisibility", () => {
	it("names the window type that satisfied the launch", () => {
		expect(
			describeStartupVisibility("none", {
				windows: [hud(true)],
				elapsedMs: 1200,
				hudShowAttempted: false,
			}),
		).toContain(HUD_OVERLAY_WINDOW_TYPE);
	});

	it("explains why the HUD is being revealed", () => {
		const text = describeStartupVisibility("show-hud", {
			windows: [hud(false)],
			elapsedMs: STARTUP_VISIBILITY_PROBE_MS,
			hudShowAttempted: false,
		});
		expect(text).toContain("showing the HUD overlay");
		expect(text).toContain("hidden");
	});

	it("explains an empty window list", () => {
		expect(
			describeStartupVisibility("open-editor", {
				windows: [],
				elapsedMs: STARTUP_VISIBILITY_EDITOR_FALLBACK_MS,
				hudShowAttempted: true,
			}),
		).toContain("no windows exist");
	});
});
