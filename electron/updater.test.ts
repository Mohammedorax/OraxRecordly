import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type UpdaterEventHandler = (...args: unknown[]) => void;

const mocks = vi.hoisted(() => {
	const settings: Record<string, unknown> = {};
	const appState = { isPackaged: true };
	const handlers: Record<string, UpdaterEventHandler> = {};
	const autoUpdater = {
		setFeedURL: vi.fn(),
		on: vi.fn((event: string, handler: UpdaterEventHandler) => {
			handlers[event] = handler;
		}),
		checkForUpdates: vi.fn(async () => undefined),
		downloadUpdate: vi.fn(async () => undefined),
		quitAndInstall: vi.fn(),
		channel: "latest",
		allowPrerelease: false,
		allowDowngrade: false,
		autoDownload: true,
		autoInstallOnAppQuit: true,
	};
	const dialog = {
		showMessageBox: vi.fn(async () => ({ response: 1, checkboxChecked: false })),
	};
	return { settings, appState, handlers, autoUpdater, dialog };
});

vi.mock("electron", () => ({
	app: {
		getPath: () => os.tmpdir(),
		setPath: () => undefined,
		getVersion: () => "1.4.0",
		get isPackaged() {
			return mocks.appState.isPackaged;
		},
		on: vi.fn(),
	},
	BrowserWindow: class {},
	dialog: mocks.dialog,
}));

vi.mock("electron-updater", () => ({ autoUpdater: mocks.autoUpdater }));

vi.mock("./appSettingsStore", () => ({
	readAppSetting: (key: string) => (key in mocks.settings ? mocks.settings[key] : null),
	writeAppSetting: (key: string, value: unknown) => {
		mocks.settings[key] = value;
	},
	readAppSettingsStore: () => ({ ...mocks.settings }),
	writeAppSettingsStore: () => undefined,
	hasAppSetting: (store: Record<string, unknown>, key: string) => key in store,
}));

const FEED = "https://updates.example.com/recordly/";
const RESOURCES_DIR = path.join(os.tmpdir(), "recordly-updater-test", "resources");
const BUNDLED_CONFIG_PATH = path.join(RESOURCES_DIR, "app-update.yml");
const BUNDLED_CONFIG = [
	"provider: github",
	"owner: recordly-owner",
	"repo: recordly-repo",
	"updaterCacheDirName: recordly-updater",
	"",
].join("\n");
const PLACEHOLDER_CONFIG = [
	"provider: github",
	"owner: REPLACE_WITH_GITHUB_OWNER",
	"repo: REPLACE_WITH_GITHUB_REPO",
	"",
].join("\n");
const ORIGINAL_RESOURCES_PATH = process.resourcesPath;

async function loadUpdater() {
	vi.resetModules();
	return await import("./updater");
}

function writeBundledConfig(contents: string) {
	fs.mkdirSync(RESOURCES_DIR, { recursive: true });
	fs.writeFileSync(BUNDLED_CONFIG_PATH, contents, "utf8");
}

function emitUpdaterEvent(event: string, ...args: unknown[]) {
	const handler = mocks.handlers[event];
	if (!handler) {
		throw new Error(`No electron-updater handler registered for "${event}"`);
	}

	handler(...args);
}

async function flushSetImmediate() {
	await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
	vi.resetModules();
	for (const key of Object.keys(mocks.settings)) {
		delete mocks.settings[key];
	}
	for (const key of Object.keys(mocks.handlers)) {
		delete mocks.handlers[key];
	}
	mocks.appState.isPackaged = true;
	fs.rmSync(BUNDLED_CONFIG_PATH, { force: true });
	process.resourcesPath = RESOURCES_DIR;
	delete process.env.RECORDLY_UPDATE_FEED;
	delete process.env.RECORDLY_UPDATE_FEED_URL;
	delete process.env.RECORDLY_DISABLE_AUTO_UPDATES;
	process.env.RECORDLY_UPDATER_LOG_PATH = path.join(
		os.tmpdir(),
		"recordly-updater-test",
		"updater.log",
	);
	mocks.autoUpdater.setFeedURL.mockClear();
	mocks.autoUpdater.on.mockClear();
	mocks.autoUpdater.checkForUpdates.mockClear();
	mocks.autoUpdater.downloadUpdate.mockClear();
	mocks.autoUpdater.quitAndInstall.mockClear();
	mocks.dialog.showMessageBox.mockClear();
});

afterEach(() => {
	delete process.env.RECORDLY_UPDATE_FEED;
	delete process.env.RECORDLY_UPDATE_FEED_URL;
	delete process.env.RECORDLY_DISABLE_AUTO_UPDATES;
	delete process.env.RECORDLY_UPDATER_LOG_PATH;
	if (ORIGINAL_RESOURCES_PATH === undefined) {
		delete (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
	} else {
		process.resourcesPath = ORIGINAL_RESOURCES_PATH;
	}
	vi.useRealTimers();
});

describe("update feed configuration", () => {
	it("has no feed by default", async () => {
		const updater = await loadUpdater();

		expect(updater.isAutoUpdateConfigured()).toBe(false);
		expect(updater.getConfiguredUpdateFeedUrl()).toBe("");
		expect(updater.hasBundledUpdateFeed()).toBe(false);
		expect(updater.hasUpdateFeed()).toBe(false);
	});

	it("treats a blank or non-string setting as unconfigured", async () => {
		mocks.settings.updateFeedUrl = "   ";
		expect((await loadUpdater()).isAutoUpdateConfigured()).toBe(false);

		mocks.settings.updateFeedUrl = 42;
		expect((await loadUpdater()).isAutoUpdateConfigured()).toBe(false);
	});

	it("reads the updateFeedUrl app setting", async () => {
		mocks.settings.updateFeedUrl = FEED;

		const updater = await loadUpdater();

		expect(updater.isAutoUpdateConfigured()).toBe(true);
		expect(updater.getConfiguredUpdateFeedUrl()).toBe(FEED);
	});

	it("prefers the RECORDLY_UPDATE_FEED environment variable", async () => {
		mocks.settings.updateFeedUrl = "https://setting.example.com/";
		process.env.RECORDLY_UPDATE_FEED = FEED;

		expect((await loadUpdater()).getConfiguredUpdateFeedUrl()).toBe(FEED);
	});

	it("still honors the legacy RECORDLY_UPDATE_FEED_URL variable", async () => {
		process.env.RECORDLY_UPDATE_FEED_URL = FEED;

		expect((await loadUpdater()).getConfiguredUpdateFeedUrl()).toBe(FEED);
	});

	it("uses the bundled app-update.yml as a feed without an override", async () => {
		writeBundledConfig(BUNDLED_CONFIG);
		const updater = await loadUpdater();

		expect(updater.getBundledUpdateConfigPath()).toBe(BUNDLED_CONFIG_PATH);
		expect(updater.getBundledUpdateFeedState()).toBe("ready");
		expect(updater.hasBundledUpdateFeed()).toBe(true);
		expect(updater.hasUpdateFeed()).toBe(true);
		// The bundled feed is not an explicit override.
		expect(updater.isAutoUpdateConfigured()).toBe(false);
	});

	it("ignores an app-update.yml that still carries the fork placeholders", async () => {
		writeBundledConfig(PLACEHOLDER_CONFIG);
		const updater = await loadUpdater();

		expect(updater.getBundledUpdateFeedState()).toBe("placeholder");
		expect(updater.hasBundledUpdateFeed()).toBe(false);
		expect(updater.hasUpdateFeed()).toBe(false);
	});
});

describe("describeAutoUpdateState", () => {
	it("names the force-disable escape hatch", async () => {
		process.env.RECORDLY_DISABLE_AUTO_UPDATES = "1";
		writeBundledConfig(BUNDLED_CONFIG);

		expect((await loadUpdater()).describeAutoUpdateState()).toBe(
			"disabled by RECORDLY_DISABLE_AUTO_UPDATES=1",
		);
	});

	it("names an unpackaged build", async () => {
		mocks.appState.isPackaged = false;
		writeBundledConfig(BUNDLED_CONFIG);

		expect((await loadUpdater()).describeAutoUpdateState()).toBe("not a packaged build");
	});

	it("names a missing feed", async () => {
		expect((await loadUpdater()).describeAutoUpdateState()).toBe("no feed configured");
	});

	it("reports the bundled feed when it is active", async () => {
		writeBundledConfig(BUNDLED_CONFIG);
		const state = (await loadUpdater()).describeAutoUpdateState();

		expect(state).toContain("active with feed");
		expect(state).toContain(BUNDLED_CONFIG_PATH);
	});

	it("never writes feed credentials into the state string", async () => {
		process.env.RECORDLY_UPDATE_FEED = "https://user:secret-token@example.com/feed/";
		const state = (await loadUpdater()).describeAutoUpdateState();

		expect(state).toContain("active with feed");
		expect(state).not.toContain("secret-token");
	});

	it("never writes a query-string token into the state string", async () => {
		process.env.RECORDLY_UPDATE_FEED = "https://example.com/feed/?token=secret-token";
		const state = (await loadUpdater()).describeAutoUpdateState();

		expect(state).toContain("active with feed");
		expect(state).not.toContain("secret-token");
	});
});

describe("setupAutoUpdates", () => {
	it("stays completely inert when no feed is configured", async () => {
		const updater = await loadUpdater();
		const getMainWindow = () => null;
		const sendToRenderer = vi.fn(() => true);

		updater.setupAutoUpdates(getMainWindow, sendToRenderer);

		expect(mocks.autoUpdater.setFeedURL).not.toHaveBeenCalled();
		expect(mocks.autoUpdater.on).not.toHaveBeenCalled();
		expect(updater.getUpdateStatusSummary()).toMatchObject({
			status: "idle",
			availableVersion: null,
		});
	});

	it("registers the feed and listeners once a feed is configured", async () => {
		process.env.RECORDLY_UPDATE_FEED = FEED;
		const updater = await loadUpdater();

		updater.setupAutoUpdates(
			() => null,
			() => true,
		);

		expect(mocks.autoUpdater.setFeedURL).toHaveBeenCalledWith({
			provider: "generic",
			url: FEED,
			channel: "latest",
		});
		const registeredEvents = mocks.autoUpdater.on.mock.calls.map(([event]) => event);
		expect(registeredEvents).toContain("update-available");
		expect(registeredEvents).toContain("update-downloaded");
	});

	it("activates the updater from a bundled app-update.yml in a packaged build", async () => {
		writeBundledConfig(BUNDLED_CONFIG);
		const updater = await loadUpdater();

		updater.setupAutoUpdates(
			() => null,
			() => true,
		);

		// electron-updater reads app-update.yml itself; overriding it would point
		// the updater somewhere else.
		expect(mocks.autoUpdater.setFeedURL).not.toHaveBeenCalled();
		const registeredEvents = mocks.autoUpdater.on.mock.calls.map(([event]) => event);
		expect(registeredEvents).toContain("update-available");
		expect(registeredEvents).toContain("update-downloaded");
		expect(mocks.autoUpdater.autoDownload).toBe(false);
		expect(mocks.autoUpdater.autoInstallOnAppQuit).toBe(false);
	});

	it("keeps the updater inert when app-update.yml only has placeholders", async () => {
		writeBundledConfig(PLACEHOLDER_CONFIG);
		const updater = await loadUpdater();

		updater.setupAutoUpdates(
			() => null,
			() => true,
		);

		expect(mocks.autoUpdater.setFeedURL).not.toHaveBeenCalled();
		expect(mocks.autoUpdater.on).not.toHaveBeenCalled();
		expect(updater.getUpdateStatusSummary()).toMatchObject({ status: "idle" });
	});

	it("keeps the updater inert when the build is not packaged", async () => {
		mocks.appState.isPackaged = false;
		writeBundledConfig(BUNDLED_CONFIG);
		const updater = await loadUpdater();

		updater.setupAutoUpdates(
			() => null,
			() => true,
		);

		expect(mocks.autoUpdater.setFeedURL).not.toHaveBeenCalled();
		expect(mocks.autoUpdater.on).not.toHaveBeenCalled();
	});

	it("lets the environment override win over the bundled feed", async () => {
		writeBundledConfig(BUNDLED_CONFIG);
		process.env.RECORDLY_UPDATE_FEED = FEED;
		const updater = await loadUpdater();

		updater.setupAutoUpdates(
			() => null,
			() => true,
		);

		expect(mocks.autoUpdater.setFeedURL).toHaveBeenCalledWith({
			provider: "generic",
			url: FEED,
			channel: "latest",
		});
	});

	it("forces the updater inert with RECORDLY_DISABLE_AUTO_UPDATES=1", async () => {
		writeBundledConfig(BUNDLED_CONFIG);
		process.env.RECORDLY_DISABLE_AUTO_UPDATES = "1";
		const updater = await loadUpdater();

		updater.setupAutoUpdates(
			() => null,
			() => true,
		);

		expect(mocks.autoUpdater.setFeedURL).not.toHaveBeenCalled();
		expect(mocks.autoUpdater.on).not.toHaveBeenCalled();
	});

	it("checks once at launch and never schedules a periodic re-check", async () => {
		vi.useFakeTimers();
		writeBundledConfig(BUNDLED_CONFIG);
		const updater = await loadUpdater();

		updater.setupAutoUpdates(
			() => null,
			() => true,
		);

		// Exactly one pending timer: the delayed launch check.
		expect(vi.getTimerCount()).toBe(1);

		await vi.advanceTimersByTimeAsync(15_000);
		expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);

		// A full day later nothing has been scheduled again.
		await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
		expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe("update actions before a feed is configured", () => {
	it("explains that updates are not configured when a manual check is requested", async () => {
		const updater = await loadUpdater();

		await updater.checkForAppUpdates(() => null, { manual: true });

		expect(mocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
		expect(mocks.dialog.showMessageBox).toHaveBeenCalledTimes(1);
		const [options] = mocks.dialog.showMessageBox.mock.calls[0];
		expect(options.message).toBe("Automatic updates are not configured for this build.");
		expect(String(options.detail)).toContain("RECORDLY_UPDATE_FEED");
	});

	it("explains the force-disable switch when a manual check is requested", async () => {
		process.env.RECORDLY_DISABLE_AUTO_UPDATES = "1";
		writeBundledConfig(BUNDLED_CONFIG);
		const updater = await loadUpdater();

		await updater.checkForAppUpdates(() => null, { manual: true });

		expect(mocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
		const [options] = mocks.dialog.showMessageBox.mock.calls[0];
		expect(String(options.detail)).toContain("RECORDLY_DISABLE_AUTO_UPDATES=1");
	});

	it("never installs because nothing can have been downloaded", async () => {
		const updater = await loadUpdater();

		updater.installDownloadedUpdateNow();

		expect(mocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
	});

	it("reports that no update is ready to download", async () => {
		const updater = await loadUpdater();

		await expect(updater.downloadAvailableUpdate()).resolves.toMatchObject({
			success: false,
		});
		expect(mocks.autoUpdater.downloadUpdate).not.toHaveBeenCalled();
	});
});

describe("manual update checks", () => {
	async function setupWithFeed() {
		process.env.RECORDLY_UPDATE_FEED = FEED;
		const updater = await loadUpdater();
		updater.setupAutoUpdates(
			() => null,
			() => true,
		);
		return updater;
	}

	it("tells the user they are up to date", async () => {
		const updater = await setupWithFeed();

		await updater.checkForAppUpdates(() => null, { manual: true });
		emitUpdaterEvent("update-not-available");

		expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
		expect(mocks.dialog.showMessageBox).toHaveBeenCalledTimes(1);
		const [options] = mocks.dialog.showMessageBox.mock.calls[0];
		expect(String(options.message)).toContain("up to date");
	});

	it("does not nag after an automatic check finds nothing", async () => {
		const updater = await setupWithFeed();

		await updater.checkForAppUpdates(() => null);
		emitUpdaterEvent("update-not-available");

		expect(mocks.dialog.showMessageBox).not.toHaveBeenCalled();
		expect(updater.getUpdateStatusSummary()).toMatchObject({ status: "up-to-date" });
	});

	it("answers a manual request that arrives while a check is running", async () => {
		const updater = await setupWithFeed();

		void updater.checkForAppUpdates(() => null);
		await updater.checkForAppUpdates(() => null, { manual: true });
		emitUpdaterEvent("update-not-available");

		expect(mocks.dialog.showMessageBox).toHaveBeenCalledTimes(1);
	});

	it("surfaces a failed manual check", async () => {
		const updater = await setupWithFeed();

		await updater.checkForAppUpdates(() => null, { manual: true });
		emitUpdaterEvent("error", new Error("network down"));

		expect(mocks.dialog.showMessageBox).toHaveBeenCalledTimes(1);
		const [options] = mocks.dialog.showMessageBox.mock.calls[0];
		expect(String(options.message)).toContain("could not check for updates");
		expect(String(options.detail)).toContain("network down");
	});
});

describe("install approval", () => {
	async function setupWithAvailableUpdate() {
		process.env.RECORDLY_UPDATE_FEED = FEED;
		const updater = await loadUpdater();
		const sendToRenderer = vi.fn(() => true);
		updater.setupAutoUpdates(() => null, sendToRenderer);
		emitUpdaterEvent("update-available", { version: "1.5.0" });
		return { updater, sendToRenderer };
	}

	it("downloads only when the update action asks for it", async () => {
		const { updater } = await setupWithAvailableUpdate();

		expect(mocks.autoUpdater.downloadUpdate).not.toHaveBeenCalled();
		await updater.downloadAvailableUpdate(() => true);
		expect(mocks.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
	});

	it("does not quit and install a download the user did not approve for install", async () => {
		const { updater } = await setupWithAvailableUpdate();

		await updater.downloadAvailableUpdate(() => true);
		emitUpdaterEvent("update-downloaded", { version: "1.5.0" });
		await flushSetImmediate();

		expect(mocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
	});

	it("does not quit and install just because an update was found", async () => {
		await setupWithAvailableUpdate();
		await flushSetImmediate();

		expect(mocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
	});

	it("quits and installs after the user approves installing the downloaded update", async () => {
		const { updater } = await setupWithAvailableUpdate();

		await updater.downloadAvailableUpdate(() => true, { installAfterDownload: true });
		emitUpdaterEvent("update-downloaded", { version: "1.5.0" });
		await flushSetImmediate();

		expect(mocks.autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
	});

	it("quits and installs when the ready notification is accepted", async () => {
		const { updater } = await setupWithAvailableUpdate();

		await updater.downloadAvailableUpdate(() => true);
		emitUpdaterEvent("update-downloaded", { version: "1.5.0" });
		updater.installDownloadedUpdateNow();

		expect(mocks.autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
	});
});
