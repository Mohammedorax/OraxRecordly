import fs from "node:fs/promises";
import { parseJsonWithByteOrderMark } from "../utils";

export interface StartupPreferences {
	/** Register Recordly as an OS login item so it launches when the user signs in. */
	openAtLogin: boolean;
	/** Launch Recordly without showing its windows until the user asks for them. */
	startMinimized: boolean;
}

export interface StartupPreferencesPatch {
	openAtLogin?: boolean;
	startMinimized?: boolean;
}

/**
 * Both preferences default to off: installing a customized build must not add a
 * login item behind the user's back, and must not hide the window on launch.
 */
export const DEFAULT_STARTUP_PREFERENCES: StartupPreferences = {
	openAtLogin: false,
	startMinimized: false,
};

export function normalizeStartupPreferences(raw: Record<string, unknown>): StartupPreferences {
	return {
		openAtLogin:
			typeof raw.openAtLogin === "boolean"
				? raw.openAtLogin
				: DEFAULT_STARTUP_PREFERENCES.openAtLogin,
		startMinimized:
			typeof raw.startMinimized === "boolean"
				? raw.startMinimized
				: DEFAULT_STARTUP_PREFERENCES.startMinimized,
	};
}

function buildPatch(raw: StartupPreferencesPatch): Record<string, unknown> {
	const patch: Record<string, unknown> = {};

	if (typeof raw.openAtLogin === "boolean") {
		patch.openAtLogin = raw.openAtLogin;
	}

	if (typeof raw.startMinimized === "boolean") {
		patch.startMinimized = raw.startMinimized;
	}

	return patch;
}

/**
 * Startup preferences live in their own userData JSON file so they can never
 * disturb (or be disturbed by) the settings files that share userData. The file
 * path is owned by `electron/autoLaunch.ts`, which also maps the stored
 * `openAtLogin` value onto the operating system's login item.
 */
export function createStartupPreferencesStore(filePath: string) {
	let operationQueue: Promise<void> = Promise.resolve();

	const readFile = async (): Promise<Record<string, unknown>> => {
		try {
			const content = await fs.readFile(filePath, "utf-8");
			const parsed = parseJsonWithByteOrderMark<unknown>(content);
			return parsed && typeof parsed === "object" && !Array.isArray(parsed)
				? (parsed as Record<string, unknown>)
				: {};
		} catch {
			return {};
		}
	};

	return {
		async read(): Promise<StartupPreferences> {
			await operationQueue;
			return normalizeStartupPreferences(await readFile());
		},
		async update(patch: StartupPreferencesPatch): Promise<StartupPreferences> {
			const normalizedPatch = buildPatch(patch);
			const operation = operationQueue.then(async () => {
				const existing = await readFile();
				const next = { ...existing, ...normalizedPatch };
				await fs.writeFile(filePath, JSON.stringify(next, null, 2), "utf-8");
			});
			operationQueue = operation.catch(() => undefined);
			await operation;
			return normalizeStartupPreferences(await readFile());
		},
	};
}
