import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { I18nProvider as AriaI18nProvider } from "react-aria";
import {
	type AppLocale,
	BASE_LOCALE,
	DEFAULT_STARTUP_LOCALE,
	getLocaleDirection,
	I18N_NAMESPACES,
	type I18nNamespace,
	SUPPORTED_LOCALES,
} from "@/i18n/config";
import arCommon from "@/i18n/locales/ar/common.json";
import arDialogs from "@/i18n/locales/ar/dialogs.json";
import arEditor from "@/i18n/locales/ar/editor.json";
import arLaunch from "@/i18n/locales/ar/launch.json";
import arSettings from "@/i18n/locales/ar/settings.json";
import arShortcuts from "@/i18n/locales/ar/shortcuts.json";
import arTimeline from "@/i18n/locales/ar/timeline.json";
import enCommon from "@/i18n/locales/en/common.json";
import enDialogs from "@/i18n/locales/en/dialogs.json";
import enEditor from "@/i18n/locales/en/editor.json";
import enLaunch from "@/i18n/locales/en/launch.json";
import enSettings from "@/i18n/locales/en/settings.json";
import enShortcuts from "@/i18n/locales/en/shortcuts.json";
import enTimeline from "@/i18n/locales/en/timeline.json";

const LOCALE_STORAGE_KEY = "recordly.locale";

type LocaleBundle = Record<I18nNamespace, Record<string, unknown>>;

const messages: Record<AppLocale, LocaleBundle> = {
	ar: {
		common: arCommon,
		launch: arLaunch,
		editor: arEditor,
		timeline: arTimeline,
		settings: arSettings,
		dialogs: arDialogs,
		shortcuts: arShortcuts,
	},
	en: {
		common: enCommon,
		launch: enLaunch,
		editor: enEditor,
		timeline: enTimeline,
		settings: enSettings,
		dialogs: enDialogs,
		shortcuts: enShortcuts,
	},
} as const;

interface I18nContextValue {
	locale: AppLocale;
	setLocale: (locale: AppLocale) => void;
	t: (key: string, fallback?: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function isSupportedLocale(locale: string): locale is AppLocale {
	return SUPPORTED_LOCALES.includes(locale as AppLocale);
}

function normalizeLocale(locale: string | null | undefined): AppLocale {
	if (!locale) {
		return BASE_LOCALE;
	}

	// Exact match first (e.g. "en").
	if (isSupportedLocale(locale)) return locale;

	// Canonicalize case (e.g. "EN" → "en").
	const canonical = SUPPORTED_LOCALES.find((l) => l.toLowerCase() === locale.toLowerCase());
	if (canonical) return canonical;

	// Language-only fallback (e.g. "ar-SA" matches "ar").
	const lang = locale.split("-")[0].toLowerCase();
	const byLang = SUPPORTED_LOCALES.find((l) => l.split("-")[0].toLowerCase() === lang);
	if (byLang) return byLang;

	return BASE_LOCALE;
}

/**
 * Locale to boot with: an explicit choice made in Settings always wins; a fresh
 * install opens in Arabic (DEFAULT_STARTUP_LOCALE).
 *
 * Exported so `src/main.tsx` can seed `<html lang>` / `<html dir>` before the
 * first React render and avoid a flash of the wrong direction.
 */
export function getInitialLocale(): AppLocale {
	if (typeof window === "undefined") {
		return DEFAULT_STARTUP_LOCALE;
	}

	const storedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY);
	if (storedLocale) {
		return normalizeLocale(storedLocale);
	}

	return DEFAULT_STARTUP_LOCALE;
}

/** Apply the locale's language and writing direction to the document element. */
function applyDocumentLocale(locale: AppLocale) {
	if (typeof document === "undefined") return;
	const root = document.documentElement;
	root.lang = locale;
	root.dir = getLocaleDirection(locale);
}

function getMessageValue(source: unknown, key: string): string | undefined {
	const parts = key.split(".");
	let current: unknown = source;

	for (const part of parts) {
		if (!current || typeof current !== "object" || !(part in current)) {
			return undefined;
		}

		current = (current as Record<string, unknown>)[part];
	}

	return typeof current === "string" ? current : undefined;
}

function interpolate(template: string, vars?: Record<string, string | number>) {
	if (!vars) return template;
	return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
		const value = vars[key];
		return value === undefined ? "" : String(value);
	});
}

function parseKey(key: string): { namespace: I18nNamespace; path: string } {
	const [first, ...rest] = key.split(".");
	if (I18N_NAMESPACES.includes(first as I18nNamespace) && rest.length > 0) {
		return { namespace: first as I18nNamespace, path: rest.join(".") };
	}
	return { namespace: "common", path: key };
}

function translateForLocale(
	locale: AppLocale,
	key: string,
	fallback?: string,
	vars?: Record<string, string | number>,
) {
	const { namespace, path } = parseKey(key);

	const rawValue =
		getMessageValue(messages[locale][namespace], path) ??
		getMessageValue(messages[BASE_LOCALE][namespace], path) ??
		fallback ??
		key;

	return interpolate(rawValue, vars);
}

/**
 * Translate outside React. Module-level callers such as the toast helper have
 * no hook to read the provider from, so they resolve the active locale the same
 * way the provider boots: from the choice persisted by `setLocale` in
 * localStorage, falling back to the startup default.
 */
export function translateForActiveLocale(
	key: string,
	fallback?: string,
	vars?: Record<string, string | number>,
): string {
	return translateForLocale(getInitialLocale(), key, fallback, vars);
}

export function I18nProvider({ children }: { children: ReactNode }) {
	const [locale, setLocaleState] = useState<AppLocale>(getInitialLocale);

	const setLocale = useCallback((nextLocale: AppLocale) => {
		setLocaleState(nextLocale);
		if (typeof window !== "undefined") {
			window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
		}
	}, []);

	useEffect(() => {
		applyDocumentLocale(locale);
	}, [locale]);

	const t = useCallback(
		(key: string, fallback?: string, vars?: Record<string, string | number>) => {
			return translateForLocale(locale, key, fallback, vars);
		},
		[locale],
	);

	const value = useMemo<I18nContextValue>(
		() => ({
			locale,
			setLocale,
			t,
		}),
		[locale, setLocale, t],
	);

	return (
		<I18nContext.Provider value={value}>
			{/*
			 * react-aria (used by the HeroUI controls) resolves its own locale
			 * and writing direction from `navigator.language`, not from the app
			 * language. Binding it to our locale keeps widgets such as tabs,
			 * selects and calendars in sync with the RTL/LTR choice.
			 */}
			<AriaI18nProvider locale={locale}>{children}</AriaI18nProvider>
		</I18nContext.Provider>
	);
}

export function useI18n() {
	const context = useContext(I18nContext);
	if (!context) {
		throw new Error("useI18n must be used within <I18nProvider>");
	}
	return context;
}

export function useScopedT(namespace: I18nNamespace) {
	const { t } = useI18n();
	return useCallback(
		(key: string, fallback?: string, vars?: Record<string, string | number>) => {
			return t(`${namespace}.${key}`, fallback, vars);
		},
		[namespace, t],
	);
}
