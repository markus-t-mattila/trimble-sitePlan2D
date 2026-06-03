/*
DEV-only diagnostic logger. The Trimble Core API + persistence paths
log file/folder/project/version IDs at multiple steps so developers can
trace upload/download timing locally. Those IDs are not secrets but
they DO reveal project topology — and the production-build user has no
need to see any of it. Routing everything through `devLog` keeps the
verbose stream in `npm run dev` while emitting nothing from the
`dist/` bundle.

Errors and genuine warnings still use the real `console.error` /
`console.warn` directly so they remain visible in production for
incident triage.
*/

const enabled =
  typeof import.meta !== "undefined" && (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;

export function devLog(...args: unknown[]): void {
  if (!enabled) return;
  console.warn(...args);
}
