import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { expect, test } from 'vitest';
import {
  detectInvokingPackageManager,
  detectPackageManager,
  devCommand,
  installDependenciesCommand,
  PACKAGE_MANAGERS,
  resolvePackageManager,
} from '../src/pm.ts';
import { assertCleanError, directInvocationEnv, packageDir, runCreateOk } from './cli-fixture.ts';

test.skipIf(process.platform === 'win32')(
  'default install runs through the detected package manager (fake-PM probe)',
  async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'open-create-pm-'));
    try {
      // A fake pnpm earlier on PATH records its argv and exits 0: the default
      // (--install) path runs without network, and the detection order (pnpm
      // ahead of the other three) is observable in the recorded invocation.
      const binDir = join(tmpRoot, 'bin');
      mkdirSync(binDir);
      const invocationLog = join(tmpRoot, 'invocations.log');
      writeFileSync(join(binDir, 'pnpm'), `#!/bin/sh\necho "$@" >> ${invocationLog}\nexit 0\n`, {
        mode: 0o755,
      });
      const child = spawn(process.execPath, [join(packageDir, 'src', 'cli.ts'), 'pm-app'], {
        cwd: tmpRoot,
        env: directInvocationEnv({ PATH: `${binDir}:${process.env.PATH}` }),
      });
      const [out] = await Promise.all([Array.fromAsync(child.stdout!)]);
      const code = await new Promise<number>((resolve) =>
        child.once('exit', (c) => resolve(c ?? -1)),
      );
      const stdout = Buffer.concat(out).toString();
      expect(code, stdout).toEqual(0);
      const invocations = readFileSync(invocationLog, 'utf8').trim().split('\n');
      // Probe (--version) then the install command, both through pnpm.
      expect(invocations[0], invocations.join('\n')).toContain('--version');
      expect(
        invocations.some((line) => line.includes('install')),
        `expected an install invocation: ${invocations.join('\n')}`,
      ).toBeTruthy();
      expect(stdout.includes('Installing dependencies with pnpm'), stdout).toBeTruthy();
    } finally {
      rmSync(tmpRoot, { recursive: true });
    }
  },
);

test.skipIf(process.platform === 'win32')(
  'detection falls through pnpm to npm when pnpm is not on PATH (fake-PM probe)',
  async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'open-create-npm-'));
    try {
      // PATH carries node plus a fake npm and NOTHING else: pnpm, yarn and bun
      // cannot be probed, so the install must run through npm — the alpha.15
      // fall-through the pnpm-only template made impossible.
      const binDir = join(tmpRoot, 'bin');
      mkdirSync(binDir);
      symlinkSync(process.execPath, join(binDir, 'node'));
      const invocationLog = join(tmpRoot, 'invocations.log');
      writeFileSync(join(binDir, 'npm'), `#!/bin/sh\necho "$@" >> ${invocationLog}\nexit 0\n`, {
        mode: 0o755,
      });
      const child = spawn(process.execPath, [join(packageDir, 'src', 'cli.ts'), 'npm-app'], {
        cwd: tmpRoot,
        env: directInvocationEnv({ PATH: resolve(binDir) }),
      });
      const [out, err] = await Promise.all([
        Array.fromAsync(child.stdout!),
        Array.fromAsync(child.stderr!),
      ]);
      const code = await new Promise<number>((resolve) =>
        child.once('exit', (c) => resolve(c ?? -1)),
      );
      const stdout = Buffer.concat(out).toString();
      expect(code, `${stdout}\n${Buffer.concat(err).toString()}`).toEqual(0);
      const invocations = readFileSync(invocationLog, 'utf8').trim().split('\n');
      expect(invocations[0], invocations.join('\n')).toContain('--version');
      expect(
        invocations.some((line) => line.includes('install')),
        `expected an npm install invocation: ${invocations.join('\n')}`,
      ).toBeTruthy();
      expect(stdout.includes('Installing dependencies with npm'), stdout).toBeTruthy();
    } finally {
      rmSync(tmpRoot, { recursive: true });
    }
  },
);

test('manager detection prefers pnpm, then npm, yarn, bun — and answers null when none exists', () => {
  // The order is the contract (pnpm first for the repository's own tooling
  // habit), the fall-through is what makes the scaffold manager-neutral, and
  // an empty PATH is the ONE failure case. Injected probes pin all three
  // without touching the host's PATH.
  const only = (available: string) => (pm: string) => pm === available;
  expect(detectPackageManager(only('pnpm'))).toEqual('pnpm');
  expect(detectPackageManager(() => true)).toEqual('pnpm');
  expect(detectPackageManager((pm) => pm !== 'pnpm')).toEqual('npm');
  expect(detectPackageManager((pm) => pm === 'yarn' || pm === 'bun')).toEqual('yarn');
  expect(detectPackageManager((pm) => pm === 'bun')).toEqual('bun');
  expect(detectPackageManager(() => false)).toEqual(null);
  // Every candidate is offered the probe, in the documented order.
  const probed: string[] = [];
  detectPackageManager((pm) => {
    probed.push(pm);
    return false;
  });
  expect(probed).toEqual([...PACKAGE_MANAGERS]);
});

test('invoking-manager detection reads the user agent, then exec path, then argv[1]', () => {
  // TPL-02: a packed npm-create run must spell npm, not pnpm, even when pnpm
  // sits on PATH. These signals are the ones each manager exports to its
  // child; the precedence is agent, exec path, runner name.
  expect(
    detectInvokingPackageManager(
      { npm_config_user_agent: 'npm/11.6.0 node/v24.18.0 darwin arm64 workspaces/false' },
      ['node', '/pkg/src/cli.ts'],
    ),
  ).toEqual('npm');
  expect(
    detectInvokingPackageManager(
      { npm_config_user_agent: 'pnpm/12.8.1 npm/? node/v24.18.0 darwin arm64' },
      ['node', '/pkg/src/cli.ts'],
    ),
  ).toEqual('pnpm');
  expect(
    detectInvokingPackageManager({ npm_config_user_agent: 'yarn/4.5.0 npm/? node/v24.18.0' }, []),
  ).toEqual('yarn');
  expect(detectInvokingPackageManager({ npm_config_user_agent: 'bun/1.2.0' }, [])).toEqual('bun');

  // A signal that names no manager (corepack is a shim over one, not one) is
  // not an answer: the next signal decides.
  expect(
    detectInvokingPackageManager(
      {
        npm_config_user_agent: 'corepack/0.34.0 node/v24.18.0',
        npm_execpath: '/opt/pnpm/bin/pnpm.cjs',
      },
      [],
    ),
  ).toEqual('pnpm');
  // The exec path is matched on the basename, pnpm first (pnpm contains npm).
  expect(
    detectInvokingPackageManager(
      { npm_execpath: '/usr/local/lib/node_modules/npm/bin/npm-cli.js' },
      [],
    ),
  ).toEqual('npm');
  expect(
    detectInvokingPackageManager({ npm_execpath: 'C:\\Program Files\\nodejs\\npm.cmd' }, []),
  ).toEqual('npm');
  expect(detectInvokingPackageManager({ npm_execpath: '/usr/lib/yarn/bin/yarn.js' }, [])).toEqual(
    'yarn',
  );
  // The runner name is the last resort, and a direct node run names the CLI
  // file itself: no signal.
  expect(detectInvokingPackageManager({}, ['node', '/usr/local/bin/pnpm.cjs'])).toEqual('pnpm');
  expect(detectInvokingPackageManager({}, ['node', '/usr/local/bin/bunx'])).toEqual('bun');
  expect(detectInvokingPackageManager({}, ['node', '/pkg/src/cli.ts'])).toEqual(null);
  expect(detectInvokingPackageManager({}, [])).toEqual(null);
});

test('resolvePackageManager prefers the invoking manager over every PATH probe', () => {
  // The probe would answer pnpm, but npm invoked this run: npm wins and the
  // probe is never consulted (the invoking manager is running by definition).
  let probed = false;
  expect(
    resolvePackageManager({
      env: { npm_config_user_agent: 'npm/11.6.0 node/v24.18.0' },
      argv: ['node', '/pkg/src/cli.ts'],
      probe: () => {
        probed = true;
        return true;
      },
    }),
  ).toEqual('npm');
  expect(probed).toBeFalsy();
  // No wrapper named itself: the PATH probe decides in its documented order.
  expect(
    resolvePackageManager({
      env: {},
      argv: ['node', '/pkg/src/cli.ts'],
      probe: (pm) => pm === 'yarn',
    }),
  ).toEqual('yarn');
  expect(resolvePackageManager({ env: {}, argv: [], probe: () => false })).toEqual(null);
});

test.skipIf(process.platform === 'win32')(
  'the handoff spells the INVOKING manager, not the first one on PATH (TPL-02)',
  async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'open-create-invoked-'));
    try {
      // PATH carries a fake pnpm, so the PATH probe would answer pnpm. The run
      // was invoked through npm (the packed npm-create scenario): every
      // printed next step must be npm's.
      const binDir = join(tmpRoot, 'bin');
      mkdirSync(binDir);
      symlinkSync(process.execPath, join(binDir, 'node'));
      writeFileSync(join(binDir, 'pnpm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      const executable = join(packageDir, 'src', 'cli.ts');
      const runHandoff = async (
        name: string,
        agent: string,
      ): Promise<{ code: number; stdout: string }> => {
        const child = spawn(process.execPath, [executable, name, '--no-install', '--no-git'], {
          cwd: tmpRoot,
          env: directInvocationEnv({
            PATH: `${binDir}:${process.env.PATH}`,
            npm_config_user_agent: agent,
          }),
        });
        const [out] = await Promise.all([Array.fromAsync(child.stdout!)]);
        const code = await new Promise<number>((resolve) =>
          child.once('exit', (c) => resolve(c ?? -1)),
        );
        return { code, stdout: Buffer.concat(out).toString() };
      };

      const npmRun = await runHandoff(
        'npm-invoked-app',
        'npm/11.6.0 node/v24.18.0 darwin arm64 workspaces/false',
      );
      expect(npmRun.code, npmRun.stdout).toEqual(0);
      expect(
        npmRun.stdout.includes('npm install      # install dependencies'),
        npmRun.stdout,
      ).toBeTruthy();
      expect(
        npmRun.stdout.includes('npm run dev      # start the dev server'),
        npmRun.stdout,
      ).toBeTruthy();
      // The manager merely on PATH must not appear in the box at all.
      expect(npmRun.stdout.includes('pnpm '), npmRun.stdout).toBeFalsy();

      const pnpmRun = await runHandoff(
        'pnpm-invoked-app',
        'pnpm/12.8.1 npm/? node/v24.18.0 darwin arm64',
      );
      expect(pnpmRun.code, pnpmRun.stdout).toEqual(0);
      expect(
        pnpmRun.stdout.includes('pnpm install      # install dependencies'),
        pnpmRun.stdout,
      ).toBeTruthy();
      expect(
        pnpmRun.stdout.includes('pnpm run dev      # start the dev server'),
        pnpmRun.stdout,
      ).toBeTruthy();
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  },
);

test.skipIf(process.platform === 'win32')(
  'the default install drives the invoking manager even when another is on PATH (TPL-02)',
  async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'open-create-invoked-install-'));
    try {
      const binDir = join(tmpRoot, 'bin');
      mkdirSync(binDir);
      symlinkSync(process.execPath, join(binDir, 'node'));
      const log = join(tmpRoot, 'invocations.log');
      // Both managers exist on PATH; only the INVOKED one may be run, and it
      // is used directly (no --version probe: the wrapper is already running).
      for (const name of ['npm', 'pnpm']) {
        writeFileSync(join(binDir, name), `#!/bin/sh\necho "${name} $@" >> ${log}\nexit 0\n`, {
          mode: 0o755,
        });
      }
      const child = spawn(process.execPath, [join(packageDir, 'src', 'cli.ts'), 'invoked-app'], {
        cwd: tmpRoot,
        env: directInvocationEnv({
          PATH: `${binDir}:${process.env.PATH}`,
          npm_config_user_agent: 'npm/11.6.0 node/v24.18.0 darwin arm64 workspaces/false',
        }),
      });
      const [out, err] = await Promise.all([
        Array.fromAsync(child.stdout!),
        Array.fromAsync(child.stderr!),
      ]);
      const code = await new Promise<number>((resolve) =>
        child.once('exit', (c) => resolve(c ?? -1)),
      );
      const stdout = Buffer.concat(out).toString();
      expect(code, `${stdout}\n${Buffer.concat(err).toString()}`).toEqual(0);
      expect(stdout.includes('Installing dependencies with npm'), stdout).toBeTruthy();
      const invocations = readFileSync(log, 'utf8').trim().split('\n');
      expect(invocations).toHaveLength(1);
      expect(invocations[0], invocations.join('\n')).toContain('install');
      expect(invocations[0]!.startsWith('npm '), invocations.join('\n')).toBeTruthy();
      expect(stdout.includes('npm run dev      # start the dev server'), stdout).toBeTruthy();
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  },
);

test('a host without any package manager fails naming all four, with the files intact', async () => {
  // PATH keeps node (already running this process) and nothing else, so none
  // of the four probes resolves. The scaffold must still be written — the
  // message has to leave the user something to install into — and the run
  // must name every manager it accepts instead of demanding one of them.
  const binDir = `node${process.pid}-bin`;
  mkdirSync(binDir, { recursive: true });
  symlinkSync(process.execPath, join(binDir, 'node'));
  const tmpRoot = `node${process.pid}-no-pm`;
  mkdirSync(tmpRoot, { recursive: true });
  try {
    const child = spawn(process.execPath, [join(packageDir, 'src', 'cli.ts'), 'no-pm-app'], {
      cwd: tmpRoot,
      env: directInvocationEnv({ PATH: resolve(binDir) }),
    });
    const writes = await Promise.all([
      Array.fromAsync(child.stdout!),
      Array.fromAsync(child.stderr!),
    ]);
    const code = await new Promise<number>((resolve) =>
      child.once('exit', (c) => resolve(c ?? -1)),
    );
    const stderr = Buffer.concat(writes[1]!).toString();
    expect(code).toEqual(1);
    expect(stderr.includes('No package manager found'), stderr).toBeTruthy();
    for (const pm of PACKAGE_MANAGERS) {
      expect(stderr.includes(pm), `${pm} must be named in: ${stderr}`).toBeTruthy();
    }
    expect(stderr.includes('npm install'), stderr).toBeTruthy();
    assertCleanError(stderr);
    // The files survive: the message tells the user to install in place, and
    // nothing manager-specific is required to do it.
    expect(existsSync(join(tmpRoot, 'no-pm-app', 'package.json'))).toBeTruthy();
    expect(existsSync(join(tmpRoot, 'no-pm-app', 'node_modules'))).toBeFalsy();

    // The same PATH with --no-install is a SUCCESS: the handoff falls back to
    // npm's universal spelling for both commands, so a host with no manager at
    // all still gets a runnable next step instead of a requirement.
    const noInstall = spawn(
      process.execPath,
      [join(packageDir, 'src', 'cli.ts'), 'no-pm-handoff-app', '--no-install', '--no-git'],
      { cwd: tmpRoot, env: directInvocationEnv({ PATH: resolve(binDir) }) },
    );
    const [out] = await Promise.all([Array.fromAsync(noInstall.stdout!)]);
    const noInstallCode = await new Promise<number>((resolve) =>
      noInstall.once('exit', (c) => resolve(c ?? -1)),
    );
    const handoff = Buffer.concat(out).toString();
    expect(noInstallCode, handoff).toEqual(0);
    expect(handoff.includes('npm install      # install dependencies'), handoff).toBeTruthy();
    expect(handoff.includes('npm run dev      # start the dev server'), handoff).toBeTruthy();
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
  }
});

test('the --no-install handoff teaches the install command before the dev command', async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'open-create-handoff-'));
  try {
    const executable = join(packageDir, 'src', 'cli.ts');
    const stdout = await runCreateOk(
      executable,
      tmpRoot,
      'handoff-app',
      '--no-install',
      '--no-git',
    );
    // The box spells both commands for the manager THIS host would have used
    // (the same four probes the install step runs) — never a bare `npm run dev`
    // that would exit 127 in a project with no node_modules.
    const pm = detectPackageManager();
    const installLine = `${installDependenciesCommand(pm)}`;
    const devLine = `${devCommand(pm)}`;
    const installAt = stdout.indexOf(`${installLine}      # install dependencies`);
    const devAt = stdout.indexOf(`${devLine}      # start the dev server`);
    expect(installAt, stdout).toBeGreaterThanOrEqual(0);
    expect(devAt, stdout).toBeGreaterThan(installAt);
    expect(stdout.includes('cd handoff-app'), stdout).toBeTruthy();
    // The project really has no dependencies yet: the install line is not
    // decorative.
    expect(existsSync(join(tmpRoot, 'handoff-app', 'node_modules'))).toBeFalsy();
  } finally {
    rmSync(tmpRoot, { recursive: true });
  }
});
