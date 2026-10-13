import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, unknown>();

vi.mock("./appSettings", () => ({
	loadAppSetting: (key: string) => (store.has(key) ? store.get(key) : null),
	saveAppSetting: (key: string, value: unknown) => {
		store.set(key, value);
		return true;
	},
}));

const { BACKGROUND_RUN_SETTING_KEY, loadBackgroundRunPreference, saveBackgroundRunPreference } =
	await import("./backgroundRun");

beforeEach(() => {
	store.clear();
});

describe("background run preference", () => {
	it("is off until the user asks for it", () => {
		expect(loadBackgroundRunPreference()).toBe(false);
	});

	it("round-trips through the shared settings store", () => {
		saveBackgroundRunPreference(true);
		expect(store.get(BACKGROUND_RUN_SETTING_KEY)).toBe(true);
		expect(loadBackgroundRunPreference()).toBe(true);

		saveBackgroundRunPreference(false);
		expect(loadBackgroundRunPreference()).toBe(false);
	});

	it("only treats an explicit true as enabled", () => {
		store.set(BACKGROUND_RUN_SETTING_KEY, "yes");
		expect(loadBackgroundRunPreference()).toBe(false);

		store.set(BACKGROUND_RUN_SETTING_KEY, 1);
		expect(loadBackgroundRunPreference()).toBe(false);
	});
});
