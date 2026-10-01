/**
 * Locale-aware formatting for user-visible values.
 *
 * The app's active locale drives month names, date order and separators, but the
 * numbering system is always pinned to Latin digits: Arabic's default numbering
 * system is Arabic-Indic (`٣٠/١٠`), which makes dates, durations and file sizes
 * noticeably harder to scan in this UI.
 */

/** Intl option that pins the numbering system to Western Arabic (Latin) digits. */
export const LATIN_NUMBERING_SYSTEM = { numberingSystem: "latn" } as const;

/**
 * `Date#toLocaleDateString` bound to the active locale, rendered with Latin
 * digits (e.g. `ar` gives `٣٠ أكتوبر` without this and `30 أكتوبر` with it).
 *
 * Only for user-visible strings — never use the result for comparison, sorting
 * or persistence, because the text changes with the locale.
 */
export function formatLocaleDate(
	date: Date | number | string,
	locale: string,
	options?: Intl.DateTimeFormatOptions,
): string {
	return new Date(date).toLocaleDateString(locale, {
		...options,
		...LATIN_NUMBERING_SYSTEM,
	});
}
