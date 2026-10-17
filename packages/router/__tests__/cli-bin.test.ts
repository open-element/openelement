/**
 * @openelement/router — the `openelement` / `oe` bin dispatcher (#1633).
 *
 * The manifest declares `src/cli/cli.ts` as the bin target under two names —
 * `openelement` (the long, unambiguous spelling) and `oe` (the short alias) —
 * and the generated starter's scripts run `oe dev` / `oe build` / `oe start`.
 * This suite pins the dispatch contract against the subpath entries the bins
 * front, so the bins can never drift from them:
 *
 *   1. the manifest maps both bin names to the same entry file — the alias
 *      is zero-behavior-difference by construction, and every behavioral
 *      assertion below runs once per declared bin name through the target
 *      the manifest itself names (not a hardcoded path), so a renamed,
 *      dropped, or re-pointed entry fails here first;
 *   2. `dev` boots the framework dev server (the Vite server the project's
 *      vite.config.ts configures) and serves a real page; its own flags
 *      (`--port`, `--host`, ...) parse and fail closed on an unknown one;
 *   3. `start [--mode=preview]` behaves exactly like running `cli/start.ts`
 *      with the same arguments (the flag passes through verbatim);
 *   4. `build` behaves exactly like running `cli/build.ts`;
 *   5. the usage paths answer without loading any subcommand's module graph
 *      — `start` must resolve in a consumer tree that has no Vite install
 *      (the same resolution `cli/start.ts` has), which an eager import of
 *      the build or dev entry would break;
 *   6. `version` / `--version` / `-v` print the executing tree's package
 *      version (read from the router manifest beside the module, not the
 *      working directory), and the usage text names the command and the
 *      `oe` alias.
 */

import { expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { join } from 'node:path';

const pkgRoot = join(import.meta.dirname!, '..');
const repoRoot = join(pkgRoot, '..', '..');
const cliBin = join(pkgRoot, 'src/cli/cli.ts');
const startEntry = join(pkgRoot, 'src/cli/start.ts');
const buildEntry = join(pkgRoot, 'src/cli/build.ts');

/**
 * The bin map exactly as the manifest declares it. Every behavioral test
 * iterates over this map, so the suite exercises the bins npm will actually
 * materialize rather than a copy of their declaration.
 */
function declaredBins(): Record<string, string> {
  const manifest = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')) as {
    bin?: Record<string, string>;
  };
  if (!manifest.bin || typeof manifest.bin !== 'object') {
    throw new Error('[openelement] router package.json declares no bin map');
  }
  return manifest.bin;
}

/** The manifest-declared target of one bin name, resolved to an absolute path. */
function binTarget(binName: string): string {
  const target = declaredBins()[binName];
  if (typeof target !== 'string') {
    throw new Error(`[openelement] router package.json declares no "${binName}" bin`);
  }
  return join(pkgRoot, target.replace(/^\.\//, ''));
}

async function run(
  executable: string,
  args: string[],
  cwd: string,
): Promise<{ code: number; output: string }> {
  const child = spawn(process.execPath, [executable, ...args], { cwd });
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

/** An ephemeral port the OS just handed out and took back. */
async function freePort(): Promise<number> {
  const probe = createServer();
  const port = await new Promise<number>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => resolve((probe.address() as { port: number }).port));
  });
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

/**
 * Poll the dev server until it answers (the boot is asynchronous: config load,
 * plugin setup, listen). The child's captured output rides every failure so a
 * boot that dies is reported with its own error, not a bare timeout.
 */
async function pollForResponse(
  url: string,
  output: () => string,
  exited: Promise<number>,
  timeoutMs = 90_000,
): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const settled = await Promise.race([
      fetch(url).then(
        (response) => ({ kind: 'response' as const, response }),
        (error: unknown) => ({ kind: 'error' as const, error }),
      ),
      exited.then((code) => ({ kind: 'exit' as const, code })),
    ]);
    if (settled.kind === 'response') return settled.response;
    if (settled.kind === 'exit') {
      throw new Error(`dev server exited (${settled.code}) before answering:\n${output()}`);
    }
    if (Date.now() > deadline) {
      throw new Error(`dev server did not answer ${url} within ${timeoutMs}ms:\n${output()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

test('router bins: the manifest maps openelement and oe onto one shared entry', () => {
  const bins = declaredBins();
  // Exactly the two names, and both name the same file: the alias cannot
  // diverge behaviorally because there is no second dispatcher to drift.
  expect(Object.keys(bins).sort()).toEqual(['oe', 'openelement']);
  expect(bins.openelement).toEqual(bins.oe);
  // The shared target is the dispatcher this suite exercises, and it is a
  // real shebang-carrying file npm can materialize as a `.bin` shim.
  expect(binTarget('openelement')).toEqual(cliBin);
  expect(readFileSync(cliBin, 'utf8').startsWith('#!/usr/bin/env node')).toBe(true);
});

test('router bins: usage and unknown commands fail closed without a subcommand load', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-bin-'));
  try {
    // Both bin spellings, each through its manifest-declared target.
    for (const binName of Object.keys(declaredBins())) {
      const bare = await run(binTarget(binName), [], dir);
      expect(bare.code, `${binName} bare`).toEqual(1);
      expect(bare.output).toContain('Usage: openelement <command> [options]');
      expect(bare.output).toContain('build');
      expect(bare.output).toContain('start');
      expect(bare.output).toContain('dev');

      const unknown = await run(binTarget(binName), ['frobnicate'], dir);
      expect(unknown.code, `${binName} unknown`).toEqual(1);
      expect(unknown.output).toContain('Unknown command "frobnicate".');

      const help = await run(binTarget(binName), ['--help'], dir);
      expect(help.code, `${binName} help`).toEqual(0);
      expect(help.output).toContain('Usage: openelement <command> [options]');
      // The usage text names the version command, its flags (F-2), and the
      // `oe` alias the manifest declares.
      expect(help.output).toContain('version                print the router package version');
      expect(help.output).toContain('--version, -v          print the router package version');
      expect(help.output).toContain('Alias: oe <command> [options] (same entry, same behavior)');
    }
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('router bins: dev parses its own flags without booting a server', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-bin-'));
  try {
    for (const binName of Object.keys(declaredBins())) {
      // `--help` answers before any config load or listen: the usage names
      // every supported flag, so the surface is discoverable from the bin.
      const help = await run(binTarget(binName), ['dev', '--help'], dir);
      expect(help.code, `${binName} dev --help`).toEqual(0);
      expect(help.output).toContain('Usage: openelement dev [options]');
      for (const flag of ['--port', '--host', '--strictPort', '--open', '--debug']) {
        expect(help.output, `${binName} dev help must name ${flag}`).toContain(flag);
      }

      // An unknown flag fails closed with one actionable line, before the
      // server starts (a silently dropped flag is a different server).
      const unknown = await run(binTarget(binName), ['dev', '--bogus', 'x'], dir);
      expect(unknown.code, `${binName} dev --bogus`).toEqual(1);
      expect(unknown.output).toContain('Unknown flag "--bogus"');
      expect(unknown.output).toContain('oe dev --help');
      expect(unknown.output.includes('\n    at '), unknown.output).toBeFalsy();

      // A port outside the TCP range is refused the same way.
      const badPort = await run(binTarget(binName), ['dev', '--port', '99999'], dir);
      expect(badPort.code, `${binName} dev --port 99999`).toEqual(1);
      expect(badPort.output).toContain('Invalid port "99999"');
    }
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('router bins: dev boots the framework dev server and serves the app', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-dev-'));
  let child: ReturnType<typeof spawn> | undefined;
  try {
    // A consumer-shaped tree: the two resolve targets a vite.config.ts needs
    // (`vite` for defineConfig, the router for the plugin) plus the element
    // runtime the SSR module graph loads, each linked at the app root exactly
    // as an installed tree would have them. The app is one function page —
    // the smallest real route the dev server can render.
    for (const [name, target] of [
      ['@openelement/router', join(repoRoot, 'packages', 'router')],
      ['@openelement/element', join(repoRoot, 'packages', 'element')],
      ['vite', join(repoRoot, 'node_modules', 'vite')],
    ] as const) {
      const link = join(dir, 'node_modules', name);
      await mkdir(join(link, '..'), { recursive: true });
      await symlink(target, link, 'dir');
    }
    await mkdir(join(dir, 'app', 'routes'), { recursive: true });
    await writeFile(
      join(dir, 'package.json'),
      `${JSON.stringify({ name: 'oe-dev-fixture', private: true, type: 'module' }, null, 2)}\n`,
    );
    await writeFile(
      join(dir, 'vite.config.ts'),
      [
        'import { openElement } from "@openelement/router/vite";',
        'import { defineConfig } from "vite";',
        '',
        'export default defineConfig({ base: "/", plugins: [...openElement()] });',
        '',
      ].join('\n'),
    );
    await writeFile(
      join(dir, 'app', 'routes', 'index.tsx'),
      [
        'import { definePage } from "@openelement/router";',
        '',
        'export function Page() {',
        '  return <main>oe dev fixture page</main>;',
        '}',
        '',
        'export default definePage(Page);',
        '',
      ].join('\n'),
    );

    const port = await freePort();
    const binName = Object.keys(declaredBins())[0]!;
    // `--host 127.0.0.1` keeps the probe on IPv4 regardless of how the host
    // resolves `localhost`; `--strictPort` turns a busy port into a failure
    // instead of a silent second choice.
    child = spawn(
      process.execPath,
      [binTarget(binName), 'dev', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
      { cwd: dir },
    );
    let output = '';
    child.stdout!.on('data', (chunk) => (output += chunk.toString()));
    child.stderr!.on('data', (chunk) => (output += chunk.toString()));
    const exited = new Promise<number>((resolve) =>
      child!.once('exit', (code) => resolve(code ?? -1)),
    );

    const response = await pollForResponse(`http://127.0.0.1:${port}/`, () => output, exited);
    expect(response.status, output).toEqual(200);
    const html = await response.text();
    // The page is the framework's SSR output for the route, not a Vite
    // placeholder: the plugin's dev middleware rendered it.
    expect(html, output).toContain('oe dev fixture page');
  } finally {
    child?.kill('SIGKILL');
    await rm(dir, { recursive: true, force: true });
  }
}, 120_000);

test('router bins: version prints the executing tree manifest, from any cwd', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-bin-'));
  try {
    const manifest = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')) as {
      version: string;
    };
    // Both bin spellings agree, and the answer is the module-relative
    // manifest — never the working directory's (the temp cwd has no manifest
    // at all, so a cwd-relative read would throw instead of printing).
    for (const binName of Object.keys(declaredBins())) {
      for (const args of [['version'], ['--version'], ['-v']]) {
        const result = await run(binTarget(binName), args, dir);
        expect(result.code, `${binName} ${args.join(' ')}`).toEqual(0);
        expect(result.output.trim()).toEqual(manifest.version);
      }
    }
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('router bins: start and preview dispatch identically to the cli/start entry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-bin-'));
  try {
    // The entry-reference invocations do not depend on the bin name (the bins
    // dispatch to this very entry), so each runs ONCE and every bin's output
    // is compared against the shared reference instead of re-spawning the
    // entry per bin. All `start` runs must also happen BEFORE the
    // request-time fixture below: with dist/server/index.js present the
    // start mode boots a server that never exits, while the missing-dist
    // refusal is the cheap shared outcome under comparison.
    const entryStart = await run(startEntry, [], dir);
    for (const binName of Object.keys(declaredBins())) {
      const binStart = await run(binTarget(binName), ['start'], dir);
      expect(binStart.output, `${binName} start output`).toEqual(entryStart.output);
      expect(binStart.code, `${binName} start code`).toEqual(entryStart.code);
    }

    // The preview mode flag passes through verbatim, and the refusal names
    // the bin's own spelling as the alternative (#1633).
    await mkdir(join(dir, 'dist', 'server'), { recursive: true });
    await writeFile(join(dir, 'dist', 'server', 'index.js'), 'export default () => {};\n');
    const entryPreview = await run(startEntry, ['--mode=preview'], dir);
    for (const binName of Object.keys(declaredBins())) {
      const binPreview = await run(binTarget(binName), ['start', '--mode=preview'], dir);
      expect(binPreview.output, `${binName} preview output`).toEqual(entryPreview.output);
      expect(binPreview.code, `${binName} preview code`).toEqual(1);
      expect(binPreview.output).toContain('request-time routes');
      expect(binPreview.output).toContain('oe start');
      expect(binPreview.output).toContain('(or: openelement start)');
    }
  } finally {
    await rm(dir, { recursive: true });
  }
}, 180_000); // CI cold-boot cost of sequential CLI spawns of the router graph

test('router bins: build dispatches identically to the cli/build entry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-bin-'));
  try {
    // No app in the directory: both paths fail the same way, which pins that
    // `build` reaches buildApp through the same error rendering. Vite writes
    // its own progress lines first, so the shared contract is the rendered
    // `Build failed:` line (message plus the dispatcher's stack frame). Run
    // once per declared bin name.
    const entryBuild = await run(buildEntry, [], dir);
    expect(entryBuild.code).toEqual(1);
    expect(entryBuild.output).toContain('Build failed:');
    expect(entryBuild.output).toContain('Cannot resolve entry module index.html');
    for (const binName of Object.keys(declaredBins())) {
      const binBuild = await run(binTarget(binName), ['build'], dir);
      expect(binBuild.code, `${binName} build code`).toEqual(entryBuild.code);
      expect(binBuild.output, `${binName} build output`).toContain('Build failed:');
      expect(binBuild.output).toContain('Cannot resolve entry module index.html');
    }
  } finally {
    await rm(dir, { recursive: true });
  }
});
