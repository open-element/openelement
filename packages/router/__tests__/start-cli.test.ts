/**
 * @openelement/router — merged serve CLI contract (#859, ADR-0123
 * item 4): `cli/start` and `cli/preview` are one command with a mode flag.
 * Covers the mode parser plus the two refusal paths and a real static-serve
 * boot of start mode.
 */

import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { join } from '@std/path';
import { extractServeMode } from '../src/cli/start.ts';

const startCli = join(import.meta.dirname!, '../src/cli/start.ts');

Deno.test('start cli: extractServeMode defaults to start and passes args through', () => {
  assertEquals(extractServeMode([]), { mode: 'start', rest: [] });
  assertEquals(extractServeMode(['--port', '5000']), { mode: 'start', rest: ['--port', '5000'] });
  assertEquals(extractServeMode(['--mode=preview']), { mode: 'preview', rest: [] });
  assertEquals(extractServeMode(['--mode', 'preview', '--host']), {
    mode: 'preview',
    rest: ['--host'],
  });
  assertEquals(extractServeMode(['--mode=start']), { mode: 'start', rest: [] });
});

Deno.test('start cli: extractServeMode rejects unknown or missing mode values', () => {
  for (const argv of [['--mode=bogus'], ['--mode', 'bogus'], ['--mode']]) {
    let threw = false;
    try {
      extractServeMode(argv);
    } catch {
      threw = true;
    }
    assert(threw, `expected ${argv.join(' ')} to throw`);
  }
});

async function runCli(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
): Promise<{ code: number; output: string }> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ['run', '-A', startCli, ...args],
    cwd,
    env,
    stdout: 'piped',
    stderr: 'piped',
  });
  const output = await command.output();
  return {
    code: output.code,
    output: new TextDecoder().decode(output.stdout) + new TextDecoder().decode(output.stderr),
  };
}

Deno.test('start cli: both modes refuse when dist/ is missing', async () => {
  const dir = await Deno.makeTempDir();
  try {
    for (const args of [[], ['--mode=preview']]) {
      const { code, output } = await runCli(dir, args);
      assertEquals(code, 1);
      assertStringIncludes(output, 'not found. Run `deno task build` first.');
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test('start cli: preview mode refuses when dist/server exists and points at start', async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(join(dir, 'dist', 'server'), { recursive: true });
    await Deno.writeTextFile(join(dir, 'dist', 'server', 'index.js'), 'export default () => {};\n');

    const { code, output } = await runCli(dir, ['--mode=preview']);
    assertEquals(code, 1);
    assertStringIncludes(output, 'request-time routes');
    assertStringIncludes(output, 'deno task start');
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test('start cli: start mode rejects an invalid port with a clear error (#1067)', async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(join(dir, 'dist'), { recursive: true });
    await Deno.writeTextFile(join(dir, 'dist', 'index.html'), '<h1>port check</h1>\n');

    for (const rawPort of ['abc', '70000', '0']) {
      const { code, output } = await runCli(dir, [], { OPEN_ELEMENT_PORT: rawPort });
      assertEquals(code, 1);
      assertStringIncludes(output, `Invalid port "${rawPort}"`);
      assertStringIncludes(output, 'integer between 1 and 65535');
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test({
  name: 'start cli: start mode serves dist/ statically over HTTP',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const dir = await Deno.makeTempDir();
    const probe = Deno.listen({ hostname: '127.0.0.1', port: 0 });
    const freePort = (probe.addr as Deno.NetAddr).port;
    probe.close();

    let server: Deno.ChildProcess | undefined;
    try {
      await Deno.mkdir(join(dir, 'dist'), { recursive: true });
      await Deno.writeTextFile(join(dir, 'dist', 'index.html'), '<h1>merged cli</h1>\n');

      server = new Deno.Command(Deno.execPath(), {
        args: ['run', '-A', startCli],
        cwd: dir,
        env: { OPEN_ELEMENT_PORT: String(freePort), OPEN_ELEMENT_HOST: '127.0.0.1' },
        stdout: 'null',
        stderr: 'null',
      }).spawn();

      let response: Response | undefined;
      for (let attempt = 0; attempt < 50; attempt++) {
        try {
          response = await fetch(`http://127.0.0.1:${freePort}/`);
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      assert(response, 'start mode server did not come up');
      assertEquals(response.status, 200);
      assertStringIncludes(await response.text(), '<h1>merged cli</h1>');
    } finally {
      try {
        server?.kill('SIGTERM');
      } catch {
        // The process may have already exited.
      }
      await server?.status.catch(() => undefined);
      await Deno.remove(dir, { recursive: true });
    }
  },
});
