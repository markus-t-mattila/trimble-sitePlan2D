# Localization

The extension ships with English (`en`) and Finnish (`fi`). The active
locale is auto-detected at boot from the Trimble Connect user profile;
there is no manual override surface — the host locale is the single
source of truth.

## Detection order

`src/i18n/detectLocale.ts` probes in this sequence; the first non-null
candidate wins.

1. `workspaceApi.user.getLanguage()` / `getLocale()` / static `language`/
   `locale` fields on `workspaceApi.user`.
2. `workspaceApi.extension.getLanguage()` (only present in some host
   versions).
3. `navigator.language`, then `navigator.languages[]`.
4. `"en"` fallback.

Any candidate that throws or returns an unsupported tag is silently
ignored — one host probe failure must never crash the app.

Detection runs **twice**: once at boot from `navigator.language` only (so
the splash already uses the right language), and once again after
`connectWorkspaceApi()` resolves, with the live Workspace API as input. The
second pass overrides the first if the host's locale differs.

## File layout

```
src/i18n/
├─ types.ts          # Translations interface — source of truth for keys
├─ en.ts             # English copy, must satisfy `Translations`
├─ fi.ts             # Finnish copy, must satisfy `Translations`
├─ detectLocale.ts   # detectLocale(), normalizeLanguageTag()
└─ index.ts          # LocaleProvider, useTranslations, useLocale, useSetLocale
```

`Translations` is a typed interface — adding a copy entry to English without
translating it to Finnish is a **compile error**, not a runtime surprise.
The `tests/unit/i18n/translations.test.ts` parity test enforces this.

## Adding a new locale

1. Add the code to the `Locale` union in `src/i18n/types.ts`.
2. Create `src/i18n/<code>.ts` that exports an object satisfying
   `Translations`.
3. Register it in `TRANSLATIONS` in `src/i18n/index.ts`.
4. Make sure the host-language tag for the new locale is covered by
   `normalizeLanguageTag()` in `src/i18n/detectLocale.ts` (the probe
   order above is what selects the active value at boot).
5. Run `npm test` — the parity test will tell you if any copy is missing.

## Adding a new copy entry

1. Add the key to `Translations` in `src/i18n/types.ts`.
2. Add the English value to `src/i18n/en.ts`.
3. The compiler will refuse to build until you've added the value to every
   other locale file.
4. Use the entry from a component via `const t = useTranslations(); … {t.x.y}`.

## Why no i18n framework?

The full string set is small (a few dozen entries), translations are
static, and pluralisation is trivial in both English and Finnish. A
dedicated framework (i18next, FormatJS) would be more overhead than value
at this scale. If pluralisation or message formatting ever becomes a need,
swap `Translations` for a function map — every call site already routes
through `useTranslations()`.
