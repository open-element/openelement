/**
 * The one vp run dispatch surface (S3 owner ruling: vite-plus is the unified
 * task entry; package.json scripts stay the single source of truth and pnpm
 * stays the package manager).
 *
 * Every gate step, generator task, and evidence-recorded command spawns the
 * vp CLI the same way, so there is exactly one place that knows how a task is
 * dispatched:
 *
 * - Package-qualified through `--filter` + `--fail-if-no-match`: that is the
 *   documented fail-closed selection form. A selector that names no package
 *   exits non-zero; the bare `pkg#task` specifier form instead silently
 *   no-ops on an unknown package (observed against vp 1.0.0: exit 0, no
 *   output), so it is never dispatched here.
 * - `--no-cache`: a gate step is proof, not a build accelerator — a stale
 *   cache entry must never fake-pass a gate.
 * - Serial: one task per invocation, and callers await invocations in order.
 *   There is no scheduler here, only the argv shape and the executable path.
 *
 * The recorded-evidence contract (tools/repo/candidate-steps.ts) builds its
 * expected argv with `vpTaskArgv`, so the dispatch shape cannot drift between
 * the producer that spawns it and the validator that audits it.
 */

import { accessSync, constants } from 'node:fs';
import { join } from 'node:path';

/**
 * The fail-closed selector flag, non-optional by construction for every
 * tooling-spawned task.
 *
 * `vp run <pkg>#<task>` resolves the package part by exact package NAME and
 * exits 0 without running anything when nothing matches — the same is true
 * with `--fail-if-no-match` appended (measured against vp 1.0.0), because the
 * flag is a property of `--filter`. Only `--filter <pkg>` plus this flag turns
 * a no-match into a non-zero exit. The tooling therefore never dispatches the
 * `pkg#task` specifier form: this argv, built here and nowhere else, is the
 * fail-closed shape, and tools/repo/check-vp-selector-flags.ts is the tripwire
 * for the hand-written call sites (workflow `run:` steps, hooks, package.json
 * scripts) that do not go through it.
 */
const FAIL_IF_NO_MATCH = '--fail-if-no-match';

/**
 * The canonical argv for one vp-dispatched task, with the literal `vp` at
 * position 0 (the executable basename evidence normalizes to). Spawn callers
 * replace that element with the real executable path from `vpExecutable`.
 *
 * The flag is emitted unconditionally: it is the policy, not an option a
 * caller chooses, which is why no caller passes it and no caller can omit it.
 * A task that had to tolerate an unmatched selector would require changing
 * this function — one reviewed place that must explain itself, instead of one
 * of seventy call sites silently dropping it.
 */
export function vpTaskArgv(pkg: string, task: string): string[] {
  return ['vp', 'run', '--no-cache', FAIL_IF_NO_MATCH, '--filter', pkg, task];
}

/**
 * The installed vp CLI shim (`node_modules/.bin/vp`), failing closed when the
 * workspace has not been installed — a missing task runner must stop the gate
 * with a diagnosis, never fall back to another dispatcher.
 */
export function vpExecutable(repoRoot: string): string {
  const executable = join(repoRoot, 'node_modules', '.bin', 'vp');
  try {
    accessSync(executable, constants.X_OK);
  } catch {
    throw new Error(
      `vp dispatch: ${executable} is missing or not executable — install the workspace ` +
        `(pnpm install --frozen-lockfile) before dispatching tasks.`,
    );
  }
  return executable;
}
