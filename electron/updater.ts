import fs from "node:fs";
import path from "node:path";
import type { MessageBoxOptions, MessageBoxReturnValue } from "electron";
import { app, BrowserWindow, dialog } from "electron";
import { autoUpdater } from "electron-updater";
import { USER_DATA_PATH } from "./appPaths";
import { readAppSetting, writeAppSetting } from "./appSettingsStore";
import { EXPERIMENTAL_UPDATE_DESCRIPTION, getUpdateChannelConfiguration } from "./updateChannel";

const INITIAL_UPDATE_CHECK_DELAY_MS = 15 * 1000;
const BUNDLED_UPDATE_CONFIG_FILENAME = "app-update.yml";
/**
 * electron-builder.json5 and package.json ship with these placeholders until
 * the repository owner fills in the real values; see docs/updates.md.
 */
const GITHUB_PLACEHOLDER_PREFIX = "REPLACE_WITH_GITHUB_";
export const UPDATE_REMINDER_DELAY_MS = 3 * 60 * 60 * 1000;
const DISMISSED_READY_REMINDER_DELAY_MS = 5 * 60 * 1000;
const AUTO_UPDATES_DISABLED = process.env.RECORDLY_DISABLE_AUTO_UPDATES === "1";
/**
 * Recordly's update feed is the GitHub Releases page of the repository named in
 * electron-builder.json5, which packaging records in the bundled
 * `app-update.yml`. A fork must never follow upstream releases, so a feed
 * configured here explicitly (environment variable or the `updateFeedUrl` app
 * setting) always wins over the bundled one. `RECORDLY_UPDATE_FEED_URL` is the
 * legacy name and keeps working so existing maintainer scripts do not break.
 */
const UPDATE_FEED_ENV_KEYS = ["RECORDLY_UPDATE_FEED", "RECORDLY_UPDATE_FEED_URL"] as const;
export const UPDATE_FEED_SETTING_KEY = "updateFeedUrl";
const UPDATER_LOG_PATH =
	process.env.RECORDLY_UPDATER_LOG_PATH?.trim() || path.join(USER_DATA_PATH, "updater.log");
const DEV_UPDATE_PREVIEW_VERSION = "9.9.9";
const DEV_UPDATE_PREVIEW_IS_EXPERIMENTAL =
	process.env.RECORDLY_DEV_PREVIEW_EXPERIMENTAL_UPDATE === "1";
const DEV_UPDATE_PREVIEW_PROGRESS_STEP_MS = 300;
const DEV_UPDATE_PREVIEW_PROGRESS_INCREMENT = 20;
const ONE_MEGABYTE = 1024 * 1024;
const EXPERIMENTAL_UPDATES_SETTING_KEY = "experimentalUpdatesEnabled";

export type UpdateToastPhase = "available" | "downloading" | "ready" | "error";

export type UpdateStatusKind =
	| "idle"
	| "checking"
	| "up-to-date"
	| "available"
	| "downloading"
	| "ready"
	| "error";

export interface UpdateStatusSummary {
	status: UpdateStatusKind;
	currentVersion: string;
	availableVersion: string | null;
	detail?: string;
}

export interface UpdateToastPayload {
	version: string;
	detail: string;
	phase: UpdateToastPhase;
	delayMs: number;
	isPreview?: boolean;
	isExperimental?: boolean;
	progressPercent?: number;
	transferredBytes?: number;
	totalBytes?: number;
	remainingBytes?: number;
	bytesPerSecond?: number;
	primaryAction?: "install-and-restart" | "retry-check";
}

interface DownloadProgressSnapshot {
	progressPercent?: number;
	transferredBytes?: number;
	totalBytes?: number;
	bytesPerSecond?: number;
}

type UpdateToastSender = (
	channel: "update-toast-state",
	payload: UpdateToastPayload | null,
) => boolean;

let updaterInitialized = false;
let updateCheckInProgress = false;
let manualCheckRequested = false;
let initialCheckTimer: NodeJS.Timeout | null = null;
let deferredReminderTimer: NodeJS.Timeout | null = null;
let devPreviewProgressTimer: NodeJS.Timeout | null = null;
let currentToastPayload: UpdateToastPayload | null = null;
let availableVersion: string | null = null;
let pendingDownloadedVersion: string | null = null;
let downloadInProgress = false;
let downloadToastDismissed = false;
let skippedVersion: string | null = null;
let installAfterDownloadRequested = false;
let updateStatusSummary: UpdateStatusSummary = {
	status: "idle",
	currentVersion: app.getVersion(),
	availableVersion: null,
};

function setUpdateStatusSummary(summary: Partial<UpdateStatusSummary>) {
	updateStatusSummary = {
		...updateStatusSummary,
		currentVersion: app.getVersion(),
		...summary,
	};
}

function summarizeError(error: unknown) {
	if (error instanceof Error) {
		return error.stack || `${error.name}: ${error.message}`;
	}

	return String(error);
}

function writeUpdaterLog(message: string, detail?: unknown) {
	try {
		fs.mkdirSync(path.dirname(UPDATER_LOG_PATH), { recursive: true });
		const suffix = detail === undefined ? "" : ` ${summarizeError(detail)}`;
		fs.appendFileSync(
			UPDATER_LOG_PATH,
			`${new Date().toISOString()} ${message}${suffix}\n`,
			"utf8",
		);
	} catch (logError) {
		console.error("Failed to write updater log:", logError);
	}
}

function normalizeUpdateFeedUrl(value: unknown) {
	if (typeof value !== "string") {
		return "";
	}

	return value.trim();
}

/**
 * Returns the explicitly configured update feed URL, or an empty string when the
 * build is not configured for updates. The environment variables win over the
 * `updateFeedUrl` app setting so a maintainer can point a build at a test feed
 * without editing the settings file.
 */
export function getConfiguredUpdateFeedUrl() {
	for (const key of UPDATE_FEED_ENV_KEYS) {
		const fromEnv = normalizeUpdateFeedUrl(process.env[key]);
		if (fromEnv) {
			return fromEnv;
		}
	}

	return normalizeUpdateFeedUrl(readAppSetting(UPDATE_FEED_SETTING_KEY));
}

/** True only when an update server has been configured explicitly. */
export function isAutoUpdateConfigured() {
	return getConfiguredUpdateFeedUrl().length > 0;
}

/**
 * Absolute path of the `app-update.yml` electron-builder writes into the
 * packaged resources directory. electron-updater reads that file on its own, so
 * Recordly only ever needs to know whether it exists. Returns an empty string
 * outside a packaged Electron runtime, where `process.resourcesPath` is unset.
 */
export function getBundledUpdateConfigPath() {
	const resourcesPath = typeof process.resourcesPath === "string" ? process.resourcesPath : "";
	return resourcesPath ? path.join(resourcesPath, BUNDLED_UPDATE_CONFIG_FILENAME) : "";
}

/**
 * State of the update metadata electron-builder writes into the packaged
 * resources directory (`app-update.yml`, generated from the `publish` entry in
 * electron-builder.json5). `placeholder` means a fork has not replaced the
 * owner/repo placeholders yet, so the feed must stay inert rather than query a
 * repository that does not exist.
 */
export type BundledUpdateFeedState = "missing" | "placeholder" | "ready";

export function getBundledUpdateFeedState(): BundledUpdateFeedState {
	const configPath = getBundledUpdateConfigPath();
	if (!configPath) {
		return "missing";
	}

	let contents: string;
	try {
		contents = fs.readFileSync(configPath, "utf8");
	} catch {
		return "missing";
	}

	// A fork that has not edited electron-builder.json5 yet would otherwise ship
	// an updater aimed at a repository that does not exist.
	return contents.includes(GITHUB_PLACEHOLDER_PREFIX) ? "placeholder" : "ready";
}

export function hasBundledUpdateFeed() {
	return getBundledUpdateFeedState() === "ready";
}

/** True when the updater has a feed from either the override or the bundle. */
export function hasUpdateFeed() {
	return isAutoUpdateConfigured() || hasBundledUpdateFeed();
}

/** Strips anything credential-shaped out of a feed URL before it reaches the log. */
function sanitizeFeedUrl(feedUrl: string) {
	try {
		const parsed = new URL(feedUrl);
		parsed.username = "";
		parsed.password = "";
		parsed.search = "";
		parsed.hash = "";
		return parsed.toString();
	} catch {
		return "<unparseable feed url>";
	}
}

function describeUpdateFeedSource() {
	const feedUrl = getConfiguredUpdateFeedUrl();
	if (feedUrl) {
		return `configured feed ${sanitizeFeedUrl(feedUrl)}`;
	}

	if (hasBundledUpdateFeed()) {
		return `bundled feed ${getBundledUpdateConfigPath()}`;
	}

	return "";
}

/**
 * One-line, credential-free description used by the updater log: why the
 * updater is inert, or which feed it is running against.
 */
export function describeAutoUpdateState() {
	if (AUTO_UPDATES_DISABLED) {
		return "disabled by RECORDLY_DISABLE_AUTO_UPDATES=1";
	}

	if (!app.isPackaged) {
		return "not a packaged build";
	}

	if (process.mas) {
		return "macOS App Store build";
	}

	const feedSource = describeUpdateFeedSource();
	if (feedSource) {
		return `active with feed ${feedSource}`;
	}

	if (getBundledUpdateFeedState() === "placeholder") {
		return `no feed configured (app-update.yml still contains ${GITHUB_PLACEHOLDER_PREFIX}* placeholders)`;
	}

	return "no feed configured";
}

function configureUpdateFeed() {
	const feedUrl = getConfiguredUpdateFeedUrl();
	if (feedUrl) {
		autoUpdater.setFeedURL({
			provider: "generic",
			url: feedUrl,
			channel: "latest",
		});
		writeUpdaterLog(`Using configured update feed: ${sanitizeFeedUrl(feedUrl)}`);
		return true;
	}

	if (hasBundledUpdateFeed()) {
		// electron-builder wrote `app-update.yml` for this repository and
		// electron-updater reads it itself. Calling setFeedURL here would replace
		// that packaged feed, so it is deliberately skipped.
		writeUpdaterLog(`Using bundled update feed from ${getBundledUpdateConfigPath()}.`);
		return true;
	}

	writeUpdaterLog("No update feed configured; electron-updater stays inert.");
	return false;
}

export function getExperimentalUpdatesEnabled() {
	return readAppSetting(EXPERIMENTAL_UPDATES_SETTING_KEY) === true;
}

function applyExperimentalUpdatesPreference() {
	const enabled = getExperimentalUpdatesEnabled();
	const { channel, allowPrerelease, allowDowngrade } = getUpdateChannelConfiguration(enabled);
	autoUpdater.channel = channel;
	autoUpdater.allowPrerelease = allowPrerelease;
	// Changing channels enables downgrades inside electron-updater. Recordly never
	// needs that behaviour: opting out waits for the next stable version instead.
	autoUpdater.allowDowngrade = allowDowngrade;
	writeUpdaterLog(
		`Update channel configured: ${enabled ? "experimental" : "stable"} (${channel}).`,
	);
	return enabled;
}

export function setExperimentalUpdatesEnabled(enabled: boolean) {
	writeAppSetting(EXPERIMENTAL_UPDATES_SETTING_KEY, enabled);
	applyExperimentalUpdatesPreference();
	skippedVersion = null;
	writeUpdaterLog(`Experimental updates ${enabled ? "enabled" : "disabled"} by user.`);
	return enabled;
}

function canUseAutoUpdates() {
	// Four independent gates, all required: the build must be a packaged
	// release, must not be a MAS build, must not be force-disabled, and must have
	// a feed — either the explicit override or the packaged `app-update.yml`.
	return isAutoUpdateFeatureEnabled() && app.isPackaged && !process.mas && hasUpdateFeed();
}

export function isAutoUpdateFeatureEnabled() {
	return !AUTO_UPDATES_DISABLED;
}

function getDialogWindow(getMainWindow: () => BrowserWindow | null) {
	const window = getMainWindow();
	return window && !window.isDestroyed() ? window : undefined;
}

function showMessageBox(
	getMainWindow: () => BrowserWindow | null,
	options: MessageBoxOptions,
): Promise<MessageBoxReturnValue> {
	if (process.platform !== "darwin") {
		return dialog.showMessageBox(options);
	}

	const window = getDialogWindow(getMainWindow);
	return window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options);
}

function clearDeferredReminderTimer() {
	if (deferredReminderTimer) {
		clearTimeout(deferredReminderTimer);
		deferredReminderTimer = null;
	}
}

function clearDevPreviewProgressTimer() {
	if (devPreviewProgressTimer) {
		clearInterval(devPreviewProgressTimer);
		devPreviewProgressTimer = null;
	}
}

function emitUpdateToastState(
	sendToRenderer: UpdateToastSender | undefined,
	payload: UpdateToastPayload | null,
) {
	currentToastPayload = payload;
	if (!sendToRenderer) {
		return false;
	}

	return sendToRenderer("update-toast-state", payload);
}

function getCurrentToastExperimentalFlag() {
	return currentToastPayload?.isExperimental ?? getExperimentalUpdatesEnabled();
}

function createAvailableUpdateToastPayload(
	version: string,
	isExperimental = getExperimentalUpdatesEnabled(),
): UpdateToastPayload {
	return {
		version,
		phase: "available",
		detail: isExperimental
			? EXPERIMENTAL_UPDATE_DESCRIPTION
			: "Install the latest version now, or remind yourself to come back to it later.",
		delayMs: UPDATE_REMINDER_DELAY_MS,
		isExperimental,
		primaryAction: "install-and-restart",
	};
}

function createDownloadingUpdateToastPayload(
	version: string,
	progress: DownloadProgressSnapshot = {},
	isExperimental = getCurrentToastExperimentalFlag(),
): UpdateToastPayload {
	const normalizedProgress = Math.max(
		0,
		Math.min(100, Math.round(progress.progressPercent ?? 0)),
	);
	const transferredBytes =
		typeof progress.transferredBytes === "number" && Number.isFinite(progress.transferredBytes)
			? Math.max(0, progress.transferredBytes)
			: undefined;
	const totalBytes =
		typeof progress.totalBytes === "number" && Number.isFinite(progress.totalBytes)
			? Math.max(0, progress.totalBytes)
			: undefined;
	const remainingBytes =
		totalBytes !== undefined && transferredBytes !== undefined
			? Math.max(totalBytes - transferredBytes, 0)
			: undefined;
	const bytesPerSecond =
		typeof progress.bytesPerSecond === "number" && Number.isFinite(progress.bytesPerSecond)
			? Math.max(0, progress.bytesPerSecond)
			: undefined;
	const remainingMb =
		remainingBytes !== undefined ? Math.max(0, remainingBytes / ONE_MEGABYTE) : null;
	return {
		version,
		phase: "downloading",
		detail:
			normalizedProgress >= 100
				? "Finishing the update download. Recordly will restart as soon as the installer is ready."
				: remainingMb !== null
					? `${remainingMb.toFixed(1)} MB left before Recordly restarts.`
					: "Downloading the update now. Recordly will restart when it finishes.",
		delayMs: UPDATE_REMINDER_DELAY_MS,
		isExperimental,
		progressPercent: normalizedProgress,
		transferredBytes,
		totalBytes,
		remainingBytes,
		bytesPerSecond,
		primaryAction: "install-and-restart",
	};
}

function createDownloadedUpdateToastPayload(
	version: string,
	isExperimental = getCurrentToastExperimentalFlag(),
): UpdateToastPayload {
	return {
		version,
		phase: "ready",
		detail: "The update is ready. Install and restart now, or remind yourself later.",
		delayMs: UPDATE_REMINDER_DELAY_MS,
		isExperimental,
		primaryAction: "install-and-restart",
	};
}

function createUpdateErrorToastPayload(
	version: string,
	error: unknown,
	isExperimental = getCurrentToastExperimentalFlag(),
): UpdateToastPayload {
	return {
		version,
		phase: "error",
		detail: `The update could not be downloaded. ${String(error)}`,
		delayMs: UPDATE_REMINDER_DELAY_MS,
		isExperimental,
		primaryAction: "install-and-restart",
	};
}

function getReminderPayload(): UpdateToastPayload | null {
	if (pendingDownloadedVersion) {
		return createDownloadedUpdateToastPayload(pendingDownloadedVersion);
	}

	if (availableVersion && !downloadInProgress) {
		return createAvailableUpdateToastPayload(availableVersion);
	}

	return null;
}

function clearVisibleUpdateToast(sendToRenderer?: UpdateToastSender) {
	emitUpdateToastState(sendToRenderer, null);
}

export function getCurrentUpdateToastPayload() {
	return currentToastPayload;
}

export function getUpdaterLogPath() {
	return UPDATER_LOG_PATH;
}

export function getUpdateStatusSummary() {
	return updateStatusSummary;
}

function resetDevPreviewState(sendToRenderer?: UpdateToastSender) {
	clearDevPreviewProgressTimer();
	availableVersion = null;
	pendingDownloadedVersion = null;
	downloadInProgress = false;
	downloadToastDismissed = false;
	skippedVersion = null;
	installAfterDownloadRequested = false;
	clearVisibleUpdateToast(sendToRenderer);
}

function simulateDevPreviewDownload(sendToRenderer?: UpdateToastSender) {
	availableVersion = DEV_UPDATE_PREVIEW_VERSION;
	pendingDownloadedVersion = null;
	downloadInProgress = true;
	downloadToastDismissed = false;
	clearDeferredReminderTimer();
	clearDevPreviewProgressTimer();

	let progressPercent = 0;
	emitUpdateToastState(sendToRenderer, {
		...createDownloadingUpdateToastPayload(DEV_UPDATE_PREVIEW_VERSION, {
			progressPercent,
			transferredBytes: 0,
			totalBytes: 20 * ONE_MEGABYTE,
			bytesPerSecond: 5 * ONE_MEGABYTE,
		}),
		isPreview: true,
	});

	devPreviewProgressTimer = setInterval(() => {
		progressPercent = Math.min(100, progressPercent + DEV_UPDATE_PREVIEW_PROGRESS_INCREMENT);

		if (progressPercent >= 100) {
			clearDevPreviewProgressTimer();
			downloadInProgress = false;
			pendingDownloadedVersion = DEV_UPDATE_PREVIEW_VERSION;
			emitUpdateToastState(sendToRenderer, {
				...createDownloadedUpdateToastPayload(DEV_UPDATE_PREVIEW_VERSION),
				isPreview: true,
				detail: "Development preview: the update is ready to install. No real update will be installed.",
			});
			return;
		}

		if (downloadToastDismissed) {
			return;
		}

		emitUpdateToastState(sendToRenderer, {
			...createDownloadingUpdateToastPayload(DEV_UPDATE_PREVIEW_VERSION, {
				progressPercent,
				transferredBytes: (progressPercent / 100) * 20 * ONE_MEGABYTE,
				totalBytes: 20 * ONE_MEGABYTE,
				bytesPerSecond: 5 * ONE_MEGABYTE,
			}),
			isPreview: true,
		});
	}, DEV_UPDATE_PREVIEW_PROGRESS_STEP_MS);

	return { success: true };
}

export function dismissUpdateToast(
	getMainWindow: () => BrowserWindow | null,
	sendToRenderer?: UpdateToastSender,
) {
	if (currentToastPayload?.isPreview) {
		resetDevPreviewState(sendToRenderer);
		return { success: true };
	}

	if (downloadInProgress) {
		installAfterDownloadRequested = false;
		downloadToastDismissed = true;
		clearVisibleUpdateToast(sendToRenderer);
		return { success: true };
	}

	if (currentToastPayload?.phase === "ready") {
		return deferUpdateReminder(
			getMainWindow,
			sendToRenderer,
			DISMISSED_READY_REMINDER_DELAY_MS,
		);
	}

	if (currentToastPayload?.phase === "available" || currentToastPayload?.phase === "error") {
		return deferUpdateReminder(getMainWindow, sendToRenderer, UPDATE_REMINDER_DELAY_MS);
	}

	clearVisibleUpdateToast(sendToRenderer);
	return { success: true };
}

export function installDownloadedUpdateNow(sendToRenderer?: UpdateToastSender) {
	if (currentToastPayload?.isPreview) {
		resetDevPreviewState(sendToRenderer);
		return;
	}

	if (!pendingDownloadedVersion) {
		writeUpdaterLog("Ignored install request because no update has been downloaded.");
		return;
	}

	clearDeferredReminderTimer();
	downloadToastDismissed = false;
	installAfterDownloadRequested = false;
	clearVisibleUpdateToast(sendToRenderer);
	setUpdateStatusSummary({ status: "ready", availableVersion: pendingDownloadedVersion });
	writeUpdaterLog("Installing downloaded update.");
	autoUpdater.quitAndInstall();
}

export async function downloadAvailableUpdate(
	sendToRenderer?: UpdateToastSender,
	options?: { installAfterDownload?: boolean },
) {
	if (currentToastPayload?.isPreview) {
		return simulateDevPreviewDownload(sendToRenderer);
	}

	if (!availableVersion) {
		return { success: false, message: "No update is ready to download." };
	}

	if (pendingDownloadedVersion === availableVersion) {
		return { success: false, message: "This update has already been downloaded." };
	}

	if (downloadInProgress) {
		return { success: false, message: "This update is already downloading." };
	}

	clearDeferredReminderTimer();
	downloadInProgress = true;
	downloadToastDismissed = false;
	installAfterDownloadRequested =
		Boolean(options?.installAfterDownload) || installAfterDownloadRequested;
	setUpdateStatusSummary({
		status: "downloading",
		availableVersion,
		detail: `Downloading Recordly ${availableVersion}`,
	});
	emitUpdateToastState(
		sendToRenderer,
		createDownloadingUpdateToastPayload(availableVersion, {
			progressPercent: 0,
			transferredBytes: 0,
		}),
	);
	writeUpdaterLog(`Starting update download for ${availableVersion}.`);

	try {
		await autoUpdater.downloadUpdate();
		writeUpdaterLog(`Update download requested for ${availableVersion}.`);
		return { success: true };
	} catch (error) {
		downloadInProgress = false;
		setUpdateStatusSummary({
			status: "error",
			availableVersion,
			detail: String(error),
		});
		writeUpdaterLog(`Update download failed for ${availableVersion}.`, error);
		emitUpdateToastState(
			sendToRenderer,
			createUpdateErrorToastPayload(availableVersion, error),
		);
		return { success: false, message: String(error) };
	}
}

export function deferUpdateReminder(
	getMainWindow: () => BrowserWindow | null,
	sendToRenderer?: UpdateToastSender,
	delayMs = UPDATE_REMINDER_DELAY_MS,
) {
	const payload = getReminderPayload();
	if (!payload) {
		return { success: false, message: "No update reminder is ready yet." };
	}

	clearDeferredReminderTimer();
	installAfterDownloadRequested = false;
	clearVisibleUpdateToast(sendToRenderer);
	deferredReminderTimer = setTimeout(() => {
		const nextPayload = getReminderPayload();
		if (!nextPayload) {
			return;
		}

		if (sendToRenderer && emitUpdateToastState(sendToRenderer, nextPayload)) {
			return;
		}

		if (nextPayload.phase === "ready") {
			void showDownloadedUpdateDialog(getMainWindow, nextPayload.version);
			return;
		}

		void showAvailableUpdateDialog(getMainWindow, nextPayload.version, sendToRenderer);
	}, delayMs);

	return { success: true };
}

export function skipAvailableUpdateVersion(sendToRenderer?: UpdateToastSender) {
	const versionToSkip = pendingDownloadedVersion ?? availableVersion;
	if (!versionToSkip) {
		return { success: false, message: "No update is available to skip." };
	}

	skippedVersion = versionToSkip;
	if (pendingDownloadedVersion === versionToSkip) {
		pendingDownloadedVersion = null;
	}
	if (availableVersion === versionToSkip) {
		availableVersion = null;
	}
	downloadInProgress = false;
	downloadToastDismissed = false;
	installAfterDownloadRequested = false;
	clearDeferredReminderTimer();
	clearVisibleUpdateToast(sendToRenderer);

	return { success: true };
}

export function previewUpdateToast(sendToRenderer: UpdateToastSender) {
	clearDeferredReminderTimer();
	clearDevPreviewProgressTimer();
	availableVersion = DEV_UPDATE_PREVIEW_VERSION;
	pendingDownloadedVersion = null;
	downloadInProgress = false;
	downloadToastDismissed = false;
	installAfterDownloadRequested = false;
	return emitUpdateToastState(sendToRenderer, {
		version: DEV_UPDATE_PREVIEW_VERSION,
		phase: "available",
		detail: DEV_UPDATE_PREVIEW_IS_EXPERIMENTAL
			? EXPERIMENTAL_UPDATE_DESCRIPTION
			: "This is a development preview of the in-app update toast.",
		delayMs: UPDATE_REMINDER_DELAY_MS,
		isPreview: true,
		isExperimental: DEV_UPDATE_PREVIEW_IS_EXPERIMENTAL,
	});
}

async function showAvailableUpdateDialog(
	getMainWindow: () => BrowserWindow | null,
	version: string,
	sendToRenderer?: UpdateToastSender,
	options?: { isPreview?: boolean; isExperimental?: boolean },
) {
	const isPreview = Boolean(options?.isPreview);
	const isExperimental = options?.isExperimental ?? getExperimentalUpdatesEnabled();
	const result = await showMessageBox(getMainWindow, {
		type: "info",
		title: isExperimental ? "Experimental Update Available" : "Update Available",
		message: `Recordly ${version} is available${isExperimental ? " on the experimental channel" : ""}.`,
		detail: isPreview
			? `${isExperimental ? EXPERIMENTAL_UPDATE_DESCRIPTION : "This is a development preview of the standard update flow."} No real update will be installed.`
			: isExperimental
				? EXPERIMENTAL_UPDATE_DESCRIPTION
				: "Install and restart now, or remind me later.",
		buttons: ["Install & Restart", "Later"],
		defaultId: 0,
		cancelId: 1,
		noLink: true,
	});

	if (result.response === 0) {
		if (isPreview) {
			await showMessageBox(getMainWindow, {
				type: "info",
				title: "Preview Only",
				message: "No real update was installed.",
				detail: "This was only a manual development preview of the update prompt.",
			});
			return;
		}

		await downloadAvailableUpdate(sendToRenderer, { installAfterDownload: true });
		return;
	}

	if (isPreview) {
		return;
	}

	deferUpdateReminder(getMainWindow, sendToRenderer, UPDATE_REMINDER_DELAY_MS);
}

async function showDownloadedUpdateDialog(
	getMainWindow: () => BrowserWindow | null,
	version: string,
	options?: { isPreview?: boolean },
) {
	const isPreview = Boolean(options?.isPreview);
	const result = await showMessageBox(getMainWindow, {
		type: "info",
		title: "Update Ready",
		message: isPreview
			? `Recordly ${version} is ready to install.`
			: `Recordly ${version} has been downloaded.`,
		detail: isPreview
			? "Development preview of the native update prompt. No real update will be installed."
			: "Install and restart now, or remind me later.",
		buttons: ["Install & Restart", "Later"],
		defaultId: 0,
		cancelId: 1,
		noLink: true,
	});

	if (result.response === 0) {
		if (isPreview) {
			await showMessageBox(getMainWindow, {
				type: "info",
				title: "Preview Only",
				message: "No real update was installed.",
				detail: "This was only a manual development preview of the update prompt.",
			});
			return;
		}

		clearDeferredReminderTimer();
		setImmediate(() => {
			installDownloadedUpdateNow();
		});
		return;
	}

	if (result.response === 1) {
		if (isPreview) {
			return;
		}

		deferUpdateReminder(getMainWindow, undefined, UPDATE_REMINDER_DELAY_MS);
	}
}

export function previewNativeUpdateDialog(getMainWindow: () => BrowserWindow | null) {
	return showAvailableUpdateDialog(getMainWindow, DEV_UPDATE_PREVIEW_VERSION, undefined, {
		isPreview: true,
		isExperimental: DEV_UPDATE_PREVIEW_IS_EXPERIMENTAL,
	});
}

async function showUpdateErrorDialog(
	getMainWindow: () => BrowserWindow | null,
	version: string,
	error: unknown,
) {
	await showMessageBox(getMainWindow, {
		type: "error",
		title: "Update Failed",
		message: `Recordly ${version} could not be downloaded.`,
		detail: String(error),
		buttons: ["OK"],
		defaultId: 0,
		noLink: true,
	});
}

/** Shown only after an explicit "check for updates" request finds nothing. */
async function showNoUpdatesAvailableDialog(getMainWindow: () => BrowserWindow | null) {
	await showMessageBox(getMainWindow, {
		type: "info",
		title: "No Updates Available",
		message: `Recordly ${app.getVersion()} is up to date.`,
		detail: "You are running the latest version of Recordly.",
		buttons: ["OK"],
		defaultId: 0,
		noLink: true,
	});
}

/** Shown only after an explicit "check for updates" request fails. */
async function showUpdateCheckErrorDialog(
	getMainWindow: () => BrowserWindow | null,
	error: unknown,
) {
	await showMessageBox(getMainWindow, {
		type: "error",
		title: "Update Check Failed",
		message: "Recordly could not check for updates.",
		detail: String(error),
		buttons: ["OK"],
		defaultId: 0,
		noLink: true,
	});
}

export async function checkForAppUpdates(
	getMainWindow: () => BrowserWindow | null,
	options?: { manual?: boolean },
) {
	if (!canUseAutoUpdates()) {
		const feedConfigured = hasUpdateFeed();
		writeUpdaterLog(
			`Skipped update check because auto-updates are unavailable: ${describeAutoUpdateState()}`,
		);
		if (options?.manual) {
			await showMessageBox(getMainWindow, {
				type: "info",
				title: "Updates Not Enabled",
				message: AUTO_UPDATES_DISABLED
					? "Automatic updates are disabled for this build."
					: feedConfigured
						? "Auto-updates are only available in packaged releases."
						: "Automatic updates are not configured for this build.",
				detail: AUTO_UPDATES_DISABLED
					? "This build disabled auto-updates through RECORDLY_DISABLE_AUTO_UPDATES=1."
					: feedConfigured
						? "Development builds do not ship the packaged update metadata required by electron-updater."
						: `Set the ${UPDATE_FEED_SETTING_KEY} setting or the RECORDLY_UPDATE_FEED environment variable to enable update checks.`,
			});
		}
		return;
	}

	if (updateCheckInProgress) {
		// A manual request can arrive while the launch check is still running; let
		// that in-flight check answer the user instead of staying silent.
		if (options?.manual) {
			manualCheckRequested = true;
		}
		writeUpdaterLog("Skipped update check because a previous check is still running.");
		return;
	}

	manualCheckRequested = Boolean(options?.manual);
	updateCheckInProgress = true;
	applyExperimentalUpdatesPreference();
	setUpdateStatusSummary({ status: "checking", detail: "Checking for updates..." });
	writeUpdaterLog(`Starting ${manualCheckRequested ? "manual" : "automatic"} update check.`);

	try {
		await autoUpdater.checkForUpdates();
		writeUpdaterLog("Update check request completed.");
	} catch (error) {
		updateCheckInProgress = false;
		manualCheckRequested = false;
		setUpdateStatusSummary({
			status: "error",
			availableVersion,
			detail: String(error),
		});
		writeUpdaterLog("Update check failed.", error);
		console.error("Auto-update check failed:", error);
	}
}

export function setupAutoUpdates(
	getMainWindow: () => BrowserWindow | null,
	sendToRenderer: UpdateToastSender,
) {
	if (updaterInitialized) {
		return;
	}

	if (!canUseAutoUpdates()) {
		// Disabled by env, not packaged, MAS, or no feed at all: never set a feed
		// URL, never register listeners, never schedule a check.
		writeUpdaterLog(`Updater left inert: ${describeAutoUpdateState()}.`);
		setUpdateStatusSummary({ status: "idle", availableVersion: null, detail: undefined });
		return;
	}

	updaterInitialized = true;
	if (!configureUpdateFeed()) {
		updaterInitialized = false;
		setUpdateStatusSummary({ status: "idle", availableVersion: null, detail: undefined });
		return;
	}
	applyExperimentalUpdatesPreference();
	autoUpdater.autoDownload = false;
	autoUpdater.autoInstallOnAppQuit = false;
	writeUpdaterLog(
		`Updater initialized: ${describeAutoUpdateState()}. logPath=${UPDATER_LOG_PATH}`,
	);

	autoUpdater.on("checking-for-update", () => {
		setUpdateStatusSummary({
			status: "checking",
			availableVersion: null,
			detail: "Checking for updates...",
		});
		writeUpdaterLog("electron-updater emitted checking-for-update.");
	});

	autoUpdater.on("update-available", (info) => {
		writeUpdaterLog(`Update available: version=${info.version}`);
		updateCheckInProgress = false;
		availableVersion = info.version;
		pendingDownloadedVersion = null;
		downloadInProgress = false;
		downloadToastDismissed = false;
		installAfterDownloadRequested = false;
		setUpdateStatusSummary({
			status: "available",
			availableVersion: info.version,
			detail: `Recordly ${info.version} is available.`,
		});
		if (skippedVersion === info.version) {
			manualCheckRequested = false;
			return;
		}

		const payload = createAvailableUpdateToastPayload(info.version);
		if (emitUpdateToastState(sendToRenderer, payload)) {
			manualCheckRequested = false;
			return;
		}

		void showAvailableUpdateDialog(getMainWindow, info.version, sendToRenderer);
		manualCheckRequested = false;
	});

	autoUpdater.on("update-not-available", () => {
		writeUpdaterLog("No update available.");
		updateCheckInProgress = false;
		availableVersion = null;
		pendingDownloadedVersion = null;
		downloadInProgress = false;
		downloadToastDismissed = false;
		installAfterDownloadRequested = false;
		setUpdateStatusSummary({
			status: "up-to-date",
			availableVersion: null,
			detail: `Recordly ${app.getVersion()} is up to date.`,
		});
		clearVisibleUpdateToast(sendToRenderer);

		const wasManualCheck = manualCheckRequested;
		manualCheckRequested = false;
		if (wasManualCheck) {
			// A user who asks explicitly deserves an answer even when there is
			// nothing to install.
			void showNoUpdatesAvailableDialog(getMainWindow);
		}
	});

	autoUpdater.on("download-progress", (progress) => {
		if (!availableVersion) {
			return;
		}

		downloadInProgress = true;
		setUpdateStatusSummary({
			status: "downloading",
			availableVersion,
			detail: `Downloading Recordly ${availableVersion}`,
		});
		writeUpdaterLog(
			`Download progress for ${availableVersion}: ${progress.percent.toFixed(1)}%`,
		);
		if (downloadToastDismissed) {
			return;
		}

		emitUpdateToastState(
			sendToRenderer,
			createDownloadingUpdateToastPayload(availableVersion, {
				progressPercent: progress.percent,
				transferredBytes: progress.transferred,
				totalBytes: progress.total,
				bytesPerSecond: progress.bytesPerSecond,
			}),
		);
	});

	autoUpdater.on("error", (error) => {
		const wasManualCheck = manualCheckRequested && !downloadInProgress;
		updateCheckInProgress = false;
		manualCheckRequested = false;
		setUpdateStatusSummary({
			status: "error",
			availableVersion,
			detail: String(error),
		});
		writeUpdaterLog("electron-updater emitted error.", error);
		console.error("Auto-updater error:", error);
		if (downloadInProgress && availableVersion) {
			downloadInProgress = false;
			downloadToastDismissed = false;
			installAfterDownloadRequested = false;
			const shownInRenderer = emitUpdateToastState(
				sendToRenderer,
				createUpdateErrorToastPayload(availableVersion, error),
			);
			if (!shownInRenderer) {
				void showUpdateErrorDialog(getMainWindow, availableVersion, error);
			}
			return;
		}

		if (wasManualCheck) {
			void showUpdateCheckErrorDialog(getMainWindow, error);
		}
	});

	autoUpdater.on("update-downloaded", (info) => {
		writeUpdaterLog(`Update downloaded: version=${info.version}`);
		updateCheckInProgress = false;
		manualCheckRequested = false;
		downloadInProgress = false;
		downloadToastDismissed = false;
		if (skippedVersion === info.version) {
			installAfterDownloadRequested = false;
			return;
		}
		availableVersion = info.version;
		pendingDownloadedVersion = info.version;
		setUpdateStatusSummary({
			status: "ready",
			availableVersion: info.version,
			detail: `Recordly ${info.version} is ready to install.`,
		});
		clearDeferredReminderTimer();

		if (installAfterDownloadRequested && !currentToastPayload?.isPreview) {
			installAfterDownloadRequested = false;
			clearVisibleUpdateToast(sendToRenderer);
			writeUpdaterLog(`Auto-installing downloaded update: version=${info.version}`);
			setImmediate(() => {
				installDownloadedUpdateNow(sendToRenderer);
			});
			return;
		}

		if (
			emitUpdateToastState(sendToRenderer, createDownloadedUpdateToastPayload(info.version))
		) {
			return;
		}

		void showDownloadedUpdateDialog(getMainWindow, info.version);
	});

	// Launch-only check. There is deliberately no periodic re-check: a running
	// session asks GitHub exactly once, and every later check is user-initiated
	// through the "Check for Updates…" menu item or the update toast.
	initialCheckTimer = setTimeout(() => {
		initialCheckTimer = null;
		void checkForAppUpdates(getMainWindow);
	}, INITIAL_UPDATE_CHECK_DELAY_MS);

	app.on("before-quit", () => {
		clearDeferredReminderTimer();
		clearDevPreviewProgressTimer();
		if (initialCheckTimer) {
			clearTimeout(initialCheckTimer);
			initialCheckTimer = null;
		}
	});
}
