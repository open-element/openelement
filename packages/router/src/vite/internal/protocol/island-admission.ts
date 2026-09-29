/**
 * island-admission.ts — the single definition of the router's island
 * admission descriptor.
 *
 * The element compiler owns no router knowledge: a compiled module's island
 * delivery policy statement
 * (`export const openElement = defineIslandConfig({ ... })`) is admitted only
 * when the host injects a 'static-sidecar' descriptor matching the callee's
 * import binding. Router is that host — this module is the one place the
 * (moduleSpecifier, exportName) pair is written, and every compiler call site
 * that compiles route or island sources consumes it, so the admission and the
 * authored grammar cannot drift apart.
 */

import type { StaticSidecarDescriptor } from '@openelement/element/compiler';

/** The static-sidecar descriptor router injects into the element compiler. */
export const ISLAND_ADMISSION: StaticSidecarDescriptor = {
  moduleSpecifier: '@openelement/router',
  exportName: 'defineIslandConfig',
  kind: 'static-sidecar',
};
