/**
 * Package-manager detection for the create CLI's install/start steps.
 *
 * A separate module (not cli.ts): the module is imported by the tests, and
 * cli.ts executes the CLI at import time (top-level main), so anything the
 * tests need to call must live beside it, not inside it.
 *
 * Manager-neutral since alpha.15. The scaffold used to pin pnpm through a
 * `catalog:` specifier in its own pnpm-workspace.yaml, and `catalog:` is a
 * pnpm-only protocol — npm rejects the manifest with EUNSUPPORTEDPROTOCOL —
 * so the probe had exactly one answer and a missing pnpm failed the run with
 * a requirement. The template now ships explicit version pins, no
 * `packageManager` field, and no workspace file, so any of the four common
 * managers installs it unchanged. Detection is therefore a preference order,
 * not a requirement: pnpm, then npm, then yarn, then bun — and only a PATH
 * with none of them fails.
 */
import { spawnSync } from 'node:child_process';
import process from 'node:process';

/** The managers the install step can drive, in detection order. */
export const PACKAGE_MANAGERS = ['pnpm', 'npm', 'yarn', 'bun'] as const;

export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

/** Probe `<pm> --version`; an off-PATH binary gives ENOENT. */
export function packageManagerAvailable(pm: PackageManager): boolean {
  const probe = spawnSync(pm, ['--version'], {
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
  return probe.error === undefined && probe.status === 0;
}

/**
 * The first available manager in {@link PACKAGE_MANAGERS} order, or `null`
 * when none of the four is on PATH. The probe is injectable so the order (and
 * the total miss) can be pinned without rewriting PATH.
 */
export function detectPackageManager(
  probe: (pm: PackageManager) => boolean = packageManagerAvailable,
): PackageManager | null {
  for (const pm of PACKAGE_MANAGERS) {
    if (probe(pm)) return pm;
  }
  return null;
}
