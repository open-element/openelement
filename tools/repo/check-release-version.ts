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
 * Usage: deno run --allow-read tools/repo/check-release-version.ts <version>
 */

import { join } from '@std/path';
import { parseLineVersion } from '../lib/version.ts';
import { PACKAGE_CONFIGS, readConfigVersion } from './version-bump.ts';

const repoRoot = new URL('../..', import.meta.url).pathname;

const expected = Deno.args[0];
if (!expected) {
  console.error('usage: check-release-version.ts <version>');
  Deno.exit(1);
}
try {
  parseLineVersion(expected);
} catch {
  console.error(`release version "${expected}" is not a valid release-line version`);
  Deno.exit(1);
}

const failures: string[] = [];
for (const config of PACKAGE_CONFIGS) {
  let actual: string | null;
  try {
    actual = readConfigVersion(await Deno.readTextFile(join(repoRoot, config)));
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
  Deno.exit(1);
}
console.log(
  `release version check: all ${PACKAGE_CONFIGS.length} package manifests carry ${expected}`,
);
