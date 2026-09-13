import { assert, assertEquals } from '@std/assert';
import { runGate } from './gate.ts';

Deno.test('gate: green steps all pass with per-step results', async () => {
  const seen: string[] = [];
  const lines: string[] = [];
  const { ok, results } = await runGate(
    ['a', 'b'],
    async (task) => {
      seen.push(task);
      return 0;
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
    async (task) => {
      seen.push(task);
      return task === 'failing' ? 3 : 0;
    },
    (line) => lines.push(line),
  );
  assert(!ok);
  assertEquals(seen, ['a', 'failing']);
  assertEquals(results.length, 2);
  assert(lines.some((l) => l.startsWith('FAIL failing')));
  assert(lines.some((l) => l.includes('gate stopped')));
});
