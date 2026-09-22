/**
 * tools/repo/version-bump.test.ts — six-point bump contract (#1415).
 *
 * The dry run is the acceptance surface: it must report exactly the four
 * package configs, the CREATE_VERSION anchor, and the registry fixture locks
 * whose recorded `@<version>` links really change. `--write` is exercised
 * against a copy of the tree pieces it owns (never the live repo).
 */

import { assert, assertEquals } from '@std/assert';
import { join } from '@std/path';
import { prereleaseParts } from '../lib/version.ts';
import {
  inconsistencyFailures,
  LOCK_FILES,
  PACKAGE_CONFIGS,
  planVersionBump,
  readConfigVersion,
  rewriteConfigVersion,
  rewriteCreateVersion,
  rewriteLockVersion,
  validateVersion,
  VERSION_SOURCE,
} from './version-bump.ts';

const repoRoot = join(import.meta.dirname!, '..', '..');

Deno.test('version-bump: the six points are the four configs, the anchor, and the locks', () => {
  assertEquals(PACKAGE_CONFIGS, [
    'packages/element/deno.json',
    'packages/router/deno.json',
    'packages/create/deno.json',
    'packages/ui/deno.json',
  ]);
  assertEquals(VERSION_SOURCE, 'packages/create/src/version.ts');
  assertEquals(LOCK_FILES.length, 6);
});

Deno.test('version-bump: version input is validated', () => {
  assertEquals(validateVersion('1.0.0-alpha.4'), null);
  assertEquals(validateVersion('1.0.0'), null);
  for (const bad of ['alpha', 'v1.0.0-alpha.4', '^1.0.0', '', '1.0']) {
    assert(validateVersion(bad), `"${bad}" must be rejected`);
  }
});

Deno.test('version-bump: rewriters move only the version token', () => {
  const config =
    `{\n  "name": "@openelement/element",\n  "version": "1.0.0-alpha.2",\n  "description": "1.0.0-alpha.2 stays"\n}`;
  assertEquals(
    rewriteConfigVersion(config, '1.0.0-alpha.2', '1.0.0-alpha.3'),
    `{\n  "name": "@openelement/element",\n  "version": "1.0.0-alpha.3",\n  "description": "1.0.0-alpha.2 stays"\n}`,
  );
  const anchor =
    "/** The published CLI version. */\nexport const CREATE_VERSION = '1.0.0-alpha.2';\n\nexport const VITE_STARTER_PIN = '8.0.16';\n";
  const rewritten = rewriteCreateVersion(anchor, '1.0.0-alpha.2', '1.0.0-alpha.3');
  assert(rewritten.includes("CREATE_VERSION = '1.0.0-alpha.3'"), rewritten);
  assert(rewritten.includes("VITE_STARTER_PIN = '8.0.16'"), rewritten);
  const lock =
    '{\n      "jsr:@openelement/router@1.0.0-alpha.2": {\n        "dependencies": []\n      }\n}';
  assertEquals(
    rewriteLockVersion(lock, '1.0.0-alpha.2', '1.0.0-alpha.3'),
    '{\n      "jsr:@openelement/router@1.0.0-alpha.3": {\n        "dependencies": []\n      }\n}',
  );
});

Deno.test('version-bump: dry run reports every point against the live tree', async () => {
  // The dry-run target is derived from the live tree, not hardcoded: this test
  // once pinned `1.0.0-alpha.4` as the "next" version, which is exactly the
  // version the tree reaches after the alpha.4 bump — at which point the dry run
  // correctly reports "nothing to do" and the assertions below fail on a
  // legitimate tree. Advancing the trailing prerelease identifier keeps the
  // test about the knob's reporting contract instead of about which train is
  // being cut.
  const current = readConfigVersion(await Deno.readTextFile(join(repoRoot, PACKAGE_CONFIGS[0])));
  const parts = prereleaseParts(current ?? '');
  assert(parts, `the live tree must declare a prerelease line version, got ${current}`);
  const target = `${parts.base}-${parts.name}.${parts.num + 1}`;
  const plan = await planVersionBump(repoRoot, target);
  assertEquals(
    plan.currentVersion,
    readConfigVersion(
      await Deno.readTextFile(join(repoRoot, PACKAGE_CONFIGS[0])),
    ),
  );
  assert(plan.currentVersion !== target);
  // Points 1-5: all four configs plus the anchor carry the bumped token.
  assertEquals(
    plan.edits.map((edit) => edit.path),
    [...PACKAGE_CONFIGS, VERSION_SOURCE],
  );
  assertEquals(plan.edits.filter((edit) => edit.point === 'package-config').length, 4);
  assertEquals(plan.edits.filter((edit) => edit.point === 'create-anchor').length, 1);
  // Point 6: only the locks that record an @openelement workspace link.
  for (const edit of plan.lockEdits) {
    assert(edit.point === 'fixture-lock', edit.path);
    assert(
      edit.after.includes(`@${target}`) && !edit.after.includes(`@${plan.currentVersion}`),
      edit.path,
    );
  }
  // Byte-identical shared universe (router-native-framework ↔ router-request-time)
  // must stay byte-identical after the predicted rewrite.
  const native = plan.lockEdits.find((edit) => edit.path.includes('router-native-framework'));
  const requestTime = plan.lockEdits.find((edit) => edit.path.includes('router-request-time'));
  if (native && requestTime) assertEquals(native.after, requestTime.after);
});

Deno.test('version-bump: consistency check reports the points that lag', async () => {
  // The live tree is consistent with its own version.
  const current = readConfigVersion(
    await Deno.readTextFile(join(repoRoot, PACKAGE_CONFIGS[0])),
  )!;
  assertEquals(await inconsistencyFailures(repoRoot, current), []);
  // A different expected version reports every point.
  const failures = await inconsistencyFailures(repoRoot, '9.9.9');
  assertEquals(failures.length, 5 + 4);
  assert(failures.some((line) => line.startsWith(VERSION_SOURCE)), failures.join('\n'));
});
