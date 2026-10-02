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

import { spawn } from 'node:child_process';
import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from '@std/path';

const repoRoot = join(dirname(new URL(import.meta.url).pathname), '..', '..');

const PROMPT_MARKERS = ['Allow?', 'requests ffi access'];

async function runClosed(
  args: string[],
  timeoutMs: number,
): Promise<{ code: number; output: string; timedOut: boolean }> {
  // node's spawn drains piped stdio independently of the exit wait; the
  // timeout kills the child so a prompt can never hang the test. The SUT is
  // the deno CLI itself (the release-train host): the deno-run scripts this
  // file audits execute under deno, so the probe launches `deno` from PATH.
  const child = spawn('deno', args, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  const timeout = new Promise<{ timedOut: true }>((resolve) =>
    setTimeout(() => resolve({ timedOut: true as const }), timeoutMs),
  );
  const finished = (async () => {
    const [stdout, stderr] = await Promise.all([
      Array.fromAsync(child.stdout!),
      Array.fromAsync(child.stderr!),
    ]);
    const code = await new Promise<number>((resolve) =>
      child.once('exit', (c) => resolve(c ?? -1)),
    );
    return {
      code,
      output: Buffer.concat([...stdout, ...stderr]).toString(),
      timedOut: false as const,
    };
  })();
  const result = await Promise.race([finished, timeout]);
  if (result.timedOut) {
    try {
      child.kill('SIGKILL');
    } catch {
      // Already exited between the race and the kill.
    }
    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
      setTimeout(resolve, 5000).unref();
    });
    return { code: -1, output: '', timedOut: true };
  }
  return result;
}

test('permissions: an FFI request with stdin closed fails closed without prompting', async () => {
  const result = await runClosed(
    ['eval', '--deny-ffi', '--no-prompt', 'Deno.dlopen("noninteractive-ffi-probe", {});'],
    30_000,
  );
  expect(
    !result.timedOut,
    'the denied FFI request must settle promptly, never hang on input',
  ).toBeTruthy();
  expect(
    result.code !== 0,
    `the denied FFI request must fail closed, got exit 0:\n${result.output}`,
  ).toBeTruthy();
  for (const marker of PROMPT_MARKERS) {
    expect(
      !result.output.includes(marker),
      `denied FFI must never print a permission prompt (found ${JSON.stringify(
        marker,
      )}):\n${result.output}`,
    ).toBeTruthy();
  }
});

test('permissions: packed gate tasks deny FFI and never prompt', () => {
  // The B2 surface: tools/release/package.json scripts. Node-host scripts
  // carry no permission flags by ruling; the audit covers the remaining
  // deno-run scripts (every one must deny FFI and never prompt).
  const text = readFileSync(join(repoRoot, 'tools/release/package.json'), 'utf8');
  const scripts = (JSON.parse(text) as { scripts: Record<string, string> }).scripts;
  const gated = Object.entries(scripts).filter(([, command]) => command.includes('deno run'));
  expect(
    gated.length > 0,
    'tools/release/package.json must keep deno-run gate scripts to audit',
  ).toBeTruthy();
  const violations: string[] = [];
  for (const [name, command] of gated) {
    if (!command.includes('--deny-ffi')) violations.push(`${name}: missing --deny-ffi`);
    if (!command.includes('--no-prompt')) violations.push(`${name}: missing --no-prompt`);
  }
  expect(
    violations,
    `packed gate tasks must be non-interactive:\n${violations.join('\n')}`,
  ).toEqual([]);
});

test('permissions: the gate coordinator spawns children with stdin closed', () => {
  const gate = readFileSync(join(repoRoot, 'tools/repo/gate.ts'), 'utf8');
  expect(
    gate.includes("stdin: 'null'"),
    'gate.ts must spawn gate children with stdin closed so a permission request fails closed instead of prompting',
  ).toBeTruthy();
});
