/**
 * Readable fail-closed gate coordinator (1.0 Alpha baseline).
 *
 * Root `gate:*` scripts must not be single-line `&&` chains of dozens of
 * sub-scripts: failures hide mid-chain and no per-step report exists. Gates
 * delegate here with the same member scripts; each member runs as one
 * vp-dispatched task (S3 unified entry) with inherited stdio, and the
 * coordinator prints one PASS/FAIL line with the duration per step. The
 * first failure stops the gate and the process exits 1 (fail-closed); a
 * fully green gate prints the step count and exits 0. This coordinator owns
 * no test logic and no workspace/task resolution of its own — the dispatch
 * argv and executable come from tools/repo/vp-dispatch.ts, and vp resolves
 * the task against the package.json scripts.
 *
 * Usage:
 *   node tools/repo/gate.ts <step> [<step> ...]
 *
 * A step is either a root script (`typecheck`) or a package-qualified task
 * (`@openelement/www#build`). Bare steps dispatch against the root workspace
 * package; qualified steps must use the exact package NAME — vp resolves by
 * name, and the path-shaped `dir#task` selector form silently no-ops, so
 * parseGateStep rejects it up front. Both parts are restricted to
 * package/task-name characters, so a gate definition cannot smuggle shell
 * composition past review.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { commandStatus } from './node-command.ts';
import { vpExecutable, vpTaskArgv } from './vp-dispatch.ts';

export interface GateStepResult {
  name: string;
  ok: boolean;
  durationMs: number;
}

export type GateSpawn = (task: string) => Promise<number>;

export interface GateStep {
  /** Exact package name the task dispatches against; null = root package. */
  pkg: string | null;
  task: string;
}

const STEP_CHARS = /^[A-Za-z0-9:_-]+$/;
const PKG_CHARS = /^[A-Za-z0-9@/._-]+$/;

export function parseGateStep(step: string): GateStep {
  const hash = step.indexOf('#');
  if (hash < 0) {
    if (!STEP_CHARS.test(step)) throw new Error(`gate: invalid task name '${step}'`);
    return { pkg: null, task: step };
  }
  const pkg = step.slice(0, hash);
  const task = step.slice(hash + 1);
  if (!pkg || !PKG_CHARS.test(pkg) || pkg.startsWith('/') || pkg.split('/').includes('..')) {
    throw new Error(`gate: package selector must be an exact package name, got '${pkg}'`);
  }
  if (pkg.includes('/') && !pkg.startsWith('@')) {
    // The path-shaped `dir#task` selector form silently no-ops under vp run:
    // only exact package names are dispatchable, so reject it at parse time
    // instead of letting the gate report a step that never ran.
    throw new Error(
      `gate: '${step}' is a path selector; use the package name form '@scope/name#${task}'`,
    );
  }
  if (!task || !STEP_CHARS.test(task)) throw new Error(`gate: invalid task name '${task}'`);
  return { pkg, task };
}

const repoRoot = new URL('../..', import.meta.url).pathname;

let rootPackage: string | undefined;

/** The root workspace package name a bare step dispatches against. */
function rootPackageName(): string {
  if (rootPackage === undefined) {
    let parsed: { name?: unknown };
    try {
      parsed = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
    } catch (cause) {
      throw new Error('gate: the root package.json is unreadable; bare steps cannot dispatch', {
        cause,
      });
    }
    if (typeof parsed.name !== 'string' || parsed.name === '') {
      throw new Error('gate: the root package.json carries no name; bare steps cannot dispatch');
    }
    rootPackage = parsed.name;
  }
  return rootPackage;
}

export async function runGate(
  steps: string[],
  spawn: GateSpawn = defaultSpawn,
  log: (line: string) => void = console.log,
): Promise<{ ok: boolean; results: GateStepResult[] }> {
  const results: GateStepResult[] = [];
  for (const name of steps) {
    const startedAt = Date.now();
    const code = await spawn(name);
    const result = { name, ok: code === 0, durationMs: Date.now() - startedAt };
    results.push(result);
    log(`${result.ok ? 'PASS' : 'FAIL'} ${name} (${(result.durationMs / 1000).toFixed(1)}s)`);
    if (!result.ok) {
      log(`gate stopped: ${name} failed (${results.length}/${steps.length} steps attempted)`);
      return { ok: false, results };
    }
  }
  log(`gate ok: ${results.length} step(s)`);
  return { ok: true, results };
}

async function defaultSpawn(step: string): Promise<number> {
  let parsed: GateStep;
  try {
    parsed = parseGateStep(step);
  } catch (error) {
    console.error((error as Error).message);
    return 127;
  }
  try {
    const executable = vpExecutable(repoRoot);
    const args = vpTaskArgv(parsed.pkg ?? rootPackageName(), parsed.task).slice(1);
    const status = await commandStatus(executable, {
      args,
      cwd: repoRoot,
      // Gates never interact: stdin stays closed so an unexpected prompt fails
      // closed instead of hanging (non-interactive invariant).
      stdin: 'null',
      stdout: 'inherit',
      stderr: 'inherit',
    });
    return status.code;
  } catch (error) {
    // A spawn failure (missing binary) is a failed step, not a crash: the
    // gate reports FAIL and stops, exactly like a non-zero task exit.
    console.error(`gate: could not dispatch '${step}': ${(error as Error).message}`);
    return 127;
  }
}

if (import.meta.main) {
  if (process.argv.slice(2).length === 0) {
    console.error('gate: at least one task name is required');
    process.exit(2);
  }
  const { ok } = await runGate(process.argv.slice(2));
  if (!ok) process.exit(1);
}
