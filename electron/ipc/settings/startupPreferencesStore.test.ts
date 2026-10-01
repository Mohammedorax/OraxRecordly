import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: {
		// `electron/ipc/utils.ts` -> `electron/ipc/constants.ts` -> `electron/appPaths.ts`
		// reads userData at import time; these tests always pass an explicit file path.
		getPath: () => os.tmpdir(),
		setPath: () => undefined,
	},
}));

import {
	createStartupPreferencesStore,
	DEFAULT_STARTUP_PREFERENCES,
	normalizeStartupPreferences,
} from "./startupPreferencesStore";

const tempDirs: string[] = [];
let settingsFile = "";

async function makeStore() {
	return createStartupPreferencesStore(settingsFile);
}

async function readRaw() {
	return JSON.parse(await fs.readFile(settingsFile, "utf-8")) as Record<string, unknown>;
}

beforeEach(async () => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-startup-prefs-"));
	tempDirs.push(dir);
	settingsFile = path.join(dir, "startup-settings.json");
});

afterEach(async () => {
	await Promise.allSettled(
		tempDirs.splice(0).map((dir) => fs.rm(dir, { force: true, recursive: true })),
	);
});

describe("startup preferences defaults", () => {
	it("returns off-by-default preferences when no settings file exists", async () => {
		const store = await makeStore();

		await expect(store.read()).resolves.toEqual({
			openAtLogin: false,
			startMinimized: false,
		});
		expect(DEFAULT_STARTUP_PREFERENCES).toEqual({
			openAtLogin: false,
			startMinimized: false,
		});
	});

	it("round-trips a written patch and persists it to disk", async () => {
		const store = await makeStore();
		await store.update({ openAtLogin: true, startMinimized: true });

		await expect((await makeStore()).read()).resolves.toEqual({
			openAtLogin: true,
			startMinimized: true,
		});
		await expect(readRaw()).resolves.toMatchObject({
			openAtLogin: true,
			startMinimized: true,
		});
	});

	it("merges a partial patch instead of dropping the other preference", async () => {
		const store = await makeStore();
		await store.update({ openAtLogin: true });
		await store.update({ startMinimized: true });

		await expect(store.read()).resolves.toEqual({
			openAtLogin: true,
			startMinimized: true,
		});
	});

	it("ignores non-boolean values instead of coercing them", async () => {
		const store = await makeStore();
		const updated = await store.update({
			openAtLogin: "yes" as never,
			startMinimized: 1 as never,
		});

		expect(updated).toEqual(DEFAULT_STARTUP_PREFERENCES);
	});

	it("normalizes unreadable values back to defaults", () => {
		const preferences = normalizeStartupPreferences({
			openAtLogin: "true",
			startMinimized: 0,
		});

		expect(preferences).toEqual(DEFAULT_STARTUP_PREFERENCES);
	});
});
