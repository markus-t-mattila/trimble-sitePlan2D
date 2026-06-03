import { describe, it, expect, beforeEach } from "vitest";

import {
  clearCachedAccessToken,
  extractAccessTokenFromPayload,
  extractAccessTokenPermissionStatus,
  getCachedAccessToken,
  setCachedAccessToken,
  updateAccessTokenCacheFromEvent,
} from "../../../src/trimble/accessToken";

describe("extractAccessTokenFromPayload", () => {
  it("returns null for nullish input", () => {
    expect(extractAccessTokenFromPayload(null)).toBeNull();
    expect(extractAccessTokenFromPayload(undefined)).toBeNull();
  });

  it("returns the value when payload is a bare token string", () => {
    expect(extractAccessTokenFromPayload("eyJhbGc.payload.sig")).toBe(
      "eyJhbGc.payload.sig",
    );
  });

  it("trims surrounding whitespace from a bare token string", () => {
    expect(extractAccessTokenFromPayload("  token-with-padding  ")).toBe(
      "token-with-padding",
    );
  });

  it("strips a leading 'Bearer ' prefix", () => {
    expect(extractAccessTokenFromPayload("Bearer my-token")).toBe("my-token");
    expect(extractAccessTokenFromPayload("bearer my-token")).toBe("my-token");
  });

  it("filters out bare permission-status strings", () => {
    expect(extractAccessTokenFromPayload("pending")).toBeNull();
    expect(extractAccessTokenFromPayload("denied")).toBeNull();
    expect(extractAccessTokenFromPayload("DENIED")).toBeNull();
  });

  it("reads token from top-level `token` field", () => {
    expect(extractAccessTokenFromPayload({ token: "abc" })).toBe("abc");
  });

  it("reads token from top-level `accessToken` field", () => {
    expect(extractAccessTokenFromPayload({ accessToken: "def" })).toBe("def");
  });

  it("reads token from top-level `data` (when scalar string)", () => {
    expect(extractAccessTokenFromPayload({ data: "from-data" })).toBe("from-data");
  });

  it("reads token from top-level `payload` (when scalar string)", () => {
    expect(extractAccessTokenFromPayload({ payload: "from-payload" })).toBe(
      "from-payload",
    );
  });

  it("reads token from top-level `value` (when scalar string)", () => {
    expect(extractAccessTokenFromPayload({ value: "from-value" })).toBe("from-value");
  });

  it("reads token from nested `data.token`", () => {
    expect(extractAccessTokenFromPayload({ data: { token: "nested-data" } })).toBe(
      "nested-data",
    );
  });

  it("reads token from nested `data.accessToken`", () => {
    expect(
      extractAccessTokenFromPayload({ data: { accessToken: "nested-data-2" } }),
    ).toBe("nested-data-2");
  });

  it("reads token from nested `payload.token`", () => {
    expect(
      extractAccessTokenFromPayload({ payload: { token: "nested-payload" } }),
    ).toBe("nested-payload");
  });

  it("reads token from nested `payload.accessToken`", () => {
    expect(
      extractAccessTokenFromPayload({ payload: { accessToken: "nested-payload-2" } }),
    ).toBe("nested-payload-2");
  });

  it("returns null when no token-bearing field is present", () => {
    expect(extractAccessTokenFromPayload({ foo: "bar" })).toBeNull();
    expect(extractAccessTokenFromPayload({})).toBeNull();
  });

  it("returns null when nested `data` is a non-string object without token", () => {
    expect(extractAccessTokenFromPayload({ data: { unrelated: 123 } })).toBeNull();
  });

  it("prefers top-level token over nested fields", () => {
    expect(
      extractAccessTokenFromPayload({
        token: "top",
        data: { token: "nested" },
      }),
    ).toBe("top");
  });

  it("returns null when token field holds a permission status", () => {
    expect(extractAccessTokenFromPayload({ token: "pending" })).toBeNull();
    expect(extractAccessTokenFromPayload({ accessToken: "denied" })).toBeNull();
  });
});

describe("extractAccessTokenPermissionStatus", () => {
  it("returns null for nullish input", () => {
    expect(extractAccessTokenPermissionStatus(null)).toBeNull();
    expect(extractAccessTokenPermissionStatus(undefined)).toBeNull();
  });

  it("returns a bare 'pending' / 'denied' string", () => {
    expect(extractAccessTokenPermissionStatus("pending")).toBe("pending");
    expect(extractAccessTokenPermissionStatus("denied")).toBe("denied");
    expect(extractAccessTokenPermissionStatus("DENIED")).toBe("denied");
  });

  it("returns null for non-status strings", () => {
    expect(extractAccessTokenPermissionStatus("granted")).toBeNull();
    expect(extractAccessTokenPermissionStatus("some-token-value")).toBeNull();
  });

  it("reads status from top-level fields", () => {
    expect(extractAccessTokenPermissionStatus({ status: "pending" })).toBe("pending");
    expect(extractAccessTokenPermissionStatus({ data: "denied" })).toBe("denied");
    expect(extractAccessTokenPermissionStatus({ payload: "pending" })).toBe("pending");
    expect(extractAccessTokenPermissionStatus({ value: "denied" })).toBe("denied");
  });

  it("reads status from nested data/payload `.status`", () => {
    expect(
      extractAccessTokenPermissionStatus({ data: { status: "pending" } }),
    ).toBe("pending");
    expect(
      extractAccessTokenPermissionStatus({ payload: { status: "denied" } }),
    ).toBe("denied");
  });

  it("returns null when no status candidate matches", () => {
    expect(extractAccessTokenPermissionStatus({ foo: "bar" })).toBeNull();
    expect(extractAccessTokenPermissionStatus({ token: "abc" })).toBeNull();
  });
});

describe("access token cache", () => {
  beforeEach(() => {
    clearCachedAccessToken();
  });

  it("starts empty", () => {
    expect(getCachedAccessToken()).toBeNull();
  });

  it("stores and reads back a token", () => {
    setCachedAccessToken("hello");
    expect(getCachedAccessToken()).toBe("hello");
  });

  it("clearCachedAccessToken empties the slot", () => {
    setCachedAccessToken("hello");
    clearCachedAccessToken();
    expect(getCachedAccessToken()).toBeNull();
  });

  it("setCachedAccessToken(null) empties the slot", () => {
    setCachedAccessToken("hello");
    setCachedAccessToken(null);
    expect(getCachedAccessToken()).toBeNull();
  });

  it("updateAccessTokenCacheFromEvent extracts and caches", () => {
    const cached = updateAccessTokenCacheFromEvent({
      data: { accessToken: "tok-from-event" },
    });
    expect(cached).toBe("tok-from-event");
    expect(getCachedAccessToken()).toBe("tok-from-event");
  });

  it("updateAccessTokenCacheFromEvent keeps existing cache when payload has no token", () => {
    setCachedAccessToken("previous");
    const result = updateAccessTokenCacheFromEvent({ status: "pending" });
    expect(result).toBe("previous");
    expect(getCachedAccessToken()).toBe("previous");
  });
});
