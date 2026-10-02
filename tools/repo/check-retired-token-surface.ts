/**
 * Retired-token-surface guard (alpha9 C1 gate surgery, #1504).
 *
 * The retired third-party token dependency was removed ENTIRELY — dependency
 * declaration, generated token sheet, generator, notices, manifest keyword,
 * docs. This gate keeps it out: any tracked file (except CHANGELOGs, which
 * are immutable history) referencing it fails the release gate. The old
 * `packages/ui#ui-tokens:check` step this replaces verified the old token
 * sheet was fresh; the new semantic is that the dependency cannot come back
 * through ANY surface — source, manifest, notice, or doc — without this
 * gate going red.
 *
 * The pattern literal is assembled at runtime (join below) so this file, its
 * own name, and the gate wiring stay inside the very invariant they enforce:
 * a repo-wide case-insensitive reference scan returns zero matches, which is
 * exactly the issue's acceptance command (the tracked-file scan excluding
 * CHANGELOGs). The pattern covers every spelling — hyphenated, camelCase, and
 * the prose space form — because review found the prose form surviving in
 * shipped copy and content docs after the hyphen-only scan went green.
 *
 * Scans `git ls-files` output, so untracked build output (dist/, drafts) and
 * node_modules never enter the scan.
 */

import { spawnSync } from 'node:child_process';
import { fromFileUrl, join } from '@std/path';
import { readFileSync } from 'node:fs';
import process from 'node:process';

const repoRoot = fromFileUrl(new URL('../../', import.meta.url));
const PATTERN = new RegExp(['open', 'props'].join('[- ]?'), 'i');
const SKIP = /(^|\/)CHANGELOG/i;

const listed = spawnSync('git', ['ls-files', '-z'], {
  cwd: repoRoot,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
});
if (listed.error) throw listed.error;
if (listed.status !== 0) throw new Error(`git ls-files exited ${listed.status}`);

const failures: string[] = [];
for (const path of listed.stdout.split('\0').filter(Boolean)) {
  if (SKIP.test(path)) continue;
  let text: string;
  try {
    text = readFileSync(join(repoRoot, path), 'utf8');
  } catch {
    continue; // deleted in the working tree — nothing to scan
  }
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (PATTERN.test(lines[i])) {
      failures.push(`${path}:${i + 1}: ${lines[i].trim().slice(0, 160)}`);
    }
  }
}

if (failures.length > 0) {
  console.error('retired-token-surface: retired token dependency references found (#1504):');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(
  'retired-token-surface: zero retired token dependency references across tracked files.',
);
