/*
Internal helpers used by the Trimble Connect API clients.

These mirror the small string/error utilities from the reference project's
`app/utils/common.js` but are kept private to the `src/trimble` folder — they
are not part of the public API of the trimble module and must not be re-exported
from `src/trimble/index.ts`.
*/

/**
 * Check whether a value is a non-empty string after trimming whitespace.
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Convert any scalar into a trimmed string and return `null` when the result
 * is empty. Keeps identifier handling explicit and predictable.
 */
export function normalizeToOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalizedValue = String(value).trim();
  return normalizedValue === "" ? null : normalizedValue;
}

/**
 * Normalize an unknown error value into a single human-readable message
 * suitable for diagnostic logs and UI banners.
 */
export function toErrorMessage(
  errorCandidate: unknown,
  fallbackMessage: string = "Unknown error",
): string {
  if (errorCandidate instanceof Error && isNonEmptyString(errorCandidate.message)) {
    return errorCandidate.message;
  }

  if (isNonEmptyString(errorCandidate)) {
    return errorCandidate.trim();
  }

  if (errorCandidate && typeof errorCandidate === "object") {
    const candidateRecord = errorCandidate as Record<string, unknown>;
    const nestedMessage = normalizeToOptionalString(
      candidateRecord["message"] ?? candidateRecord["details"] ?? candidateRecord["error"],
    );
    if (nestedMessage) {
      return nestedMessage;
    }
  }

  return fallbackMessage;
}

/**
 * Safely encode a path parameter that may contain reserved URL characters.
 */
export function encodePathSegment(value: unknown): string {
  return encodeURIComponent(String(value ?? ""));
}

/**
 * Pick the first non-empty string candidate from an ordered list.
 */
export function pickFirstNonEmptyString(candidates: ReadonlyArray<unknown>): string | null {
  for (const candidateValue of candidates) {
    const normalizedValue = normalizeToOptionalString(candidateValue);
    if (normalizedValue) {
      return normalizedValue;
    }
  }
  return null;
}

/**
 * Treat a value as a plain object record when it is a non-null object,
 * otherwise return an empty record. This keeps narrowing concise at call
 * sites without sprinkling `as` assertions everywhere.
 */
export function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return {};
}

/**
 * Read a property from an unknown value, returning `undefined` when the
 * input is not an object. Helps drill into heterogeneous API payloads
 * without intermediate `as` casts.
 */
export function getProp(value: unknown, key: string): unknown {
  if (value && typeof value === "object") {
    return (value as Record<string, unknown>)[key];
  }
  return undefined;
}
