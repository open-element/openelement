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
  const { pkg, task } = parseGateStep('typecheck');
  expect(pkg).toEqual(null);
  expect(task).toEqual('typecheck');
});

test('gate: parseGateStep accepts a package-qualified step', () => {
  const { pkg, task } = parseGateStep('@openelement/www#build');
  expect(pkg).toEqual('@openelement/www');
  expect(task).toEqual('build');
  const unscoped = parseGateStep('fixture#build');
  expect(unscoped.pkg).toEqual('fixture');
  expect(unscoped.task).toEqual('build');
});

test('gate: parseGateStep rejects escapes, shell composition, and path selectors', () => {
  const bad = [
    '',
    '#build',
    'www#',
    '../evil#build',
    'apps/../evil#build',
    '/abs#build',
    // The dir#task path form silently no-ops under vp run: it is a parse
    // error, never a dispatchable step.
    'tools/repo#generate:all',
    'www/build#task',
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
