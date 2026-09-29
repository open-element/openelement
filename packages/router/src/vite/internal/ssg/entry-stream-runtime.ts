/**
 * Request-local stream emission for entries with an admitted stream route.
 * The streaming pump itself — request scope, deferred-field front gate,
 * bounded queue, timeout/cancellation, Part backfill frames — and the browser
 * bootstrap string are the imported
 * `@openelement/router/server-runtime/stream-runtime.ts` module (ADR-0160
 * rule a, #1470 block d); this emitter keeps only what the entry must still
 * own: the `__createDeferredPageShell` gate, whose text the read-only
 * stream-manifest oracle pins and whose body binds the entry's
 * `__streamManifests` data and `createDeferredDsdExecutor` import (the
 * deferred shell re-verifies the wire hash; this gate fails closed first,
 * with the route).
 */

export function renderStreamRuntime(): string {
  return `
// #1276 (B1.3-F1): the compiled program is the one canonical source for the
// route→program tag binding — the deferred shell re-checks it against the
// build manifest before any shell can exist (createDeferredDsdExecutor
// re-verifies the wire hash; this gate fails closed first, with the route).
async function __createDeferredPageShell(route, routeModule, props, instanceId, documentToken) {
  const manifest = typeof __streamManifests === "undefined" ? undefined : __streamManifests[route];
  const Cls = routeModule?.default;
  if (!manifest || !Cls?.__partProgram || Cls.__partProgram.tag !== manifest.program.tag || Cls.__partProgram.version !== manifest.program.version) {
    throw new Error("[openElement] stream route " + route + " has no matching compiled route manifest/program.");
  }
  return createDeferredDsdExecutor({ componentClass: Cls, props, manifest, instanceId, documentToken });
}
`;
}
