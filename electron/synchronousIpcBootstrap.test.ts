import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `electron/synchronousIpcBootstrap.ts` is the fix for the "HUD never presents a
 * frame" bug: the preload's blocking `ipcRenderer.sendSync("app-settings:get")`
 * must always find a listener. These tests cover the two things that make that
 * true — the reply is always produced, and the channels are registered at import
 * time (before any window can load).
 */

const store = new Map<string, unknown>();

vi.mock("electron", () => {
	const handlers = new Map<string, (event: unknown, ...args: unknown[]) => void>();
	return {
		ipcMain: {
			on: vi.fn((channel: string, handler: (event: unknown, ...args: unknown[]) => void) => {
				handlers.set(channel, handler);
			}),
			__handlers: handlers,
		},
	};
});

vi.mock("./appSettingsStore", () => ({
	readAppSettingsStore: () => Object.fromEntries(store),
	writeAppSettingsStore: (next: Record<string, unknown>) => {
		store.clear();
		for (const [key, value] of Object.entries(next)) {
			store.set(key, value);
		}
	},
	hasAppSetting: (snapshot: Record<string, unknown>, key: string) =>
		Object.getOwnPropertyDescriptor(snapshot, key) !== undefined,
}));

const {
	APP_SETTING_GET_CHANNEL,
	APP_SETTING_SET_CHANNEL,
	isValidAppSettingKey,
	registerSynchronousAppSettingHandlers,
	resetSynchronousAppSettingHandlersForTests,
	resolveAppSettingGet,
	resolveAppSettingSet,
} = await import("./synchronousIpcBootstrap");

const { ipcMain } = (await import("electron")) as unknown as {
	ipcMain: { __handlers: Map<string, (event: unknown, ...args: unknown[]) => void> };
};

beforeEach(() => {
	store.clear();
	resetSynchronousAppSettingHandlersForTests();
});

describe("isValidAppSettingKey", () => {
	it("accepts a non-empty string", () => {
		expect(isValidAppSettingKey("recordly.theme")).toBe(true);
	});

	it("rejects empty and non-string keys", () => {
		expect(isValidAppSettingKey("")).toBe(false);
		expect(isValidAppSettingKey(undefined)).toBe(false);
		expect(isValidAppSettingKey(null)).toBe(false);
		expect(isValidAppSettingKey(42)).toBe(false);
	});
});

describe("resolveAppSettingGet", () => {
	it("returns the stored value", () => {
		store.set("recordly.theme", "dark");
		expect(resolveAppSettingGet("recordly.theme")).toEqual({
			success: true,
			value: "dark",
		});
	});

	it("reports a known key with no value as null rather than failing", () => {
		expect(resolveAppSettingGet("recordly.missing")).toEqual({
			success: true,
			value: null,
		});
	});

	it("always produces a reply for an invalid key", () => {
		// A missing `event.returnValue` is what wedges the renderer, so even a bad
		// key must answer.
		const result = resolveAppSettingGet("");
		expect(result).toHaveProperty("success", false);
		expect(result).toHaveProperty("value", null);
	});
});

describe("resolveAppSettingSet", () => {
	it("stores a value and reports success", () => {
		expect(resolveAppSettingSet("recordly.theme", "light")).toEqual({ success: true });
		expect(store.get("recordly.theme")).toBe("light");
	});

	it("always produces a reply for an invalid key", () => {
		expect(resolveAppSettingSet(undefined, "x")).toEqual({ success: false });
	});
});

describe("registerSynchronousAppSettingHandlers", () => {
	it("registers both blocking channels", () => {
		registerSynchronousAppSettingHandlers();
		expect(ipcMain.__handlers.has(APP_SETTING_GET_CHANNEL)).toBe(true);
		expect(ipcMain.__handlers.has(APP_SETTING_SET_CHANNEL)).toBe(true);
	});

	it("answers the synchronous channel with event.returnValue", () => {
		registerSynchronousAppSettingHandlers();
		store.set("recordly.theme", "system");

		const event: { returnValue?: unknown } = {};
		ipcMain.__handlers.get(APP_SETTING_GET_CHANNEL)?.(event, "recordly.theme");

		// The reply must be set synchronously: this is what unblocks the
		// renderer's sendSync, and an unset returnValue is the bug.
		expect(event.returnValue).toEqual({ success: true, value: "system" });
	});

	it("is idempotent", () => {
		registerSynchronousAppSettingHandlers();
		const first = ipcMain.__handlers.size;
		registerSynchronousAppSettingHandlers();
		expect(ipcMain.__handlers.size).toBe(first);
	});
});
