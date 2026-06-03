/*
RFC-4122 v4 UUID generator. Wrapped here so the call sites stay
short and so we can swap the implementation centrally if needed
(e.g. moving to ULID or KSUID for sortability). `crypto.randomUUID()`
is available in every supported runtime: all modern browsers (Chrome
92+, Firefox 95+, Safari 15.4+) plus Node 19+. Engines.node is pinned
to 22.12.0 in package.json so the global is always defined.

We previously depended on the `uuid` npm package; dropping it shrinks
the bundle and removes a one-major-behind upgrade chore. The native
implementation is also slightly faster.
*/

export function newId(): string {
  return crypto.randomUUID();
}
