/**
 * Runtime-carrier island for the light-mode probe fixture.
 *
 * The client entry statically imports one island chunk carrying the shared
 * scheduler/runtime helpers; the probe island must stay a dynamic import so
 * the spec can hold its chunk without stalling client.js evaluation. This
 * trivial island exists so Rollup has a second dynamic entry and cannot fold
 * the shared runtime into the probe chunk. It renders on `visible` and is not
 * referenced by any route (islands are built from the directory).
 */

import { element, OpenElement } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ hydrate: 'visible', ssr: true });

@element('light-probe-runtime-carrier', { root: 'light' })
export default class LightProbeRuntimeCarrier extends OpenElement {
  render() {
    return <span class='runtime-carrier'>runtime carrier</span>;
  }
}
