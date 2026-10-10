import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_KEYCAST_SETTINGS, normalizeKeycastSettings } from "./keycastModel";
import {
	KEYCAST_SETTINGS_STORAGE_KEY,
	loadKeycastSettings,
	saveKeycastSettings,
} from "./keycastSettings";

function createStorageMock(initialValues: Record<string, string> = {}): Storage {
	const store = new Map(Object.entries(initialValues));

	return {
		get length() {
			return store.size;
		},
		clear() {
			store.clear();
		},
		getItem(key) {
			return store.get(key) ?? null;
		},
		key(index) {
			return Array.from(store.keys())[index] ?? null;
		},
		removeItem(key) {
			store.delete(key);
		},
		setItem(key, value) {
			store.set(key, value);
		},
	};
}

/** Minimal stand-in for the preload `getAppSetting`/`setAppSetting` bridge. */
function stubAppSettingsBridge(initialValue: unknown = null) {
	let stored: unknown = initialValue;
	const api = {
		getAppSetting: vi.fn(() => stored),
		setAppSetting: vi.fn((_key: string, value: unknown) => {
			stored = value;
			return true;
		}),
	};
	vi.stubGlobal("electronAPI", api);
	return {
		api,
		read: () => stored,
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("keycast settings persistence", () => {
	it("defaults to the opt-out overlay when nothing is stored", () => {
		stubAppSettingsBridge(null);
		vi.stubGlobal("localStorage", createStorageMock());

		expect(loadKeycastSettings()).toEqual(DEFAULT_KEYCAST_SETTINGS);
	});

	it("round-trips through the app-settings bridge", () => {
		const bridge = stubAppSettingsBridge(null);
		vi.stubGlobal("localStorage", createStorageMock());

		const saved = saveKeycastSettings({
			enabled: true,
			position: "top-right",
			size: 1.4,
			opacity: 0.8,
			holdMs: 2_200,
		});

		expect(bridge.api.setAppSetting).toHaveBeenCalledWith(KEYCAST_SETTINGS_STORAGE_KEY, saved);
		expect(loadKeycastSettings()).toEqual(saved);
		expect(loadKeycastSettings()).toEqual({
			enabled: true,
			position: "top-right",
			size: 1.4,
			opacity: 0.8,
			holdMs: 2_200,
			style: "pill",
			lines: 1,
			accentColor: null,
		});
	});

	it("normalises whatever the store hands back", () => {
		stubAppSettingsBridge({ enabled: true, position: "nope", size: 42, opacity: 9 });
		vi.stubGlobal("localStorage", createStorageMock());

		expect(loadKeycastSettings()).toEqual(
			normalizeKeycastSettings({ enabled: true, position: "nope", size: 42, opacity: 9 }),
		);
	});

	it("falls back to the localStorage mirror when the bridge is absent", () => {
		vi.stubGlobal("electronAPI", undefined);
		const storage = createStorageMock({
			[KEYCAST_SETTINGS_STORAGE_KEY]: JSON.stringify({
				enabled: true,
				position: "top-left",
				size: 1,
				opacity: 1,
				holdMs: 1_600,
			}),
		});
		vi.stubGlobal("localStorage", storage);

		expect(loadKeycastSettings()).toMatchObject({ enabled: true, position: "top-left" });
	});

	it("survives a corrupt localStorage mirror", () => {
		vi.stubGlobal("electronAPI", undefined);
		vi.stubGlobal(
			"localStorage",
			createStorageMock({ [KEYCAST_SETTINGS_STORAGE_KEY]: "{not json" }),
		);

		expect(loadKeycastSettings()).toEqual(DEFAULT_KEYCAST_SETTINGS);
	});
});
