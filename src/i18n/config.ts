/**
 * English is the structural source of truth for the locale files and the last
 * resort in the translation fallback chain, so it stays the base locale even
 * though Arabic is what the app opens with.
 */
export const BASE_LOCALE = "en" as const;

/**
 * Language the app starts in when the user has never picked one.
 * Arabic is the primary language of Recordly; a choice made in
 * Settings → Language is persisted in localStorage and always wins.
 */
export const DEFAULT_STARTUP_LOCALE = "ar" as const;

/**
 * Languages offered by the app. Recordly ships Arabic and English only:
 * Arabic is the default experience and English is the structural fallback.
 */
export const SUPPORTED_LOCALES = ["ar", "en"] as const;

export const I18N_NAMESPACES = [
	"common",
	"launch",
	"editor",
	"timeline",
	"settings",
	"dialogs",
	"shortcuts",
] as const;

export type AppLocale = (typeof SUPPORTED_LOCALES)[number];
export type I18nNamespace = (typeof I18N_NAMESPACES)[number];

/**
 * Scripts that are written right to left. Matched on the primary subtag, so
 * any regional variant ("ar-SA", "ar-EG", "he-IL", …) is covered.
 */
const RTL_LANGUAGE_SUBTAGS: ReadonlySet<string> = new Set(["ar", "fa", "he", "ur", "yi"]);

/** Whether the given locale tag must be rendered right to left. */
export function isRtlLocale(locale: string | null | undefined): boolean {
	if (!locale) return false;
	return RTL_LANGUAGE_SUBTAGS.has(locale.split("-")[0].toLowerCase());
}

/** `dir` attribute value for the given locale. */
export function getLocaleDirection(locale: string | null | undefined): "rtl" | "ltr" {
	return isRtlLocale(locale) ? "rtl" : "ltr";
}
