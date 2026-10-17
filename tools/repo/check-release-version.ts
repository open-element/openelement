/**
 * Release-input version gate for the publish workflow (autoflow-release.yml).
 *
 * The dispatch names one exact version; every retained package manifest must
 * carry it before anything is qualified or published. The manifests are read
 * through PACKAGE_CONFIGS — the same single source version-bump.ts edits — so
 * the workflow can never verify a narrower package set than the bump writes.
 * Both the input and each manifest version are validated against the strict
 * release-line contract in tools/lib/version.ts, and any mismatch or absent
 * version fails closed with a non-zero exit.
 *
 * A T7 subset dispatch checks only its listed packages:
 *   node tools/repo/check-release-version.ts <version> --packages router,ui
 *
 * Usage: node tools/repo/check-release-version.ts <version> [--packages a,b]
 */

import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { parseLineVersion } from '../lib/version.ts';
import { PACKAGE_CONFIGS, readConfigVersion, resolvePackageSubset } from './version-bump.ts';

const repoRoot = new URL('../..', import.meta.url).pathname;

const expected = process.argv[2];
if (!expected) {
  console.error('usage: check-release-version.ts <version> [--packages a,b]');
  process.exit(1);
}
let configs = PACKAGE_CONFIGS;
const packagesFlag = process.argv.findIndex(
  (arg) => arg === '--packages' || arg.startsWith('--packages='),
);
if (packagesFlag !== -1) {
  const flag = process.argv[packagesFlag];
  const value = flag.includes('=')
    ? flag.slice('--packages='.length)
    : process.argv[packagesFlag + 1];
  if (!value || value.startsWith('--')) {
    console.error('check-release-version.ts: --packages needs a comma-separated package list.');
    process.exit(1);
  }
  try {
    configs = resolvePackageSubset(value.split(','));
  } catch (error) {
    console.error(
      `check-release-version.ts: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
try {
  parseLineVersion(expected);
} catch {
  console.error(`release version "${expected}" is not a valid release-line version`);
  process.exit(1);
}

const failures: string[] = [];
for (const config of configs) {
  let actual: string | null;
  try {
    actual = readConfigVersion(await readFile(join(repoRoot, config), 'utf8'));
  } catch {
    failures.push(`${config}: manifest is unreadable`);
    continue;
  }
  if (actual === null) {
    failures.push(`${config}: no readable version field`);
    continue;
  }
  try {
    parseLineVersion(actual);
  } catch {
    failures.push(`${config}: "${actual}" is not a valid release-line version`);
    continue;
  }
  if (actual !== expected) {
    failures.push(`${config}: carries ${actual}, release input is ${expected}`);
  }
}

if (failures.length > 0) {
  console.error(`release version check failed (${failures.length}):`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(
  `release version check: all ${configs.length} checked package manifests carry ${expected}`,
);
