/*
Workspace API connection helpers ported from
`/Users/mattilam/trimble-mass-editor/app/api/workspaceClient.js`.

The Workspace API global is loaded by `index.html` from
`https://components.connect.trimble.com/trimble-connect-workspace-api/index.js`
and is exposed on `window.TrimbleConnectWorkspace`. We type that surface with a
minimal interface — only the operations we actually call — so the rest of the
codebase can stay strictly typed without depending on any external typings.
*/

import type { ProjectContext } from "../types";
import { asRecord, getProp, normalizeToOptionalString } from "./internal";

/** Workspace event name that delivers the access token. */
export const WORKSPACE_EVENT_ACCESS_TOKEN = "extension.accessToken";

/** Workspace event name that delivers extension command activations. */
export const WORKSPACE_EVENT_EXTENSION_COMMAND = "extension.command";

/** Command identifier registered for the main menu entry. */
export const WORKSPACE_COMMAND_MAIN_CLICKED = "main_clicked";

/** Default Workspace `connect` timeout (matches the reference implementation). */
const WORKSPACE_CONNECT_TIMEOUT_MS = 30_000;

/**
 * Resolve a URL for the menu icon relative to this module so the menu icon
 * works both in production and on the dev server without code changes.
 */
const MAIN_MENU_ICON_URL = new URL(
  "../assets/menu-icon.svg",
  import.meta.url,
).toString();

const MAIN_MENU_DEFINITION = {
  title: "sitePlan2D",
  icon: MAIN_MENU_ICON_URL,
  command: WORKSPACE_COMMAND_MAIN_CLICKED,
} as const;

/**
 * Callback the Workspace API hands events to. Normalized to a single shape:
 * `(eventName, eventArgs)` — regardless of which underlying runtime variant
 * the host uses.
 */
export type WorkspaceEventHandler = (
  eventName: string,
  eventArgs: Record<string, unknown>,
) => void;

/**
 * Minimal type surface for the Workspace API. The full surface area is much
 * larger; we only declare the slices we actually call. Optional members are
 * marked optional so we can probe and fall back to compatibility alternatives.
 */
export interface WorkspaceApi {
  project?: WorkspaceProjectApi;
  extension: WorkspaceExtensionApi;
  ui: WorkspaceUiApi;
}

export interface WorkspaceProjectApi {
  getCurrentProject?: () => Promise<unknown>;
  getProject?: () => Promise<unknown>;
}

export interface WorkspaceExtensionApi {
  requestPermission: (permissionName: string) => Promise<unknown>;
  setStatusMessage: (message: string) => Promise<void> | void;
}

export interface WorkspaceUiApi {
  setMenu: (definition: WorkspaceMenuDefinition) => Promise<void> | void;
}

export interface WorkspaceMenuDefinition {
  title: string;
  icon: string;
  command: string;
}

/** Raw connect function shape exposed on `window.TrimbleConnectWorkspace`. */
export interface WorkspaceApiGlobal {
  connect: (
    parentWindow: Window,
    eventCallback: (...args: unknown[]) => void,
    timeoutMs: number,
  ) => Promise<WorkspaceApi>;
}

/* The Workspace SDK script attaches itself to `window`. Declare it so we can
read it without `any`. */
declare global {
  interface Window {
    TrimbleConnectWorkspace?: WorkspaceApiGlobal;
  }
}

/**
 * Singleton cache for the in-flight or resolved Workspace connect promise.
 * Multiple callers may invoke `connectWorkspaceApi` concurrently during boot;
 * we want exactly one underlying connection.
 */
let workspaceConnectPromise: Promise<WorkspaceApi> | null = null;

/**
 * Normalized event view as observed by the rest of the extension.
 */
export interface NormalizedWorkspaceEvent {
  eventName: string;
  eventArgs: Record<string, unknown>;
}

/**
 * Normalize callback arguments emitted by the Workspace SDK into one stable
 * `{ eventName, eventArgs }` shape. Supports both:
 *
 * - Legacy two-positional form: `(eventName: string, eventArgs)`.
 * - Single-object form: `{ type, data }` (or `{ event, args }`, etc.).
 *
 * Returns `null` when the arguments do not look like a known event shape.
 */
export function normalizeWorkspaceEventArguments(
  callbackArguments: ReadonlyArray<unknown>,
): NormalizedWorkspaceEvent | null {
  if (
    Array.isArray(callbackArguments) &&
    callbackArguments.length >= 2 &&
    typeof callbackArguments[0] === "string"
  ) {
    const eventName = callbackArguments[0];
    const secondArgument = callbackArguments[1];
    const normalizedLegacyArgs = (() => {
      if (secondArgument && typeof secondArgument === "object") {
        return secondArgument as Record<string, unknown>;
      }

      if (secondArgument !== undefined) {
        return { data: secondArgument } as Record<string, unknown>;
      }

      return {} as Record<string, unknown>;
    })();

    return {
      eventName,
      eventArgs: normalizedLegacyArgs,
    };
  }

  const firstArgument = callbackArguments[0] ?? null;
  const secondArgument = callbackArguments[1] ?? null;

  if (!firstArgument || typeof firstArgument !== "object") {
    return null;
  }

  const firstRecord = firstArgument as Record<string, unknown>;
  const normalizedEventName = String(
    firstRecord["type"] ?? firstRecord["event"] ?? firstRecord["name"] ?? "",
  ).trim();
  if (!normalizedEventName) {
    return null;
  }

  const normalizedEventArgs = ((): Record<string, unknown> => {
    const argsField = firstRecord["args"];
    if (argsField && typeof argsField === "object") {
      return argsField as Record<string, unknown>;
    }

    if (firstRecord["data"] !== undefined) {
      return { data: firstRecord["data"] };
    }

    if (firstRecord["payload"] !== undefined) {
      return { data: firstRecord["payload"] };
    }

    if (secondArgument && typeof secondArgument === "object") {
      return secondArgument as Record<string, unknown>;
    }

    if (secondArgument !== undefined && secondArgument !== null) {
      return { data: secondArgument };
    }

    /*
    Some runtime variants put the token directly into event object fields,
    for example `{ type: "extension.accessToken", accessToken: "..." }`. We
    return the original object as the args so token extraction stays robust.
    */
    return firstRecord;
  })();

  return {
    eventName: normalizedEventName,
    eventArgs: normalizedEventArgs,
  };
}

/**
 * Resolve the Workspace API global, throwing a descriptive error referencing
 * the expected script tag in `index.html` when the global is missing.
 */
function resolveWorkspaceApiGlobal(): WorkspaceApiGlobal {
  const candidate = typeof window !== "undefined" ? window.TrimbleConnectWorkspace : undefined;
  if (!candidate || typeof candidate.connect !== "function") {
    throw new Error(
      "Trimble Workspace API is missing. Confirm that index.html loads the official Workspace API script.",
    );
  }
  return candidate;
}

/**
 * Connect to the Trimble Connect Workspace API and reuse one shared connection
 * across the lifetime of the extension. The event callback is invoked with the
 * normalized `(eventName, eventArgs)` shape regardless of runtime variant.
 */
export async function connectWorkspaceApi(
  onEvent: WorkspaceEventHandler,
): Promise<WorkspaceApi> {
  if (workspaceConnectPromise) {
    return workspaceConnectPromise;
  }

  const workspaceApiGlobal = resolveWorkspaceApiGlobal();

  const normalizedEventCallback = (...callbackArguments: unknown[]): void => {
    const normalizedEvent = normalizeWorkspaceEventArguments(callbackArguments);
    if (!normalizedEvent) {
      return;
    }
    onEvent(normalizedEvent.eventName, normalizedEvent.eventArgs);
  };

  workspaceConnectPromise = workspaceApiGlobal.connect(
    window.parent,
    normalizedEventCallback,
    WORKSPACE_CONNECT_TIMEOUT_MS,
  );

  return workspaceConnectPromise;
}

/**
 * Reset the singleton connect cache. Intended for tests; production code
 * should never need to call this.
 */
export function resetWorkspaceConnectCacheForTesting(): void {
  workspaceConnectPromise = null;
}

/**
 * Request access-token permission from the host so the extension can call REST
 * APIs on the user's behalf. Returns the raw permission response — callers can
 * pass it to `extractAccessTokenFromPayload` / `extractAccessTokenPermissionStatus`.
 */
export async function requestAccessTokenPermission(
  workspaceApi: WorkspaceApi,
): Promise<unknown> {
  return workspaceApi.extension.requestPermission("accesstoken");
}

/**
 * Read the currently active Trimble project context and normalize it to the
 * shared `ProjectContext` shape used across the extension.
 */
export async function getCurrentProject(
  workspaceApi: WorkspaceApi,
): Promise<ProjectContext> {
  const projectApi = workspaceApi.project;
  if (!projectApi || typeof projectApi !== "object") {
    throw new Error("Workspace project API is missing.");
  }

  let rawPayload: unknown;
  if (typeof projectApi.getCurrentProject === "function") {
    rawPayload = await projectApi.getCurrentProject();
  } else if (typeof projectApi.getProject === "function") {
    /*
    Some Workspace API variants expose `getProject()` instead of
    `getCurrentProject()`. Supporting both keeps project-context loading
    robust across runtime versions.
    */
    rawPayload = await projectApi.getProject();
  } else {
    throw new Error(
      "Workspace project API does not expose getCurrentProject() or getProject().",
    );
  }

  return normalizeProjectPayload(rawPayload);
}

/**
 * Register the extension's main menu entry in the Trimble Connect shell.
 */
export async function registerMainMenu(workspaceApi: WorkspaceApi): Promise<void> {
  await workspaceApi.ui.setMenu({ ...MAIN_MENU_DEFINITION });
}

/**
 * Publish a host-level status text to the Trimble Connect shell.
 */
export async function setExtensionStatusMessage(
  workspaceApi: WorkspaceApi,
  message: string,
): Promise<void> {
  await workspaceApi.extension.setStatusMessage(message);
}

/**
 * Convert a raw Workspace project payload into our `ProjectContext` shape.
 * Workspace payloads can use slightly different field names across runtime
 * variants (`rootFolderId` vs `rootFolder.id`, nested `project.id`, etc.), so
 * we probe a few candidates instead of assuming one shape.
 */
function normalizeProjectPayload(rawPayload: unknown): ProjectContext {
  const payloadRecord = asRecord(rawPayload);
  const nestedProject = asRecord(payloadRecord["project"]);

  const id = normalizeToOptionalString(
    payloadRecord["id"] ?? nestedProject["id"],
  );
  if (!id) {
    throw new Error("Workspace project payload is missing project id.");
  }

  const name = normalizeToOptionalString(
    payloadRecord["name"] ?? nestedProject["name"],
  ) ?? "";
  const location = normalizeToOptionalString(
    payloadRecord["location"] ?? nestedProject["location"],
  );

  const rootFolderId = normalizeToOptionalString(
    payloadRecord["rootFolderId"] ??
      getProp(payloadRecord["rootFolder"], "id") ??
      nestedProject["rootFolderId"] ??
      getProp(nestedProject["rootFolder"], "id"),
  );

  return {
    id,
    name,
    location,
    rootFolderId,
  };
}
