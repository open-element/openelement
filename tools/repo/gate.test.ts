import { assert, assertEquals } from '@std/assert';
import { parseGateStep, runGate } from './gate.ts';

Deno.test('gate: green steps all pass with per-step results', async () => {
  const seen: string[] = [];
  const lines: string[] = [];
  const { ok, results } = await runGate(
    ['a', 'b'],
    (task) => {
      seen.push(task);
      return Promise.resolve(0);
    },
    (line) => lines.push(line),
  );
  assert(ok);
  assertEquals(seen, ['a', 'b']);
  assertEquals(results.map((r) => r.name), ['a', 'b']);
  assert(results.every((r) => r.ok));
  assert(lines.some((l) => l.startsWith('PASS a')));
  assert(lines.some((l) => l.startsWith('PASS b')));
  assert(lines.some((l) => l.includes('gate ok: 2 step(s)')));
});

Deno.test('gate: first failure stops the gate fail-closed', async () => {
  const seen: string[] = [];
  const lines: string[] = [];
  const { ok, results } = await runGate(
    ['a', 'failing', 'never'],
    (task) => {
      seen.push(task);
      return Promise.resolve(task === 'failing' ? 3 : 0);
    },
    (line) => lines.push(line),
  );
  assert(!ok);
  assertEquals(seen, ['a', 'failing']);
  assertEquals(results.length, 2);
  assert(lines.some((l) => l.startsWith('FAIL failing')));
  assert(lines.some((l) => l.includes('gate stopped')));
});

Deno.test('gate: parseGateStep accepts a root task', () => {
  const { dir, task } = parseGateStep('typecheck');
  assertEquals(dir, null);
  assertEquals(task, 'typecheck');
});

Deno.test('gate: parseGateStep accepts a workspace DIR#TASK step', () => {
  const { dir, task } = parseGateStep('www#build');
  assertEquals(dir, 'www');
  assertEquals(task, 'build');
});

Deno.test('gate: parseGateStep rejects escapes and shell composition', () => {
  const bad = [
    '',
    '#build',
    'www#',
    '../evil#build',
    'apps/../evil#build',
    '/abs#build',
    'www#build && rm -rf /',
    'www#build;evil',
    'a b#c',
    'www#',
  ];
  for (const step of bad) {
    let threw = false;
    try {
      parseGateStep(step);
    } catch {
      threw = true;
    }
    assert(threw, `expected parseGateStep to reject '${step}'`);
  }
});
