/**
 * non-interactive-permissions.test.ts — packed gates never prompt (unit half).
 *
 * A packed Element/Playwright consumer once stalled on an FFI prompt
 * (`Deno requests ffi access to ".../fsevents/fsevents.node" / Allow?
 * [y/n/A]`), which a human had to refuse by hand. The deno-era fix carried
 * `--deny-ffi --no-prompt` on every release-lane entry; the S2 exit (owner
 * ruling 2026-10-03) removed the deno host entirely, and with it the
 * permission-prompt mechanism itself — on the node host non-interactivity is
 * structural. What remains auditable here:
 *   1. wiring (this file): tools/release/package.json carries NO deno-run
 *      entry — a reintroduced deno entry would reintroduce the host and its
 *      prompt surface;
 *   2. the real launcher chain (gate.ts -> vp -> task) completes with the
 *      gate's stdin closed: a step that read input would hang and hit the
 *      timeout instead of finishing.
 * The full dynamic proof (gate:packed with stdin closed, zero prompt text)
 * runs in candidate evidence, not here — re-running whole packed consumers
 * inside a unit test would double CI time for no extra signal.
 */

import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { runProcess } from './consumer-packaged-shared.ts';

const repoRoot = join(dirname(new URL(import.meta.url).pathname), '..', '..');

test('permissions: the release lane carries no deno-run entries', () => {
  const text = readFileSync(join(repoRoot, 'tools/release/package.json'), 'utf8');
  const scripts = (JSON.parse(text) as { scripts: Record<string, string> }).scripts;
  const denoEntries = Object.entries(scripts).filter(([, command]) =>
    /\bdeno\s+(run|task|test|eval)\b/.test(command),
  );
  expect(
    denoEntries,
    `tools/release/package.json is node-hosted (owner ruling 2026-10-03); a deno entry ` +
      `reintroduces the host and its permission-prompt surface:\n${denoEntries
        .map(([name, command]) => `${name}: ${command}`)
        .join('\n')}`,
  ).toEqual([]);
});

test(
  'permissions: the gate task entry completes with stdin closed (no prompt hang)',
  { timeout: 180_000 },
  async () => {
    // The real launcher chain against the fastest read-only gate step
    // (root fmt:check through vp): the gate itself runs with stdin closed —
    // the condition that used to surface a permission prompt as a hang.
    const run = await runProcess(process.execPath, ['tools/repo/gate.ts', 'fmt:check'], repoRoot, {
      timeoutMs: 150_000,
    });
    expect(
      run.success,
      `gate fmt:check must pass with stdin closed:\n${run.output.slice(-4000)}`,
    ).toBeTruthy();
    expect(run.output, 'the timed-out marker means the chain hung on input').not.toContain(
      'Timed out after',
    );
  },
);
