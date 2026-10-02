/**
 * Readable fail-closed gate coordinator (1.0 Alpha baseline).
 *
 * Root `gate:*` scripts must not be single-line `&&` chains of dozens of
 * sub-scripts: failures hide mid-chain and no per-step report exists. Gates
 * delegate here with the same member scripts; each member runs as
 * `pnpm run <name>` from the repository root with inherited stdio, and the
 * coordinator prints one PASS/FAIL line with the duration per step. The
 * first failure stops the gate and the process exits 1 (fail-closed); a
 * fully green gate prints the step count and exits 0. This coordinator owns
 * no test logic — it only sequences formal tasks.
 *
 * Usage:
 *   node tools/repo/gate.ts <step> [<step> ...]
 *
 * A step is either a root script (`typecheck`) or a workspace script
 * (`<dir>#<script>`, e.g. `www#build`): the latter runs as
 * `pnpm --dir <dir> run <script>` from the repository root. `<dir>` must
 * stay inside the repo (no `..`, no absolute paths) and both parts are
 * restricted to task-name characters, so a gate definition cannot smuggle
 * shell composition past review.
 */

export interface GateStepResult {
  name: string;
  ok: boolean;
  durationMs: number;
}

export type GateSpawn = (task: string) => Promise<number>;

export interface GateStep {
  dir: string | null;
  task: string;
}

import { commandStatus } from './node-command.ts';
import process from 'node:process';

const STEP_CHARS = /^[A-Za-z0-9:_-]+$/;
const DIR_CHARS = /^[A-Za-z0-9_./-]+$/;

export function parseGateStep(step: string): GateStep {
  const hash = step.indexOf('#');
  if (hash < 0) {
    if (!STEP_CHARS.test(step)) throw new Error(`gate: invalid task name '${step}'`);
    return { dir: null, task: step };
  }
  const dir = step.slice(0, hash);
  const task = step.slice(hash + 1);
  if (!dir || !DIR_CHARS.test(dir) || dir.startsWith('/') || dir.split('/').includes('..')) {
    throw new Error(`gate: dir must stay inside the repo, got '${dir}'`);
  }
  if (!task || !STEP_CHARS.test(task)) throw new Error(`gate: invalid task name '${task}'`);
  return { dir, task };
}

const repoRoot = new URL('../..', import.meta.url).pathname;

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

/**
 * The pnpm entry used for every spawned step. When gate.ts itself is run
 * through a pnpm script (the normal path), `npm_execpath` names the running
 * pnpm JS entry — spawning it with the current `process.execPath` avoids
 * PATH/shebang surprises. A direct `node gate.ts` invocation falls back to
 * the `pnpm` on PATH.
 */
function pnpmLauncher(): { command: string; extraArgs: string[] } {
  const execpath = process.env.npm_execpath;
  if (execpath && execpath.endsWith('.cjs')) {
    return { command: process.execPath, extraArgs: [execpath] };
  }
  return { command: 'pnpm', extraArgs: [] };
}

async function defaultSpawn(step: string): Promise<number> {
  let parsed: GateStep;
  try {
    parsed = parseGateStep(step);
  } catch (error) {
    console.error((error as Error).message);
    return 127;
  }
  const { command, extraArgs } = pnpmLauncher();
  const args = [
    ...extraArgs,
    ...(parsed.dir === null ? ['run', parsed.task] : ['--dir', parsed.dir, 'run', parsed.task]),
  ];
  const status = await commandStatus(command, {
    args,
    cwd: repoRoot,
    // Gates never interact: stdin stays closed so an unexpected prompt fails
    // closed instead of hanging (non-interactive invariant).
    stdin: 'null',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  return status.code;
}

if (import.meta.main) {
  if (process.argv.slice(2).length === 0) {
    console.error('gate: at least one task name is required');
    process.exit(2);
  }
  const { ok } = await runGate(process.argv.slice(2));
  if (!ok) process.exit(1);
}
