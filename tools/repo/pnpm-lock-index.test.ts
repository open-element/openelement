import { expect, test } from 'vitest';
import { baseLockedVersion, lockedDirectVersions, parsePnpmLockIndex } from './pnpm-lock-index.ts';

const LOCK = `lockfileVersion: '9.0'

configDependencies: {}
packageManagerDependencies:
  pnpm:
    specifier: 12.8.1
    version: 12.8.1

---
lockfileVersion: '9.0'

settings:
  autoInstallPeers: true

importers:

  .:
    devDependencies:
      vite:
        specifier: 8.1.6
        version: 8.1.6(@types/node@26.5.0)(jiti@2.7.0)
      '@tailwindcss/vite':
        specifier: 4.3.3
        version: 4.3.3(vite@8.1.6(@types/node@26.5.0))

  packages/router:
    dependencies:
      marked:
        specifier: ^15.0.0
        version: 15.0.12
      postcss:
        specifier: ^8.5.28
        version: 8.5.28
      '@openelement/element':
        specifier: workspace:*
        version: link:../element

  packages/ui:
    dependencies:
      postcss:
        specifier: ^8.5.31
        version: 8.5.31
`;

test('baseLockedVersion strips pnpm peer contexts and workspace links', () => {
  expect(baseLockedVersion('4.3.3(vite@8.1.6(@types/node@26.5.0))')).toBe('4.3.3');
  expect(baseLockedVersion('15.0.12')).toBe('15.0.12');
  expect(baseLockedVersion('link:../element')).toBe('');
});

test('parsePnpmLockIndex reads importer dependency sections only', () => {
  const index = parsePnpmLockIndex(LOCK);
  expect([...index.importers.keys()].sort()).toEqual(['.', 'packages/router', 'packages/ui']);
  expect(index.importers.get('.')?.get('vite')).toEqual({
    specifier: '8.1.6',
    version: '8.1.6',
  });
  // Workspace links are not registry artifacts.
  expect(index.importers.get('packages/router')?.has('@openelement/element')).toBe(false);
});

test('lockedDirectVersions returns one exact version per name from the owners', () => {
  const index = parsePnpmLockIndex(LOCK);
  expect(
    lockedDirectVersions(index, ['.', 'packages/router'], ['vite', 'marked', 'postcss']),
  ).toEqual(
    new Map([
      ['vite', '8.1.6'],
      ['marked', '15.0.12'],
      ['postcss', '8.5.28'],
    ]),
  );
});

test('lockedDirectVersions fails closed when owners disagree on a version', () => {
  const index = parsePnpmLockIndex(LOCK);
  expect(() =>
    lockedDirectVersions(index, ['.', 'packages/router', 'packages/ui'], ['postcss']),
  ).toThrow(/resolves to different versions across importers: 8\.5\.28 .*8\.5\.31/);
});

test('lockedDirectVersions fails closed when the lockfile has no resolution', () => {
  const index = parsePnpmLockIndex(LOCK);
  expect(() => lockedDirectVersions(index, ['.', 'packages/router'], ['unocss'])).toThrow(
    /no committed lock resolution for unocss/,
  );
});

test('parsePnpmLockIndex reads the workspace document of the two-document stream', () => {
  // The first document is the package-manager dependency set and carries no
  // importers; the second carries the workspace graph.
  const index = parsePnpmLockIndex(LOCK);
  expect(index.importers.get('packages/router')?.get('marked')?.version).toBe('15.0.12');
});

test('parsePnpmLockIndex fails closed on a lockfile without importers', () => {
  expect(() => parsePnpmLockIndex(`lockfileVersion: '9.0'\n\npackages: {}\n`)).toThrow(
    /carries no importers section/,
  );
  expect(() => parsePnpmLockIndex('not: [valid')).toThrow(/not parseable/);
});
