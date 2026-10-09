/**
 * Registry-sync consumer form (alpha.13 E3): the publish train's last step.
 *
 * The seam this pins: the tracked registry block (docs/release/release-state.json)
 * must be a READ-BACK of the live registry, and the site's display constants
 * must be a projection of that block. The tests below drive the writer with
 * forged registry answers and assert it (a) writes exactly what npm answered,
 * including a lagging block being corrected, (b) leaves unpublished packages
 * absent, (c) fails closed when the registry disagrees with the line, and
 * (d) rewrites the www projection without disturbing a byte of the rest of the
 * file. The second half pins the mirror contract: the drift checker
 * (`@openelement/tools-release#registry-drift:check`) must reject a forged
 * divergence between the
 * tracked block and the live registry — a green run over a drift would make
 * the whole gate decorative.
 */

import { expect, test } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type RegistryEvidence,
  REGISTRY_METHOD,
  RELEASE_STATE_PATH,
  calendarDateStamp,
  projectWwwVersionSource,
  registryLineTag,
  rewriteRegistryBlock,
  syncRegistryState,
  WWW_VERSION_PATH,
} from './registry-sync.ts';
import {
  displayDriftFailures,
  isMissingPackageFailure,
  isOfflineFailure,
  readDisplayProjection,
  registryDriftFailures,
  runRegistryDriftCheck,
  type DriftQuery,
} from './registry-drift-check.ts';
import type { ReleaseStateDocument } from './registry-sync.ts';

const VERSION = '1.0.0-alpha.13';
const PREVIOUS = '1.0.0-alpha.12';

function stateDocument(): ReleaseStateDocument {
  const published = (name: string, latest: string) => ({
    name,
    status: 'published' as const,
    registry: { latest, alpha: latest },
  });
  return {
    schemaVersion: 4,
    sourceVersion: VERSION,
    activeTarget: `v${VERSION}`,
    nextPlannedTrain: 'not scheduled',
    maturity: 'alpha',
    registry: { source: 'registry.npmjs.org', verifiedAt: '2026-10-08', method: REGISTRY_METHOD },
    packages: [
      published('@openelement/protocol', PREVIOUS),
      published('@openelement/element', PREVIOUS),
      published('@openelement/compiler', PREVIOUS),
      published('@openelement/router', PREVIOUS),
      published('@openelement/create', PREVIOUS),
      published('@openelement/ui', PREVIOUS),
    ],
    commonCompleteVersion: null,
    commonCompleteVersionNote: 'unchanged by the sync',
    latestPrerelease: {
      version: PREVIOUS,
      distTag: 'alpha',
      state: 'complete',
      publishedPackages: [
        '@openelement/protocol',
        '@openelement/element',
        '@openelement/compiler',
        '@openelement/router',
        '@openelement/create',
        '@openelement/ui',
      ],
      missingPackages: [],
      note: 'stale note from the previous read-back',
    },
  } as ReleaseStateDocument;
}

/** What the registry answers for a package serving `version` on `tag`. */
/**
 * What the registry answers for a package serving `version` on the line's
 * tag. `versions` is explicit so a package that did NOT publish the train is
 * modelled honestly (a partial publish): its version list lacks the new line.
 */
function evidence(
  version: string,
  options: { tag?: string; versions?: string[] } = {},
): RegistryEvidence {
  const tag = options.tag ?? registryLineTag(version);
  return {
    distTags: { [tag]: version, latest: version },
    versions: options.versions ?? [previousOf(version), version],
  };
}

/** The same-line predecessor of a checkpoint version (`alpha.13` → `alpha.12`). */
function previousOf(version: string): string {
  const match = /^(.*\.)(\d+)$/u.exec(version);
  if (!match) return version;
  return `${match[1]}${Number(match[2]) - 1}`;
}

test('registry sync writes the registry answers back, correcting a lagging block', () => {
  const document = stateDocument();
  const answers: Record<string, RegistryEvidence> = {};
  for (const entry of document.packages) answers[entry.name] = evidence(VERSION);
  const synced = rewriteRegistryBlock(document, answers, '2026-10-09');

  // Every published package records exactly the tags npm served. The 1.0 line
  // publishes onto `latest` (owner ruling 2026-10-07), so the read-back
  // carries that one tag for every package.
  for (const entry of synced.packages) {
    expect(entry.registry).toEqual({ latest: VERSION });
  }
  // The lagging prerelease row follows the read-back.
  expect(synced.latestPrerelease.version).toEqual(VERSION);
  expect(synced.latestPrerelease.distTag).toEqual('latest');
  expect(synced.latestPrerelease.state).toEqual('complete');
  expect(synced.latestPrerelease.missingPackages).toEqual([]);
  expect(synced.latestPrerelease.note).toContain(VERSION);
  expect(synced.registry).toMatchObject({ verifiedAt: '2026-10-09', method: REGISTRY_METHOD });
  // Fields the sync does not own stay untouched.
  expect(synced.commonCompleteVersion).toBeNull();
  expect(synced.commonCompleteVersionNote).toEqual('unchanged by the sync');
  expect(synced.sourceVersion).toEqual(VERSION);
});

test('registry sync never manufactures registry truth for unpublished packages', () => {
  const document = stateDocument();
  document.packages = [
    ...document.packages.slice(0, 5),
    { name: '@openelement/ui', status: 'unpublished' as const },
  ];
  const answers: Record<string, RegistryEvidence> = {};
  for (const entry of document.packages) {
    if (entry.status === 'published') answers[entry.name] = evidence(VERSION);
  }
  const synced = rewriteRegistryBlock(document, answers, '2026-10-09');
  const ui = synced.packages.find((entry) => entry.name === '@openelement/ui');
  expect(ui?.status).toEqual('unpublished');
  expect('registry' in (ui ?? {})).toEqual(false);
  // The never-published package still votes on completeness: the offline check
  // requires published ∪ missing to cover the WHOLE package set, so a train
  // that has not published every package must read as partial (P5).
  expect(synced.latestPrerelease.missingPackages).toEqual(['@openelement/ui']);
  expect(synced.latestPrerelease.state).toEqual('partial');
  expect(
    synced.latestPrerelease.publishedPackages.length +
      synced.latestPrerelease.missingPackages.length,
  ).toEqual(synced.packages.length);
});

test('registry sync records a stable line as a release, not a prerelease (P6)', () => {
  const document = stateDocument();
  document.sourceVersion = '1.0.0';
  const answers: Record<string, RegistryEvidence> = {};
  for (const entry of document.packages) {
    answers[entry.name] = { distTags: { latest: '1.0.0' }, versions: [PREVIOUS, '1.0.0'] };
  }
  const synced = rewriteRegistryBlock(document, answers, '2026-10-09');
  expect(synced.latestPrerelease.version).toEqual('1.0.0');
  expect(synced.latestPrerelease.state).toEqual('complete');
  expect(synced.latestPrerelease.missingPackages).toEqual([]);
  for (const entry of synced.packages) expect(entry.registry).toEqual({ latest: '1.0.0' });
});

test('registry sync records a partial line instead of claiming completeness', () => {
  const document = stateDocument();
  const answers: Record<string, RegistryEvidence> = {};
  for (const entry of document.packages) answers[entry.name] = evidence(VERSION);
  // Router did not publish this train.
  answers['@openelement/router'] = evidence(PREVIOUS);
  const synced = rewriteRegistryBlock(document, answers, '2026-10-09');
  expect(synced.latestPrerelease.state).toEqual('partial');
  expect(synced.latestPrerelease.missingPackages).toEqual(['@openelement/router']);
  expect(synced.latestPrerelease.publishedPackages).not.toContain('@openelement/router');
});

test('registry sync fails closed when the registry answer contradicts the line', () => {
  const document = stateDocument();
  const answers: Record<string, RegistryEvidence> = {};
  for (const entry of document.packages) answers[entry.name] = evidence(VERSION);
  delete answers['@openelement/element'];
  expect(() => rewriteRegistryBlock(document, answers, '2026-10-09')).toThrow(
    /no registry evidence for @openelement\/element/,
  );
});

test('registry line tag follows the publish tag rule (1.0 rides latest, 0.x rides the channel)', () => {
  expect(registryLineTag('1.0.0-alpha.13')).toEqual('latest');
  expect(registryLineTag('0.44.0-beta.2.2')).toEqual('beta');
  expect(registryLineTag('1.0.0')).toEqual('latest');
});

test('the www projection rewrites exactly the two registry constants', () => {
  const document = stateDocument();
  const answers: Record<string, RegistryEvidence> = {};
  for (const entry of document.packages) answers[entry.name] = evidence(VERSION);
  const synced = rewriteRegistryBlock(document, answers, '2026-10-09');
  const source = [
    '// header comment stays',
    'export const PUBLISHED_LATEST: Readonly<Record<string, string>> = {',
    `  '@openelement/element': 'v${PREVIOUS}',`,
    '};',
    '',
    'export const UNRELEASED_PACKAGES: readonly string[] = [];',
    '// trailing comment stays',
    '',
  ].join('\n');
  const projected = projectWwwVersionSource(source, synced);
  expect(projected).toContain(`  '@openelement/router': 'v${VERSION}',`);
  expect(projected).not.toContain(PREVIOUS);
  expect(projected).toContain('// header comment stays');
  expect(projected).toContain('// trailing comment stays');
  expect(projected).toContain('export const UNRELEASED_PACKAGES: readonly string[] = [];');
  // Fail closed when the declarations are missing rather than writing garbage.
  expect(() => projectWwwVersionSource('export const X = 1;', synced)).toThrow(
    /PUBLISHED_LATEST declaration not found/,
  );
});

test('the sync writes the three files from forged answers, end to end', async () => {
  const root = await mkdtemp(join(tmpdir(), 'registry-sync-'));
  try {
    await mkdir(join(root, 'docs/release'), { recursive: true });
    await mkdir(join(root, 'www/app/data'), { recursive: true });
    await writeFile(
      join(root, RELEASE_STATE_PATH),
      `${JSON.stringify(stateDocument(), null, 2)}\n`,
    );
    await writeFile(
      join(root, WWW_VERSION_PATH),
      [
        'export const PUBLISHED_LATEST: Readonly<Record<string, string>> = {',
        `  '@openelement/element': 'v${PREVIOUS}',`,
        '};',
        'export const UNRELEASED_PACKAGES: readonly string[] = [];',
        '',
      ].join('\n'),
    );
    const query: DriftQuery = (name) =>
      Promise.resolve(name === '@openelement/router' ? evidence(PREVIOUS) : evidence(VERSION));
    let regenerated: string | undefined;
    const result = await syncRegistryState({
      root,
      query,
      now: () => new Date('2026-10-09T00:00:00Z'),
      regenerate: false,
      runGenerator: (script) => {
        regenerated = script;
        return Promise.resolve();
      },
    });
    expect(result.verifiedAt).toEqual('2026-10-09');
    expect(result.latestPrerelease).toEqual(VERSION);
    expect(result.latest['@openelement/element']).toEqual(VERSION);
    // regenerate: false is what the test passes, so the generator never runs;
    // the production default runs it (see the module doc).
    expect(regenerated).toBeUndefined();

    const written = JSON.parse(await readFile(join(root, RELEASE_STATE_PATH), 'utf8')) as {
      packages: Array<{ name: string; registry?: Record<string, string> }>;
      latestPrerelease: { version: string; state: string; missingPackages: string[] };
    };
    expect(written.latestPrerelease.version).toEqual(VERSION);
    expect(written.latestPrerelease.state).toEqual('partial');
    expect(written.latestPrerelease.missingPackages).toEqual(['@openelement/router']);
    expect(
      written.packages.find((entry) => entry.name === '@openelement/router')?.registry,
    ).toEqual({ latest: PREVIOUS });

    const www = await readFile(join(root, WWW_VERSION_PATH), 'utf8');
    expect(www).toContain(`  '@openelement/element': 'v${VERSION}',`);
    expect(www).toContain(`  '@openelement/router': 'v${PREVIOUS}',`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the drift check fails closed on a block that diverges from the registry', async () => {
  const document = stateDocument();
  // Tracked block says alpha.12 everywhere; the registry serves alpha.13.
  const query: DriftQuery = () => Promise.resolve(evidence(VERSION));
  const failures = await registryDriftFailures(document, query);
  expect(failures.length).toBeGreaterThan(0);
  expect(failures.join('\n')).toContain('@openelement/element');
  expect(failures.join('\n')).toContain(VERSION);
  expect(failures.join('\n')).toContain(PREVIOUS);
});

test('the drift check passes when the tracked block matches the registry', async () => {
  const document = stateDocument();
  const answers: Record<string, RegistryEvidence> = {};
  for (const entry of document.packages) answers[entry.name] = evidence(VERSION);
  const synced = rewriteRegistryBlock(document, answers, '2026-10-09');
  const query: DriftQuery = () => Promise.resolve(evidence(VERSION));
  expect(await registryDriftFailures(synced, query)).toEqual([]);
});

test('the display layer fails when the page shows a version the registry no longer serves', async () => {
  // The alpha.12 failure mode, exactly: the site shows alpha.11 (last read
  // back) while npm already serves alpha.12.
  const display = {
    publishedLatest: { '@openelement/element': `v${PREVIOUS}` },
    unreleased: ['@openelement/protocol'],
  };
  const query: DriftQuery = (name) =>
    Promise.resolve(
      name === '@openelement/protocol'
        ? evidence(VERSION) // named never-published, but the registry knows it
        : evidence(VERSION),
    );
  const failures = await displayDriftFailures(display, query);
  expect(failures.join('\n')).toContain('shows v1.0.0-alpha.12');
  expect(failures.join('\n')).toContain("registry's latest is 1.0.0-alpha.13");
  expect(failures.join('\n')).toContain('never-published');
});

test('the display layer accepts a matching page and an absent never-published name', async () => {
  const display = {
    publishedLatest: { '@openelement/element': `v${VERSION}` },
    unreleased: ['@openelement/protocol'],
  };
  const query: DriftQuery = (name) => {
    if (name === '@openelement/protocol') {
      return Promise.reject(new Error('npm error code E404\nnpm error 404 Not Found'));
    }
    return Promise.resolve(evidence(VERSION));
  };
  expect(await displayDriftFailures(display, query)).toEqual([]);
});

test('an offline run is a loud skip, never a pass, and a real failure still throws', async () => {
  const document = stateDocument();
  const display = readDisplayProjection(
    [
      'export const PUBLISHED_LATEST: Readonly<Record<string, string>> = {',
      `  '@openelement/element': 'v${VERSION}',`,
      '};',
      'export const UNRELEASED_PACKAGES: readonly string[] = [];',
      '',
    ].join('\n'),
  );
  const offline: DriftQuery = () =>
    Promise.reject(
      new Error('npm view @openelement/element dist-tags failed: getaddrinfo ENOTFOUND'),
    );
  const skipped = await runRegistryDriftCheck({ document, display, query: offline });
  expect(skipped.skipped).toEqual(true);
  expect(isOfflineFailure(skipped.reason ?? '')).toEqual(true);

  const authFailure: DriftQuery = () =>
    Promise.reject(new Error('npm error code E401\nnpm error 401 Unauthorized'));
  await expect(runRegistryDriftCheck({ document, display, query: authFailure })).rejects.toThrow(
    /E401/,
  );
  expect(isOfflineFailure('npm error code E401')).toEqual(false);
  expect(isMissingPackageFailure('npm error code E404')).toEqual(true);
  expect(isMissingPackageFailure('npm error code E401')).toEqual(false);
});

test('a mid-run network failure never discards drift already proven (P2)', async () => {
  // The failure this pins: the first cut of the check ran both layers inside
  // one try and returned `{ failures: [] }` on ANY network error, so a
  // confirmed drift found before the failure was erased by it — the check's
  // green then meant nothing, which is exactly what it exists to prevent.
  const document = stateDocument();
  const display = readDisplayProjection(
    [
      'export const PUBLISHED_LATEST: Readonly<Record<string, string>> = {',
      `  '@openelement/element': 'v1.0.0-alpha.11',`, // stale: the registry serves alpha.12
      '};',
      'export const UNRELEASED_PACKAGES: readonly string[] = [];',
      '',
    ].join('\n'),
  );
  let calls = 0;
  const flaky: DriftQuery = (name) => {
    calls += 1;
    // The drift is proven for element; every later query hits a dead network.
    if (name === '@openelement/element' && calls === 1) return Promise.resolve(evidence(VERSION));
    return Promise.reject(new Error('npm view failed: socket hang up ECONNRESET'));
  };
  const result = await runRegistryDriftCheck({ document, display, query: flaky });
  expect(result.failures.join('\n')).toContain('shows v1.0.0-alpha.11');
  expect(result.skipped).toEqual(true);
  expect(result.unverifiedPackages).toBeGreaterThan(0);
});

test('a clean run with an unreachable package is a skip, and counts what it verified (P2)', async () => {
  const document = stateDocument();
  const display = readDisplayProjection(
    [
      'export const PUBLISHED_LATEST: Readonly<Record<string, string>> = {',
      `  '@openelement/element': 'v${VERSION}',`,
      '};',
      'export const UNRELEASED_PACKAGES: readonly string[] = [];',
      '',
    ].join('\n'),
  );
  let calls = 0;
  const halfOffline: DriftQuery = () => {
    calls += 1;
    if (calls === 1) return Promise.resolve(evidence(VERSION));
    return Promise.reject(new Error('npm view failed: getaddrinfo ENOTFOUND'));
  };
  const result = await runRegistryDriftCheck({ document, display, query: halfOffline });
  expect(result.failures).toEqual([]);
  expect(result.skipped).toEqual(true);
  expect(result.unverifiedPackages).toBeGreaterThan(0);
  expect(result.verifiedPackages).toBeGreaterThan(0);
});

test('the display projection parser fails closed on a missing constant', () => {
  expect(() => readDisplayProjection('export const X = 1;')).toThrow(
    /PUBLISHED_LATEST declaration not found/,
  );
  const parsed = readDisplayProjection(
    [
      'export const PUBLISHED_LATEST: Readonly<Record<string, string>> = {',
      `  '@openelement/element': 'v${VERSION}',`,
      '};',
      "export const UNRELEASED_PACKAGES: readonly string[] = ['@openelement/protocol'];",
      '',
    ].join('\n'),
  );
  expect(parsed.publishedLatest).toEqual({ '@openelement/element': `v${VERSION}` });
  expect(parsed.unreleased).toEqual(['@openelement/protocol']);
});

test('calendarDateStamp is an ISO calendar date', () => {
  expect(calendarDateStamp(new Date('2026-10-09T23:59:59Z'))).toEqual('2026-10-09');
});
