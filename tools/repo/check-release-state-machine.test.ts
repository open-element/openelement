import { expect, test } from 'vitest';
import {
  commonStableVersion,
  type RegistryEvidence,
  type ReleaseStateV4,
  validateRegistryEvidence,
  validateReleaseState,
} from './check-release-state-machine.ts';

const PINNED_STATE: ReleaseStateV4 = {
  schemaVersion: 4,
  sourceVersion: '1.0.0-alpha.12',
  activeTarget: 'v1.0.0-alpha.12',
  nextPlannedTrain: 'not scheduled',
  maturity: 'alpha',
  commonCompleteVersion: null,
  latestPrerelease: {
    version: '0.44.0-beta.2.2',
    distTag: 'beta',
    state: 'partial',
    publishedPackages: ['@openelement/element', '@openelement/create', '@openelement/ui'],
    missingPackages: ['@openelement/router', '@openelement/protocol'],
  },
  packages: [
    {
      name: '@openelement/element',
      status: 'published',
      registry: { latest: '0.43.3', beta: '0.44.0-beta.2.2' },
    },
    // Schema v4 (#1557): an unpublished package carries no registry object.
    { name: '@openelement/protocol', status: 'unpublished' },
    { name: '@openelement/router', status: 'published', registry: { latest: '0.41.0-alpha.6' } },
    {
      name: '@openelement/create',
      status: 'published',
      registry: { latest: '0.43.3', beta: '0.44.0-beta.2.2' },
    },
    {
      name: '@openelement/ui',
      status: 'published',
      registry: { latest: '0.43.3', beta: '0.44.0-beta.2.2' },
    },
  ],
};

const SITE_SOURCE = `
export const PUBLISHED_LATEST: Readonly<Record<string, string>> = {
  '@openelement/element': 'v0.43.3',
  '@openelement/create': 'v0.43.3',
  '@openelement/ui': 'v0.43.3',
  '@openelement/router': 'v0.41.0-alpha.6',
};
export const COMMON_PUBLISHED_VERSION: string | null = null;
export const UNRELEASED_PACKAGES: readonly string[] = ['@openelement/protocol'];
`;

const VERSIONS = new Map([
  ['@openelement/protocol', '1.0.0-alpha.12'],
  ['@openelement/element', '1.0.0-alpha.12'],
  ['@openelement/router', '1.0.0-alpha.12'],
  ['@openelement/create', '1.0.0-alpha.12'],
  ['@openelement/ui', '1.0.0-alpha.12'],
]);

function evidence(): RegistryEvidence {
  return {
    versions: {
      '@openelement/element': ['0.43.2', '0.43.3', '0.44.0-beta.2.2'],
      '@openelement/router': ['0.41.0-alpha.6', '0.41.0-alpha.8'],
      '@openelement/create': ['0.43.2', '0.43.3', '0.44.0-beta.2.2'],
      '@openelement/ui': ['0.43.2', '0.43.3', '0.44.0-beta.2.2'],
    },
    distTags: {
      '@openelement/element': { latest: '0.43.3', beta: '0.44.0-beta.2.2' },
      '@openelement/router': { latest: '0.41.0-alpha.6' },
      '@openelement/create': { latest: '0.43.3', beta: '0.44.0-beta.2.2' },
      '@openelement/ui': { latest: '0.43.3', beta: '0.44.0-beta.2.2' },
    },
  };
}

test('release state: the pinned per-package model validates offline', () => {
  expect(validateReleaseState(PINNED_STATE, VERSIONS, SITE_SOURCE)).toEqual([]);
});

test('release state: an unpublished package with a fabricated registry is rejected', () => {
  const fabricated = structuredClone(PINNED_STATE);
  const protocol = fabricated.packages.find((entry) => entry.name === '@openelement/protocol');
  protocol!.status = 'unpublished';
  (protocol as { registry?: Record<string, string> }).registry = { latest: '0.0.1' };
  const failures = validateReleaseState(fabricated, VERSIONS, SITE_SOURCE);
  expect(
    failures.some((f) => f.includes('is unpublished and must not carry a registry object')),
  ).toEqual(true);
});

test('release state: the site unpublished list must match the tracked set', () => {
  const drifted = SITE_SOURCE.replace(
    "['@openelement/protocol']",
    "['@openelement/protocol', '@openelement/compiler']",
  );
  const failures = validateReleaseState(PINNED_STATE, VERSIONS, drifted);
  expect(
    failures.some((f) => f.includes('UNRELEASED_PACKAGES must list exactly the unpublished')),
  ).toEqual(true);
});

test('release state: the legacy shared-version schema is rejected', () => {
  const legacy = { ...PINNED_STATE, schemaVersion: 2 } as unknown as ReleaseStateV4;
  const failures = validateReleaseState(legacy, VERSIONS, SITE_SOURCE);
  expect(failures.includes('unsupported release-state schema')).toEqual(true);
});

test('release state: Site copy must not reintroduce a common version', () => {
  const reintroduced = SITE_SOURCE.replace(
    'COMMON_PUBLISHED_VERSION: string | null = null',
    "COMMON_PUBLISHED_VERSION: string | null = 'v0.43.3'",
  );
  const failures = validateReleaseState(PINNED_STATE, VERSIONS, reintroduced);
  expect(failures.some((f) => f.includes('COMMON_PUBLISHED_VERSION must be null'))).toEqual(true);
});

test('release state: per-package Site latest must match the tracked dist-tags', () => {
  const drifted = SITE_SOURCE.replace(
    "'@openelement/router': 'v0.41.0-alpha.6'",
    "'@openelement/router': 'v0.43.3'",
  );
  const failures = validateReleaseState(PINNED_STATE, VERSIONS, drifted);
  expect(
    failures.some((f) =>
      f.includes('PUBLISHED_LATEST must record @openelement/router v0.41.0-alpha.6'),
    ),
  ).toEqual(true);
});

test('registry drift: the per-package model matches live evidence', () => {
  expect(validateRegistryEvidence(PINNED_STATE, evidence())).toEqual([]);
});

test('registry drift: three-package 0.43.3 is not a common complete version', () => {
  // Router lacks 0.43.3, so the live published-package stable intersection is
  // none (the unpublished protocol entry has no versions at all).
  const wrong = structuredClone(PINNED_STATE);
  wrong.commonCompleteVersion = '0.43.3';
  const failures = validateRegistryEvidence(wrong, evidence());
  expect(
    failures.some((f) =>
      f.includes(
        'commonCompleteVersion: tracked 0.43.3, registry published-package stable intersection null',
      ),
    ),
  ).toEqual(true);
});

test('registry drift: only three packages containing the target fails', () => {
  const threeOfFour = evidence();
  threeOfFour.versions['@openelement/element'] = ['0.43.3'];
  threeOfFour.versions['@openelement/create'] = ['0.43.3'];
  threeOfFour.versions['@openelement/ui'] = ['0.43.3'];
  threeOfFour.versions['@openelement/router'] = ['0.41.0-alpha.6'];
  const wrong = structuredClone(PINNED_STATE);
  wrong.commonCompleteVersion = '0.43.3';
  const failures = validateRegistryEvidence(wrong, threeOfFour);
  expect(failures.some((f) => f.includes('commonCompleteVersion'))).toEqual(true);
});

test('commonStableVersion computes the four-package stable intersection', () => {
  expect(
    commonStableVersion(
      {
        a: ['0.43.2', '0.43.3'],
        b: ['0.43.2', '0.43.3'],
        c: ['0.43.2'],
        d: ['0.43.2', '0.43.3'],
      },
      ['a', 'b', 'c', 'd'],
    ),
  ).toEqual('0.43.2');
  expect(
    commonStableVersion({ a: ['0.43.3'], b: ['0.43.3'], c: ['0.43.3'], d: [] }, [
      'a',
      'b',
      'c',
      'd',
    ]),
  ).toEqual(null);
  // Prereleases never count as a common complete version.
  expect(
    commonStableVersion(
      { a: ['1.0.0-alpha.1'], b: ['1.0.0-alpha.1'], c: ['1.0.0-alpha.1'], d: ['1.0.0-alpha.1'] },
      ['a', 'b', 'c', 'd'],
    ),
  ).toEqual(null);
});

test('registry drift: a moved dist-tag fails closed', () => {
  const moved = evidence();
  moved.distTags['@openelement/element'].beta = '0.44.0-beta.2.1';
  const failures = validateRegistryEvidence(PINNED_STATE, moved);
  expect(failures.some((f) => f.includes('dist-tag beta'))).toEqual(true);
});

test('registry drift: Router absent at the prerelease is accepted', () => {
  const failures = validateRegistryEvidence(PINNED_STATE, evidence());
  expect(failures).toEqual([]);
});

test('registry drift: a tracked-but-absent latest fails', () => {
  const absent = evidence();
  absent.versions['@openelement/router'] = ['0.41.0-alpha.8'];
  const failures = validateRegistryEvidence(PINNED_STATE, absent);
  expect(failures.some((f) => f.includes('recorded latest 0.41.0-alpha.6'))).toEqual(true);
});

test('registry drift: a claimed-but-absent package fails closed', () => {
  const absent = evidence();
  absent.versions['@openelement/element'] = ['0.43.3'];
  absent.distTags['@openelement/element'] = { latest: '0.43.3', beta: '0.44.0-beta.2.2' };
  const failures = validateRegistryEvidence(PINNED_STATE, absent);
  expect(failures.some((f) => f.includes('recorded as published'))).toEqual(true);
});
