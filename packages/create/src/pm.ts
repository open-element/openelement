/**
 * Package-manager detection for the create CLI's install/start steps.
 *
 * A separate module (not cli.ts): the module is imported by the tests, and
 * cli.ts executes the CLI at import time (top-level main), so anything the
 * tests need to call must live beside it, not inside it.
 */
import { spawnSync } from 'node:child_process';
import process from 'node:process';

/** One package-manager probe: spawn `<pm> --version` off-PATH failures give ENOENT. */
function packageManagerAvailable(pm: string): boolean {
  const probe = spawnSync(pm, ['--version'], {
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
  return probe.error === undefined && probe.status === 0;
}

/**
 * Package-manager detection (pnpm wins, npm is the floor). Both ship with
 * Node-adjacent toolchains; the first probe that answers --version wins.
 * Never returns: with no manager the CLI fails with the manual-install path.
 */
export function detectPackageManager(): 'pnpm' | 'npm' {
  for (const pm of ['pnpm', 'npm'] as const) {
    if (packageManagerAvailable(pm)) return pm;
  }
  console.error(
    'error: No package manager found (probed pnpm, then npm). Install one of them, then run the ' +
      'install step manually inside the project directory.',
  );
  process.exit(1);
}
