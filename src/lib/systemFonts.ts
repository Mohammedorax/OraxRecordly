/**
 * The font list offered for text formatting.
 *
 * The list comes from the machine, not from us: a caption or an annotation is
 * burned into the video with a font that has to exist on the renderer, and the
 * user's own fonts are the ones they expect to choose from. Chromium exposes them
 * through the Local Font Access API; when that is unavailable (this Electron
 * version does not surface the permission, and a denied request is a normal
 * outcome) a short list of fonts every such system ships with is used instead, so
 * the picker is never empty and nothing is ever downloaded from the network.
 */

/** Fonts that ship with each platform, used when enumeration is unavailable. */
const FALLBACK_FAMILIES: Record<string, string[]> = {
	win32: [
		"Segoe UI",
		"Segoe UI Variable",
		"Calibri",
		"Arial",
		"Arial Black",
		"Bahnschrift",
		"Cambria",
		"Candara",
		"Cascadia Mono",
		"Comic Sans MS",
		"Consolas",
		"Constantia",
		"Corbel",
		"Courier New",
		"Ebrima",
		"Franklin Gothic Medium",
		"Gabriola",
		"Georgia",
		"Impact",
		"Ink Free",
		"Lucida Console",
		"Lucida Sans Unicode",
		"Malgun Gothic",
		"Marlett",
		"Microsoft Himalaya",
		"Microsoft JhengHei",
		"Microsoft Sans Serif",
		"Microsoft YaHei",
		"MingLiU-ExtB",
		"Modern",
		"MS Gothic",
		"Nirmala UI",
		"Palatino Linotype",
		"Sans Serif Collection",
		"Sitka",
		"Sylfaen",
		"Symbol",
		"Tahoma",
		"Times New Roman",
		"Trebuchet MS",
		"Verdana",
		"Webdings",
		"Wingdings",
		"Yu Gothic",
	],
	darwin: [
		"Helvetica",
		"Helvetica Neue",
		"Arial",
		"Avenir",
		"Avenir Next",
		"Baskerville",
		"Chalkboard",
		"Chicago",
		"Courier New",
		"Futura",
		"Geneva",
		"Georgia",
		"Gill Sans",
		"Helvetica Neue",
		"Herculanum",
		"Impact",
		"Lucida Grande",
		"Marker Felt",
		"Menlo",
		"Monaco",
		"Noteworthy",
		"Optima",
		"Palatino",
		"Papyrus",
		"SF Pro",
		"SF Mono",
		"Skia",
		"Tahoma",
		"Times New Roman",
		"Verdana",
	],
	linux: [
		"DejaVu Sans",
		"DejaVu Serif",
		"DejaVu Sans Mono",
		"Liberation Sans",
		"Liberation Serif",
		"Liberation Mono",
		"Noto Sans",
		"Noto Serif",
		"Noto Color Emoji",
		"Ubuntu",
		"Ubuntu Mono",
		"Cantarell",
		"FreeSans",
		"FreeSerif",
		"FreeMono",
	],
};

/** How many device fonts the picker offers before the list becomes unusable. */
const MAX_DEVICE_FONTS = 300;

export function getPlatformKey(platform: string | undefined): string {
	if (platform?.startsWith("Win")) return "win32";
	if (platform?.startsWith("Mac")) return "darwin";
	if (platform?.startsWith("Linux")) return "linux";
	return "win32";
}

/** The fallback list for a platform, safe on every platform. */
export function getFallbackFontFamilies(platform: string | undefined): string[] {
	return FALLBACK_FAMILIES[getPlatformKey(platform)] ?? FALLBACK_FAMILIES.win32;
}

type LocalFontData = { family?: string };
type LocalFontQuery = () => Promise<LocalFontData[]>;

/**
 * Every font family installed on this machine, or the platform fallback list.
 *
 * Never throws: a denied permission, a browser without the API and a device with
 * no readable fonts all fall back to the short list above.
 */
export async function loadSystemFontFamilies(
	platform: string | undefined = typeof navigator === "undefined"
		? undefined
		: navigator.platform,
): Promise<string[]> {
	const fallback = getFallbackFontFamilies(platform);
	const query = (globalThis as { queryLocalFonts?: LocalFontQuery }).queryLocalFonts;
	if (typeof query !== "function") {
		return fallback;
	}

	try {
		const fonts = await query();
		const families = new Set<string>();
		for (const font of fonts) {
			const family = typeof font?.family === "string" ? font.family.trim() : "";
			if (family.length > 0) {
				families.add(family);
			}
		}
		if (families.size === 0) {
			return fallback;
		}

		return [...families]
			.sort((left, right) => left.localeCompare(right))
			.slice(0, MAX_DEVICE_FONTS);
	} catch {
		return fallback;
	}
}
