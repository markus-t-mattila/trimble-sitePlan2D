import type { Locale } from "./types";

const SUPPORTED_LOCALES: ReadonlyArray<Locale> = ["en", "fi"];
const DEFAULT_LOCALE: Locale = "en";

/**
 * Convert any IETF BCP-47 language tag (e.g. `fi-FI`, `en-US`, `sv-SE`,
 * `pt-BR`) into one of the locales the extension actually ships translations
 * for. Returns `null` when the tag is unrecognised or unsupported so the
 * caller can keep probing other sources before falling back to English.
 *
 * The match is case-insensitive and only looks at the primary subtag (the
 * region is ignored). This intentionally lumps `fi-FI` and `fi-SE` together —
 * we ship one Finnish translation, not regional variants.
 *
 * @param raw  candidate language code or `null`/`undefined`
 * @returns supported `Locale` or `null` when nothing matches
 */
export function normalizeLanguageTag(raw: string | null | undefined): Locale | null {
  if (!raw) return null;
  const primary = String(raw).trim().toLowerCase().split(/[-_]/)[0];
  if (!primary) return null;
  return SUPPORTED_LOCALES.includes(primary as Locale) ? (primary as Locale) : null;
}

/**
 * Result of locale detection. The caller is encouraged to surface `source`
 * in dev logs so misdetection is easy to diagnose.
 */
export interface DetectedLocale {
  locale: Locale;
  source: "workspace-user" | "workspace-project" | "navigator" | "default";
}

/**
 * Trimble Connect Workspace API user surface — typed permissively because
 * different runtime variants expose slightly different methods.
 *
 * The CANONICAL Trimble Connect path is `api.user.getCurrent()` returning
 * an object with `.language`. Older / variant runtimes have shipped
 * `getUserSettings()` and a couple of direct field exposures; we probe
 * them all in order so the detection works against every version we've
 * seen in the wild.
 */
export interface LocaleProbeApi {
  user?: {
    /** Canonical: returns `{ id, email, language, ... }`. */
    getCurrent?: () => Promise<{ language?: string | null; locale?: string | null } | null | undefined>
      | { language?: string | null; locale?: string | null } | null | undefined;
    /** Older runtime variant. */
    getUserSettings?: () => Promise<{ language?: string | null } | null | undefined>
      | { language?: string | null } | null | undefined;
    /** Legacy direct methods / fields (left in for defensive coverage). */
    getLanguage?: () => Promise<string | null | undefined> | string | null | undefined;
    getLocale?: () => Promise<string | null | undefined> | string | null | undefined;
    language?: string | null;
    locale?: string | null;
  };
  project?: {
    getCurrentProject?: () => Promise<unknown>;
  };
  extension?: {
    getLanguage?: () => Promise<string | null | undefined> | string | null | undefined;
  };
}

/**
 * Detect the active locale at boot.
 *
 * Probe order:
 *   1. `workspaceApi.user.getLanguage()` / `getLocale()` / static fields.
 *   2. `workspaceApi.extension.getLanguage()` (some host versions expose it).
 *   3. `navigator.language` (browser default).
 *   4. `"en"` fallback.
 *
 * Network errors / unexpected payloads in any probe are caught silently and
 * the detector moves on; one detection failure must never crash the app.
 *
 * @param workspaceApi  Workspace API instance, or `null` when running outside
 *                      the Trimble shell (e.g. local dev).
 * @returns the detected locale plus the source it was read from.
 */
export async function detectLocale(workspaceApi: LocaleProbeApi | null): Promise<DetectedLocale> {
  if (workspaceApi) {
    const fromWorkspaceUser = await readFromWorkspaceUser(workspaceApi);
    if (fromWorkspaceUser) return { locale: fromWorkspaceUser, source: "workspace-user" };

    const fromWorkspaceExtension = await readFromWorkspaceExtension(workspaceApi);
    if (fromWorkspaceExtension) return { locale: fromWorkspaceExtension, source: "workspace-project" };
  }

  const fromNavigator = readFromNavigator();
  if (fromNavigator) return { locale: fromNavigator, source: "navigator" };

  return { locale: DEFAULT_LOCALE, source: "default" };
}

async function readFromWorkspaceUser(api: LocaleProbeApi): Promise<Locale | null> {
  const userApi = api.user;
  if (!userApi || typeof userApi !== "object") return null;

  // Probe order matches what the trimble-sitedrive integration uses on
  // the same runtime: `user.getCurrent()` first (the canonical Trimble
  // Connect surface — returns `{ language: "fi", ... }`), then the
  // older `getUserSettings()`, then direct method / field variants we
  // saw in earlier runtime drops. The previous implementation only
  // probed the direct methods, none of which exist on the production
  // Workspace API — so detection silently fell through to
  // navigator.language and the Trimble user's chosen UI language was
  // ignored.
  const tagCandidates: ReadonlyArray<() => Promise<string | null | undefined> | string | null | undefined> = [
    async () => {
      if (typeof userApi.getCurrent !== "function") return null;
      const u = await Promise.resolve(userApi.getCurrent());
      // Some runtimes spell it `language`, others `locale`. Try both.
      return u?.language ?? u?.locale ?? null;
    },
    async () => {
      if (typeof userApi.getUserSettings !== "function") return null;
      const s = await Promise.resolve(userApi.getUserSettings());
      return s?.language ?? null;
    },
    () => (typeof userApi.getLanguage === "function" ? userApi.getLanguage() : null),
    () => (typeof userApi.getLocale === "function" ? userApi.getLocale() : null),
    () => userApi.language,
    () => userApi.locale,
  ];

  for (const candidate of tagCandidates) {
    try {
      const value = await Promise.resolve(candidate());
      const normalized = normalizeLanguageTag(typeof value === "string" ? value : null);
      if (normalized) return normalized;
    } catch {
      // Keep trying the next candidate; missing methods on some host variants
      // can throw rather than return undefined.
    }
  }
  return null;
}

async function readFromWorkspaceExtension(api: LocaleProbeApi): Promise<Locale | null> {
  const extensionApi = api.extension;
  if (!extensionApi || typeof extensionApi !== "object") return null;
  if (typeof extensionApi.getLanguage !== "function") return null;
  try {
    const value = await Promise.resolve(extensionApi.getLanguage());
    return normalizeLanguageTag(typeof value === "string" ? value : null);
  } catch {
    return null;
  }
}

function readFromNavigator(): Locale | null {
  if (typeof navigator === "undefined") return null;
  const primary = normalizeLanguageTag(navigator.language);
  if (primary) return primary;
  const list = (navigator as Navigator & { languages?: ReadonlyArray<string> }).languages;
  if (list) {
    for (const tag of list) {
      const normalized = normalizeLanguageTag(tag);
      if (normalized) return normalized;
    }
  }
  return null;
}
