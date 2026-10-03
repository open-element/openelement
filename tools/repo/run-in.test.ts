import { expect, test } from 'vitest';
import { join } from '@std/path';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { execute, parseRunInArgs } from './run-in.ts';

test('run-in: parses root, env, and command', () => {
  const options = parseRunInArgs([
    '--root',
    'fixtures/x',
    '--env',
    'A=1',
    '--env',
    'B=2=3',
    '--',
    'npm',
    'ci',
  ]);
  expect(options).toEqual({
    root: 'fixtures/x',
    env: { A: '1', B: '2=3' },
    command: ['npm', 'ci'],
  });
});

test('run-in: rejects missing root, separator, and command', () => {
  for (const args of [['--', 'true'], ['--root', 'x'], ['--root', 'x', '--'], ['--bogus']]) {
    let threw = false;
    try {
      parseRunInArgs(args);
    } catch {
      threw = true;
    }
    expect(threw, `expected failure for ${JSON.stringify(args)}`).toBeTruthy();
  }
});

test('run-in: runs the child in the given root with the given env', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'openelement-run-in-'));
  try {
    const probe = join(dir, 'probe.ts');
    // The probe runs under a child node (node-host run-in); it reads env
    // through the node:process surface (B1b) — same values. The source is an
    // array of plain statements joined with newlines: no static string may
    // carry a `${…}` template shape (the "string references variable"
    // heuristic static analysis fires on that shape), so failure messages are
    // fixed text — the child's stderr names the failing assertion.
    const probeSource = [
      'const assert = (ok, message) => {',
      '  if (!ok) throw new Error(message);',
      '};',
      'assert(process.env["OPENELEMENT_RUN_IN_PROBE"] === "ok", "env missing");',
      'assert(process.cwd() === process.env["OPENELEMENT_RUN_IN_CWD"], "cwd mismatch");',
    ].join('\n');
    await writeFile(probe, probeSource, 'utf8');
    const expectedCwd = await realpath('tools/repo');
    const code = await execute({
      root: 'tools/repo',
      env: { OPENELEMENT_RUN_IN_PROBE: 'ok', OPENELEMENT_RUN_IN_CWD: expectedCwd },
      command: [process.execPath, probe],
    });
    expect(code).toEqual(0);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('run-in: passes the child exit code through', async () => {
  const code = await execute({
    root: '.',
    env: {},
    command: [process.execPath, '--eval', 'process.exit(7);'],
  });
  expect(code).toEqual(7);
});
