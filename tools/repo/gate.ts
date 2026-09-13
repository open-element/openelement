/**
 * Readable fail-closed gate coordinator (1.0 Alpha baseline).
 *
 * Root `gate:*` tasks must not be single-line `&&` chains of dozens of
 * subtasks: failures hide mid-chain and no per-step report exists. Gates
 * delegate here with the same member tasks; each member runs as
 * `deno task <name>` from the repository root with inherited stdio, and the
 * coordinator prints one PASS/FAIL line with the duration per step. The
 * first failure stops the gate and the process exits 1 (fail-closed); a
 * fully green gate prints the step count and exits 0. This coordinator owns
 * no test logic — it only sequences formal tasks.
 *
 * Usage:
 *   deno run --allow-run tools/repo/gate.ts <task> [<task> ...]
 */

export interface GateStepResult {
  name: string;
  ok: boolean;
  durationMs: number;
}

export type GateSpawn = (task: string) => Promise<number>;

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

async function defaultSpawn(task: string): Promise<number> {
  const child = new Deno.Command(Deno.execPath(), {
    args: ['task', task],
    cwd: repoRoot,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }).spawn();
  return (await child.status).code;
}

if (import.meta.main) {
  if (Deno.args.length === 0) {
    console.error('gate: at least one task name is required');
    Deno.exit(2);
  }
  const { ok } = await runGate(Deno.args);
  if (!ok) Deno.exit(1);
}
