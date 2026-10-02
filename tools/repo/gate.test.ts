import { expect, test } from 'vitest';
import { parseGateStep, runGate } from './gate.ts';

test('gate: green steps all pass with per-step results', async () => {
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
  expect(ok).toBeTruthy();
  expect(seen).toEqual(['a', 'b']);
  expect(results.map((r) => r.name)).toEqual(['a', 'b']);
  expect(results.every((r) => r.ok)).toBeTruthy();
  expect(lines.some((l) => l.startsWith('PASS a'))).toBeTruthy();
  expect(lines.some((l) => l.startsWith('PASS b'))).toBeTruthy();
  expect(lines.some((l) => l.includes('gate ok: 2 step(s)'))).toBeTruthy();
});

test('gate: first failure stops the gate fail-closed', async () => {
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
  expect(!ok).toBeTruthy();
  expect(seen).toEqual(['a', 'failing']);
  expect(results.length).toEqual(2);
  expect(lines.some((l) => l.startsWith('FAIL failing'))).toBeTruthy();
  expect(lines.some((l) => l.includes('gate stopped'))).toBeTruthy();
});

test('gate: parseGateStep accepts a root task', () => {
  const { dir, task } = parseGateStep('typecheck');
  expect(dir).toEqual(null);
  expect(task).toEqual('typecheck');
});

test('gate: parseGateStep accepts a workspace DIR#TASK step', () => {
  const { dir, task } = parseGateStep('www#build');
  expect(dir).toEqual('www');
  expect(task).toEqual('build');
});

test('gate: parseGateStep rejects escapes and shell composition', () => {
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
    expect(threw, `expected parseGateStep to reject '${step}'`).toBeTruthy();
  }
});
