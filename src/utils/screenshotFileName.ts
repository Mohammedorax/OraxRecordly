/**
 * Screenshot file-name templates.
 *
 * A template renders the **base** name of a capture; the writer appends the
 * image extension afterwards. The renderer (live preview in the settings UI) and
 * the main process (the actual write) both import this module, so what the user
 * previews can never disagree with what lands on disk.
 *
 * The module is deliberately free of Node APIs so it can be bundled into the
 * renderer as well as the Electron main process.
 */

/**
 * Tokens understood by a file-name template, in the order the settings UI lists
 * them:
 *
 * - `{date}`     — local `YYYY-MM-DD`
 * - `{time}`     — local `HH-MM-SS`
 * - `{datetime}` — local `YYYY-MM-DD-HH-MM-SS`
 * - `{counter}`  — zero-padded per-day capture number (`001`, `002`, …)
 * - `{app}`      — name of the captured window/source when it is known
 *
 * Matching is case-insensitive; anything else is left as literal text.
 */
export const SCREENSHOT_FILE_NAME_TEMPLATE_TOKENS = [
	"{date}",
	"{time}",
	"{datetime}",
	"{counter}",
	"{app}",
] as const;

/** Default template: `Screenshot 2026-10-01 13-47-41.png`. */
export const DEFAULT_SCREENSHOT_FILE_NAME_TEMPLATE = "Screenshot {date} {time}";

/** Longest template the store persists; longer values are truncated on read/write. */
export const SCREENSHOT_FILE_NAME_TEMPLATE_MAX_LENGTH = 200;

/** Longest rendered base name (the extension is added on top of this). */
export const SCREENSHOT_FILE_NAME_MAX_LENGTH = 100;

/**
 * Characters Windows forbids in a file name. `/` and `\` are also path
 * separators, so removing them is what makes path traversal impossible.
 */
const ILLEGAL_FILE_NAME_CHARACTERS = /[\\/:*?"<>|]/g;
/**
 * Windows reserves these device names regardless of extension, so a capture
 * literally named `CON` can never be created.
 */
const WINDOWS_RESERVED_BASE_NAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const KNOWN_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "bmp"]);

/** Replaces every C0 control character (and DEL) with a space. */
function stripControlCharacters(value: string): string {
	let result = "";
	for (const character of value) {
		const codePoint = character.codePointAt(0) ?? 0;
		result += codePoint < 0x20 || codePoint === 0x7f ? " " : character;
	}
	return result;
}

export interface ScreenshotFileNameContext {
	/** Timestamp the tokens are rendered from. */
	date: Date;
	/** Per-day capture number substituted into `{counter}`; defaults to 1. */
	counter?: number;
	/** Captured source name substituted into `{app}`; empty when unknown. */
	appName?: string | null;
}

export interface ScreenshotFileNameOptions {
	/** Per-day capture number substituted into `{counter}`. */
	counter?: number;
	/** Captured source name substituted into `{app}`. */
	appName?: string | null;
	/** Image extension without the dot; defaults to `png`. */
	extension?: string;
}

function padNumber(value: number, length = 2) {
	return String(Math.max(0, Math.trunc(value))).padStart(length, "0");
}

/** Local `YYYY-MM-DD`. */
export function formatScreenshotDate(date: Date): string {
	return `${padNumber(date.getFullYear(), 4)}-${padNumber(date.getMonth() + 1)}-${padNumber(
		date.getDate(),
	)}`;
}

/** Local `HH-MM-SS` (dashes so the result is always a valid file name). */
export function formatScreenshotTime(date: Date): string {
	return `${padNumber(date.getHours())}-${padNumber(date.getMinutes())}-${padNumber(
		date.getSeconds(),
	)}`;
}

/** Normalizes any requested extension onto the two formats the app writes. */
export function normalizeScreenshotExtension(extension?: string): string {
	return extension?.toLowerCase() === "jpeg" || extension?.toLowerCase() === "jpg"
		? "jpg"
		: "png";
}

/**
 * Renders the template tokens. `{app}` is sanitized on its own so a window title
 * such as `C:\Users\me\secret.txt` cannot contribute a separator or a dot run.
 */
export function expandScreenshotFileNameTemplate(
	template: string,
	context: ScreenshotFileNameContext,
): string {
	const date = context.date;
	const replacements: Record<string, string> = {
		"{date}": formatScreenshotDate(date),
		"{time}": formatScreenshotTime(date),
		"{datetime}": `${formatScreenshotDate(date)}-${formatScreenshotTime(date)}`,
		"{counter}": padNumber(context.counter ?? 1, 3),
		"{app}": sanitizeScreenshotFileName(context.appName ?? "", ""),
	};

	return template.replace(/\{(date|time|datetime|counter|app)\}/gi, (match) => {
		return replacements[match.toLowerCase()] ?? match;
	});
}

/** Drops a user-typed image extension so the writer never produces `x.png.png`. */
function stripKnownImageExtension(value: string): string {
	const dot = value.lastIndexOf(".");
	if (dot <= 0) {
		return value;
	}

	const extension = value.slice(dot + 1).toLowerCase();
	return KNOWN_IMAGE_EXTENSIONS.has(extension) ? value.slice(0, dot) : value;
}

/**
 * Sanitizes an arbitrary string into a single, safe file-name component.
 *
 * Rules, in order:
 * 1. `\ / : * ? " < > |` become spaces — a separator can therefore never create
 *    a subfolder or traverse out of the target directory.
 * 2. Control characters become spaces.
 * 3. Whitespace runs collapse to one space.
 * 4. Leading/trailing dots and spaces are stripped (Windows rejects them).
 * 5. Reserved device names get a trailing underscore.
 * 6. The result is capped at `SCREENSHOT_FILE_NAME_MAX_LENGTH` and re-trimmed.
 * 7. An empty result falls back to `fallback`.
 *
 * Example: `..\..\Windows\System32\evil.png` becomes `Windows System32 evil`
 * (a harmless file inside the screenshots folder, never an escape).
 */
export function sanitizeScreenshotFileName(value: string, fallback: string): string {
	let name = typeof value === "string" ? value : "";

	name = name.replace(ILLEGAL_FILE_NAME_CHARACTERS, " ");
	name = stripControlCharacters(name);
	name = name.replace(/\s+/g, " ").trim();
	name = name.replace(/^[.\s]+/, "").replace(/[.\s]+$/, "");

	if (WINDOWS_RESERVED_BASE_NAMES.test(name)) {
		name = `${name}_`;
	}

	if (name.length > SCREENSHOT_FILE_NAME_MAX_LENGTH) {
		name = name.slice(0, SCREENSHOT_FILE_NAME_MAX_LENGTH).replace(/[.\s]+$/, "");
	}

	return name.length > 0 ? name : fallback;
}

/**
 * The pre-template default name: `screenshot-<YYYY-MM-DD>-<HH-MM-SS-mmm>.<ext>`.
 * It is also the fallback when a template renders to nothing.
 */
export function buildLegacyScreenshotFileName(date: Date, extension = "png"): string {
	return `screenshot-${formatScreenshotDate(date)}-${formatScreenshotTime(date)}-${padNumber(
		date.getMilliseconds(),
		3,
	)}.${normalizeScreenshotExtension(extension)}`;
}

/**
 * Renders a template into a complete, sanitized file name (base + extension).
 * An empty result falls back to `buildLegacyScreenshotFileName`.
 */
export function buildScreenshotFileName(
	date: Date,
	template: string = DEFAULT_SCREENSHOT_FILE_NAME_TEMPLATE,
	options: ScreenshotFileNameOptions = {},
): string {
	const extension = normalizeScreenshotExtension(options.extension);
	const expanded = expandScreenshotFileNameTemplate(template, {
		date,
		counter: options.counter,
		appName: options.appName,
	});
	const base = sanitizeScreenshotFileName(stripKnownImageExtension(expanded), "");
	if (!base) {
		return buildLegacyScreenshotFileName(date, extension);
	}

	return `${base}.${extension}`;
}

/** Splits `name.ext` into its base and the `.ext` suffix (extension may be empty). */
function splitFileName(fileName: string): { base: string; extension: string } {
	const dot = fileName.lastIndexOf(".");
	if (dot <= 0) {
		return { base: fileName, extension: "" };
	}

	return { base: fileName.slice(0, dot), extension: fileName.slice(dot) };
}

/**
 * Appends ` (2)`, ` (3)`, … when the name is already taken, so a capture never
 * overwrites an existing file. Names are compared case-insensitively because
 * Windows and macOS file systems are case-insensitive.
 */
export function withUniqueScreenshotFileName(
	fileName: string,
	existingNames: Iterable<string>,
): string {
	const taken = new Set<string>();
	for (const name of existingNames) {
		taken.add(name.toLowerCase());
	}

	if (!taken.has(fileName.toLowerCase())) {
		return fileName;
	}

	const { base, extension } = splitFileName(fileName);
	for (let suffix = 2; suffix <= 100000; suffix += 1) {
		const suffixText = ` (${suffix})`;
		const trimmedBase = base
			.slice(0, Math.max(1, SCREENSHOT_FILE_NAME_MAX_LENGTH - suffixText.length))
			.replace(/[.\s]+$/, "");
		const candidate = `${trimmedBase}${suffixText}${extension}`;
		if (!taken.has(candidate.toLowerCase())) {
			return candidate;
		}
	}

	return `${base} (${Date.now()})${extension}`;
}
