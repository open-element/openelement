import { assertEquals } from '@std/assert';
import {
  commonStableVersion,
  type RegistryEvidence,
  type ReleaseStateV3,
  validateRegistryEvidence,
  validateReleaseState,
} from './check-release-state-machine.ts';

const PINNED_STATE: ReleaseStateV3 = {
  schemaVersion: 3,
  sourceVersion: '1.0.0-alpha.2',
  activeTarget: 'v1.0.0-alpha.2',
  nextPlannedTrain: 'not scheduled',
  maturity: 'alpha',
  commonCompleteVersion: null,
  latestPrerelease: {
    version: '0.44.0-beta.2.2',
    distTag: 'beta',
    state: 'partial',
    publishedPackages: ['@openelement/element', '@openelement/create', '@openelement/ui'],
    missingPackages: ['@openelement/router'],
  },
  packages: [
    { name: '@openelement/element', registry: { latest: '0.43.3', beta: '0.44.0-beta.2.2' } },
    { name: '@openelement/router', registry: { latest: '0.41.0-alpha.6' } },
    { name: '@openelement/create', registry: { latest: '0.43.3', beta: '0.44.0-beta.2.2' } },
    { name: '@openelement/ui', registry: { latest: '0.43.3', beta: '0.44.0-beta.2.2' } },
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
`;

const VERSIONS = new Map([
  ['@openelement/element', '1.0.0-alpha.2'],
  ['@openelement/router', '1.0.0-alpha.2'],
  ['@openelement/create', '1.0.0-alpha.2'],
  ['@openelement/ui', '1.0.0-alpha.2'],
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

Deno.test('release state: the pinned per-package model validates offline', () => {
  assertEquals(validateReleaseState(PINNED_STATE, VERSIONS, SITE_SOURCE), []);
});

Deno.test('release state: the legacy shared-version schema is rejected', () => {
  const legacy = { ...PINNED_STATE, schemaVersion: 2 } as unknown as ReleaseStateV3;
  const failures = validateReleaseState(legacy, VERSIONS, SITE_SOURCE);
  assertEquals(failures.includes('unsupported release-state schema'), true);
});

Deno.test('release state: Site copy must not reintroduce a common version', () => {
  const reintroduced = SITE_SOURCE.replace(
    'COMMON_PUBLISHED_VERSION: string | null = null',
    "COMMON_PUBLISHED_VERSION: string | null = 'v0.43.3'",
  );
  const failures = validateReleaseState(PINNED_STATE, VERSIONS, reintroduced);
  assertEquals(
    failures.some((f) => f.includes('COMMON_PUBLISHED_VERSION must be null')),
    true,
  );
});

Deno.test('release state: per-package Site latest must match the tracked dist-tags', () => {
  const drifted = SITE_SOURCE.replace(
    "'@openelement/router': 'v0.41.0-alpha.6'",
    "'@openelement/router': 'v0.43.3'",
  );
  const failures = validateReleaseState(PINNED_STATE, VERSIONS, drifted);
  assertEquals(
    failures.some((f) =>
      f.includes('PUBLISHED_LATEST must record @openelement/router v0.41.0-alpha.6')
    ),
    true,
  );
});

Deno.test('registry drift: the per-package model matches live evidence', () => {
  assertEquals(validateRegistryEvidence(PINNED_STATE, evidence()), []);
});

Deno.test('registry drift: three-package 0.43.3 is not a common complete version', () => {
  // Router lacks 0.43.3, so the live four-package stable intersection is none.
  const wrong = structuredClone(PINNED_STATE);
  wrong.commonCompleteVersion = '0.43.3';
  const failures = validateRegistryEvidence(wrong, evidence());
  assertEquals(
    failures.some((f) =>
      f.includes(
        'commonCompleteVersion: tracked 0.43.3, registry four-package stable intersection null',
      )
    ),
    true,
  );
});

Deno.test('registry drift: only three packages containing the target fails', () => {
  const threeOfFour = evidence();
  threeOfFour.versions['@openelement/element'] = ['0.43.3'];
  threeOfFour.versions['@openelement/create'] = ['0.43.3'];
  threeOfFour.versions['@openelement/ui'] = ['0.43.3'];
  threeOfFour.versions['@openelement/router'] = ['0.41.0-alpha.6'];
  const wrong = structuredClone(PINNED_STATE);
  wrong.commonCompleteVersion = '0.43.3';
  const failures = validateRegistryEvidence(wrong, threeOfFour);
  assertEquals(failures.some((f) => f.includes('commonCompleteVersion')), true);
});

Deno.test('commonStableVersion computes the four-package stable intersection', () => {
  assertEquals(
    commonStableVersion(
      {
        a: ['0.43.2', '0.43.3'],
        b: ['0.43.2', '0.43.3'],
        c: ['0.43.2'],
        d: ['0.43.2', '0.43.3'],
      },
      ['a', 'b', 'c', 'd'],
    ),
    '0.43.2',
  );
  assertEquals(
    commonStableVersion({ a: ['0.43.3'], b: ['0.43.3'], c: ['0.43.3'], d: [] }, [
      'a',
      'b',
      'c',
      'd',
    ]),
    null,
  );
  // Prereleases never count as a common complete version.
  assertEquals(
    commonStableVersion(
      { a: ['1.0.0-alpha.1'], b: ['1.0.0-alpha.1'], c: ['1.0.0-alpha.1'], d: ['1.0.0-alpha.1'] },
      ['a', 'b', 'c', 'd'],
    ),
    null,
  );
});

Deno.test('registry drift: a moved dist-tag fails closed', () => {
  const moved = evidence();
  moved.distTags['@openelement/element'].beta = '0.44.0-beta.2.1';
  const failures = validateRegistryEvidence(PINNED_STATE, moved);
  assertEquals(failures.some((f) => f.includes('dist-tag beta')), true);
});

Deno.test('registry drift: Router absent at the prerelease is accepted', () => {
  const failures = validateRegistryEvidence(PINNED_STATE, evidence());
  assertEquals(failures, []);
});

Deno.test('registry drift: a tracked-but-absent latest fails', () => {
  const absent = evidence();
  absent.versions['@openelement/router'] = ['0.41.0-alpha.8'];
  const failures = validateRegistryEvidence(PINNED_STATE, absent);
  assertEquals(failures.some((f) => f.includes('recorded latest 0.41.0-alpha.6')), true);
});

Deno.test('registry drift: a claimed-but-absent package fails closed', () => {
  const absent = evidence();
  absent.versions['@openelement/element'] = ['0.43.3'];
  absent.distTags['@openelement/element'] = { latest: '0.43.3', beta: '0.44.0-beta.2.2' };
  const failures = validateRegistryEvidence(PINNED_STATE, absent);
  assertEquals(failures.some((f) => f.includes('recorded as published')), true);
});
