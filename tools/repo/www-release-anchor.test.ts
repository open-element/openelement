/**
 * tools/repo/www-release-anchor.test.ts — www version-anchor audit (#1468).
 *
 * The audit is text-level, so the cases below pin the exact module shapes it
 * accepts and rejects: OPENELEMENT_VERSION must stay derived from the
 * generated release-line module, and that module must mirror release-state
 * truth. The live tree must always pass — a failure here is the dual-version
 * bug back on screen.
 */

import { expect, test } from 'vitest';
import { join } from 'node:path';
import { wwwReleaseAnchorDrift, wwwReleaseAnchorFailures } from './www-release-anchor.ts';

const repoRoot = join(import.meta.dirname!, '..', '..');

const STATE = {
  sourceVersion: '1.0.0-alpha.5',
  packages: [
    { name: '@openelement/element', registry: { latest: '0.43.3', alpha: '1.0.0-alpha.5' } },
    { name: '@openelement/router', registry: { latest: '0.41.0-alpha.6', alpha: '1.0.0-alpha.5' } },
    { name: '@openelement/create', registry: { latest: '0.43.3', alpha: '1.0.0-alpha.5' } },
    { name: '@openelement/ui', registry: { latest: '0.43.3', alpha: '1.0.0-alpha.5' } },
  ],
};

const SITE = 'export const OPENELEMENT_VERSION = `v${SOURCE_VERSION}`;\n';
const RELEASE_LINE =
  "export const SOURCE_VERSION = '1.0.0-alpha.5';\n" +
  'export const SOURCE_LINE_PUBLISHED = true;\n' +
  "export const ALPHA_RESOLVES_TO = '1.0.0-alpha.5';\n";

test('www release anchor: derived version and fresh generated module pass', () => {
  expect(wwwReleaseAnchorFailures(STATE, SITE, RELEASE_LINE)).toEqual([]);
});

test('www release anchor: a hand-written OPENELEMENT_VERSION is rejected', () => {
  const handwritten = "export const OPENELEMENT_VERSION = 'v1.0.0-alpha.5';\n";
  const failures = wwwReleaseAnchorFailures(STATE, handwritten, RELEASE_LINE);
  expect(failures.some((f) => f.includes('OPENELEMENT_VERSION must stay derived'))).toEqual(true);
});

test('www release anchor: a stale generated module is rejected', () => {
  const stale = RELEASE_LINE.replace('1.0.0-alpha.5', '1.0.0-alpha.4');
  const failures = wwwReleaseAnchorFailures(STATE, SITE, stale);
  expect(
    failures.some((f) =>
      f.includes(
        'SOURCE_VERSION 1.0.0-alpha.4 must equal release-state sourceVersion 1.0.0-alpha.5',
      ),
    ),
  ).toEqual(true);
});

test('www release anchor: SOURCE_LINE_PUBLISHED mirrors the @alpha dist-tags', () => {
  // A partial train (one package's @alpha behind the source version) must
  // read as unpublished.
  const partialState = {
    ...STATE,
    packages: STATE.packages.map((entry) =>
      entry.name === '@openelement/router'
        ? { ...entry, registry: { ...entry.registry, alpha: '1.0.0-alpha.4' } }
        : entry,
    ),
  };
  const failures = wwwReleaseAnchorFailures(partialState, SITE, RELEASE_LINE);
  expect(failures.some((f) => f.includes('SOURCE_LINE_PUBLISHED must be false'))).toEqual(true);
  // And the committed module claiming `true` for the published state matches.
  expect(wwwReleaseAnchorFailures(STATE, SITE, RELEASE_LINE)).toEqual([]);
});

test('www release anchor: ALPHA_RESOLVES_TO follows the create package', () => {
  const wrong = RELEASE_LINE.replace(
    "ALPHA_RESOLVES_TO = '1.0.0-alpha.5'",
    "ALPHA_RESOLVES_TO = '0.43.3'",
  );
  const failures = wwwReleaseAnchorFailures(STATE, SITE, wrong);
  expect(failures.some((f) => f.includes('ALPHA_RESOLVES_TO must be 1.0.0-alpha.5'))).toEqual(true);
});

test('www release anchor: the live tree is consistent', async () => {
  expect(await wwwReleaseAnchorDrift(repoRoot)).toEqual([]);
});
