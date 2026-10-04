/**
 * @openelement/router - the build workspace anchor
 *
 * One filesystem ancestor search for the canonical pnpm-workspace.yaml
 * marker. The anchor exists for stable, machine-independent identities only:
 * project-relative module ids in compiler Part Programs, source maps, HMR
 * error copy and route-scan anchors. It is not an alias source — workspace
 * packages resolve through the package manager's node_modules layout, and a
 * consumer that needs an alias declares it in its own vite config.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'pathe';

/**
 * The workspace root of the project being BUILT, for machine-independent
 * identities (stable module ids, source-map anchors, route-scan anchors).
 * Discovers the canonical pnpm-workspace.yaml marker by walking up from
 * startDir. Null when no ancestor carries the marker: callers pass that
 * through as "no anchor" and identities stay unanchored, as before.
 */
export function findBuildWorkspaceRoot(startDir: string): string | null {
  let dir = resolve(startDir);
  const fsRoot = resolve('/');
  while (dir !== fsRoot && dir !== resolve(dir, '..')) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = resolve(dir, '..');
  }
  return null;
}
