import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain } from "electron";
import { getPackagedRendererBaseUrl } from "./rendererServer";
import {
	SCREENSHOT_EDITOR_LOAD_IMAGE_EVENT,
	SCREENSHOT_REGION_ACTIVITY_CHANNEL,
	SCREENSHOT_REGION_CANCEL_CHANNEL,
	SCREENSHOT_REGION_COMPLETE_CHANNEL,
	SCREENSHOT_REGION_READY_EVENT,
} from "./screenshotEvents";

const screenshotWindowsDir = path.dirname(fileURLToPath(import.meta.url));
const nodeRequire = createRequire(import.meta.url);

const APP_ROOT = path.join(screenshotWindowsDir, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const RENDERER_DIST = path.join(APP_ROOT, "dist");
const WINDOW_ICON_FILENAME =
	process.platform === "darwin" ? "recordlymac-512.png" : "recordly-512.png";
const WINDOW_ICON_PATH = path.join(
	process.env.VITE_PUBLIC || RENDERER_DIST,
	"app-icons",
	WINDOW_ICON_FILENAME,
);

/** Selection rectangle in the overlay's client (DIP) coordinate space. */
export interface RegionSelectionRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** How long an idle region overlay may stay on screen before it self-cancels. */
export const REGION_OVERLAY_SAFETY_TIMEOUT_MS = 60_000;
const EDITOR_WINDOW_WIDTH = 1180;
const EDITOR_WINDOW_HEIGHT = 820;

function getScreen() {
	if (!app.isReady()) {
		throw new Error(
			"getScreen() called before app is ready. Ensure all screen access happens after app.whenReady().",
		);
	}
	return nodeRequire("electron").screen as typeof import("electron").screen;
}

/**
 * Loads the shared renderer bundle the same way `electron/windows.ts` does:
 * Vite dev server first, then the packaged renderer server, then `dist` on disk.
 */
function loadRendererWindow(win: BrowserWindow, query: Record<string, string>) {
	const search = new URLSearchParams(query).toString();
	const loadFromFile = () => {
		void win.loadFile(path.join(RENDERER_DIST, "index.html"), { query });
	};

	if (VITE_DEV_SERVER_URL) {
		void win.loadURL(`${VITE_DEV_SERVER_URL}?${search}`);
		return;
	}

	const packagedBaseUrl = getPackagedRendererBaseUrl();
	if (packagedBaseUrl) {
		void win.loadURL(`${packagedBaseUrl}/index.html?${search}`);
		return;
	}

	loadFromFile();
}

let regionSelectorWindow: BrowserWindow | null = null;
let imageEditorWindow: BrowserWindow | null = null;

export function getRegionSelectorWindow(): BrowserWindow | null {
	return regionSelectorWindow && !regionSelectorWindow.isDestroyed()
		? regionSelectorWindow
		: null;
}

export function closeRegionSelectorWindow(): void {
	const win = getRegionSelectorWindow();
	regionSelectorWindow = null;
	if (win) {
		try {
			win.destroy();
		} catch {
			// The window may already be tearing down.
		}
	}
}

export function getImageEditorWindow(): BrowserWindow | null {
	return imageEditorWindow && !imageEditorWindow.isDestroyed() ? imageEditorWindow : null;
}

/**
 * Overlay window used to draw a region. It spans exactly one display, sits above
 * every other window (including full-screen apps), and is destroyed as soon as
 * the selection resolves.
 */
function createRegionSelectorWindow(display: Electron.Display): BrowserWindow {
	const bounds = display.bounds;
	const win = new BrowserWindow({
		x: Math.round(bounds.x),
		y: Math.round(bounds.y),
		width: Math.max(1, Math.round(bounds.width)),
		height: Math.max(1, Math.round(bounds.height)),
		frame: false,
		transparent: true,
		backgroundColor: "#00000000",
		resizable: false,
		movable: false,
		minimizable: false,
		maximizable: false,
		fullscreenable: false,
		skipTaskbar: true,
		hasShadow: false,
		alwaysOnTop: true,
		show: false,
		enableLargerThanScreen: true,
		...(process.platform !== "darwin" && {
			icon: WINDOW_ICON_PATH,
		}),
		webPreferences: {
			preload: path.join(screenshotWindowsDir, "preload.mjs"),
			nodeIntegration: false,
			contextIsolation: true,
		},
	});

	// "screen-saver" is the highest portable level, so the overlay also covers
	// full-screen windows and other always-on-top panels.
	win.setAlwaysOnTop(true, "screen-saver");
	win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

	loadRendererWindow(win, {
		windowType: "screenshot-region",
		displayId: String(display.id),
		scaleFactor: String(display.scaleFactor ?? 1),
		displayBoundsX: String(bounds.x),
		displayBoundsY: String(bounds.y),
		displayWidthDip: String(bounds.width),
		displayHeightDip: String(bounds.height),
		physicalWidth: String(Math.round(bounds.width * (display.scaleFactor || 1))),
		physicalHeight: String(Math.round(bounds.height * (display.scaleFactor || 1))),
	});

	return win;
}

/**
 * Show the region selection overlay for `display` and resolve with the drawn
 * rectangle in DIP client coordinates, or `null` when the user cancelled.
 *
 * The promise always settles: window close, display removal and a safety
 * timeout are all treated as cancellation.
 *
 * The safety timeout is an *idle* timeout. It exists to tear down an overlay
 * whose renderer has stopped responding, so the selector reports its pointer and
 * key activity back (see `SCREENSHOT_REGION_ACTIVITY_CHANNEL`) and every report
 * re-arms the timer. Without that, a user who takes longer than the timeout to
 * place and adjust a selection would have the overlay destroyed mid-edit — the
 * handle-dragging and arrow-key nudging flow makes that easy to hit.
 */
export function selectRegionOnDisplay(
	display: Electron.Display,
	safetyTimeoutMs = REGION_OVERLAY_SAFETY_TIMEOUT_MS,
	platform: NodeJS.Platform = process.platform,
): Promise<RegionSelectionRect | null> {
	return new Promise<RegionSelectionRect | null>((resolve) => {
		let settled = false;
		let safetyTimer: NodeJS.Timeout | null = null;
		let removeDisplayListener: (() => void) | null = null;
		let removeGlobalListeners: (() => void) | null = null;
		let win: BrowserWindow;

		const clearSafetyTimer = () => {
			if (safetyTimer) {
				clearTimeout(safetyTimer);
				safetyTimer = null;
			}
		};

		const cleanup = () => {
			clearSafetyTimer();
			removeDisplayListener?.();
			removeDisplayListener = null;
			removeGlobalListeners?.();
			removeGlobalListeners = null;
			if (regionSelectorWindow === win) {
				regionSelectorWindow = null;
			}
			if (win && !win.isDestroyed()) {
				win.destroy();
			}
		};

		const settle = (rect: RegionSelectionRect | null) => {
			if (settled) {
				return;
			}
			settled = true;
			cleanup();
			resolve(rect);
		};

		/** (Re)arm the idle watchdog that tears down a hung overlay. */
		const armSafetyTimer = () => {
			clearSafetyTimer();
			safetyTimer = setTimeout(() => {
				console.warn(
					"Screenshot region selection was idle for too long; cancelling the overlay.",
				);
				settle(null);
			}, safetyTimeoutMs);
		};

		const onComplete = (_event: Electron.IpcMainEvent, payload: unknown) => {
			const rect = normalizeRegionSelection(payload);
			settle(rect);
		};
		const onCancel = () => settle(null);
		const onActivity = (event: Electron.IpcMainEvent) => {
			// Only this overlay's own renderer may keep it alive.
			if (settled || event?.sender !== win?.webContents) {
				return;
			}
			armSafetyTimer();
		};

		try {
			win = createRegionSelectorWindow(display);
		} catch (error) {
			console.error("Failed to create the screenshot region selector window:", error);
			resolve(null);
			return;
		}

		regionSelectorWindow = win;
		const webContents = win.webContents;

		webContents.on("did-finish-load", () => {
			if (win.isDestroyed()) {
				return;
			}

			if (platform === "darwin") {
				// Cover the menu bar/dock area on macOS.
				win.setSimpleFullScreen(true);
			}

			if (platform === "win32") {
				win.showInactive();
			} else {
				win.show();
			}
			win.moveTop();
			win.focus();
			webContents.send(SCREENSHOT_REGION_READY_EVENT, {
				displayId: String(display.id),
				scaleFactor: display.scaleFactor,
				bounds: display.bounds,
			});
		});

		win.on("closed", () => {
			settle(null);
		});

		win.on("unresponsive", () => {
			settle(null);
		});

		// A monitor unplugged/reconfigured underneath the overlay would leave a
		// stale rectangle, so treat it as cancellation.
		const onDisplayRemoved = (_event: Electron.Event, removedDisplay: Electron.Display) => {
			if (removedDisplay.id === display.id) {
				settle(null);
			}
		};
		try {
			getScreen().on("display-removed", onDisplayRemoved);
			removeDisplayListener = () => {
				getScreen().removeListener("display-removed", onDisplayRemoved);
			};
		} catch {
			// Display change tracking is best-effort.
		}

		webContents.ipc.on(SCREENSHOT_REGION_COMPLETE_CHANNEL, onComplete);
		webContents.ipc.on(SCREENSHOT_REGION_CANCEL_CHANNEL, onCancel);
		webContents.ipc.on(SCREENSHOT_REGION_ACTIVITY_CHANNEL, onActivity);

		// Belt and braces: some Electron/OS combinations deliver the renderer's
		// `ipcRenderer.send` to the global `ipcMain` emitter only. Accept the region
		// result from either path, gated to this overlay's webContents so another
		// window can never spoof a selection. `settle` is idempotent.
		const onGlobalComplete = (event: Electron.IpcMainEvent, payload: unknown) => {
			if (event?.sender !== webContents) {
				return;
			}
			onComplete(event, payload);
		};
		const onGlobalCancel = (event: Electron.IpcMainEvent) => {
			if (event?.sender !== webContents) {
				return;
			}
			onCancel();
		};
		ipcMain.on(SCREENSHOT_REGION_COMPLETE_CHANNEL, onGlobalComplete);
		ipcMain.on(SCREENSHOT_REGION_CANCEL_CHANNEL, onGlobalCancel);
		ipcMain.on(SCREENSHOT_REGION_ACTIVITY_CHANNEL, onActivity);
		removeGlobalListeners = () => {
			ipcMain.removeListener(SCREENSHOT_REGION_COMPLETE_CHANNEL, onGlobalComplete);
			ipcMain.removeListener(SCREENSHOT_REGION_CANCEL_CHANNEL, onGlobalCancel);
			ipcMain.removeListener(SCREENSHOT_REGION_ACTIVITY_CHANNEL, onActivity);
		};

		armSafetyTimer();
	});
}

/** Round and reject degenerate rectangles coming from the renderer. */
export function normalizeRegionSelection(payload: unknown): RegionSelectionRect | null {
	if (!payload || typeof payload !== "object") {
		return null;
	}

	const candidate = payload as Partial<RegionSelectionRect>;
	const values = [candidate.x, candidate.y, candidate.width, candidate.height];
	if (values.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
		return null;
	}

	const rect: RegionSelectionRect = {
		x: Math.round(candidate.x as number),
		y: Math.round(candidate.y as number),
		width: Math.round(candidate.width as number),
		height: Math.round(candidate.height as number),
	};

	if (rect.width < 1 || rect.height < 1) {
		return null;
	}

	return rect;
}

/** Opens (or focuses) the image editor window for an existing image file. */
export function openImageEditorWindow(filePath: string): BrowserWindow {
	const existing = getImageEditorWindow();
	if (existing) {
		existing.webContents.send(SCREENSHOT_EDITOR_LOAD_IMAGE_EVENT, { filePath });
		existing.show();
		existing.focus();
		return existing;
	}

	const win = new BrowserWindow({
		width: EDITOR_WINDOW_WIDTH,
		height: EDITOR_WINDOW_HEIGHT,
		minWidth: 640,
		minHeight: 480,
		title: "Image Editor",
		show: false,
		backgroundColor: "#111111",
		...(process.platform !== "darwin" && {
			icon: WINDOW_ICON_PATH,
		}),
		webPreferences: {
			preload: path.join(screenshotWindowsDir, "preload.mjs"),
			nodeIntegration: false,
			contextIsolation: true,
		},
	});

	imageEditorWindow = win;
	win.once("ready-to-show", () => {
		if (!win.isDestroyed()) {
			win.show();
		}
	});
	win.once("closed", () => {
		if (imageEditorWindow === win) {
			imageEditorWindow = null;
		}
	});

	// The image editor renderer reads `?windowType=image-editor&path=<absolute path>`.
	loadRendererWindow(win, {
		windowType: "image-editor",
		path: filePath,
	});

	return win;
}
