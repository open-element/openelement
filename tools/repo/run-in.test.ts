import { assert, assertEquals } from '@std/assert';
import { join } from '@std/path';
import { execute, parseRunInArgs } from './run-in.ts';

Deno.test('run-in: parses root, env, and command', () => {
  const options = parseRunInArgs(
    ['--root', 'fixtures/x', '--env', 'A=1', '--env', 'B=2=3', '--', 'npm', 'ci'],
  );
  assertEquals(options, {
    root: 'fixtures/x',
    env: { A: '1', B: '2=3' },
    command: ['npm', 'ci'],
  });
});

Deno.test('run-in: rejects missing root, separator, and command', () => {
  for (const args of [['--', 'true'], ['--root', 'x'], ['--root', 'x', '--'], ['--bogus']]) {
    let threw = false;
    try {
      parseRunInArgs(args);
    } catch {
      threw = true;
    }
    assert(threw, `expected failure for ${JSON.stringify(args)}`);
  }
});

Deno.test('run-in: runs the child in the given root with the given env', async () => {
  const dir = await Deno.makeTempDir({ prefix: 'openelement-run-in-' });
  try {
    const probe = join(dir, 'probe.ts');
    await Deno.writeTextFile(
      probe,
      'if (Deno.env.get("OPENELEMENT_RUN_IN_PROBE") !== "ok") throw new Error("env missing");' +
        'if (Deno.cwd() !== Deno.env.get("OPENELEMENT_RUN_IN_CWD")) {' +
        '  throw new Error(`cwd=${Deno.cwd()}`);' +
        '}',
    );
    const expectedCwd = await Deno.realPath('tools/repo');
    const code = await execute({
      root: 'tools/repo',
      env: { OPENELEMENT_RUN_IN_PROBE: 'ok', OPENELEMENT_RUN_IN_CWD: expectedCwd },
      command: [Deno.execPath(), 'run', '--allow-env', '--allow-read', probe],
    });
    assertEquals(code, 0);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test('run-in: passes the child exit code through', async () => {
  const code = await execute({
    root: '.',
    env: {},
    command: [Deno.execPath(), 'eval', 'Deno.exit(7);'],
  });
  assertEquals(code, 7);
});
