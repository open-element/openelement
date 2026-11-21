/**
 * Runtime-carrier island for the light-mode probe fixture.
 *
 * The client entry statically imports one island chunk carrying the shared
 * scheduler/runtime helpers; the probe island must stay a dynamic import so
 * the spec can hold its chunk without stalling client.js evaluation. This
 * trivial island exists so Rollup has a second dynamic entry and cannot fold
 * the shared runtime into the probe chunk. It renders on `visible` and is not
 * referenced by any route (islands are built from the directory).
 *
 * GENERATED lane (F16: class → function). `root: 'light'` is the class lane's
 * `root: 'light'`; the declaration is explicit because an omitted root is ALSO
 * light but says so only by default, and this fixture's whole contract is the
 * light delivery — a reader must not have to know the default to see it. The
 * DOM is unchanged: the island keeps its plain-tag host and its one `<span>`.
 */

import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  hydrate: 'visible',
  ssr: true,
  root: 'light',
});

export default function LightProbeRuntimeCarrier() {
  return <span class='runtime-carrier'>runtime carrier</span>;
}
