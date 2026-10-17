/**
 * Focused guards for the retired-API scan's hand-maintained token list.
 *
 * The defect these pin: `@openelement/protocol` stayed on the list after the
 * current six-package line reintroduced the package, so every legitimate
 * reference to a published package (its own README, the distribution page,
 * the starter catalog, the registry-synced version projection) was reported
 * as a retired reference and `gate:release`'s `retired-api:check` could never
 * pass. A name only belongs on the list while the line genuinely no longer
 * publishes it.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { RETIRED_API_TOKENS } from './retired-api-tokens.ts';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/** The workspace package names — the set of packages the line publishes. */
async function workspacePackageNames(): Promise<string[]> {
  const names: string[] = [];
  for (const entry of await readdir(join(repoRoot, 'packages'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = JSON.parse(
      await readFile(join(repoRoot, 'packages', entry.name, 'package.json'), 'utf8'),
    ) as { name?: string };
    if (manifest.name) names.push(manifest.name);
  }
  return names;
}

test('no retired token names a package the workspace still publishes', async () => {
  const live = new Set(await workspacePackageNames());
  const collisions = RETIRED_API_TOKENS.filter((token) => live.has(token));
  expect(
    collisions,
    `retired token(s) name a live workspace package: ${collisions.join(', ')} — every ` +
      'legitimate reference to it would be reported as a retired reference',
  ).toEqual([]);
});

test('the hand list keeps the genuinely retired historical entries', () => {
  // Anti-gutting guard: these names are not published by the current line, so
  // the scan must keep catching them. Without this, reaching GREEN by
  // emptying the list would look identical to fixing a stale entry.
  for (const token of [
    '@openelement/app',
    '@openelement/adapter-vite',
    'adapter-vite',
    '@openelement/core',
    '@openelement/signal',
    '@openelement/content',
    '@openelement/ssg',
    '/preact',
    'preact-render-to-string',
  ]) {
    expect(RETIRED_API_TOKENS, `${token} must stay retired`).toContain(token);
  }
});
