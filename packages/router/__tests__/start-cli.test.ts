/**
 * @openelement/router — merged serve CLI contract (#859, ADR-0123
 * item 4): `cli/start` and `cli/preview` are one command with a mode flag.
 * Covers the mode parser plus the two refusal paths and a real static-serve
 * boot of start mode.
 */

import { expect, test } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { join } from '@std/path';
import { OpenElementError } from '@openelement/element/authoring';
import { extractServeMode } from '../src/internal/serve-mode.ts';
import { ServeErrorCode } from '../src/internal/error-codes.ts';

const startCli = join(import.meta.dirname!, '../src/cli/start.ts');

test('start cli: extractServeMode defaults to start and passes args through', () => {
  expect(extractServeMode([])).toEqual({ mode: 'start', rest: [], debug: false });
  expect(extractServeMode(['--port', '5000'])).toEqual({
    mode: 'start',
    rest: ['--port', '5000'],
    debug: false,
  });
  expect(extractServeMode(['--mode=preview'])).toEqual({
    mode: 'preview',
    rest: [],
    debug: false,
  });
  expect(extractServeMode(['--mode', 'preview', '--host'])).toEqual({
    mode: 'preview',
    rest: ['--host'],
    debug: false,
  });
  expect(extractServeMode(['--mode=start'])).toEqual({ mode: 'start', rest: [], debug: false });
});

test('start cli: --debug is hoisted out of the pass-through args (#1413)', () => {
  // The flag selects the CLI's own raw-stack rendering, so it must never
  // reach Vite's argument parser as an unknown option.
  expect(extractServeMode(['--debug'])).toEqual({ mode: 'start', rest: [], debug: true });
  expect(extractServeMode(['--debug', '--mode=preview'])).toEqual({
    mode: 'preview',
    rest: [],
    debug: true,
  });
  expect(extractServeMode(['--mode', 'preview', '--debug', '--host'])).toEqual({
    mode: 'preview',
    rest: ['--host'],
    debug: true,
  });
});

test('start cli: extractServeMode rejects unknown or missing mode values', () => {
  for (const argv of [['--mode=bogus'], ['--mode', 'bogus'], ['--mode']]) {
    let thrown: unknown;
    try {
      extractServeMode(argv);
    } catch (error) {
      thrown = error;
    }
    // #1413: the parser's failures are classified, not bare Errors.
    expect(
      thrown instanceof OpenElementError,
      `expected ${argv.join(' ')} to classify`,
    ).toBeTruthy();
    expect((thrown as OpenElementError).code).toEqual(ServeErrorCode.MODE);
    expect((thrown as OpenElementError).phase).toEqual('validation');
    expect((thrown as OpenElementError).severity).toEqual('error');
  }
});

async function runCli(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
): Promise<{ code: number; output: string }> {
  // The start CLI is node-hosted (B1a); the run passes the env through so the
  // child sees OPEN_ELEMENT_PORT/HOST.
  const child = spawn(process.execPath, [startCli, ...args], {
    cwd,
    env: { ...process.env, ...env },
  });
  const [out, err] = await Promise.all([
    Array.fromAsync(child.stdout),
    Array.fromAsync(child.stderr),
  ]);
  const output = Buffer.concat([...out, ...err]).toString();
  const code = await new Promise<number>((resolve) => {
    child.once('exit', (c) => resolve(c ?? -1));
  });
  return { code, output };
}

test('start cli: both modes refuse when dist/ is missing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'start-cli-'));
  try {
    for (const args of [[], ['--mode=preview']]) {
      const { code, output } = await runCli(dir, args);
      expect(code).toEqual(1);
      expect(output).toContain('not found. Run `pnpm build` first.');
    }
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('start cli: preview mode refuses when dist/server exists and points at start', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'start-cli-'));
  try {
    await mkdir(join(dir, 'dist', 'server'), { recursive: true });
    await writeFile(join(dir, 'dist', 'server', 'index.js'), 'export default () => {};\n');

    const { code, output } = await runCli(dir, ['--mode=preview']);
    expect(code).toEqual(1);
    expect(output).toContain('request-time routes');
    expect(output).toContain('pnpm start');
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('start cli: start mode rejects an invalid port with a clear error (#1067)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'start-cli-'));
  try {
    await mkdir(join(dir, 'dist'), { recursive: true });
    await writeFile(join(dir, 'dist', 'index.html'), '<h1>port check</h1>\n');

    for (const rawPort of ['abc', '70000', '0']) {
      const { code, output } = await runCli(dir, [], { OPEN_ELEMENT_PORT: rawPort });
      expect(code).toEqual(1);
      expect(output).toContain(`Invalid port "${rawPort}"`);
      expect(output).toContain('integer between 1 and 65535');
    }
  } finally {
    await rm(dir, { recursive: true });
  }
});

/** A path that fails at import time: the loader throws with a real stack. */
async function makeFailingServerEntry(dir: string): Promise<void> {
  await mkdir(join(dir, 'dist', 'server'), { recursive: true });
  await writeFile(
    join(dir, 'dist', 'server', 'index.js'),
    'throw new Error("server entry exploded");\n',
  );
}

test('start cli: a fatal error prints the message without a raw stack (#1413)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'start-cli-'));
  try {
    await mkdir(join(dir, 'dist'), { recursive: true });
    await makeFailingServerEntry(dir);

    const { code, output } = await runCli(dir, []);
    expect(code).toEqual(1);
    expect(output).toContain('Start failed:');
    expect(output).toContain('server entry exploded');
    // The acceptance bar: no default raw stack. A stack would print an
    // "at " frame line with a source location.
    expect(
      !/\n\s+at .*:\d+:\d+/.test(output),
      `start must not print a raw stack by default, got:\n${output}`,
    ).toBeTruthy();
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('start cli: --debug expands the raw stack (#1413)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'start-cli-'));
  try {
    await mkdir(join(dir, 'dist'), { recursive: true });
    await makeFailingServerEntry(dir);

    const { code, output } = await runCli(dir, ['--debug']);
    expect(code).toEqual(1);
    expect(output).toContain('server entry exploded');
    expect(
      /\n\s+at .*:\d+:\d+/.test(output),
      `--debug must expand a raw stack, got:\n${output}`,
    ).toBeTruthy();
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('start cli: start mode serves dist/ statically over HTTP', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'start-cli-'));
  const freePort = await new Promise<number>((resolve) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });

  let server: ChildProcess | undefined;
  try {
    await mkdir(join(dir, 'dist'), { recursive: true });
    await writeFile(join(dir, 'dist', 'index.html'), '<h1>merged cli</h1>\n');

    server = spawn(process.execPath, [startCli], {
      cwd: dir,
      env: { ...process.env, OPEN_ELEMENT_PORT: String(freePort), OPEN_ELEMENT_HOST: '127.0.0.1' },
      stdio: 'ignore',
    });

    let response: Response | undefined;
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        response = await fetch(`http://127.0.0.1:${freePort}/`);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    expect(response, 'start mode server did not come up').toBeTruthy();
    expect(response.status).toEqual(200);
    expect(await response.text()).toContain('<h1>merged cli</h1>');
  } finally {
    try {
      server?.kill('SIGTERM');
    } catch {
      // The process may have already exited.
    }
    if (server) {
      await new Promise<void>((resolve) => {
        server!.once('exit', () => resolve());
        setTimeout(resolve, 5000).unref();
      });
    }
    await rm(dir, { recursive: true });
  }
});
