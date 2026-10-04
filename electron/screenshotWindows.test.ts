import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (...args: unknown[]) => void;

const mocks = vi.hoisted(() => ({
	loadURL: vi.fn(),
	loadFile: vi.fn(),
	destroy: vi.fn(),
	show: vi.fn(),
	showInactive: vi.fn(),
	moveTop: vi.fn(),
	focus: vi.fn(),
	setAlwaysOnTop: vi.fn(),
	setVisibleOnAllWorkspaces: vi.fn(),
	setSimpleFullScreen: vi.fn(),
	webContentsHandlers: new Map<string, Handler>(),
	windowHandlers: new Map<string, Handler>(),
	ipcHandlers: new Map<string, Handler>(),
	ipcMainHandlers: new Map<string, Handler>(),
	screenHandlers: new Map<string, Handler>(),
}));

function registerHandler(store: Map<string, Handler>, event: string, handler: Handler): void {
	store.set(event, handler);
}

const fakeWindow = {
	webContents: {
		ipc: {
			on: (event: string, handler: Handler) => mocks.ipcHandlers.set(event, handler),
		},
		on: (event: string, handler: Handler) => mocks.webContentsHandlers.set(event, handler),
		send: vi.fn(),
	},
	loadURL: mocks.loadURL,
	loadFile: mocks.loadFile,
	destroy: mocks.destroy,
	show: mocks.show,
	showInactive: mocks.showInactive,
	moveTop: mocks.moveTop,
	focus: mocks.focus,
	setAlwaysOnTop: mocks.setAlwaysOnTop,
	setVisibleOnAllWorkspaces: mocks.setVisibleOnAllWorkspaces,
	setSimpleFullScreen: mocks.setSimpleFullScreen,
	isDestroyed: vi.fn(() => false),
	on: (event: string, handler: Handler) => mocks.windowHandlers.set(event, handler),
	once: (event: string, handler: Handler) => mocks.windowHandlers.set(event, handler),
};

const windowOptions = vi.hoisted(() => ({ last: null as Record<string, unknown> | null }));

vi.mock("electron", () => ({
	app: { isReady: () => true, getPath: () => "C:\\temp", setPath: () => undefined },
	ipcMain: {
		on: (event: string, handler: Handler) => {
			mocks.ipcMainHandlers.set(event, handler);
		},
		removeListener: vi.fn(),
		handle: vi.fn(),
	},
	BrowserWindow: class {
		constructor(options: Record<string, unknown>) {
			windowOptions.last = options;
			return fakeWindow as unknown as BrowserWindow;
		}
	},
}));

vi.mock("node:module", () => ({
	createRequire: () => (id: string) => {
		if (id === "electron") {
			return {
				screen: {
					on: (event: string, handler: Handler) =>
						registerHandler(mocks.screenHandlers, event, handler),
					removeListener: vi.fn(),
				},
			};
		}
		throw new Error(`Unexpected require: ${id}`);
	},
}));

vi.mock("./rendererServer", () => ({
	getPackagedRendererBaseUrl: () => null,
}));

// `screenshotWindows.ts` captures the dev-server URL at module load, so it must
// be set before the module under test is imported.
vi.hoisted(() => {
	process.env.VITE_DEV_SERVER_URL = "http://127.0.0.1:5173";
});

import { normalizeRegionSelection, selectRegionOnDisplay } from "./screenshotWindows";

const display = {
	id: 7,
	scaleFactor: 2,
	bounds: { x: 1280, y: 0, width: 1280, height: 720 },
	size: { width: 1280, height: 720 },
	workArea: { x: 1280, y: 0, width: 1280, height: 720 },
} as unknown as Electron.Display;

beforeEach(() => {
	mocks.webContentsHandlers.clear();
	mocks.windowHandlers.clear();
	mocks.ipcHandlers.clear();
	mocks.ipcMainHandlers.clear();
	mocks.screenHandlers.clear();
	windowOptions.last = null;
	mocks.loadURL.mockReset();
	mocks.destroy.mockReset();
	mocks.show.mockReset();
	mocks.showInactive.mockReset();
	mocks.moveTop.mockReset();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("selectRegionOnDisplay", () => {
	it("creates a transparent, always-on-top overlay covering the display at screen-saver level", async () => {
		const selection = selectRegionOnDisplay(display, 10_000);

		expect(windowOptions.last).toMatchObject({
			x: 1280,
			y: 0,
			width: 1280,
			height: 720,
			frame: false,
			transparent: true,
			alwaysOnTop: true,
			show: false,
		});
		expect(mocks.setAlwaysOnTop).toHaveBeenCalledWith(true, "screen-saver");
		expect(mocks.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
			visibleOnFullScreen: true,
		});

		const loadUrl = mocks.loadURL.mock.calls[0]?.[0] as string;
		const query = new URLSearchParams(loadUrl.split("?")[1]);
		expect(query.get("windowType")).toBe("screenshot-region");
		expect(query.get("displayId")).toBe("7");
		expect(query.get("scaleFactor")).toBe("2");
		expect(query.get("displayWidthDip")).toBe("1280");
		expect(query.get("physicalWidth")).toBe("2560");

		mocks.ipcHandlers.get("screenshot-region-complete")?.({}, null);
		await expect(selection).resolves.toBeNull();
	});

	it("resolves with the drawn rectangle and destroys the overlay", async () => {
		const selection = selectRegionOnDisplay(display, 10_000);
		mocks.ipcHandlers.get("screenshot-region-complete")?.(
			{},
			{
				x: 10.4,
				y: 20.6,
				width: 100.5,
				height: 50.5,
			},
		);

		await expect(selection).resolves.toEqual({ x: 10, y: 21, width: 101, height: 51 });
		expect(mocks.destroy).toHaveBeenCalledTimes(1);
	});

	it("treats a null payload (Escape/right-click) as cancellation", async () => {
		const selection = selectRegionOnDisplay(display, 10_000);
		mocks.ipcHandlers.get("screenshot-region-complete")?.({}, null);

		await expect(selection).resolves.toBeNull();
	});

	it("still shows the overlay when the window is closed without a selection", async () => {
		const selection = selectRegionOnDisplay(display, 10_000);
		mocks.windowHandlers.get("closed")?.();

		await expect(selection).resolves.toBeNull();
	});

	it("cancels when the covered display is removed", async () => {
		const selection = selectRegionOnDisplay(display, 10_000);
		mocks.screenHandlers.get("display-removed")?.({}, { id: 7, bounds: display.bounds });

		await expect(selection).resolves.toBeNull();
	});

	it("cancels after the safety timeout so the overlay cannot get stuck", async () => {
		vi.useFakeTimers();
		const selection = selectRegionOnDisplay(display, 5_000);

		await vi.advanceTimersByTimeAsync(5_000);

		await expect(selection).resolves.toBeNull();
		expect(mocks.destroy).toHaveBeenCalledTimes(1);
	});

	it("defers the safety timeout while the user keeps interacting", async () => {
		// The watchdog exists to tear down a *hung* overlay, so a selection that
		// takes longer than the timeout to draw and adjust must not be destroyed
		// mid-edit: every activity report from the overlay re-arms it.
		vi.useFakeTimers();
		const selection = selectRegionOnDisplay(display, 5_000);
		const activity = mocks.ipcHandlers.get("screenshot-region-activity");
		expect(activity).toBeTruthy();

		await vi.advanceTimersByTimeAsync(4_000);
		activity?.({ sender: fakeWindow.webContents });
		await vi.advanceTimersByTimeAsync(4_000);
		activity?.({ sender: fakeWindow.webContents });
		await vi.advanceTimersByTimeAsync(4_000);
		expect(mocks.destroy).not.toHaveBeenCalled();

		// Once the user stops, the watchdog still tears the overlay down.
		await vi.advanceTimersByTimeAsync(5_000);
		await expect(selection).resolves.toBeNull();
		expect(mocks.destroy).toHaveBeenCalledTimes(1);
	});

	it("ignores an activity report from a different window", async () => {
		vi.useFakeTimers();
		const selection = selectRegionOnDisplay(display, 5_000);
		const activity = mocks.ipcHandlers.get("screenshot-region-activity");

		// Another window must not be able to keep this overlay alive.
		activity?.({ sender: {} });
		await vi.advanceTimersByTimeAsync(5_000);

		await expect(selection).resolves.toBeNull();
	});

	it("shows the overlay once the renderer finishes loading", async () => {
		// Windows shows the overlay without stealing focus from the app underneath.
		const selection = selectRegionOnDisplay(display, 10_000, "win32");
		mocks.webContentsHandlers.get("did-finish-load")?.();

		expect(mocks.showInactive).toHaveBeenCalledTimes(1);
		expect(mocks.show).not.toHaveBeenCalled();
		expect(mocks.moveTop).toHaveBeenCalledTimes(1);
		expect(mocks.ipcHandlers.has("screenshot-region-cancel")).toBe(true);

		mocks.ipcHandlers.get("screenshot-region-complete")?.({}, null);
		await expect(selection).resolves.toBeNull();
	});

	it("shows the overlay with the plain show call on non-Windows platforms", async () => {
		// Every other platform uses show(): the overlay must still become visible
		// exactly once and be raised to the top.
		const selection = selectRegionOnDisplay(display, 10_000, "linux");
		mocks.webContentsHandlers.get("did-finish-load")?.();

		expect(mocks.show).toHaveBeenCalledTimes(1);
		expect(mocks.showInactive).not.toHaveBeenCalled();
		expect(mocks.moveTop).toHaveBeenCalledTimes(1);

		mocks.ipcHandlers.get("screenshot-region-complete")?.({}, null);
		await expect(selection).resolves.toBeNull();
	});

	it("also accepts the selection through ipcMain, gated to the overlay's webContents", async () => {
		const selection = selectRegionOnDisplay(display, 10_000);
		const handler = mocks.ipcMainHandlers.get("screenshot-region-complete");
		expect(handler).toBeTruthy();

		// A message from another window must be ignored.
		handler?.({ sender: {} }, { x: 0, y: 0, width: 5, height: 5 });
		// The overlay's own message resolves.
		handler?.({ sender: fakeWindow.webContents }, { x: 5, y: 6, width: 100, height: 50 });

		await expect(selection).resolves.toEqual({ x: 5, y: 6, width: 100, height: 50 });
	});
});

describe("normalizeRegionSelection", () => {
	it("rounds rectangle values", () => {
		expect(normalizeRegionSelection({ x: 1.4, y: 2.6, width: 10.2, height: 20.8 })).toEqual({
			x: 1,
			y: 3,
			width: 10,
			height: 21,
		});
	});

	it("rejects null, non-numeric and degenerate rectangles", () => {
		expect(normalizeRegionSelection(null)).toBeNull();
		expect(normalizeRegionSelection("nope")).toBeNull();
		expect(normalizeRegionSelection({ x: 0, y: 0, width: 0, height: 0 })).toBeNull();
		expect(normalizeRegionSelection({ x: 0, y: 0, width: 10, height: Number.NaN })).toBeNull();
	});
});
