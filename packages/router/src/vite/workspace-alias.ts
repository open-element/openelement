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

import { accessSync, constants as fsConstants } from 'node:fs';
import { resolve } from 'pathe';
import { describeError } from '../internal/error-codes.ts';

/**
 * The three-way result of the workspace-anchor lookup:
 * - `found`: an ancestor carries a readable pnpm-workspace.yaml marker;
 * - `absent`: the walk completed and found no marker — the legal absent for
 *   standalone single-package consumers, silenced by contract;
 * - `error`: the lookup itself failed (the marker or an ancestor exists but
 *   could not be probed) — the one case that must surface as a diagnostic,
 *   never laundered into a silent "no anchor".
 */
export type WorkspaceRootLookup =
  | { status: 'found'; root: string }
  | { status: 'absent' }
  | { status: 'error'; reason: string };

/**
 * The workspace root of the project being BUILT, for machine-independent
 * identities (stable module ids, source-map anchors, route-scan anchors).
 * Discovers the canonical pnpm-workspace.yaml marker by walking up from
 * startDir. The probe distinguishes "no marker here" (ENOENT — keep walking)
 * from "the marker cannot be probed" (EACCES, EIO, … — the error case): an
 * unreadable ancestor must surface, not read as the walk's quiet end.
 */
export function findBuildWorkspaceRoot(startDir: string): WorkspaceRootLookup {
  let dir = resolve(startDir);
  const fsRoot = resolve('/');
  while (dir !== fsRoot && dir !== resolve(dir, '..')) {
    const marker = resolve(dir, 'pnpm-workspace.yaml');
    try {
      accessSync(marker, fsConstants.F_OK);
      return { status: 'found', root: dir };
    } catch (e) {
      const errno = (e as NodeJS.ErrnoException).code;
      if (errno !== 'ENOENT' && errno !== 'ENOTDIR') {
        return { status: 'error', reason: describeError(e) };
      }
    }
    dir = resolve(dir, '..');
  }
  return { status: 'absent' };
}

/**
 * The found anchor, or undefined when the lookup answered `absent` or
 * `error` — the value-only shape callers that merely need the anchor
 * consume. The diagnostic-bearing consumer is `plugin-config.ts`, which
 * drives {@linkcode findBuildWorkspaceRoot} directly and reports the error
 * case; this helper exists so the other call sites keep one readable form
 * instead of hand-unrolling the union.
 */
export function findBuildWorkspaceRootOrUndefined(startDir: string): string | undefined {
  const lookup = findBuildWorkspaceRoot(startDir);
  return lookup.status === 'found' ? lookup.root : undefined;
}
