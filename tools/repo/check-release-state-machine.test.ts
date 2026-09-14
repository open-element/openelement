import { assertEquals } from '@std/assert';
import {
  type RegistryEvidence,
  type ReleaseStateV2,
  validateRegistryEvidence,
  validateReleaseState,
} from './check-release-state-machine.ts';

const PINNED_STATE: ReleaseStateV2 = {
  schemaVersion: 2,
  sourceVersion: '1.0.0-alpha.1',
  activeTarget: 'v1.0.0-alpha.1',
  nextPlannedTrain: 'not scheduled',
  maturity: 'alpha',
  completePublishedVersion: '0.43.3',
  stable: { distTag: 'latest', version: '0.43.3' },
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
export const PUBLISHED_STABLE_VERSION = 'v0.43.3';
export const PUBLISHED_PACKAGE_VERSION = 'v0.43.3';
export const LATEST_PRERELEASE_VERSION = 'v0.44.0-beta.2.2';
export const PUBLISHED_PACKAGE_VERSIONS = {
  '@openelement/element': 'v0.44.0-beta.2.2',
  '@openelement/router': null,
  '@openelement/create': 'v0.44.0-beta.2.2',
  '@openelement/ui': 'v0.44.0-beta.2.2',
};
`;

const VERSIONS = new Map([
  ['@openelement/element', '1.0.0-alpha.1'],
  ['@openelement/router', '1.0.0-alpha.1'],
  ['@openelement/create', '1.0.0-alpha.1'],
  ['@openelement/ui', '1.0.0-alpha.1'],
]);

Deno.test('release state: the pinned partial-publish model validates offline', () => {
  assertEquals(validateReleaseState(PINNED_STATE, VERSIONS, SITE_SOURCE), []);
});

Deno.test('release state: a single four-package publishedVersion can no longer pass', () => {
  const legacy = { ...PINNED_STATE, schemaVersion: 1 } as unknown as ReleaseStateV2;
  const failures = validateReleaseState(legacy, VERSIONS, SITE_SOURCE);
  assertEquals(failures.includes('unsupported release-state schema'), true);
});

Deno.test('release state: prerelease partition and Site model must agree', () => {
  const unpartitioned = structuredClone(PINNED_STATE);
  // ui is in neither list: the prerelease must partition the package set.
  unpartitioned.latestPrerelease.publishedPackages = [
    '@openelement/element',
    '@openelement/create',
  ];
  unpartitioned.latestPrerelease.missingPackages = ['@openelement/router'];
  const failures = validateReleaseState(unpartitioned, VERSIONS, SITE_SOURCE);
  assertEquals(failures.some((f) => f.includes('partition the package set')), true);
  assertEquals(failures.some((f) => f.includes('LATEST_PRERELEASE')), false);
});

Deno.test('release state: Site constants must use the same fact model', () => {
  const stale = `${SITE_SOURCE}\n// old\n`.replace(
    "PUBLISHED_STABLE_VERSION = 'v0.43.3'",
    "PUBLISHED_STABLE_VERSION = 'v0.44.0-beta.2.2'",
  );
  const failures = validateReleaseState(PINNED_STATE, VERSIONS, stale);
  assertEquals(failures.some((f) => f.includes('PUBLISHED_STABLE_VERSION must be v0.43.3')), true);
});

Deno.test('registry drift: Router absent at the prerelease is accepted', () => {
  const evidence: RegistryEvidence = {
    versions: {
      '@openelement/element': ['0.43.3', '0.44.0-beta.2.2'],
      '@openelement/router': ['0.41.0-alpha.6', '0.41.0-alpha.8'],
      '@openelement/create': ['0.43.3', '0.44.0-beta.2.2'],
      '@openelement/ui': ['0.43.3', '0.44.0-beta.2.2'],
    },
    distTags: {
      '@openelement/element': { latest: '0.43.3', beta: '0.44.0-beta.2.2' },
      '@openelement/router': { latest: '0.41.0-alpha.6' },
      '@openelement/create': { latest: '0.43.3', beta: '0.44.0-beta.2.2' },
      '@openelement/ui': { latest: '0.43.3', beta: '0.44.0-beta.2.2' },
    },
  };
  assertEquals(validateRegistryEvidence(PINNED_STATE, evidence), []);
});

Deno.test('registry drift: a claimed-but-absent package fails closed', () => {
  const evidence: RegistryEvidence = {
    versions: {
      '@openelement/element': ['0.43.3', '0.44.0-beta.2.2'],
      '@openelement/router': ['0.41.0-alpha.6'],
      '@openelement/create': ['0.43.3', '0.44.0-beta.2.2'],
      '@openelement/ui': ['0.43.3', '0.44.0-beta.2.2'],
    },
    distTags: {
      '@openelement/element': { latest: '0.43.3', beta: '0.44.0-beta.2.2' },
      '@openelement/router': { latest: '0.41.0-alpha.6' },
      '@openelement/create': { latest: '0.43.3', beta: '0.44.0-beta.2.2' },
      '@openelement/ui': { latest: '0.43.3', beta: '0.44.0-beta.2.2' },
    },
  };
  // The state says element is published at the prerelease; a registry that
  // omits it must be rejected.
  evidence.versions['@openelement/element'] = ['0.43.3'];
  const failures = validateRegistryEvidence(PINNED_STATE, evidence);
  assertEquals(failures.some((f) => f.includes('recorded as published')), true);
});

Deno.test('registry drift: a state that claims Router published fails', () => {
  const wrong = structuredClone(PINNED_STATE);
  wrong.latestPrerelease.publishedPackages = wrong.packages.map((p) => p.name);
  wrong.latestPrerelease.missingPackages = [];
  wrong.latestPrerelease.state = 'complete';
  const evidence: RegistryEvidence = {
    versions: {
      '@openelement/element': ['0.43.3', '0.44.0-beta.2.2'],
      '@openelement/router': ['0.41.0-alpha.6'],
      '@openelement/create': ['0.43.3', '0.44.0-beta.2.2'],
      '@openelement/ui': ['0.43.3', '0.44.0-beta.2.2'],
    },
    distTags: {
      '@openelement/element': { latest: '0.43.3', beta: '0.44.0-beta.2.2' },
      '@openelement/router': { latest: '0.41.0-alpha.6' },
      '@openelement/create': { latest: '0.43.3', beta: '0.44.0-beta.2.2' },
      '@openelement/ui': { latest: '0.43.3', beta: '0.44.0-beta.2.2' },
    },
  };
  const failures = validateRegistryEvidence(wrong, evidence);
  assertEquals(
    failures.some((f) => f.includes('@openelement/router is recorded as published')),
    true,
  );
});

Deno.test('registry drift: a moved dist-tag fails closed', () => {
  const evidence: RegistryEvidence = {
    versions: {
      '@openelement/element': ['0.43.3', '0.44.0-beta.2.2'],
      '@openelement/router': ['0.41.0-alpha.6'],
      '@openelement/create': ['0.43.3', '0.44.0-beta.2.2'],
      '@openelement/ui': ['0.43.3', '0.44.0-beta.2.2'],
    },
    distTags: {
      '@openelement/element': { latest: '0.43.3', beta: '0.44.0-beta.2.1' },
      '@openelement/router': { latest: '0.41.0-alpha.6' },
      '@openelement/create': { latest: '0.43.3', beta: '0.44.0-beta.2.2' },
      '@openelement/ui': { latest: '0.43.3', beta: '0.44.0-beta.2.2' },
    },
  };
  const failures = validateRegistryEvidence(PINNED_STATE, evidence);
  assertEquals(failures.some((f) => f.includes('dist-tag beta')), true);
});
