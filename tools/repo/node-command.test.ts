/**
 * planWin32Spawn unit coverage (defect: `spawn npm ENOENT` on win32 — npm/pnpm
 * are `.cmd` shims that CreateProcess cannot execute without a shell).
 *
 * The planner is pure and injectable (platform, env, file probe), so the whole
 * win32 surface is exercised here on POSIX hosts; the POSIX path itself is
 * asserted to be a no-op.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { statSync } from 'node:fs';
import { expect, test } from 'vitest';
import { planWin32Spawn } from './node-command.ts';

const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

/** File probe over an explicit candidate set (exact strings, case-sensitive). */
function files(...candidates: string[]): (path: string) => boolean {
  return (path) => candidates.includes(path);
}

test('planWin32Spawn is a no-op on POSIX platforms', () => {
  const everything = () => true;
  expect(
    planWin32Spawn(
      'npm',
      ['install'],
      'linux',
      { PATH: 'C:\\tools', PATHEXT: DEFAULT_PATHEXT },
      everything,
    ),
  ).toEqual(null);
  expect(planWin32Spawn('npm', ['install'], 'darwin', { PATH: 'C:\\tools' }, everything)).toEqual(
    null,
  );
});

test('planWin32Spawn leaves extension-bearing and path-qualified commands untouched', () => {
  const everything = () => true;
  const env = { PATH: 'C:\\tools', PATHEXT: DEFAULT_PATHEXT };
  expect(planWin32Spawn('node.exe', ['--version'], 'win32', env, everything)).toEqual(null);
  expect(planWin32Spawn('node_modules/.bin/vite', ['build'], 'win32', env, everything)).toEqual(
    null,
  );
  expect(planWin32Spawn('C:\\tools\\tool', [], 'win32', env, everything)).toEqual(null);
});

test('planWin32Spawn spawns a resolved .exe directly with verbatim args (no shell)', () => {
  const git = join('C:\\tools', 'git.EXE');
  expect(
    planWin32Spawn(
      'git',
      ['status', '--porcelain'],
      'win32',
      { PATH: 'C:\\tools', PATHEXT: DEFAULT_PATHEXT },
      files(git),
    ),
  ).toEqual({ file: git, args: ['status', '--porcelain'], verbatim: false });
});

test('planWin32Spawn routes a resolved .cmd shim through cmd.exe /d /s /c', () => {
  const npm = join('C:\\tools', 'npm.CMD');
  expect(
    planWin32Spawn(
      'npm',
      ['install', '--no-audit'],
      'win32',
      { PATH: 'C:\\tools', PATHEXT: DEFAULT_PATHEXT },
      files(npm),
    ),
  ).toEqual({
    file: 'cmd.exe',
    args: ['/d', '/s', '/c', `"${npm} install --no-audit"`],
    verbatim: true,
  });
});

test('planWin32Spawn honors a comspec override', () => {
  const npm = join('C:\\tools', 'npm.CMD');
  const plan = planWin32Spawn(
    'npm',
    [],
    'win32',
    { PATH: 'C:\\tools', PATHEXT: DEFAULT_PATHEXT, comspec: 'C:\\Windows\\system32\\cmd.exe' },
    files(npm),
  );
  expect(plan?.file).toEqual('C:\\Windows\\system32\\cmd.exe');
});

test('planWin32Spawn prefers the PATHEXT order: .exe wins over .cmd', () => {
  const exe = join('C:\\a', 'tool.EXE');
  const cmd = join('C:\\a', 'tool.CMD');
  expect(
    planWin32Spawn(
      'tool',
      [],
      'win32',
      { PATH: 'C:\\a', PATHEXT: DEFAULT_PATHEXT },
      files(exe, cmd),
    ),
  ).toEqual({ file: exe, args: [], verbatim: false });
});

test('planWin32Spawn wraps non-exe PATHEXT hits (e.g. .JS) through cmd.exe like the shell would', () => {
  const js = join('C:\\a', 'tool.JS');
  expect(
    planWin32Spawn('tool', [], 'win32', { PATH: 'C:\\a', PATHEXT: '.JS;.EXE' }, files(js))
      ?.verbatim,
  ).toEqual(true);
});

test('planWin32Spawn falls back to the default PATHEXT when unset', () => {
  const npm = join('C:\\npm-dir', 'npm.CMD');
  expect(planWin32Spawn('npm', [], 'win32', { PATH: 'C:\\npm-dir' }, files(npm))?.verbatim).toEqual(
    true,
  );
});

test('planWin32Spawn returns null when nothing resolves (CreateProcess keeps its own PATH+.exe search)', () => {
  expect(
    planWin32Spawn(
      'definitely-missing',
      [],
      'win32',
      { PATH: 'C:\\a;C:\\b', PATHEXT: DEFAULT_PATHEXT },
      () => false,
    ),
  ).toEqual(null);
});

test('planWin32Spawn skips empty PATH segments and unwraps quoted legacy entries', () => {
  const git = join('C:\\a b', 'git.EXE');
  expect(
    planWin32Spawn(
      'git',
      [],
      'win32',
      { PATH: `;"C:\\a b"`, PATHEXT: DEFAULT_PATHEXT },
      files(git),
    ),
  ).toEqual({ file: git, args: [], verbatim: false });
});

test('planWin32Spawn cmd-quotes arguments with spaces and the resolved shim path when it has one', () => {
  const spacedDir = 'C:\\Program Files\\nodejs';
  const npm = join(spacedDir, 'npm.CMD');
  expect(
    planWin32Spawn(
      'npm',
      ['install', 'file:C:\\my dir\\x.tgz'],
      'win32',
      { PATH: spacedDir, PATHEXT: DEFAULT_PATHEXT },
      files(npm),
    ),
  ).toEqual({
    file: 'cmd.exe',
    // The spaced shim path is quoted inside the line; /s then strips only the
    // outer pair, leaving `"<npm>" install "<arg>"` for cmd to parse.
    args: ['/d', '/s', '/c', `""${npm}" install "file:C:\\my dir\\x.tgz""`],
    verbatim: true,
  });
});

test('planWin32Spawn doubles embedded quotes and preserves empty args through the cmd route', () => {
  const npm = join('C:\\tools', 'npm.CMD');
  expect(
    planWin32Spawn(
      'npm',
      ['exec', 'say "hi"', ''],
      'win32',
      { PATH: 'C:\\tools', PATHEXT: DEFAULT_PATHEXT },
      files(npm),
    ),
  ).toEqual({
    file: 'cmd.exe',
    args: ['/d', '/s', '/c', `"${npm} exec "say ""hi""" """`],
    verbatim: true,
  });
});

test('planWin32Spawn fails closed on an argument containing % (cmd expands %VAR% even inside quotes)', () => {
  const npm = join('C:\\tools', 'npm.CMD');
  expect(() =>
    planWin32Spawn(
      'npm',
      ['install', 'pkg@1%PATH%'],
      'win32',
      { PATH: 'C:\\tools', PATHEXT: DEFAULT_PATHEXT },
      files(npm),
    ),
  ).toThrow(/%/);
});

test('planWin32Spawn resolves against a real filesystem probe (production probe shape)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-node-command-test-'));
  try {
    const npm = join(dir, 'npm.CMD');
    await writeFile(npm, '@echo off\r\n');
    // Mirror of the production isFile probe (node-command.ts keeps it private).
    const isFile = (path: string): boolean => {
      try {
        return statSync(path).isFile();
      } catch {
        return false;
      }
    };
    const plan = planWin32Spawn('npm', ['install'], 'win32', { PATH: dir }, isFile);
    expect(plan?.verbatim).toEqual(true);
    expect(plan?.args.join(' ')).toContain(npm);
    // A directory (not a regular file) must not resolve.
    expect(planWin32Spawn('npm', ['install'], 'win32', { PATH: tmpdir() }, isFile)).toEqual(null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
