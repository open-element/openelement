/**
 * non-interactive-permissions.test.ts — packed gates never prompt (unit half).
 *
 * A packed Element/Playwright consumer once stalled on an FFI prompt
 * (`Deno requests ffi access to ".../fsevents/fsevents.node" / Allow?
 * [y/n/A]`), which a human had to refuse by hand. The fix has two halves:
 *   1. mechanism (this file): a genuine FFI request under --deny-ffi
 *      --no-prompt with stdin closed fails closed promptly and never prints
 *      a permission prompt;
 *   2. wiring (this file): every packed-consumer gate entry in
 *      tools/release/deno.json carries --deny-ffi --no-prompt, and gate.ts
 *      spawns children with stdin closed so a missing flag fails closed
 *      instead of hanging on input.
 * The full dynamic proof (gate:packed with stdin closed, zero prompt text)
 * runs in candidate evidence, not here — re-running whole packed consumers
 * inside a unit test would double CI time for no extra signal.
 */

import { assert, assertEquals } from '@std/assert';
import { dirname, join } from '@std/path';

const repoRoot = join(dirname(new URL(import.meta.url).pathname), '..', '..');

const PROMPT_MARKERS = ['Allow?', 'requests ffi access'];

async function runClosed(
  args: string[],
  timeoutMs: number,
): Promise<{ code: number; output: string; timedOut: boolean }> {
  const child = new Deno.Command(Deno.execPath(), {
    args,
    cwd: repoRoot,
    stdin: 'null',
    stdout: 'piped',
    stderr: 'piped',
  }).spawn();
  const timeout = new Promise<{ timedOut: true }>((resolve) =>
    setTimeout(() => resolve({ timedOut: true as const }), timeoutMs)
  );
  const status = await Promise.race([
    child.status.then((status) => ({ ...status, timedOut: false as const })),
    timeout,
  ]);
  if (status.timedOut) {
    try {
      child.kill('SIGKILL');
    } catch {
      // Already exited between the race and the kill.
    }
    await child.status.catch(() => undefined);
    return { code: -1, output: '', timedOut: true };
  }
  const output = await child.output().catch(() => undefined);
  const text = output
    ? new TextDecoder().decode(output.stdout) + new TextDecoder().decode(output.stderr)
    : '';
  return { code: status.code, output: text, timedOut: false };
}

Deno.test('permissions: an FFI request with stdin closed fails closed without prompting', async () => {
  const result = await runClosed(
    ['eval', '--deny-ffi', '--no-prompt', 'Deno.dlopen("noninteractive-ffi-probe", {});'],
    30_000,
  );
  assert(!result.timedOut, 'the denied FFI request must settle promptly, never hang on input');
  assert(
    result.code !== 0,
    `the denied FFI request must fail closed, got exit 0:\n${result.output}`,
  );
  for (const marker of PROMPT_MARKERS) {
    assert(
      !result.output.includes(marker),
      `denied FFI must never print a permission prompt (found ${
        JSON.stringify(marker)
      }):\n${result.output}`,
    );
  }
});

Deno.test('permissions: packed gate tasks deny FFI and never prompt', () => {
  const text = Deno.readTextFileSync(join(repoRoot, 'tools/release/deno.json'));
  const tasks = (JSON.parse(text) as { tasks: Record<string, string> }).tasks;
  const gated = Object.entries(tasks).filter(([name]) =>
    name !== 'gate:packed' && name !== 'typecheck'
  );
  assert(gated.length > 0, 'tools/release/deno.json must keep gate tasks to audit');
  const violations: string[] = [];
  for (const [name, command] of gated) {
    if (!command.includes('--deny-ffi')) violations.push(`${name}: missing --deny-ffi`);
    if (!command.includes('--no-prompt')) violations.push(`${name}: missing --no-prompt`);
  }
  assertEquals(
    violations,
    [],
    `packed gate tasks must be non-interactive:\n${violations.join('\n')}`,
  );
});

Deno.test('permissions: the gate coordinator spawns children with stdin closed', () => {
  const gate = Deno.readTextFileSync(join(repoRoot, 'tools/repo/gate.ts'));
  assert(
    gate.includes("stdin: 'null'"),
    'gate.ts must spawn gate children with stdin closed so a permission request fails closed instead of prompting',
  );
});
