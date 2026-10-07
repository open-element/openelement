/**
 * Install of the compiled Region builders (#1548).
 *
 * Imported for its side effect by the entries whose graphs may execute
 * when/each Region Parts — the default entry (`src/index.ts`, which also
 * installs the claim executor) and `./client-only` (no claim, but a
 * client-only island still builds fresh Regions from client state). Its only
 * job is to make the single regions implementation reachable from a graph
 * that wants it: dropping this one import is what turns the bundle into a
 * regions-free one (see regions-seam.ts and src/no-regions.ts).
 *
 * The import is deliberate rather than a bare `import './regions.ts'`
 * register-at-a-distance: this module is the one place that names both the
 * seam and the implementation, so a reader can see the builders being wired.
 */

import {
  buildEach,
  buildWhen,
  expectsArrayMessage,
  updateEach,
  updateWhen,
  whenActive,
} from './regions.ts';
import { installRegionBuilders } from './regions-seam.ts';

installRegionBuilders({
  buildWhen,
  buildEach,
  updateWhen,
  updateEach,
  whenActive,
  expectsArrayMessage,
});
