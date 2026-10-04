import { isHudInEditorMode } from "./hudEditorMode";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain } from "electron";
import {
	supportsHudCaptureProtection,
	shouldProtectHudCapture,
} from "../src/lib/hudCaptureProtection";
import { USER_DATA_PATH } from "./appPaths";
import {
	getHudOverlayAnchor,
	getHudOverlayWindowBounds,
	type HudOverlayAnchor,
	type HudOverlayWorkArea,
} from "./hudOverlayBounds";
import { getHudOverlayTaskbarOptions } from "./hudOverlayWindowOptions";
import {
	classifyHudFrameProbe,
	decideHudFallback,
	describeHudFallback,
	HUD_FRAME_PROBE_DELAY_MS,
	HUD_FRAME_PROBE_TIMEOUT_MS,
	type HudFrameProbeOutcome,
} from "./hudFrameProbe";
import { stopWindowBoundsCapture } from "./ipc/cursor/bounds";
import { stopInteractionCapture } from "./ipc/cursor/interaction";
import { stopNativeCursorMonitor } from "./ipc/cursor/monitor";
import { stopCursorCapture } from "./ipc/cursor/telemetry";
import { showCursor } from "./cursorHider";
import { getPackagedRendererBaseUrl } from "./rendererServer";

const electronWindowsDir = path.dirname(fileURLToPath(import.meta.url));
const nodeRequire = createRequire(import.meta.url);

const APP_ROOT = path.join(electronWindowsDir, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const RENDERER_DIST = path.join(APP_ROOT, "dist");
const WINDOW_ICON_FILENAME =
	process.platform === "darwin" ? "recordlymac-512.png" : "recordly-512.png";
const WINDOW_ICON_PATH = path.join(
	process.env.VITE_PUBLIC || RENDERER_DIST,
	"app-icons",
	WINDOW_ICON_FILENAME,
);

let hudOverlayWindow: BrowserWindow | null = null;
let hudOverlayHiddenFromCapture = true;
let hudOverlayCaptureProtectionLoaded = false;
let hudOverlayIgnoringMouse = true;
let hudOverlaySourceSelectionActive = false;
let hudOverlayMouseReassertTimer: NodeJS.Timeout | null = null;
let hudOverlayRecordingActive = false;
let hudCaptureStarting = false;
let hudCaptureProtectionOverride = false;
let hudOverlayOpaqueFallbackApplied = false;
/**
 * Result of the early frame probe for the HUD, if it has run.
 *
 * `null` means "not probed yet or inconclusive"; `false` means the compositor
 * positively never presented a frame. The cold-launch watchdog reads this so it
 * does not treat a visible-but-never-painted HUD as a successful launch.
 */
let hudOverlayFramePresented: boolean | null = null;
let countdownWindow: BrowserWindow | null = null;
let updateToastWindow: BrowserWindow | null = null;
let hudWasVisibleBeforeUpdateToast = false;

const HUD_OVERLAY_SETTINGS_FILE = path.join(USER_DATA_PATH, "hud-overlay-settings.json");
const HUD_EDGE_MARGIN_DIP = 16;
/**
 * Background for the opaque HUD fallback (see `electron/hudFrameProbe.ts`).
 *
 * This is only the colour the window shows for the instant before the document
 * paints; the page then covers it with its own `--surface` token (the
 * `.hud-overlay-opaque-window` rule in `src/index.css`). It is deliberately the
 * same near-black family as the bar rather than a themed colour, because the
 * native value cannot follow the user's light/dark preference.
 */
const HUD_OPAQUE_FALLBACK_BACKGROUND = "#101014";
const UPDATE_TOAST_WIDTH = 420;
const UPDATE_TOAST_HEIGHT = 172;

function getEditorWindowQuery(): Record<string, string> {
	const query: Record<string, string> = {
		windowType: "editor",
	};

	if (process.env.RECORDLY_DEV_OPEN_RECORDING_INPUT) {
		query.devOpenInput = process.env.RECORDLY_DEV_OPEN_RECORDING_INPUT;
	}

	if (process.env.RECORDLY_SMOKE_EXPORT === "1") {
		query.smokeExport = "1";
		if (process.env.RECORDLY_SMOKE_EXPORT_INPUT) {
			query.smokeInput = process.env.RECORDLY_SMOKE_EXPORT_INPUT;
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_OUTPUT) {
			query.smokeOutput = process.env.RECORDLY_SMOKE_EXPORT_OUTPUT;
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_USE_NATIVE === "1") {
			query.smokeUseNativeExport = "1";
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_ENCODING_MODE) {
			query.smokeEncodingMode = process.env.RECORDLY_SMOKE_EXPORT_ENCODING_MODE;
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_SHADOW_INTENSITY) {
			query.smokeShadowIntensity = process.env.RECORDLY_SMOKE_EXPORT_SHADOW_INTENSITY;
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_PIPELINE) {
			query.smokePipelineModel = process.env.RECORDLY_SMOKE_EXPORT_PIPELINE;
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_BACKEND) {
			query.smokeBackendPreference = process.env.RECORDLY_SMOKE_EXPORT_BACKEND;
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_RENDER_BACKEND) {
			query.smokeRenderBackend = process.env.RECORDLY_SMOKE_EXPORT_RENDER_BACKEND;
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_MAX_ENCODE_QUEUE) {
			query.smokeMaxEncodeQueue = process.env.RECORDLY_SMOKE_EXPORT_MAX_ENCODE_QUEUE;
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_MAX_DECODE_QUEUE) {
			query.smokeMaxDecodeQueue = process.env.RECORDLY_SMOKE_EXPORT_MAX_DECODE_QUEUE;
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_MAX_PENDING_FRAMES) {
			query.smokeMaxPendingFrames = process.env.RECORDLY_SMOKE_EXPORT_MAX_PENDING_FRAMES;
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_PROJECT) {
			query.smokeProject = process.env.RECORDLY_SMOKE_EXPORT_PROJECT;
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_QUALITY) {
			query.smokeQuality = process.env.RECORDLY_SMOKE_EXPORT_QUALITY;
		}
		if (process.env.RECORDLY_SMOKE_EXPORT_FPS) {
			query.smokeFps = process.env.RECORDLY_SMOKE_EXPORT_FPS;
		}
	}

	return query;
}

export function isHudOverlayMousePassthroughSupported(): boolean {
	return process.platform !== "linux";
}

function loadHudOverlayCaptureProtectionSetting(): boolean {
	if (hudOverlayCaptureProtectionLoaded) {
		return hudOverlayHiddenFromCapture;
	}

	hudOverlayCaptureProtectionLoaded = true;

	try {
		if (!fs.existsSync(HUD_OVERLAY_SETTINGS_FILE)) {
			return hudOverlayHiddenFromCapture;
		}

		const raw = fs.readFileSync(HUD_OVERLAY_SETTINGS_FILE, "utf-8");
		const parsed = JSON.parse(raw) as { hiddenFromCapture?: unknown };
		if (typeof parsed.hiddenFromCapture === "boolean") {
			hudOverlayHiddenFromCapture = parsed.hiddenFromCapture;
		}
	} catch {
		// Ignore settings read failures and fall back to defaults.
	}

	return hudOverlayHiddenFromCapture;
}

export function getHudOverlayCaptureProtectionEnabled(): boolean {
	return loadHudOverlayCaptureProtectionSetting();
}

function applyHudOverlayCaptureProtectionToWindow(hud: BrowserWindow, enabled: boolean): void {
	if (!supportsHudCaptureProtection(process.platform)) {
		return;
	}

	try {
		// Keep the idle HUD visible to screenshots and other capture applications,
		// unless an in-flight screenshot needs the overlay excluded.
		hud.setContentProtection(
			hudCaptureProtectionOverride ||
				shouldProtectHudCapture(enabled, hudOverlayRecordingActive, hudCaptureStarting),
		);
	} catch (error) {
		console.warn("Failed to apply HUD capture protection:", error);
	}
}

export function beginHudCaptureProtection(): void {
	hudCaptureStarting = true;
	reassertHudOverlayCaptureProtection();
}
ipcMain.handle("finish-recording-startup", () => {
	hudCaptureStarting = false;
	reassertHudOverlayCaptureProtection();
});

export function reassertHudOverlayCaptureProtection(): boolean {
	const enabled = loadHudOverlayCaptureProtectionSetting();
	const hud = getHudOverlayWindow();
	if (!hud) {
		return enabled;
	}

	applyHudOverlayCaptureProtectionToWindow(hud, enabled);

	return enabled;
}

/**
 * Forces HUD content protection on for the duration of a screenshot so the
 * Recordly overlay is never part of the capture.
 *
 * Returns a restore callback that returns the HUD to the protection state its
 * settings and recording state imply. Callers must invoke it from a `finally`
 * block so a failed capture cannot leave the overlay hidden.
 */
export function beginHudCaptureProtectionForScreenshot(): () => void {
	const previousOverride = hudCaptureProtectionOverride;
	hudCaptureProtectionOverride = true;
	reassertHudOverlayCaptureProtection();

	return () => {
		hudCaptureProtectionOverride = previousOverride;
		reassertHudOverlayCaptureProtection();
	};
}

function persistHudOverlayCaptureProtectionSetting(enabled: boolean): void {
	try {
		fs.writeFileSync(
			HUD_OVERLAY_SETTINGS_FILE,
			JSON.stringify({ hiddenFromCapture: enabled }, null, 2),
			"utf-8",
		);
	} catch {
		// Ignore settings write failures and keep runtime state working.
	}
}

function getScreen() {
	if (!app.isReady()) {
		throw new Error(
			"getScreen() called before app is ready. Ensure all screen access happens after app.whenReady().",
		);
	}
	return nodeRequire("electron").screen as typeof import("electron").screen;
}

function getHudOverlayDisplay() {
	const hudWindow = getHudOverlayWindow();
	if (hudWindow) {
		return getScreen().getDisplayMatching(hudWindow.getBounds());
	}
	return getScreen().getPrimaryDisplay();
}

function getHudOverlayBounds() {
	const { workArea } = getHudOverlayDisplay();
	return getHudOverlayWindowBounds(workArea, { anchor: hudUserPosition });
}

function applyHudOverlayBounds() {
	if (!hudOverlayWindow || hudOverlayWindow.isDestroyed()) {
		return;
	}
	hudOverlayWindow.setBounds(getHudOverlayBounds(), false);

	positionUpdateToastWindow();
	if (!hudOverlayWindow.isVisible()) {
		return;
	}
	hudOverlayWindow.moveTop();
}

function getUpdateToastBounds() {
	const hudWindow = getHudOverlayWindow();
	if (hudWindow) {
		const hudBounds = hudWindow.getBounds();
		const display = getScreen().getDisplayMatching(hudBounds);
		const { workArea } = display;
		const x = Math.round(workArea.x + (workArea.width - UPDATE_TOAST_WIDTH) / 2);
		const y = Math.round(
			workArea.y + workArea.height - UPDATE_TOAST_HEIGHT - HUD_EDGE_MARGIN_DIP,
		);

		return {
			x,
			y,
			width: UPDATE_TOAST_WIDTH,
			height: UPDATE_TOAST_HEIGHT,
		};
	}

	const primaryDisplay = getScreen().getPrimaryDisplay();
	const { workArea } = primaryDisplay;
	return {
		x: Math.round(workArea.x + (workArea.width - UPDATE_TOAST_WIDTH) / 2),
		y: Math.round(workArea.y + workArea.height - UPDATE_TOAST_HEIGHT - HUD_EDGE_MARGIN_DIP),
		width: UPDATE_TOAST_WIDTH,
		height: UPDATE_TOAST_HEIGHT,
	};
}

function positionUpdateToastWindow() {
	if (!updateToastWindow || updateToastWindow.isDestroyed()) {
		return;
	}

	updateToastWindow.setBounds(getUpdateToastBounds(), false);
	updateToastWindow.moveTop();
}

/**
 * Applies the HUD's click-through state to the native window.
 *
 * The renderer re-asserts the state it wants on every `mouseover` inside the
 * bar (moving across a row of buttons fires it once per element), so the native
 * call is only made when the state actually changes. `force` is for callers
 * that reset the native flag themselves (show/focus re-initialisation) and
 * therefore need the state re-applied even when it did not change.
 */
function setHudOverlayMousePassthrough(ignore: boolean, force = false) {
	const nextIgnoringMouse =
		hudOverlaySourceSelectionActive && !hudOverlayRecordingActive ? true : ignore;
	const changed = nextIgnoringMouse !== hudOverlayIgnoringMouse;
	hudOverlayIgnoringMouse = nextIgnoringMouse;

	if (hudOverlayMouseReassertTimer) {
		clearTimeout(hudOverlayMouseReassertTimer);
		hudOverlayMouseReassertTimer = null;
	}

	if (!hudOverlayWindow || hudOverlayWindow.isDestroyed()) {
		return;
	}

	if (!isHudOverlayMousePassthroughSupported()) {
		hudOverlayWindow.setIgnoreMouseEvents(false);
		return;
	}

	// setIgnoreMouseEvents() flips the native WS_EX_TRANSPARENT flag of a
	// layered window; doing that at hover-event rate makes the bar flicker.
	if (!changed && !force) {
		return;
	}

	if (nextIgnoringMouse) {
		hudOverlayWindow.setIgnoreMouseEvents(true, { forward: true });
		return;
	}

	hudOverlayWindow.setIgnoreMouseEvents(false);
}

ipcMain.on("hud-overlay-set-ignore-mouse", (_event, ignore: boolean) => {
	setHudOverlayMousePassthrough(Boolean(ignore));
});

ipcMain.on("hud-overlay-set-source-selection-active", (_event, active: boolean) => {
	hudOverlaySourceSelectionActive = Boolean(active);
	if (hudOverlaySourceSelectionActive) {
		// No resize is needed any more: the box is always tall enough and the
		// passthrough override below keeps it out of the way of the selection UI.
		return;
	}

	setHudOverlayMousePassthrough(hudOverlayIgnoringMouse, true);
});

// The HUD window itself is moved through this channel: the renderer reports the
// pointer's screen position and the window follows it inside the work area.
let hudUserPosition: HudOverlayAnchor | null = null;
let hudDragOffset: { x: number; y: number } | null = null;
let hudDragLastCursor: { x: number; y: number } | null = null;
let hudDragFixedSize: { width: number; height: number } | null = null;
let hudDragWorkArea: HudOverlayWorkArea | null = null;

function clampAxis(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), Math.max(min, max));
}

ipcMain.on("hud-overlay-drag", (_event, phase: string, screenX: number, screenY: number) => {
	if (!hudOverlayWindow || hudOverlayWindow.isDestroyed()) return;
	if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return;

	// On Linux the compositor (especially Wayland) refuses programmatic window
	// placement, so BrowserWindow.setBounds() with x/y is silently ignored and
	// the HUD appears "stuck".  The renderer marks the drag handle as
	// -webkit-app-region: drag on Linux, letting the OS move the window for us.
	// The resulting position is captured by the win.on("moved", ...) listener
	// below so `hudUserPosition` stays in sync.
	if (process.platform === "linux") {
		return;
	}

	if (phase === "start") {
		const bounds = hudOverlayWindow.getBounds();
		hudDragOffset = { x: screenX - bounds.x, y: screenY - bounds.y };
		hudDragLastCursor = { x: screenX, y: screenY };
		hudDragFixedSize = { width: bounds.width, height: bounds.height };
		hudDragWorkArea = getScreen().getDisplayNearestPoint({ x: screenX, y: screenY }).workArea;
		return;
	}

	if (phase === "end") {
		hudUserPosition = getHudOverlayAnchor(hudOverlayWindow.getBounds());

		hudDragOffset = null;
		hudDragLastCursor = null;
		hudDragFixedSize = null;
		hudDragWorkArea = null;
		return;
	}

	if (phase !== "move" || !hudDragOffset) {
		return;
	}

	if (hudDragLastCursor && hudDragLastCursor.x === screenX && hudDragLastCursor.y === screenY) {
		return;
	}

	hudDragLastCursor = { x: screenX, y: screenY };
	const fixedWidth = hudDragFixedSize?.width ?? hudOverlayWindow.getBounds().width;
	const fixedHeight = hudDragFixedSize?.height ?? hudOverlayWindow.getBounds().height;
	// Follow whichever display the pointer is on and never let the bar leave it.
	// Enumerating displays on every pointer event is pure overhead though, so the
	// work area found at drag start is reused until the pointer actually leaves it.
	let workArea = hudDragWorkArea;
	if (
		!workArea ||
		screenX < workArea.x ||
		screenX >= workArea.x + workArea.width ||
		screenY < workArea.y ||
		screenY >= workArea.y + workArea.height
	) {
		workArea = getScreen().getDisplayNearestPoint({ x: screenX, y: screenY }).workArea;
		hudDragWorkArea = workArea;
	}
	const targetX = Math.round(
		clampAxis(screenX - hudDragOffset.x, workArea.x, workArea.x + workArea.width - fixedWidth),
	);
	const targetY = Math.round(
		clampAxis(
			screenY - hudDragOffset.y,
			workArea.y,
			workArea.y + workArea.height - fixedHeight,
		),
	);
	// The HUD box has a fixed size, so a move must never touch the size: a
	// position-only update keeps the renderer viewport (and the layered window
	// surface) untouched while the window follows the pointer.
	hudOverlayWindow.setPosition(targetX, targetY, false);
	// Keep the anchor in step with the drag so a concurrent bounds recompute
	// (display change, recording state change) leaves the bar where the user put it.
	hudUserPosition = { x: targetX, bottom: targetY + fixedHeight };
});

ipcMain.on("hud-overlay-hide", () => {
	if (hudOverlayWindow && !hudOverlayWindow.isDestroyed()) {
		hudOverlayWindow.minimize();
	}
});

ipcMain.handle("get-hud-overlay-capture-protection", () => {
	const enabled = loadHudOverlayCaptureProtectionSetting();

	return {
		success: true,
		enabled,
	};
});

ipcMain.handle("get-hud-overlay-mouse-passthrough-supported", () => {
	return {
		success: true,
		supported: isHudOverlayMousePassthroughSupported(),
	};
});

ipcMain.handle("set-hud-overlay-capture-protection", (_event, enabled: boolean) => {
	loadHudOverlayCaptureProtectionSetting();
	hudOverlayHiddenFromCapture = Boolean(enabled);
	persistHudOverlayCaptureProtectionSetting(hudOverlayHiddenFromCapture);

	reassertHudOverlayCaptureProtection();

	return {
		success: true,
		enabled: hudOverlayHiddenFromCapture,
	};
});

const editorWindows = new Set<BrowserWindow>();
let recordingPreparationActive = false;
function getHudEditorMode() {
	return isHudInEditorMode(
		editorWindows.size,
		recordingPreparationActive,
		hudOverlayRecordingActive,
	);
}
export function setHudRecordingPreparationActive(active: boolean) {
	recordingPreparationActive = active;
	notifyEditorMode();
}
function notifyEditorMode() {
	if (hudOverlayWindow && !hudOverlayWindow.webContents.isDestroyed()) {
		hudOverlayWindow.webContents.send("editor-mode-changed", getHudEditorMode());
	}
}
ipcMain.handle("get-editor-mode", getHudEditorMode);

export interface CreateHudOverlayWindowOptions {
	/**
	 * Paint the bar on a solid background instead of a transparent one.
	 *
	 * Used by the frame-probe recovery path: when the compositor never presents
	 * the transparent surface, an opaque window still composites. The page and
	 * query are identical, so the user sees the same recording controls.
	 */
	opaqueFallback?: boolean;
}

export function createHudOverlayWindow(options: CreateHudOverlayWindowOptions = {}): BrowserWindow {
	const perfStart = Date.now();
	const opaqueFallback = options.opaqueFallback === true;
	loadHudOverlayCaptureProtectionSetting();
	const initialBounds = getHudOverlayBounds();
	let hasShownHudWindow = false;

	const win = new BrowserWindow({
		width: initialBounds.width,
		height: initialBounds.height,
		x: initialBounds.x,
		y: initialBounds.y,
		frame: false,
		transparent: !opaqueFallback,
		backgroundColor: opaqueFallback ? HUD_OPAQUE_FALLBACK_BACKGROUND : "#00000000",
		resizable: false,
		alwaysOnTop: true,
		// The HUD is Recordly's persistent top-level window, so it owns the
		// Windows taskbar entry while auxiliary overlays stay hidden there.
		...getHudOverlayTaskbarOptions(process.platform),
		hasShadow: false,
		show: false,
		webPreferences: {
			preload: path.join(electronWindowsDir, "preload.mjs"),
			nodeIntegration: false,
			contextIsolation: true,
			webSecurity: false,
		},
	});
	// Keep the recording controls above normal and full-screen apps.
	// Transparent regions remain click-through via setIgnoreMouseEvents().
	win.setAlwaysOnTop(true, "screen-saver");
	if (process.platform === "darwin") {
		win.setVisibleOnAllWorkspaces(true, {
			visibleOnFullScreen: true,
			skipTransformProcessType: true,
		});
	}

	const showHudWindow = () => {
		if (hasShownHudWindow || win.isDestroyed()) {
			return;
		}
		if (
			updateToastWindow &&
			!updateToastWindow.isDestroyed() &&
			updateToastWindow.isVisible()
		) {
			hudWasVisibleBeforeUpdateToast = true;
			return;
		}
		hasShownHudWindow = true;
		// Showing or changing native window state can recreate platform window
		// flags. Reassert capture protection on both sides of the transition.
		applyHudOverlayCaptureProtectionToWindow(win, hudOverlayHiddenFromCapture);
		if (process.platform === "win32") {
			// A focusable window is required for a Windows taskbar entry, but the
			// always-on-top HUD must not steal focus when Recordly starts.
			win.showInactive();
		} else {
			win.show();
		}
		win.moveTop();
		applyHudOverlayCaptureProtectionToWindow(win, hudOverlayHiddenFromCapture);
		if (process.platform === "win32" && isHudOverlayMousePassthroughSupported()) {
			win.setIgnoreMouseEvents(false);
			setTimeout(() => {
				if (!win.isDestroyed()) {
					// The native flag was just reset above, so re-apply
					// unconditionally even though the logical state is unchanged.
					setHudOverlayMousePassthrough(hudOverlayIgnoringMouse, true);
				}
			}, 50);
		}

		scheduleHudFrameProbe();
	};

	/**
	 * One cheap `capturePage()` probe that answers "did the compositor ever
	 * present a frame for this window?".
	 *
	 * `isVisible: true` is not that answer on Windows: the owner's bug was a HUD
	 * that reported itself visible with a fully built DOM while every captured
	 * frame came back as `UnknownVizError`. The 10 s watchdog in
	 * `electron/startupVisibility.ts` cannot tell that apart from a slow start
	 * until it gives up and opens the unrelated editor window.
	 *
	 * This probe runs ~1.2 s after the HUD is shown. On a positive failure it
	 * makes the *same* HUD bar opaque — the user keeps the recording controls
	 * instead of being bounced into the editor.
	 */
	const scheduleHudFrameProbe = () => {
		setTimeout(() => {
			void probeHudFramePresentation();
		}, HUD_FRAME_PROBE_DELAY_MS).unref?.();
	};

	const probeHudFramePresentation = async () => {
		if (win.isDestroyed() || !win.isVisible()) {
			return;
		}

		let outcome: HudFrameProbeOutcome;
		try {
			const image = await Promise.race([
				win.webContents.capturePage(),
				new Promise<never>((_resolve, reject) => {
					const timer = setTimeout(
						() => reject(new Error("__probe-timeout__")),
						HUD_FRAME_PROBE_TIMEOUT_MS,
					);
					timer.unref?.();
				}),
			]);
			const size = image.getSize();
			outcome = classifyHudFrameProbe({
				threw: false,
				width: size.width,
				height: size.height,
			});
		} catch {
			outcome = classifyHudFrameProbe({ threw: true });
		}

		// Only a positive result is recorded. `inconclusive` must leave the state
		// as "unknown" so a HUD that is merely slow is never downgraded.
		if (outcome !== "inconclusive") {
			hudOverlayFramePresented = outcome === "presented";
		}

		const action = decideHudFallback({
			outcome,
			windowAlive: !win.isDestroyed(),
			fallbackApplied: hudOverlayOpaqueFallbackApplied,
			// "Start minimized" hides the HUD on purpose, so a probe failure there
			// says nothing about the compositor.
			hudIntentionallyHidden: !win.isVisible(),
		});

		console.warn(
			`[hud-frame-probe] ${describeHudFallback(action, {
				outcome,
				windowAlive: !win.isDestroyed(),
				fallbackApplied: hudOverlayOpaqueFallbackApplied,
				hudIntentionallyHidden: !win.isVisible(),
			})}`,
		);

		if (action !== "recover-with-opaque-hud") {
			return;
		}

		applyHudOpaqueFallback();
	};

	/**
	 * Re-presents the HUD on a solid background after the compositor failed to
	 * present its transparent surface.
	 *
	 * The transparent window is not reused: a surface that was never composited
	 * stays un-composited — that is precisely the owner's bug, where a later
	 * success was never observed — so recovery means replacing the window. The
	 * replacement uses the same page and query (`windowType=hud-overlay`) and the
	 * same bounds, so the user loses neither their position nor any feature; the
	 * only difference is that the page is painted onto an opaque background,
	 * which is a code path Windows always composites.
	 */
	const applyHudOpaqueFallback = () => {
		if (hudOverlayOpaqueFallbackApplied || win.isDestroyed()) {
			return;
		}

		hudOverlayOpaqueFallbackApplied = true;
		console.warn(
			"[hud-frame-probe] The transparent HUD never presented a frame; reopening it with an opaque background so the recording controls are visible.",
		);

		const opaque = createHudOverlayWindow({ opaqueFallback: true });
		// The replacement inherits the failed window's place on screen.
		opaque.setBounds(win.getBounds(), false);
		win.destroy();
	};

	applyHudOverlayCaptureProtectionToWindow(win, hudOverlayHiddenFromCapture);
	win.on("show", () => {
		if (!win.isDestroyed()) {
			applyHudOverlayCaptureProtectionToWindow(win, hudOverlayHiddenFromCapture);
		}
	});

	if (isHudOverlayMousePassthroughSupported()) {
		if (hudOverlayRecordingActive) {
			hudOverlayIgnoringMouse = false;
			win.setIgnoreMouseEvents(false);
		} else {
			hudOverlayIgnoringMouse = true;
			win.setIgnoreMouseEvents(true, { forward: true });
		}
	}

	// On Windows 11+, focus changes (e.g. showing a native notification) can break
	// setIgnoreMouseEvents forwarding on a transparent always-on-top window, making
	// it permanently click-through without hover detection.  Re-initialise the
	// pass-through-with-forwarding state whenever the window gains focus by toggling
	// the flag off then back on so the native WS_EX_TRANSPARENT flag is fully reset.
	if (process.platform === "win32" && isHudOverlayMousePassthroughSupported()) {
		win.on("focus", () => {
			if (!win.isDestroyed()) {
				win.setIgnoreMouseEvents(false);
				setTimeout(() => {
					if (!win.isDestroyed()) {
						// See above: the explicit reset needs an explicit re-apply.
						setHudOverlayMousePassthrough(hudOverlayIgnoringMouse, true);
					}
				}, 50);
			}
		});
	}

	win.webContents.on("did-finish-load", () => {
		console.log(`[PERF:MAIN] HUD Window: did-finish-load in ${Date.now() - perfStart}ms`);
		win?.webContents.send("main-process-message", new Date().toLocaleString());
		// Safety fallback if renderer-ready signal never arrives.
		setTimeout(() => {
			showHudWindow();
		}, 1800);
	});

	// Safety net: on Linux the renderer may fail to fire did-finish-load
	// (for example due to GPU/VAAPI startup issues). Show the window after
	// ready-to-show as a fallback so the HUD still appears.
	win.once("ready-to-show", () => {
		setTimeout(() => {
			if (!win.isDestroyed() && !win.isVisible()) {
				showHudWindow();
			}
		}, 500);
	});

	const handleHudRendererReady = () => {
		if (!win.isDestroyed()) {
			console.log(`[PERF:MAIN] HUD Window: renderer-ready in ${Date.now() - perfStart}ms`);
			showHudWindow();
		}
	};
	ipcMain.on("hud-overlay-renderer-ready", handleHudRendererReady);

	hudOverlayWindow = win;

	// Mirror every window move into the anchor: the box keeps its size, and Linux
	// drags the window through -webkit-app-region (Wayland forbids client-side
	// positioning), so the anchor follows the native position on every platform.
	win.on("moved", () => {
		if (win.isDestroyed()) return;
		hudUserPosition = getHudOverlayAnchor(win.getBounds());
	});

	// Reset the user's saved HUD position when displays change so the bar
	// doesn't end up stranded off-screen after a monitor is disconnected.
	const screen = getScreen();
	const handleDisplayRemoved = () => {
		hudUserPosition = null;
	};
	const handleDisplayMetricsChanged = () => {
		if (hudUserPosition) {
			const displays = screen.getAllDisplays();
			const onScreen = displays.some(
				(d) =>
					hudUserPosition!.x >= d.workArea.x &&
					hudUserPosition!.x < d.workArea.x + d.workArea.width &&
					hudUserPosition!.bottom >= d.workArea.y &&
					hudUserPosition!.bottom <= d.workArea.y + d.workArea.height,
			);
			if (!onScreen) {
				hudUserPosition = null;
			}
		}
		applyHudOverlayBounds();
	};
	screen.on("display-removed", handleDisplayRemoved);
	screen.on("display-metrics-changed", handleDisplayMetricsChanged);

	win.on("closed", () => {
		ipcMain.removeListener("hud-overlay-renderer-ready", handleHudRendererReady);
		screen.removeListener("display-removed", handleDisplayRemoved);
		screen.removeListener("display-metrics-changed", handleDisplayMetricsChanged);
		if (hudOverlayWindow === win) {
			hudOverlayWindow = null;
			recordingPreparationActive = false;
			hudCaptureStarting = false;
			hudOverlayRecordingActive = false;
			// The frame-probe state belongs to the window that produced it, so it is
			// cleared with the window. A later HUD (reopened from the tray, say)
			// then starts from a clean slate and runs its own probe.
			//
			// `applyHudOpaqueFallback` deliberately does NOT hit this branch: it
			// creates the replacement — which assigns `hudOverlayWindow` to the new
			// window — *before* destroying the failed one, so `hudOverlayWindow ===
			// win` is already false. That keeps the "recover at most once" guard
			// intact across the handover.
			hudOverlayFramePresented = null;
			hudOverlayOpaqueFallbackApplied = false;
			// The HUD owns the recording controls, so a closed HUD must never leave
			// the desktop-wide cursor hook, the native cursor monitor or the
			// PowerShell window-bounds poll running — and an OS cursor hidden by the
			// browser-capture path must be restored. Every stop function here is
			// idempotent, and showCursor() only acts when the cursor is hidden.
			stopCursorCapture();
			stopInteractionCapture();
			stopWindowBoundsCapture();
			stopNativeCursorMonitor();
			void showCursor();
		}
	});

	const query: Record<string, string> = { windowType: "hud-overlay" };
	if (opaqueFallback) {
		// `src/App.tsx` reads this to keep the document background opaque; without
		// it the transparent-window CSS would leave the fallback see-through and
		// the recovery would be invisible.
		query["hudBackground"] = "opaque";
	}

	if (VITE_DEV_SERVER_URL) {
		const search = new URLSearchParams(query).toString();
		win.loadURL(`${VITE_DEV_SERVER_URL}?${search}`);
	} else {
		win.loadFile(path.join(RENDERER_DIST, "index.html"), { query });
	}

	return win;
}

export function getHudOverlayWindow(): BrowserWindow | null {
	return hudOverlayWindow && !hudOverlayWindow.isDestroyed() ? hudOverlayWindow : null;
}

/**
 * Whether the early frame probe proved the HUD is being presented.
 *
 * `null` until the probe has run (or when it was inconclusive), `false` only on a
 * positive "the compositor never produced a frame" result. Callers must treat
 * `null` as "unknown", never as failure.
 */
export function getHudOverlayFramePresented(): boolean | null {
	return hudOverlayFramePresented;
}

/** Test seam: forget the probe result between cases. */
export function resetHudOverlayFramePresentedForTests(): void {
	hudOverlayFramePresented = null;
	hudOverlayOpaqueFallbackApplied = false;
}

/**
 * Re-initialise the HUD overlay's mouse passthrough state.
 *
 * On Windows 11+, any new BrowserWindow appearing (even focusable:false ones
 * like the source highlight overlay) can silently corrupt the
 * WS_EX_TRANSPARENT flag that backs setIgnoreMouseEvents forwarding.  Call
 * this after any operation that creates or destroys a sibling window so that
 * hover detection on the HUD is immediately restored without requiring the
 * user to move their mouse over the bar.
 */
export function reassertHudOverlayMousePassthrough(): void {
	if (process.platform !== "win32" || !isHudOverlayMousePassthroughSupported()) {
		return;
	}

	const hud = getHudOverlayWindow();
	if (!hud) {
		return;
	}

	// Toggle off then back on so the native WS_EX_TRANSPARENT flag is fully
	// re-initialised rather than merely re-asserted in a potentially broken state.
	hud.setIgnoreMouseEvents(false);
	if (hudOverlayMouseReassertTimer) {
		clearTimeout(hudOverlayMouseReassertTimer);
	}
	hudOverlayMouseReassertTimer = setTimeout(() => {
		hudOverlayMouseReassertTimer = null;
		if (!hud.isDestroyed()) {
			// The explicit reset above needs an explicit re-apply.
			setHudOverlayMousePassthrough(hudOverlayIgnoringMouse, true);
		}
	}, 50);
}

export function setHudOverlayRecordingActive(recording: boolean): void {
	hudCaptureStarting = false;
	hudOverlayRecordingActive = Boolean(recording);
	notifyEditorMode();
	applyHudOverlayBounds();
	reassertHudOverlayCaptureProtection();
	// Start in passthrough mode. Forwarded pointer movement lets the renderer
	// make the visible HUD controls interactive when the pointer reaches them,
	// while transparent parts never block the recorded application.
	setHudOverlayMousePassthrough(true, true);
}

export function createUpdateToastWindow(): BrowserWindow {
	const initialBounds = getUpdateToastBounds();

	const win = new BrowserWindow({
		width: initialBounds.width,
		height: initialBounds.height,
		x: initialBounds.x,
		y: initialBounds.y,
		frame: false,
		transparent: true,
		resizable: false,
		alwaysOnTop: true,
		skipTaskbar: true,
		hasShadow: false,
		show: false,
		focusable: true,
		backgroundColor: "#00000000",
		webPreferences: {
			preload: path.join(electronWindowsDir, "preload.mjs"),
			nodeIntegration: false,
			contextIsolation: true,
			backgroundThrottling: false,
		},
	});

	if (process.platform === "darwin") {
		win.setAlwaysOnTop(true, "status");
	}

	win.setVisibleOnAllWorkspaces(true, {
		visibleOnFullScreen: true,
		// Keep Recordly a foreground application so macOS does not temporarily
		// remove its Dock icon while showing an overlay window.
		skipTransformProcessType: process.platform === "darwin",
	});
	updateToastWindow = win;

	win.on("closed", () => {
		if (updateToastWindow === win) {
			updateToastWindow = null;
		}
		restoreHudAfterUpdateToast();
	});

	if (VITE_DEV_SERVER_URL) {
		win.loadURL(VITE_DEV_SERVER_URL + "?windowType=update-toast");
	} else {
		win.loadFile(path.join(RENDERER_DIST, "index.html"), {
			query: { windowType: "update-toast" },
		});
	}

	return win;
}

export function getUpdateToastWindow(): BrowserWindow | null {
	return updateToastWindow && !updateToastWindow.isDestroyed() ? updateToastWindow : null;
}

export function showUpdateToastWindow(): BrowserWindow {
	const win = getUpdateToastWindow() ?? createUpdateToastWindow();
	const hud = getHudOverlayWindow();
	if (!win.isVisible()) {
		hudWasVisibleBeforeUpdateToast = Boolean(hud?.isVisible());
	}
	if (hud?.isVisible()) {
		hud.hide();
	}
	positionUpdateToastWindow();
	if (!win.isVisible()) {
		if (process.platform === "win32") {
			win.show();
		} else {
			win.showInactive();
		}
	}
	win.moveTop();

	return win;
}

function restoreHudAfterUpdateToast(): void {
	if (!hudWasVisibleBeforeUpdateToast) {
		return;
	}

	hudWasVisibleBeforeUpdateToast = false;
	const hud = getHudOverlayWindow();
	if (!hud) {
		return;
	}

	if (process.platform === "win32") {
		hud.showInactive();
	} else {
		hud.show();
	}
	hud.moveTop();
	// The HUD was hidden while the toast was up; re-apply unconditionally so the
	// click-through state is guaranteed after the show transition.
	setHudOverlayMousePassthrough(hudOverlayIgnoringMouse, true);
}

export function hideUpdateToastWindow(): void {
	if (updateToastWindow && !updateToastWindow.isDestroyed()) {
		updateToastWindow.hide();
	}
	restoreHudAfterUpdateToast();
}

function loadPackagedEditorWindow(win: BrowserWindow) {
	const query = getEditorWindowQuery();
	const queryString = new URLSearchParams(query).toString();
	const indexHtmlPath = path.join(RENDERER_DIST, "index.html");
	const packagedRendererBaseUrl = getPackagedRendererBaseUrl();
	const webContents = win.webContents;

	const loadFromFile = () => {
		if (win.isDestroyed()) {
			return;
		}

		console.log("[editor-window] load-file", indexHtmlPath);
		void win.loadFile(indexHtmlPath, { query });
	};

	if (!packagedRendererBaseUrl) {
		loadFromFile();
		return;
	}

	const targetUrl = `${packagedRendererBaseUrl}/?${queryString}`;
	let settled = false;
	let timeoutId: NodeJS.Timeout | null = setTimeout(() => {
		fallbackToFile("load-timeout");
	}, 5000);

	const clearTimeoutIfNeeded = () => {
		if (timeoutId) {
			clearTimeout(timeoutId);
			timeoutId = null;
		}
	};

	const detachLoadListeners = () => {
		clearTimeoutIfNeeded();
		if (webContents.isDestroyed()) {
			return;
		}

		webContents.removeListener("did-fail-load", handleDidFailLoad);
		webContents.removeListener("did-finish-load", handleDidFinishLoad);
	};

	const fallbackToFile = (reason: string, details?: Record<string, unknown>) => {
		if (settled || win.isDestroyed()) {
			return;
		}

		settled = true;
		detachLoadListeners();
		console.warn("[editor-window] packaged renderer URL failed, falling back to file", {
			reason,
			targetUrl,
			...details,
		});
		loadFromFile();
	};

	const handleDidFailLoad = (
		_event: Electron.Event,
		errorCode: number,
		errorDescription: string,
		validatedURL: string,
		isMainFrame: boolean,
	) => {
		if (!isMainFrame || validatedURL !== targetUrl) {
			return;
		}

		fallbackToFile("did-fail-load", {
			errorCode,
			errorDescription,
			validatedURL,
		});
	};

	const handleDidFinishLoad = () => {
		if (webContents.getURL() !== targetUrl) {
			return;
		}

		settled = true;
		detachLoadListeners();
	};

	webContents.on("did-fail-load", handleDidFailLoad);
	webContents.on("did-finish-load", handleDidFinishLoad);
	win.once("closed", clearTimeoutIfNeeded);

	console.log("[editor-window] load-url", targetUrl);
	void win.loadURL(targetUrl).catch((error) => {
		fallbackToFile("load-url-rejected", {
			error: error instanceof Error ? error.message : String(error),
		});
	});
}

export function createEditorWindow(): BrowserWindow {
	const perfStart = Date.now();
	console.log("[PERF:MAIN] createEditorWindow: STARTED");
	const isMac = process.platform === "darwin";
	const { workArea, workAreaSize } = getScreen().getPrimaryDisplay();
	const initialWidth = isMac ? Math.round(workAreaSize.width * 0.85) : workArea.width;
	const initialHeight = isMac ? Math.round(workAreaSize.height * 0.85) : workArea.height;

	const win = new BrowserWindow({
		width: initialWidth,
		height: initialHeight,
		...(!isMac && {
			x: workArea.x,
			y: workArea.y,
		}),
		minWidth: 800,
		minHeight: 600,
		...(process.platform !== "darwin" && {
			icon: WINDOW_ICON_PATH,
		}),
		...(isMac && {
			titleBarStyle: "hiddenInset",
			trafficLightPosition: { x: 16, y: 20 },
		}),
		autoHideMenuBar: !isMac,
		transparent: false,
		resizable: true,
		alwaysOnTop: false,
		skipTaskbar: false,
		title: "OraxRecordly",
		show: false,
		backgroundColor: "#000000",
		webPreferences: {
			preload: path.join(electronWindowsDir, "preload.mjs"),
			nodeIntegration: false,
			contextIsolation: true,
			webSecurity: false,
		},
	});

	recordingPreparationActive = false;
	editorWindows.add(win);
	notifyEditorMode();
	win.once("closed", () => {
		editorWindows.delete(win);
		notifyEditorMode();
	});

	const publishWindowChrome = () => {
		if (!win.isDestroyed())
			win.webContents.send("window-chrome-changed", {
				trafficLightsVisible: isMac && !win.isFullScreen() && !win.isSimpleFullScreen(),
			});
	};
	win.on("enter-full-screen", publishWindowChrome);
	win.on("leave-full-screen", publishWindowChrome);
	win.on("resize", publishWindowChrome);
	win.webContents.on("did-finish-load", publishWindowChrome);

	win.once("ready-to-show", () => {
		console.log(`[PERF:MAIN] Editor Window: ready-to-show in ${Date.now() - perfStart}ms`);
		win.show();
	});

	win.webContents.on("did-finish-load", () => {
		console.log(`[PERF:MAIN] Editor Window: did-finish-load in ${Date.now() - perfStart}ms`);
		win?.webContents.send("main-process-message", new Date().toLocaleString());
		// Fallback for Linux/Wayland where `ready-to-show` may not fire reliably.
		if (!win.isDestroyed() && !win.isVisible()) {
			console.log("[editor-window] forcing show after did-finish-load");
			win.show();
		}
	});

	win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
		console.error("[editor-window] did-fail-load", {
			errorCode,
			errorDescription,
			validatedURL,
		});
	});

	win.webContents.on("render-process-gone", (_event, details) => {
		console.error("[editor-window] render-process-gone", details);
	});

	win.on("show", () => {
		console.log("[editor-window] show");
	});

	win.on("focus", () => {
		console.log("[editor-window] focus");
	});

	win.on("enter-full-screen", () => {
		if (!win.isDestroyed()) win.webContents.send("window-fullscreen-changed", true);
	});

	win.on("leave-full-screen", () => {
		if (!win.isDestroyed()) win.webContents.send("window-fullscreen-changed", false);
	});

	if (VITE_DEV_SERVER_URL) {
		const query = new URLSearchParams(getEditorWindowQuery());
		win.loadURL(`${VITE_DEV_SERVER_URL}?${query.toString()}`);
	} else {
		loadPackagedEditorWindow(win);
	}

	return win;
}

export function createSourceSelectorWindow(): BrowserWindow {
	const { width, height } = getScreen().getPrimaryDisplay().workAreaSize;

	const win = new BrowserWindow({
		width: 620,
		height: 420,
		minHeight: 350,
		maxHeight: 500,
		x: Math.round((width - 620) / 2),
		y: Math.round((height - 420) / 2),
		frame: false,
		resizable: false,
		alwaysOnTop: true,
		transparent: true,
		show: false,
		...(process.platform !== "darwin" && {
			icon: WINDOW_ICON_PATH,
		}),
		backgroundColor: "#00000000",
		webPreferences: {
			preload: path.join(electronWindowsDir, "preload.mjs"),
			nodeIntegration: false,
			contextIsolation: true,
		},
	});

	win.webContents.on("did-finish-load", () => {
		setTimeout(() => {
			if (!win.isDestroyed()) {
				win.show();
			}
		}, 100);
	});

	if (VITE_DEV_SERVER_URL) {
		win.loadURL(VITE_DEV_SERVER_URL + "?windowType=source-selector");
	} else {
		win.loadFile(path.join(RENDERER_DIST, "index.html"), {
			query: { windowType: "source-selector" },
		});
	}

	return win;
}

export function createCountdownWindow(): BrowserWindow {
	const primaryDisplay = getScreen().getPrimaryDisplay();
	const { width, height } = primaryDisplay.workAreaSize;

	const windowSize = 200;
	const x = Math.floor((width - windowSize) / 2);
	const y = Math.floor((height - windowSize) / 2);

	const win = new BrowserWindow({
		width: windowSize,
		height: windowSize,
		x: x,
		y: y,
		frame: false,
		transparent: true,
		resizable: false,
		alwaysOnTop: true,
		skipTaskbar: true,
		hasShadow: false,
		focusable: true,
		show: false,
		webPreferences: {
			preload: path.join(electronWindowsDir, "preload.mjs"),
			nodeIntegration: false,
			contextIsolation: true,
		},
	});

	countdownWindow = win;

	win.setVisibleOnAllWorkspaces(true, {
		visibleOnFullScreen: true,
		// Keep Recordly a foreground application so macOS does not temporarily
		// remove its Dock icon while showing the countdown.
		skipTransformProcessType: process.platform === "darwin",
	});

	win.webContents.on("did-finish-load", () => {
		if (!win.isDestroyed()) {
			if (process.platform === "win32") {
				win.showInactive();
				win.moveTop();
			} else {
				win.show();
			}
		}
	});

	win.on("closed", () => {
		if (countdownWindow === win) {
			countdownWindow = null;
		}
	});

	if (VITE_DEV_SERVER_URL) {
		win.loadURL(VITE_DEV_SERVER_URL + "?windowType=countdown");
	} else {
		win.loadFile(path.join(RENDERER_DIST, "index.html"), {
			query: { windowType: "countdown" },
		});
	}

	return win;
}

export function getCountdownWindow(): BrowserWindow | null {
	return countdownWindow;
}

export function closeCountdownWindow(): void {
	if (countdownWindow && !countdownWindow.isDestroyed()) {
		countdownWindow.close();
		countdownWindow = null;
	}
}
