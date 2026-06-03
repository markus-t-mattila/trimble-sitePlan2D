import { describe, it, expect } from "vitest";

import { normalizeWorkspaceEventArguments } from "../../../src/trimble/workspaceClient";

describe("normalizeWorkspaceEventArguments — legacy (eventName, eventArgs) shape", () => {
  it("preserves an object event-args record", () => {
    const result = normalizeWorkspaceEventArguments([
      "extension.accessToken",
      { accessToken: "abc" },
    ]);
    expect(result).toEqual({
      eventName: "extension.accessToken",
      eventArgs: { accessToken: "abc" },
    });
  });

  it("wraps a scalar second argument under `data`", () => {
    const result = normalizeWorkspaceEventArguments(["some.event", "scalar-value"]);
    expect(result).toEqual({
      eventName: "some.event",
      eventArgs: { data: "scalar-value" },
    });
  });

  it("emits an empty event-args object when the second argument is undefined", () => {
    const result = normalizeWorkspaceEventArguments(["some.event", undefined]);
    expect(result).toEqual({
      eventName: "some.event",
      eventArgs: {},
    });
  });

  it("treats a null second argument as scalar and wraps it under `data`", () => {
    const result = normalizeWorkspaceEventArguments(["some.event", null]);
    expect(result).toEqual({
      eventName: "some.event",
      eventArgs: { data: null },
    });
  });
});

describe("normalizeWorkspaceEventArguments — single-object {type, data} shape", () => {
  it("normalizes `{ type, data }` to canonical pair", () => {
    const result = normalizeWorkspaceEventArguments([
      { type: "extension.accessToken", data: { token: "abc" } },
    ]);
    expect(result).toEqual({
      eventName: "extension.accessToken",
      eventArgs: { data: { token: "abc" } },
    });
  });

  it("accepts `event` as an alias of `type`", () => {
    const result = normalizeWorkspaceEventArguments([
      { event: "extension.command", data: { command: "click" } },
    ]);
    expect(result).toEqual({
      eventName: "extension.command",
      eventArgs: { data: { command: "click" } },
    });
  });

  it("accepts `name` as an alias of `type`", () => {
    const result = normalizeWorkspaceEventArguments([
      { name: "extension.accessToken", data: "raw" },
    ]);
    expect(result).toEqual({
      eventName: "extension.accessToken",
      eventArgs: { data: "raw" },
    });
  });

  it("uses `args` object when present", () => {
    const result = normalizeWorkspaceEventArguments([
      { type: "extension.event", args: { foo: 1 } },
    ]);
    expect(result).toEqual({
      eventName: "extension.event",
      eventArgs: { foo: 1 },
    });
  });

  it("prefers `data` over `payload` when both are present", () => {
    const result = normalizeWorkspaceEventArguments([
      { type: "extension.accessToken", data: "from-data", payload: "from-payload" },
    ]);
    expect(result).toEqual({
      eventName: "extension.accessToken",
      eventArgs: { data: "from-data" },
    });
  });

  it("falls back to `payload` when `data` is missing", () => {
    const result = normalizeWorkspaceEventArguments([
      { type: "extension.accessToken", payload: "from-payload" },
    ]);
    expect(result).toEqual({
      eventName: "extension.accessToken",
      eventArgs: { data: "from-payload" },
    });
  });

  it("uses a second-argument object as event-args when first object lacks data/payload/args", () => {
    const result = normalizeWorkspaceEventArguments([
      { type: "extension.accessToken" },
      { accessToken: "fromSecond" },
    ]);
    expect(result).toEqual({
      eventName: "extension.accessToken",
      eventArgs: { accessToken: "fromSecond" },
    });
  });

  it("wraps a scalar second argument under `data` when first object lacks data/payload/args", () => {
    const result = normalizeWorkspaceEventArguments([
      { type: "extension.accessToken" },
      "secondScalar",
    ]);
    expect(result).toEqual({
      eventName: "extension.accessToken",
      eventArgs: { data: "secondScalar" },
    });
  });

  it("falls through to the first object itself when nothing else is present", () => {
    // Mirrors the reference behavior: tokens may live directly on the event
    // object like `{ type: "extension.accessToken", accessToken: "..." }`.
    const firstArg = { type: "extension.accessToken", accessToken: "direct" };
    const result = normalizeWorkspaceEventArguments([firstArg]);
    expect(result).toEqual({
      eventName: "extension.accessToken",
      eventArgs: firstArg,
    });
  });
});

describe("normalizeWorkspaceEventArguments — invalid input", () => {
  it("returns null for an empty argument list", () => {
    expect(normalizeWorkspaceEventArguments([])).toBeNull();
  });

  it("returns null when first argument is not an object and second is missing", () => {
    expect(normalizeWorkspaceEventArguments([123])).toBeNull();
    expect(normalizeWorkspaceEventArguments(["only-one-string"])).toBeNull();
  });

  it("returns null when the single object has no recognizable event name", () => {
    expect(normalizeWorkspaceEventArguments([{ foo: "bar" }])).toBeNull();
  });

  it("returns null when the event name resolves to an empty string", () => {
    expect(normalizeWorkspaceEventArguments([{ type: "   " }])).toBeNull();
  });
});

describe("normalizeWorkspaceEventArguments — round-trip preservation", () => {
  it("legacy form round-trips", () => {
    const tokenPayload = { accessToken: "xyz", expiresAt: "later" };
    const result = normalizeWorkspaceEventArguments([
      "extension.accessToken",
      tokenPayload,
    ]);
    expect(result?.eventName).toBe("extension.accessToken");
    expect(result?.eventArgs).toBe(tokenPayload);
  });

  it("object form preserves the inner data payload reference", () => {
    const innerData = { token: "xyz" };
    const result = normalizeWorkspaceEventArguments([
      { type: "extension.accessToken", data: innerData },
    ]);
    expect(result?.eventName).toBe("extension.accessToken");
    expect((result?.eventArgs as { data: unknown }).data).toBe(innerData);
  });
});
