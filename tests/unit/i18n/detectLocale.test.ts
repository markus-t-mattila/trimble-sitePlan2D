import { describe, expect, it, vi } from "vitest";
import { detectLocale, normalizeLanguageTag } from "../../../src/i18n/detectLocale";

describe("normalizeLanguageTag", () => {
  it("strips region tags and accepts supported languages", () => {
    expect(normalizeLanguageTag("fi-FI")).toBe("fi");
    expect(normalizeLanguageTag("en_US")).toBe("en");
    expect(normalizeLanguageTag("FI")).toBe("fi");
  });

  it("returns null for unsupported or empty tags", () => {
    expect(normalizeLanguageTag(null)).toBeNull();
    expect(normalizeLanguageTag(undefined)).toBeNull();
    expect(normalizeLanguageTag("")).toBeNull();
    expect(normalizeLanguageTag("sv-SE")).toBeNull();
    expect(normalizeLanguageTag("xx")).toBeNull();
  });
});

describe("detectLocale", () => {
  it("falls back to the default when no workspace and no navigator", async () => {
    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", { value: undefined, configurable: true });
    try {
      const result = await detectLocale(null);
      expect(result.locale).toBe("en");
      expect(result.source).toBe("default");
    } finally {
      Object.defineProperty(globalThis, "navigator", { value: originalNavigator, configurable: true });
    }
  });

  it("reads from workspaceApi.user.getCurrent() — the canonical Trimble Connect surface", async () => {
    // This is the API shape the real Trimble Connect runtime exposes
    // (`api.user.getCurrent()` returns `{ language, ... }`). The
    // earlier detector only probed legacy `user.getLanguage()` and
    // friends, none of which the production runtime exposes — so
    // Finnish users were silently getting the English UI.
    const api = {
      user: {
        getCurrent: vi.fn(async () => ({ id: "u1", email: "a@b.c", language: "fi" })),
      },
    };
    const result = await detectLocale(api);
    expect(result.locale).toBe("fi");
    expect(result.source).toBe("workspace-user");
    expect(api.user.getCurrent).toHaveBeenCalledOnce();
  });

  it("falls back to user.getUserSettings() for older runtimes", async () => {
    const api = {
      user: {
        getUserSettings: vi.fn(async () => ({ language: "fi-FI" })),
      },
    };
    const result = await detectLocale(api);
    expect(result.locale).toBe("fi");
    expect(result.source).toBe("workspace-user");
  });

  it("still reads legacy workspaceApi.user.getLanguage when present", async () => {
    const api = {
      user: {
        getLanguage: vi.fn(async () => "fi-FI"),
      },
    };
    const result = await detectLocale(api);
    expect(result.locale).toBe("fi");
    expect(result.source).toBe("workspace-user");
    expect(api.user.getLanguage).toHaveBeenCalledOnce();
  });

  it("reads from workspaceApi.extension.getLanguage as a secondary source", async () => {
    const api = {
      user: {},
      extension: {
        getLanguage: vi.fn(async () => "FI"),
      },
    };
    const result = await detectLocale(api);
    expect(result.locale).toBe("fi");
    expect(result.source).toBe("workspace-project");
  });

  it("ignores host probe errors and falls through", async () => {
    const api = {
      user: {
        getLanguage: () => {
          throw new Error("not supported");
        },
      },
      extension: {
        getLanguage: () => {
          throw new Error("not supported either");
        },
      },
    };
    const result = await detectLocale(api);
    // No workspace + jsdom navigator returns "en" by default. Just assert
    // we got a known locale rather than an exception.
    expect(["en", "fi"]).toContain(result.locale);
  });
});
