/**
 * Full-entry install of the compiled hydration executor (#1416).
 *
 * Imported for its side effect by the default entry (`src/index.ts`) and by
 * nothing else. Its only job is to make the single hydration implementation
 * reachable from a graph that wants it: dropping this one import is what
 * turns the bundle into a client-only one (see hydrate-seam.ts and
 * src/client-only.ts).
 *
 * The import is deliberate rather than a bare `import './hydrate-install.ts'`
 * register-at-a-distance: this module is the one place that names both the
 * seam and the implementation, so a reader can see the hydration being wired.
 */
import { hydrateExistingDom } from '../runtime.ts';
import { installHydrationExecutor } from './hydrate-seam.ts';

installHydrationExecutor(hydrateExistingDom);
