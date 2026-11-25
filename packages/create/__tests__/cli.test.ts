import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { expect, test } from 'vitest';
import { createInstallCommand } from '../src/install-command.ts';
import { detectPackageManager, devCommand } from '../src/pm.ts';
import { inPlaceProjectName, validateProjectName } from '../src/template-builder.ts';
import { CREATE_VERSION } from '../src/version.ts';
import {
  assertCleanError,
  directInvocationEnv,
  packageDir,
  runCreateExpectingFailure,
  runCreateOk,
} from './cli-fixture.ts';

const gitAvailable = spawnSync('git', ['--version'], { stdio: 'ignore' }).status === 0;

// The packed-CLI test drives the release toolchain's pnpm script; on hosts
// without pnpm on PATH (probe below) it cannot run at all, so it skips there
// and stays active in CI where pnpm is the package manager.
const pnpmAvailable = spawnSync('pnpm', ['--version'], { stdio: 'ignore' }).status === 0;

test('source CLI generates the showcase starter with git init and the boxed handoff', async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'open-create-source-'));
  try {
    // --no-install keeps the default-install plumbing out of the unit lane
    // (the fake-PM test below owns it); git init runs by default.
    const executable = join(packageDir, 'src', 'cli.ts');
    const stdout = await runCreateOk(executable, tmpRoot, 'sample-app', '--no-install');
    const appDir = join(tmpRoot, 'sample-app');
    expect(existsSync(join(appDir, '.gitignore'))).toBeTruthy();
    expect(existsSync(join(appDir, 'gitignore.tmpl'))).toBeFalsy();
    // Default git: the repository is initialized without --git.
    if (gitAvailable) {
      expect(existsSync(join(appDir, '.git')), 'default run must git init').toBeTruthy();
    }
    // B5 (ADR-0161): the scaffold is a Node project — package.json manifest,
    // generated tsconfig, no Deno config anywhere.
    expect(existsSync(join(appDir, 'deno.json'))).toBeFalsy();
    const manifest = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'));
    expect(JSON.stringify(manifest).includes('${v.')).toBeFalsy();
    expect(existsSync(join(appDir, 'tsconfig.json'))).toBeTruthy();
    // The showcase surfaces are on disk: about page, ping route, both islands,
    // and no retired surface.
    expect(existsSync(join(appDir, 'app', 'routes', 'about.tsx'))).toBeTruthy();
    expect(existsSync(join(appDir, 'app', 'routes', 'api', 'ping.ts'))).toBeTruthy();
    expect(existsSync(join(appDir, 'app', 'islands', 'live-timer.tsx'))).toBeTruthy();
    expect(existsSync(join(appDir, 'app', 'islands', 'my-counter.tsx'))).toBeTruthy();
    expect(existsSync(join(appDir, 'app', 'routes', 'blog'))).toBeFalsy();
    expect(existsSync(join(appDir, 'app', 'routes', 'contact.tsx'))).toBeFalsy();
    expect(existsSync(join(appDir, 'app', 'styles', 'theme.css'))).toBeTruthy();
    expect(existsSync(join(appDir, 'README.md'))).toBeTruthy();
    // The auto-registered layout and the manager-neutral surface: no
    // workspace file, no `packageManager` pin, no manager-specific specifier
    // anywhere on disk (scaffold product assertions — the same surface the
    // starter-smoke gate drives).
    expect(existsSync(join(appDir, 'app', 'layout.tsx'))).toBeTruthy();
    expect(existsSync(join(appDir, 'pnpm-workspace.yaml'))).toBeFalsy();
    expect('packageManager' in manifest).toBeFalsy();
    // The boxed handoff names the next commands, the docs, and the generator
    // version (a cached `npx` run resolves whatever copy it first downloaded,
    // so the box is where a stale generator announces itself — #1634). The
    // per-file `created …` listing is asserted with the scaffold output; this
    // block asserts the BOX itself.
    expect(stdout.includes('cd sample-app'), stdout).toBeTruthy();
    expect(stdout.includes('run dev'), stdout).toBeTruthy();
    expect(
      stdout.includes(`@openelement/create ${CREATE_VERSION}`),
      `handoff box must carry the generator version:\n${stdout}`,
    ).toBeTruthy();
    // toContain, not includes(): CodeQL reads `<string>.includes('<domain>')`
    // as URL-substring matching and flags the domain-in-string pattern.
    expect(stdout).toContain('openelement.org');
    // The template confirmation resolves non-interactively (non-TTY skips).
    expect(stdout.includes('template: showcase'), stdout).toBeTruthy();
  } finally {
    rmSync(tmpRoot, { recursive: true });
  }
});

test('#1530 flags: --no-git skips the repository, -t showcase pins the template', async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'open-create-flags-'));
  try {
    const executable = join(packageDir, 'src', 'cli.ts');
    await runCreateOk(
      executable,
      tmpRoot,
      'no-git-app',
      '--no-install',
      '--no-git',
      '-t',
      'showcase',
    );
    expect(
      existsSync(join(tmpRoot, 'no-git-app', '.git')),
      '--no-git must skip git init',
    ).toBeFalsy();
    expect(existsSync(join(tmpRoot, 'no-git-app', '.gitignore'))).toBeTruthy();
    const stdout = await runCreateOk(
      executable,
      tmpRoot,
      'pinned-app',
      '--no-install',
      '--no-git',
      '--template=showcase',
    );
    expect(stdout.includes('template: showcase'), stdout).toBeTruthy();
  } finally {
    rmSync(tmpRoot, { recursive: true });
  }
});

test('L9: contradictory or incoherent flags fail with clean actionable errors', async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'open-create-flags-'));
  try {
    const executable = join(packageDir, 'src', 'cli.ts');
    const cases: Array<[string[], string]> = [
      [['--install', '--no-install'], 'mutually exclusive'],
      [['--git', '--no-git'], 'mutually exclusive'],
      [['--start', '--no-install'], '--start needs'],
      [['--bogus'], 'Unknown flag'],
      [['a', 'b'], 'Unexpected extra argument'],
      [['--no-install', '--no-git', '-t', 'nope'], 'Unknown template'],
      [['--template'], '--template requires a value'],
    ];
    for (const [extra, fragment] of cases) {
      const stderr = await runCreateExpectingFailure(executable, tmpRoot, 'sample-app', ...extra);
      expect(
        stderr.includes(fragment),
        `${extra.join(' ')}: expected "${fragment}" in:\n${stderr}`,
      ).toBeTruthy();
      assertCleanError(stderr);
    }
    // Every failure happened before any filesystem work.
    expect(existsSync(join(tmpRoot, 'sample-app'))).toBeFalsy();
  } finally {
    rmSync(tmpRoot, { recursive: true });
  }
});

test('usage documents the new flag surface beside the canonical install command', async () => {
  const child = spawn(process.execPath, [join(packageDir, 'src', 'cli.ts'), '--help'], {
    cwd: packageDir,
  });
  const [out, err] = await Promise.all([
    Array.fromAsync(child.stdout!),
    Array.fromAsync(child.stderr!),
  ]);
  const code = await new Promise<number>((resolve) => child.once('exit', (c) => resolve(c ?? -1)));
  const stdout = Buffer.concat(out).toString();
  expect(code).toEqual(0);
  expect(Buffer.concat(err).toString()).toEqual('');
  // First line stays the canonical install command (the starter-smoke gate
  // compares exactly that line against createInstallCommand()).
  expect(stdout.startsWith(`Usage (Alpha): ${createInstallCommand()}`), stdout).toBeTruthy();
  for (const flag of [
    '-t, --template',
    '--install',
    '--no-install',
    '--start',
    '--git',
    '--no-git',
    '--help',
  ]) {
    expect(stdout.includes(flag), `usage must document ${flag}`).toBeTruthy();
  }
  expect(stdout.includes('(default: showcase)'), stdout).toBeTruthy();
  expect(stdout.includes('(default: install)'), stdout).toBeTruthy();
  expect(stdout.includes('(default: git init)'), stdout).toBeTruthy();
  // The target positional documents the three accepted shapes: a bare name
  // (new or empty directory) and `.` for the current directory.
  expect(stdout.includes('target directory: new or empty'), stdout).toBeTruthy();
  expect(stdout.includes('"." scaffolds into the current directory'), stdout).toBeTruthy();
});

test('no arguments: usage on stdout, exit 1, canonical command first', async () => {
  const child = spawn(process.execPath, [join(packageDir, 'src', 'cli.ts')], { cwd: packageDir });
  const [out, err] = await Promise.all([
    Array.fromAsync(child.stdout!),
    Array.fromAsync(child.stderr!),
  ]);
  const code = await new Promise<number>((resolve) => child.once('exit', (c) => resolve(c ?? -1)));
  const stdout = Buffer.concat(out).toString();
  expect(code).toEqual(1);
  expect(stdout.startsWith(`Usage (Alpha): ${createInstallCommand()}`), stdout).toBeTruthy();
  expect(Buffer.concat(err).toString().includes('a project name is required')).toBeTruthy();
});

test('L11: the in-place project name is derived from the directory into a legal name', () => {
  // `npm create @openelement .` writes the manifest name, and the host
  // directory name is not the CLI's choice: derive, don't validate.
  expect(inPlaceProjectName('/tmp/my-app')).toEqual('my-app');
  expect(inPlaceProjectName('/tmp/My App')).toEqual('my-app');
  expect(inPlaceProjectName('/tmp/My_App')).toEqual('my_app');
  expect(inPlaceProjectName('/tmp/2026.Site')).toEqual('2026.site');
  expect(inPlaceProjectName('/tmp/..weird..name..')).toEqual('weird.name');
  expect(inPlaceProjectName('/')).toEqual('app');
  expect(inPlaceProjectName('/tmp/---')).toEqual('app');
  // Whatever the host directory is called, the derived name is one the
  // scaffold's own validator accepts — that is the whole point.
  for (const dir of ['/tmp/My App', '/tmp/..weird..name..', '/', '/tmp/---', '/tmp/ÄÖÜ']) {
    expect(validateProjectName(inPlaceProjectName(dir)), dir).toEqual(null);
  }
  expect(inPlaceProjectName(`/tmp/${'x'.repeat(300)}`).length).toBeLessThanOrEqual(214);
});

test('L11: project name validation enforces npm-name and traversal rules', () => {
  for (const name of ['my-app', 'app', 'my_app', 'app2', '2app', 'my.app', 'a']) {
    expect(validateProjectName(name), name).toEqual(null);
  }
  const invalid: Array<[string, string]> = [
    ['MyApp', 'lowercase'],
    ['my app', 'may only contain'],
    ['foo/bar', 'may only contain'],
    ['.hidden', 'may only contain'],
    ['_private', 'may only contain'],
    ['-leading', 'may only contain'],
    ['../escape', '".."'],
    ['a..b', '".."'],
    ['x'.repeat(215), '214'],
  ];
  for (const [name, fragment] of invalid) {
    const message = validateProjectName(name);
    expect(message !== null, `expected "${name}" to be rejected`).toBeTruthy();
    expect(
      message.includes(fragment),
      `"${name}": expected "${fragment}" in "${message}"`,
    ).toBeTruthy();
  }
});

test('L9/L11: CLI rejects an invalid project name with a clean actionable error', async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'open-create-invalid-'));
  try {
    const stderr = await runCreateExpectingFailure(
      join(packageDir, 'src', 'cli.ts'),
      tmpRoot,
      'Bad Name',
      '--no-install',
      '--no-git',
    );
    expect(stderr.includes('Invalid project name'), stderr).toBeTruthy();
    assertCleanError(stderr);
    expect(existsSync(join(tmpRoot, 'Bad Name'))).toBeFalsy();
  } finally {
    rmSync(tmpRoot, { recursive: true });
  }
});

test('L9: a non-empty target is refused with its conflicting entries, never a delete instruction', async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'open-create-exists-'));
  try {
    const executable = join(packageDir, 'src', 'cli.ts');
    const occupied = join(tmpRoot, 'sample-app');
    mkdirSync(join(occupied, 'src'), { recursive: true });
    writeFileSync(join(occupied, 'notes.txt'), 'not mine\n');
    const stderr = await runCreateExpectingFailure(
      executable,
      tmpRoot,
      'sample-app',
      '--no-install',
      '--no-git',
    );
    expect(stderr.includes('not empty'), stderr).toBeTruthy();
    // The message names what is in the way — sorted, so it is deterministic.
    expect(stderr.includes('notes.txt'), stderr).toBeTruthy();
    expect(stderr.includes('src'), stderr).toBeTruthy();
    // The scaffold refuses rather than merging into files it does not own, and
    // it never tells the reader to delete a directory it did not create.
    expect(/remove the existing directory/i.test(stderr), stderr).toBeFalsy();
    expect(/rm -rf|delete the directory/i.test(stderr), stderr).toBeFalsy();
    assertCleanError(stderr);
    // Nothing was written into the occupied directory.
    expect(existsSync(join(occupied, 'package.json'))).toBeFalsy();
  } finally {
    rmSync(tmpRoot, { recursive: true });
  }
});

test('an existing EMPTY target directory is scaffolded in place', async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'open-create-empty-'));
  try {
    const executable = join(packageDir, 'src', 'cli.ts');
    // The user made the directory first (a bare `mkdir`, an editor, a picker):
    // the scaffold fills it instead of refusing a target it never touched.
    mkdirSync(join(tmpRoot, 'pre-made-app'));
    const stdout = await runCreateOk(
      executable,
      tmpRoot,
      'pre-made-app',
      '--no-install',
      '--no-git',
    );
    const appDir = join(tmpRoot, 'pre-made-app');
    expect(existsSync(join(appDir, 'package.json'))).toBeTruthy();
    expect(existsSync(join(appDir, 'app', 'routes', 'index.tsx'))).toBeTruthy();
    expect(JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8')).name).toEqual(
      'pre-made-app',
    );
    expect(stdout.includes('created at ./pre-made-app/'), stdout).toBeTruthy();
  } finally {
    rmSync(tmpRoot, { recursive: true });
  }
});

test('`.` scaffolds into the current directory and derives the manifest name from it', async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'open-create-cwd-'));
  try {
    const executable = join(packageDir, 'src', 'cli.ts');
    // A host directory whose name is not a legal npm package name (a space,
    // uppercase) — the in-place run must still generate a legal manifest.
    const appDir = join(tmpRoot, 'My App');
    mkdirSync(appDir);
    const stdout = await runCreateOk(executable, appDir, '.', '--no-install', '--no-git');
    expect(existsSync(join(appDir, 'package.json'))).toBeTruthy();
    expect(JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8')).name).toEqual('my-app');
    // In place means in place: no `<cwd>/./` copy and no subdirectory.
    expect(existsSync(join(appDir, 'My App'))).toBeFalsy();
    expect(stdout.includes('the current directory'), stdout).toBeTruthy();
    // A `cd .` line would be noise; the box only names a subdirectory target.
    expect(stdout.includes('cd .'), stdout).toBeFalsy();
    expect(stdout.includes(devCommand(detectPackageManager())), stdout).toBeTruthy();
  } finally {
    rmSync(tmpRoot, { recursive: true });
  }
});

test('`.` in a non-empty directory is the same safe refusal, and a file target is refused too', async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'open-create-cwd-occupied-'));
  try {
    const executable = join(packageDir, 'src', 'cli.ts');
    mkdirSync(join(tmpRoot, 'work'));
    writeFileSync(join(tmpRoot, 'work', 'existing.txt'), 'x\n');
    const stderr = await runCreateExpectingFailure(
      executable,
      join(tmpRoot, 'work'),
      '.',
      '--no-install',
      '--no-git',
    );
    expect(stderr.includes('not empty'), stderr).toBeTruthy();
    expect(stderr.includes('existing.txt'), stderr).toBeTruthy();
    expect(/remove the existing directory/i.test(stderr), stderr).toBeFalsy();
    expect(existsSync(join(tmpRoot, 'work', 'package.json'))).toBeFalsy();
    assertCleanError(stderr);

    // A plain file is not a directory target either.
    writeFileSync(join(tmpRoot, 'file-app'), 'not a directory\n');
    const fileStderr = await runCreateExpectingFailure(
      executable,
      tmpRoot,
      'file-app',
      '--no-install',
      '--no-git',
    );
    expect(fileStderr.includes('is not a directory'), fileStderr).toBeTruthy();
    assertCleanError(fileStderr);
  } finally {
    rmSync(tmpRoot, { recursive: true });
  }
});

test('an occupied target names at most five entries and summarizes the rest', async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'open-create-many-'));
  try {
    const occupied = join(tmpRoot, 'busy-app');
    mkdirSync(occupied);
    const entries = ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt', 'f.txt', 'g.txt'];
    for (const entry of entries) writeFileSync(join(occupied, entry), 'x\n');
    const stderr = await runCreateExpectingFailure(
      join(packageDir, 'src', 'cli.ts'),
      tmpRoot,
      'busy-app',
      '--no-install',
      '--no-git',
    );
    expect(stderr.includes('7 entries'), stderr).toBeTruthy();
    expect(stderr.includes('a.txt, b.txt, c.txt, d.txt, e.txt'), stderr).toBeTruthy();
    expect(stderr.includes('(+2 more)'), stderr).toBeTruthy();
    expect(stderr.includes('f.txt'), stderr).toBeFalsy();
    assertCleanError(stderr);
  } finally {
    rmSync(tmpRoot, { recursive: true });
  }
});

test('a target inside an existing repository skips git init with a note', async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'open-create-nested-'));
  try {
    const executable = join(packageDir, 'src', 'cli.ts');
    // The enclosing checkout: a scaffold dropped into it is a subdirectory of
    // that repository, not a new one.
    mkdirSync(join(tmpRoot, '.git'));
    const appDir = join(tmpRoot, 'nested-app');
    const stdout = await runCreateOk(executable, tmpRoot, 'nested-app', '--no-install');
    expect(existsSync(join(appDir, '.git')), 'no nested repository may be created').toBeFalsy();
    expect(existsSync(join(appDir, '.gitignore')), 'the ignore rules still ship').toBeTruthy();
    expect(stdout.includes('inside the git repository'), stdout).toBeTruthy();
    expect(stdout.includes('skipping git init'), stdout).toBeTruthy();
    // The skip is a note, not a question: nothing was asked of stdin.
    expect(stdout.includes('Template to scaffold'), stdout).toBeFalsy();

    // --no-git still means "no repository work at all", note included.
    const quiet = await runCreateOk(executable, tmpRoot, 'quiet-app', '--no-install', '--no-git');
    expect(quiet.includes('git init'), quiet).toBeFalsy();
  } finally {
    rmSync(tmpRoot, { recursive: true });
  }
});

test('the template is never asked for: a bare run takes showcase even when stdio claims a TTY', async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'open-create-tty-'));
  try {
    const executable = join(packageDir, 'src', 'cli.ts');
    // A data: URL seam flips isTTY on without a real terminal, so the run takes
    // the branch the old confirmation prompt lived on. stdin stays open and
    // unanswered: if anything asked a question, this run would hang instead of
    // exiting 0 (the timeout below turns that regression into a failure).
    const ttySeam =
      'data:text/javascript,' +
      "Object.defineProperty(process.stdin,'isTTY',{value:true});" +
      "Object.defineProperty(process.stdout,'isTTY',{value:true});";
    const child = spawn(
      process.execPath,
      ['--import', ttySeam, executable, 'tty-app', '--no-install', '--no-git'],
      { cwd: tmpRoot, stdio: ['pipe', 'pipe', 'pipe'], env: directInvocationEnv() },
    );
    const [out] = await Promise.all([Array.fromAsync(child.stdout!)]);
    const code = await Promise.race([
      new Promise<number>((resolve) => child.once('exit', (c) => resolve(c ?? -1))),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 20_000).unref()),
    ]);
    if (code === 'timeout') child.kill('SIGKILL');
    const stdout = Buffer.concat(out).toString();
    expect(code, `the TTY run must not wait on an answer:\n${stdout}`).toEqual(0);
    expect(stdout.includes('Template to scaffold'), stdout).toBeFalsy();
    expect(stdout.includes('template: showcase'), stdout).toBeTruthy();
    expect(existsSync(join(tmpRoot, 'tty-app', 'package.json'))).toBeTruthy();
  } finally {
    rmSync(tmpRoot, { recursive: true });
  }
});

test.skipIf(process.platform === 'win32')(
  'L9: CLI reports scaffolding write failures cleanly and actionably',
  async function fn() {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'open-create-readonly-'));
    try {
      mkdirSync(join(tmpRoot, 'readonly'));
      chmodSync(join(tmpRoot, 'readonly'), 0o555);
      const stderr = await runCreateExpectingFailure(
        join(packageDir, 'src', 'cli.ts'),
        join(tmpRoot, 'readonly'),
        'sample-app',
        '--no-install',
        '--no-git',
      );
      expect(
        stderr.includes('Permission denied') || stderr.includes('Failed to'),
        stderr,
      ).toBeTruthy();
      expect(stderr.includes('sample-app'), stderr).toBeTruthy();
      assertCleanError(stderr);
    } finally {
      chmodSync(join(tmpRoot, 'readonly'), 0o755);
      rmSync(tmpRoot, { recursive: true });
    }
  },
);

test.skipIf(!pnpmAvailable)(
  'the packed CLI scaffolds starter files and scripts for the packed router bin (#1633)',
  async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'open-create-packed-'));
    try {
      // One release dry-run produces both tarballs consumed by this starter.
      const repoRoot = join(packageDir, '..', '..');
      const pack = spawnSync('pnpm', ['--dir', 'tools/release', 'run', 'pack:dry-run'], {
        cwd: repoRoot,
      });
      expect(pack.status, pack.stderr.toString()).toEqual(0);

      const routerTarball = join(
        repoRoot,
        'packages',
        'router',
        `openelement-router-${CREATE_VERSION}.tgz`,
      );
      const routerRoot = join(tmpRoot, 'router');
      mkdirSync(routerRoot);
      const unpackRouter = spawnSync('tar', ['-xzf', routerTarball, '-C', routerRoot]);
      expect(unpackRouter.status, unpackRouter.stderr.toString()).toEqual(0);
      const routerManifest = JSON.parse(
        readFileSync(join(routerRoot, 'package', 'package.json'), 'utf8'),
      ) as { bin?: Record<string, string> };
      expect(Object.keys(routerManifest.bin ?? {})).toContain('openelement');
      expect(Object.keys(routerManifest.bin ?? {})).toContain('oe');
      expect(routerManifest.bin!.oe).toEqual(routerManifest.bin!.openelement);
      const target = join(routerRoot, 'package', routerManifest.bin!.openelement);
      expect(existsSync(target), `declared bin target must exist: ${target}`).toBeTruthy();
      expect(readFileSync(target, 'utf8').startsWith('#!/usr/bin/env node')).toBeTruthy();

      const createTarball = join(packageDir, `openelement-create-${CREATE_VERSION}.tgz`);
      const unpackCreate = spawnSync('tar', ['-xzf', createTarball, '-C', tmpRoot]);
      expect(unpackCreate.status, unpackCreate.stderr.toString()).toEqual(0);
      // Skip dependency installation so the assertions inspect the shipped template.
      await runCreateOk(
        join(tmpRoot, 'package', 'src', 'cli.js'),
        tmpRoot,
        'sample-app',
        '--no-install',
      );
      const manifest = JSON.parse(
        readFileSync(join(tmpRoot, 'sample-app', 'package.json'), 'utf8'),
      ) as { scripts: Record<string, string> };
      expect(manifest.scripts.build).toEqual('oe build');
      expect(manifest.scripts.start).toEqual('oe start');
      expect(manifest.scripts.dev).toEqual('oe dev');
      expect(manifest.scripts.preview).toBeUndefined();

      expect(existsSync(join(tmpRoot, 'sample-app', '.gitignore'))).toBeTruthy();
      // The Node pin is a template DOTFILE: the packed payload has to carry it
      // (the tarball is assembled from git ls-files + the templates glob, not
      // `npm pack`, which would drop it).
      const nodeVersionPath = join(tmpRoot, 'sample-app', '.node-version');
      expect(existsSync(nodeVersionPath), 'the packed scaffold ships .node-version').toBeTruthy();
      expect(readFileSync(nodeVersionPath, 'utf8').trim()).toMatch(/^\d+\.\d+\.\d+$/);
      expect(existsSync(join(tmpRoot, 'sample-app', 'app', 'routes', 'about.tsx'))).toBeTruthy();
      expect(
        existsSync(join(tmpRoot, 'sample-app', 'app', 'routes', 'api', 'ping.ts')),
      ).toBeTruthy();
      expect(existsSync(join(tmpRoot, 'sample-app', 'README.md'))).toBeTruthy();
      // The page components live in their route modules (server function pages),
      // so the packed payload's page surface is the route tree.
      expect(existsSync(join(tmpRoot, 'sample-app', 'app', 'routes', 'index.tsx'))).toBeTruthy();
      expect(existsSync(join(tmpRoot, 'sample-app', 'app', 'routes', '404.tsx'))).toBeTruthy();
      expect(
        existsSync(join(tmpRoot, 'sample-app', 'app', 'components', 'page-home.tsx')),
      ).toBeFalsy();
      // The manager-neutral scaffold survives the pack too: the layout ships,
      // and no pnpm-only workspace file does. (The scaffold is generated with
      // --no-install above, so this reads the shipped template surface; an
      // install-time pnpm bookkeeping file cannot mask a template regression.)
      expect(existsSync(join(tmpRoot, 'sample-app', 'app', 'layout.tsx'))).toBeTruthy();
      expect(existsSync(join(tmpRoot, 'sample-app', 'pnpm-workspace.yaml'))).toBeFalsy();
      // No non-npm registry reference may ship in packed scaffolds, not just
      // workspace runs.
      // B5 (ADR-0161): the packed scaffold is a Node project — the
      // manifest and tsconfig ship, no Deno config does.
      expect(existsSync(join(tmpRoot, 'sample-app', 'package.json'))).toBeTruthy();
      expect(existsSync(join(tmpRoot, 'sample-app', 'tsconfig.json'))).toBeTruthy();
      expect(existsSync(join(tmpRoot, 'sample-app', 'deno.json'))).toBeFalsy();
      expect(existsSync(join(tmpRoot, 'sample-app', '.npmrc'))).toBeFalsy();
    } finally {
      rmSync(tmpRoot, { recursive: true });
    }
  },
  300_000,
);
