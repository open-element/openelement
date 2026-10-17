/**
 * Install of the compiled Block builders (#1548).
 *
 * Imported for its side effect by the entries whose graphs may execute
 * when/each Block Parts — the default entry (`src/index.ts`, which also
 * installs the hydration executor) and `./client-only` (no hydration, but a
 * client-only island still builds fresh Blocks from client state). Its only
 * job is to make the single blocks implementation reachable from a graph
 * that wants it: dropping this one import is what turns the bundle into a
 * blocks-free one (see blocks-seam.ts and src/no-blocks.ts).
 *
 * The import is deliberate rather than a bare `import './blocks.ts'`
 * register-at-a-distance: this module is the one place that names both the
 * seam and the implementation, so a reader can see the builders being wired.
 */

import {
  attachItemEvents,
  buildEach,
  buildWhen,
  expectsArrayMessage,
  updateEach,
  updateWhen,
  whenActive,
} from './blocks.ts';
import { installBlockBuilders } from './blocks-seam.ts';

installBlockBuilders({
  buildWhen,
  buildEach,
  updateWhen,
  updateEach,
  whenActive,
  expectsArrayMessage,
  attachItemEvents,
});
