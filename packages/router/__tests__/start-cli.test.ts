/**
 * @openelement/router — merged serve CLI contract (#859, ADR-0123
 * item 4): `cli/start` and `cli/preview` are one command with a mode flag.
 * Covers the mode parser plus the two refusal paths and a real static-serve
 * boot of start mode.
 */

import { expect, test } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { join } from 'node:path';
import { OpenElementError } from '@openelement/element/authoring';
import { extractServeMode } from '../src/internal/serve-mode.ts';
import { writePublishOutput } from '../src/vite/internal/publish-manifest.ts';
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

function runCli(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
): Promise<{ code: number; output: string }> {
  return runCommand(cwd, startCli, args, env);
}

async function runCommand(
  cwd: string,
  command: string,
  args: string[],
  env: Record<string, string> = {},
): Promise<{ code: number; output: string }> {
  // The start CLI is node-hosted (B1a); the run passes the env through so the
  // child sees OPEN_ELEMENT_PORT/HOST.
  const child = spawn(process.execPath, [command, ...args], {
    cwd,
    env: { ...process.env, ...env },
  });
  const exited = new Promise<number>((resolve) => {
    child.once('exit', (code) => resolve(code ?? -1));
  });
  const [out, err] = await Promise.all([
    Array.fromAsync(child.stdout),
    Array.fromAsync(child.stderr),
  ]);
  const output = Buffer.concat([...out, ...err]).toString();
  return { code: await exited, output };
}

test('start cli: both modes refuse when dist/ is missing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'start-cli-'));
  try {
    for (const args of [[], ['--mode=preview']]) {
      const { code, output } = await runCli(dir, args);
      expect(code).toEqual(1);
      // The guidance names the router's own manager-neutral build command
      // (`oe build`), not a package-manager shorthand: the scaffold ships no
      // packageManager pin, so a `pnpm build` spelling would be wrong advice.
      expect(output).toContain('not found. Run `oe build` first.');
    }
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('start and publish reject missing, modified, and unexpected public output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'start-publish-'));
  const dist = join(dir, 'dist');
  const upload = join(dir, 'dist-public');
  const manifest = join(dist, 'publish-manifest.json');
  const routerCli = join(import.meta.dirname!, '../src/cli/cli.ts');
  try {
    await mkdir(dist);
    await writeFile(join(dist, 'index.html'), 'public marker');
    await writeFile(join(dist, 'ordinary-staging-note.txt'), 'staging marker');
    writePublishOutput(dist, ['index.html']);
    await expect(access(join(upload, 'ordinary-staging-note.txt'))).rejects.toThrow();
    const check = () => runCommand(dir, routerCli, ['publish', '--check']);
    expect((await check()).code).toBe(0);

    const rejects = async () => {
      const results = await Promise.all([runCli(dir, []), check()]);
      for (const { code, output } of results) {
        expect(code).toBe(1);
        expect(output).toContain('publish-manifest.json');
      }
    };

    await writeFile(join(upload, 'ordinary-extra.txt'), 'unexpected marker');
    await rejects();
    await rm(join(upload, 'ordinary-extra.txt'));
    await symlink(join(dist, 'ordinary-staging-note.txt'), join(upload, 'ordinary-link.txt'));
    await rejects();
    await rm(join(upload, 'ordinary-link.txt'));
    await writeFile(join(upload, 'index.html'), 'edited marker');
    await rejects();
    writePublishOutput(dist, ['index.html']);
    await writeFile(manifest, '{}');
    await rejects();
    await rm(manifest);
    await rejects();
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
    // The refusal points at the router bin's own start subcommand (`oe start`,
    // with the `openelement start` long alias on the next line) — the
    // manager-neutral spelling the generated starter's `start` script uses.
    expect(output).toContain('Use: oe start');
    expect(output).toContain('(or: openelement start)');
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

test('start cli: an occupied port answers one actionable line and exits 1', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'start-cli-'));
  const occupier = createServer();
  await new Promise<void>((resolve) => occupier.listen(0, '127.0.0.1', resolve));
  const { port } = occupier.address() as AddressInfo;
  try {
    await mkdir(join(dir, 'dist'), { recursive: true });
    await writeFile(join(dir, 'dist', 'index.html'), '<h1>port busy</h1>\n');
    writePublishOutput(join(dir, 'dist'), ['index.html']);

    const { code, output } = await runCli(dir, [], {
      OPEN_ELEMENT_PORT: String(port),
      OPEN_ELEMENT_HOST: '127.0.0.1',
    });
    expect(code).toEqual(1);
    expect(output).toContain('already in use (EADDRINUSE)');
    expect(output).toContain(`port ${port}`);
    expect(output).toContain('OPEN_ELEMENT_PORT');
    // The success line waits for 'listening' (#1413 bar): a failed bind
    // must not print the serving URL, and no raw stack may follow.
    expect(output).not.toContain(`http://127.0.0.1:${port}`);
    expect(
      !/\n\s+at .*:\d+:\d+/.test(output),
      `occupied-port failure must not print a raw stack, got:\n${output}`,
    ).toBeTruthy();
  } finally {
    await new Promise<void>((resolve) => occupier.close(() => resolve()));
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
    writePublishOutput(join(dir, 'dist'), []);

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
    writePublishOutput(join(dir, 'dist'), []);

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
    await writeFile(join(dir, 'dist', '404.html'), '<h1>cli not found</h1>\n');
    writePublishOutput(join(dir, 'dist'), ['index.html', '404.html']);

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

    // KR-7 at the CLI layer: an unmatched route answers the build's error
    // document with a 404 status, and direct access to the document keeps
    // that status. HEAD reports the same status without a body.
    const unmatched = await fetch(`http://127.0.0.1:${freePort}/no-such-page`);
    expect(unmatched.status).toEqual(404);
    expect(await unmatched.text()).toEqual('<h1>cli not found</h1>\n');
    expect(unmatched.headers.get('content-type')).toEqual('text/html; charset=UTF-8');

    const direct = await fetch(`http://127.0.0.1:${freePort}/404.html`);
    expect(direct.status).toEqual(404);
    expect(await direct.text()).toEqual('<h1>cli not found</h1>\n');

    const head = await fetch(`http://127.0.0.1:${freePort}/no-such-page`, { method: 'HEAD' });
    expect(head.status).toEqual(404);
    expect(await head.text()).toEqual('');
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

test('start cli: preview mode serves the SAME static contract as start mode', async () => {
  // Regression (alpha13 artifact honesty): preview used to delegate to
  // `vite preview`, whose index.html fallback answered 200 with the home
  // page for every miss AND for extensionless pretty URLs like /about.
  // Two static serving modes must not disagree — preview rides the same
  // static-serve dispatch, so the contract below is byte-for-byte the one
  // the start-mode test above pins.
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
    await mkdir(join(dir, 'dist', 'about'), { recursive: true });
    await writeFile(join(dir, 'dist', 'index.html'), '<h1>merged cli</h1>\n');
    await writeFile(join(dir, 'dist', 'about', 'index.html'), '<h1>about page</h1>\n');
    await writeFile(join(dir, 'dist', '404.html'), '<h1>cli not found</h1>\n');
    writePublishOutput(join(dir, 'dist'), ['index.html', 'about/index.html', '404.html']);

    server = spawn(
      process.execPath,
      [startCli, '--mode=preview', '--port', String(freePort), '--host', '127.0.0.1'],
      { cwd: dir, stdio: 'ignore' },
    );

    let response: Response | undefined;
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        response = await fetch(`http://127.0.0.1:${freePort}/`);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    expect(response, 'preview mode server did not come up').toBeTruthy();
    expect(response.status).toEqual(200);
    expect(await response.text()).toContain('<h1>merged cli</h1>');

    // A pretty URL without the trailing slash resolves the REAL page — not
    // the SPA fallback's 200-with-index.html the vite-preview path answered.
    const about = await fetch(`http://127.0.0.1:${freePort}/about`);
    expect(about.status).toEqual(200);
    expect(await about.text()).toEqual('<h1>about page</h1>\n');

    // A miss answers the build's error document with a 404 status.
    const unmatched = await fetch(`http://127.0.0.1:${freePort}/nope`);
    expect(unmatched.status).toEqual(404);
    expect(await unmatched.text()).toEqual('<h1>cli not found</h1>\n');
    expect(unmatched.headers.get('content-type')).toEqual('text/html; charset=UTF-8');

    // Direct access to the error document keeps the 404 it denotes.
    const direct = await fetch(`http://127.0.0.1:${freePort}/404.html`);
    expect(direct.status).toEqual(404);
    expect(await direct.text()).toEqual('<h1>cli not found</h1>\n');
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

test('start cli: preview mode probes the next port when the requested one is busy', async () => {
  // vite-preview parity kept on purpose: a busy port is not a failure, the
  // server moves up until one binds (strictPort would turn it into one).
  const dir = await mkdtemp(join(tmpdir(), 'start-cli-'));
  const occupier = createServer();
  await new Promise<void>((resolve) => occupier.listen(0, '127.0.0.1', resolve));
  const { port: busyPort } = occupier.address() as AddressInfo;

  let server: ChildProcess | undefined;
  try {
    await mkdir(join(dir, 'dist'), { recursive: true });
    await writeFile(join(dir, 'dist', 'index.html'), '<h1>probed port</h1>\n');
    writePublishOutput(join(dir, 'dist'), ['index.html']);

    server = spawn(
      process.execPath,
      [startCli, '--mode=preview', '--port', String(busyPort), '--host', '127.0.0.1'],
      { cwd: dir, stdio: 'ignore' },
    );

    // The probe starts at busyPort+1; on a noisy host it may climb further,
    // so poll the first few candidates rather than exactly one.
    let response: Response | undefined;
    for (let attempt = 0; attempt < 100 && response === undefined; attempt++) {
      for (let offset = 1; offset <= 3; offset++) {
        try {
          const probe = await fetch(`http://127.0.0.1:${busyPort + offset}/`);
          if (probe.status === 200 && (await probe.text()).includes('probed port')) {
            response = probe;
            break;
          }
        } catch {
          // Not up on this candidate (yet).
        }
      }
      if (response === undefined) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    expect(response, 'preview did not come up on a probed next port').toBeTruthy();
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
    await new Promise<void>((resolve) => occupier.close(() => resolve()));
    await rm(dir, { recursive: true });
  }
});
// ─── CLI-01: help early-exit + unknown arguments fail closed ────────────────

/** An ephemeral port the OS just handed out and took back. */
async function freePort(): Promise<number> {
  const probe = createServer();
  const port = await new Promise<number>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => resolve((probe.address() as AddressInfo).port));
  });
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

test('start cli: --help/-h prints usage and exits 0 without touching the filesystem', async () => {
  // A cwd with NO dist/: reaching the missing-dist check would exit 1, so an
  // exit-0 usage answer proves help runs before that filesystem work.
  const dir = await mkdtemp(join(tmpdir(), 'start-cli-'));
  const port = await freePort();
  try {
    for (const args of [['--help'], ['-h'], ['--mode=preview', '--help'], ['--bogus', '--help']]) {
      const { code, output } = await runCli(dir, args, {
        OPEN_ELEMENT_PORT: String(port),
        OPEN_ELEMENT_HOST: '127.0.0.1',
      });
      expect(code, 'args=' + args.join(' ') + ':\n' + output).toEqual(0);
      expect(output).toContain('Usage: openelement start [options]');
      // The usage documents the modes, the two environment variables, the
      // mode/preview flags, and --debug.
      expect(output).toContain('--mode=preview');
      expect(output).toContain('--debug');
      expect(output).toContain('OPEN_ELEMENT_PORT');
      expect(output).toContain('OPEN_ELEMENT_HOST');
      expect(output).toContain('--port');
      expect(output).toContain('--host');
      // No boot happened: no listening line, no missing-dist refusal. The
      // ephemeral port stays closed after the process exits.
      expect(output).not.toContain('http://');
      expect(output).not.toContain('not found. Run');
      await expect(fetch('http://127.0.0.1:' + port + '/')).rejects.toThrow();
    }
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('start cli: unknown start-mode arguments fail closed with the env guidance', async () => {
  // No dist/ on purpose: a usage error must answer before the filesystem
  // check, so an EXIT 2 here cannot be the missing-dist path (which is 1).
  const dir = await mkdtemp(join(tmpdir(), 'start-cli-'));
  const port = await freePort();
  try {
    for (const [args, needle] of [
      [['--bogus'], 'unexpected argument "--bogus"'],
      [['extra-positional'], 'unexpected argument "extra-positional"'],
      [['--port', String(port)], 'start mode has no --port flag'],
      [['--port=' + port], 'start mode has no --port flag'],
      [['--host', '127.0.0.1'], 'start mode has no --host flag'],
      [['--strictPort'], 'unexpected argument "--strictPort"'],
      [['--debug', '--port', String(port)], 'start mode has no --port flag'],
    ] as const) {
      const { code, output } = await runCli(dir, [...args]);
      expect(code, args.join(' ') + ' must be a usage error (exit 2):\n' + output).toEqual(2);
      expect(output).toContain(needle);
      // One actionable line points at the environment, not a dead end.
      expect(output).toContain('OPEN_ELEMENT_PORT');
      expect(output).toContain('OPEN_ELEMENT_HOST');
      expect(output).toContain('--mode=preview');
      // The failed invocation never bound the port and never printed a URL.
      expect(output).not.toContain('http://');
      expect(output).not.toContain('not found. Run');
      await expect(fetch('http://127.0.0.1:' + port + '/')).rejects.toThrow();
    }
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('start cli: unknown --mode values are usage errors (exit 2)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'start-cli-'));
  try {
    for (const args of [['--mode=bogus'], ['--mode', 'bogus'], ['--mode']]) {
      const { code, output } = await runCli(dir, args);
      expect(code, 'args=' + args.join(' ') + ':\n' + output).toEqual(2);
      expect(output).toContain('Start failed:');
    }
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('start cli: preview mode still owns its --port/--host/--strictPort flags', async () => {
  // The fail-closed rule above is specific to start mode: the same flags ride
  // the preview mode's documented vite-preview ergonomics. The build has no
  // dist/server, so preview boots on the requested port; --strictPort turns a
  // busy port into the actionable failure instead of probing upward.
  const dir = await mkdtemp(join(tmpdir(), 'start-cli-'));
  const occupier = createServer();
  await new Promise<void>((resolve) => occupier.listen(0, '127.0.0.1', resolve));
  const { port: busyPort } = occupier.address() as AddressInfo;
  const port = await freePort();

  let server: ChildProcess | undefined;
  try {
    await mkdir(join(dir, 'dist'), { recursive: true });
    await writeFile(join(dir, 'dist', 'index.html'), '<h1>preview flags</h1>\n');
    writePublishOutput(join(dir, 'dist'), ['index.html']);

    server = spawn(
      process.execPath,
      [startCli, '--mode=preview', '--port', String(port), '--host', '--strictPort'],
      { cwd: dir, env: { ...process.env, OPEN_ELEMENT_HOST: '127.0.0.1' }, stdio: 'ignore' },
    );

    let response: Response | undefined;
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        response = await fetch('http://127.0.0.1:' + port + '/');
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    expect(response, 'preview did not come up on its own --port').toBeTruthy();
    expect(response.status).toEqual(200);
    expect(await response.text()).toContain('preview flags');
    server.kill('SIGTERM');
    await new Promise<void>((resolve) => server!.once('exit', () => resolve()));

    const strict = await runCli(
      dir,
      ['--mode=preview', '--port', String(busyPort), '--strictPort'],
      { OPEN_ELEMENT_HOST: '127.0.0.1' },
    );
    expect(strict.code).toEqual(1);
    expect(strict.output).toContain('already in use (EADDRINUSE)');
    expect(strict.output).toContain('--port');
  } finally {
    try {
      server?.kill('SIGTERM');
    } catch {
      // The process may have already exited.
    }
    await new Promise<void>((resolve) => occupier.close(() => resolve()));
    await rm(dir, { recursive: true });
  }
});
