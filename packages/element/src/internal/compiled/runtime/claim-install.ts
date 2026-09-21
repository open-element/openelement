/**
 * Full-entry install of the compiled claim executor (#1416).
 *
 * Imported for its side effect by the default entry (`src/index.ts`) and by
 * nothing else. Its only job is to make the single claim implementation
 * reachable from a graph that wants it: dropping this one import is what
 * turns the bundle into a client-only one (see claim-seam.ts and
 * src/client-only.ts).
 *
 * The import is deliberate rather than a bare `import './claim-install.ts'`
 * register-at-a-distance: this module is the one place that names both the
 * seam and the implementation, so a reader can see the claim being wired.
 */
import { claimExistingDom } from '../runtime.ts';
import { installClaimExecutor } from './claim-seam.ts';

installClaimExecutor(claimExistingDom);
