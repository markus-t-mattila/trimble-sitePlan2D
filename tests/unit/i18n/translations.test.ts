import { describe, expect, it } from "vitest";
import { en } from "../../../src/i18n/en";
import { fi } from "../../../src/i18n/fi";

/**
 * Structural parity test: every key that appears in the English translation
 * MUST also appear in the Finnish translation (and vice versa). This catches
 * forgotten translations long before they reach the UI.
 */
function collectKeys(value: unknown, prefix: string = ""): string[] {
  if (value === null || typeof value !== "object") return [prefix];
  const out: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const next = prefix ? `${prefix}.${key}` : key;
    out.push(...collectKeys(child, next));
  }
  return out;
}

describe("translations parity", () => {
  it("Finnish translations cover the same keys as English", () => {
    const enKeys = new Set(collectKeys(en));
    const fiKeys = new Set(collectKeys(fi));
    const missingFromFi: string[] = [];
    for (const key of enKeys) if (!fiKeys.has(key)) missingFromFi.push(key);
    expect(missingFromFi).toEqual([]);
    const missingFromEn: string[] = [];
    for (const key of fiKeys) if (!enKeys.has(key)) missingFromEn.push(key);
    expect(missingFromEn).toEqual([]);
  });

  it("every leaf translation is a non-empty string", () => {
    for (const [name, dictionary] of Object.entries({ en, fi })) {
      for (const key of collectKeys(dictionary)) {
        const value = key.split(".").reduce<unknown>((current, segment) => {
          if (current && typeof current === "object") return (current as Record<string, unknown>)[segment];
          return undefined;
        }, dictionary);
        expect(typeof value, `${name}.${key}`).toBe("string");
        expect((value as string).length, `${name}.${key}`).toBeGreaterThan(0);
      }
    }
  });
});
