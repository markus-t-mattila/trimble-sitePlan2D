import { createContext, createElement, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { en } from "./en";
import { fi } from "./fi";
import type { Locale, Translations } from "./types";

/**
 * Map of locale code -> translation object. Add a new locale by importing it
 * here; the type-checker enforces that every locale satisfies `Translations`.
 */
export const TRANSLATIONS: Readonly<Record<Locale, Translations>> = Object.freeze({ en, fi });

interface LocaleContextValue {
  locale: Locale;
  t: Translations;
  setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

interface LocaleProviderProps {
  initialLocale: Locale;
  children: ReactNode;
}

/**
 * Provides the active translations + a setter to all descendants. The
 * provider is intentionally minimal — translations are static objects, so
 * switching the locale is just a state update.
 */
export function LocaleProvider({ initialLocale, children }: LocaleProviderProps): JSX.Element {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const setLocale = useCallback((next: Locale) => setLocaleState(next), []);
  const value = useMemo<LocaleContextValue>(
    () => ({ locale, t: TRANSLATIONS[locale], setLocale }),
    [locale, setLocale],
  );
  return createElement(LocaleContext.Provider, { value }, children);
}

/**
 * Read the active translations. Throws if called outside a `LocaleProvider`
 * so missing providers fail loudly instead of silently rendering English.
 */
export function useTranslations(): Translations {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useTranslations must be used inside a <LocaleProvider>.");
  return ctx.t;
}

/**
 * Read the active locale code (e.g. `"fi"`). Use this when you need to make a
 * branching decision based on the user's language rather than fetching copy.
 */
export function useLocale(): Locale {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used inside a <LocaleProvider>.");
  return ctx.locale;
}

/**
 * Switch the active locale at runtime. Re-renders every consumer of
 * `useTranslations`.
 */
export function useSetLocale(): (locale: Locale) => void {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useSetLocale must be used inside a <LocaleProvider>.");
  return ctx.setLocale;
}

export type { Locale, Translations } from "./types";
export { detectLocale, normalizeLanguageTag } from "./detectLocale";
export type { DetectedLocale, LocaleProbeApi } from "./detectLocale";
