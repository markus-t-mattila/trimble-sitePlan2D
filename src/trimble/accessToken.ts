/*
Access-token extraction helpers ported from
`/Users/mattilam/trimble-mass-editor/app/utils/accessToken.js`.

The Trimble Connect Workspace API can deliver an access token in several
different payload shapes depending on the runtime variant. These helpers
normalize that variability so callers can rely on one stable contract.
*/

import { asRecord, normalizeToOptionalString } from "./internal";

const PERMISSION_STATUS_PENDING = "pending";
const PERMISSION_STATUS_DENIED = "denied";
const KNOWN_PERMISSION_STATUSES: ReadonlySet<string> = new Set([
  PERMISSION_STATUS_PENDING,
  PERMISSION_STATUS_DENIED,
]);

export type AccessTokenPermissionStatus = "pending" | "denied";

/**
 * Extract an access token from one of the many Workspace API response/event
 * shapes. Returns `null` when no usable token is found.
 *
 * Lookup order:
 * 1. Direct string payload.
 * 2. Top-level `token` / `accessToken` / `data` / `payload` / `value`.
 * 3. Nested `data.token`, `data.accessToken`, `payload.token`, `payload.accessToken`.
 *
 * Bare permission-status strings ("pending", "denied") are intentionally
 * filtered out so they are never used as bearer tokens.
 */
export function extractAccessTokenFromPayload(payload: unknown): string | null {
  const directStringPayload = toOptionalTokenString(payload);
  if (directStringPayload) {
    return directStringPayload;
  }

  const candidatePayload = asRecord(payload);

  const directCandidates: ReadonlyArray<unknown> = [
    candidatePayload["token"],
    candidatePayload["accessToken"],
    candidatePayload["data"],
    candidatePayload["payload"],
    candidatePayload["value"],
  ];

  for (const directCandidate of directCandidates) {
    const normalizedDirectCandidate = toOptionalTokenString(directCandidate);
    if (normalizedDirectCandidate) {
      return normalizedDirectCandidate;
    }
  }

  const nestedData = asRecord(candidatePayload["data"]);
  const nestedPayload = asRecord(candidatePayload["payload"]);

  const nestedCandidates: ReadonlyArray<unknown> = [
    nestedData["token"],
    nestedData["accessToken"],
    nestedPayload["token"],
    nestedPayload["accessToken"],
  ];

  for (const nestedCandidate of nestedCandidates) {
    const normalizedNestedCandidate = toOptionalTokenString(nestedCandidate);
    if (normalizedNestedCandidate) {
      return normalizedNestedCandidate;
    }
  }

  return null;
}

/**
 * Extract the Workspace permission status value (`pending` / `denied`) from
 * permission responses or extension access-token event payloads.
 */
export function extractAccessTokenPermissionStatus(
  payload: unknown,
): AccessTokenPermissionStatus | null {
  const candidatePayload = asRecord(payload);
  const nestedData = asRecord(candidatePayload["data"]);
  const nestedPayload = asRecord(candidatePayload["payload"]);

  const statusCandidates: ReadonlyArray<unknown> = [
    payload,
    candidatePayload["status"],
    candidatePayload["data"],
    candidatePayload["payload"],
    candidatePayload["value"],
    nestedData["status"],
    nestedPayload["status"],
  ];

  for (const statusCandidate of statusCandidates) {
    const normalizedStatus = toOptionalPermissionStatus(statusCandidate);
    if (normalizedStatus) {
      return normalizedStatus;
    }
  }

  return null;
}

/*
Module-level access token cache.

A single in-memory slot is enough because every browser tab hosts exactly one
extension instance and access tokens are scoped to that single host frame.
*/
let cachedAccessToken: string | null = null;

/**
 * Cache the most recently observed access token so callers can retrieve it
 * without re-issuing a Workspace permission request.
 */
export function setCachedAccessToken(token: string | null): void {
  const normalized = normalizeToOptionalString(token);
  cachedAccessToken = normalized;
}

/**
 * Read the cached access token, or `null` when none has been observed yet.
 */
export function getCachedAccessToken(): string | null {
  return cachedAccessToken;
}

/**
 * Clear the cached access token. Useful when the host signals an explicit
 * revocation, or in tests between cases.
 */
export function clearCachedAccessToken(): void {
  cachedAccessToken = null;
}

/**
 * Update the access token cache from a Workspace event payload. Returns the
 * token that was cached, or `null` when no usable token was present.
 */
export function updateAccessTokenCacheFromEvent(payload: unknown): string | null {
  const token = extractAccessTokenFromPayload(payload);
  if (token) {
    cachedAccessToken = token;
    return token;
  }
  return cachedAccessToken;
}

/**
 * Normalize a candidate string into a usable bearer token, filtering out
 * permission status values and stripping any leading "Bearer " prefix so we
 * never accidentally emit "Bearer Bearer <token>" downstream.
 */
function toOptionalTokenString(candidateValue: unknown): string | null {
  if (typeof candidateValue !== "string") {
    return null;
  }

  const normalizedValue = normalizeToOptionalString(candidateValue);
  if (!normalizedValue) {
    return null;
  }

  if (KNOWN_PERMISSION_STATUSES.has(normalizedValue.toLowerCase())) {
    return null;
  }

  if (normalizedValue.toLowerCase().startsWith("bearer ")) {
    return normalizeToOptionalString(normalizedValue.slice(7));
  }

  return normalizedValue;
}

/**
 * Normalize a candidate string into a known permission status, or `null`.
 */
function toOptionalPermissionStatus(
  candidateValue: unknown,
): AccessTokenPermissionStatus | null {
  if (typeof candidateValue !== "string") {
    return null;
  }

  const normalizedValue = normalizeToOptionalString(candidateValue)?.toLowerCase() ?? "";
  if (!KNOWN_PERMISSION_STATUSES.has(normalizedValue)) {
    return null;
  }

  return normalizedValue as AccessTokenPermissionStatus;
}
