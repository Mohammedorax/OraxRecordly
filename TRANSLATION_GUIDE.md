# Translation Guide

This project uses a namespace-based i18n setup so contributors can localize safely without changing app logic.

## Locale Files

All locale files live under `src/i18n/locales/<locale>/`, one directory per language.
OraxRecordly ships **exactly two** languages:

- `ar/` — Arabic (right-to-left, the default startup language)
- `en/` — English (source of truth for key structure)

`SUPPORTED_LOCALES` in `src/i18n/config.ts` lists them in picker order, and
`DEFAULT_STARTUP_LOCALE` selects the one a fresh install opens with. Anything not
listed there is dead weight in the renderer bundle, because every locale is
statically imported.

Each locale has the same namespace files:

- `common.json`
- `launch.json`
- `editor.json`
- `timeline.json`
- `settings.json`
- `dialogs.json`
- `shortcuts.json`

English (`en`) is the source of truth for key structure.

## Key Rules

- Keep the same key paths across locales.
- Do not rename existing keys unless coordinated with code changes.
- Add new keys to `en` first, then mirror into the other locale (`ar`). There are
  only two locales, so every new key must exist in both.
- Prefer descriptive, stable keys. Example: `app.editorTitle`.
- Interpolation is supported with `{{name}}` style placeholders.

## How Translation Is Read

- Keys with a namespace prefix like `settings.export.title` use that namespace.
- Keys without a namespace default to `common`.
- Missing translations fall back to English, then to the provided fallback string, then to the key.

## Registering A Locale

Adding a directory under `src/i18n/locales/` is **not** enough — `i18n:check` only
validates key parity and does not know about the language picker. A new locale
must also be registered in three places, all of which are TypeScript-enforced:

1. `src/i18n/config.ts` — add the tag to `SUPPORTED_LOCALES` (its position is the
   order shown in the language picker).
2. `src/contexts/I18nContext.tsx` — add the seven static JSON imports and the
   matching entry in the `messages` map.
3. `src/components/video-editor/SettingsPanel.tsx` — add the endonym (the
   language's own name, e.g. `العربية`) to `APP_LANGUAGE_LABELS`.

`npm run typecheck` fails until all three are updated.

## Default Language And Direction

- `DEFAULT_STARTUP_LOCALE` in `src/i18n/config.ts` is the language the app opens
  with when the user has never chosen one. It is currently `ar`.
- `BASE_LOCALE` (`en`) remains the structural source of truth and the terminal
  fallback for any key missing from the active locale.
- A choice made in Settings → Language is stored in `localStorage` under
  `recordly.locale` and always overrides the startup default.

Right-to-left languages are declared by `isRtlLocale()` / `getLocaleDirection()`
in `src/i18n/config.ts`. The active locale is written to `<html lang>` and
`<html dir>`, which mirrors the whole UI because the Tailwind utilities in use
are logical (`ps-`/`pe-`/`ms-`/`me-`/`start-`/`end-`). Two consequences for
translators and contributors:

- Prefer logical utilities over physical ones (`ps-4`, not `pl-4`) so a string
  added to a new component mirrors automatically.
- Never add `letter-spacing` to Arabic text: Arabic is a connected script and
  tracking breaks the joins.
- The video timeline is deliberately pinned to `dir="ltr"` (`TimelineWrapper`)
  because time-based surfaces stay left-to-right in professional video editors,
  even in RTL locales.

## Validate Locale Structure

Run:

```bash
npm run i18n:check
```

This checks for:

- Missing namespace files
- Missing keys compared to `en`
- Extra keys not present in `en`

## Contributor Workflow

1. Pull latest `main`.
2. Update `en/<namespace>.json` with new keys if needed.
3. Add matching keys to other locale files.
4. Run `npm run i18n:check`.
5. Run app locally (`npm run dev`) and spot-check UI text.
6. Open PR with a short summary of changed namespaces.

## Scope Notes

Current framework is app-wide and ready for full localization rollout.
Not every UI string is migrated yet. Migration should be done incrementally by namespace to keep PRs reviewable and low-risk.
