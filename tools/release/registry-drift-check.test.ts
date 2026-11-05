/**
 * registry-drift-check.test.ts — the release gate's registry-truth verdict.
 *
 * The drift checker is release evidence, not a best-effort dashboard: a proven
 * divergence and an unverifiable registry both have to be non-zero, and an
 * unreachable registry may only be a green SKIP when the caller explicitly
 * selected the non-qualifying local mode (`--allow-offline`). These tests pin
 * that verdict boundary (including E403/auth failures, which must never be
 * read as "not yet published" or as an offline skip) and the rule that a
 * confirmed drift is not erased by a later network failure.
 */

import { expect, test } from 'vitest';
import {
  driftVerdict,
  isMissingPackageFailure,
  isOfflineFailure,
  readDisplayProjection,
  runRegistryDriftCheck,
  type DisplayProjection,
  type DriftQuery,
} from './registry-drift-check.ts';
import type { RegistryEvidence, ReleaseStateDocument } from './registry-sync.ts';

const VERSION = '1.0.0-alpha.15';
const PREVIOUS = '1.0.0-alpha.14';

function display(): DisplayProjection {
  return {
    publishedLatest: {
      '@openelement/protocol': `v${VERSION}`,
      '@openelement/ui': `v${VERSION}`,
    },
    unreleased: ['@openelement/legacy'],
  };
}

function stateDocument(): ReleaseStateDocument {
  return {
    schemaVersion: 4,
    sourceVersion: VERSION,
    packages: [
      {
        name: '@openelement/protocol',
        status: 'published',
        registry: { latest: VERSION, alpha: VERSION },
      },
      {
        name: '@openelement/ui',
        status: 'published',
        registry: { latest: VERSION, alpha: VERSION },
      },
      { name: '@openelement/legacy', status: 'unpublished' },
    ],
    latestPrerelease: {
      version: VERSION,
      distTag: 'latest',
      state: 'complete',
      publishedPackages: ['@openelement/protocol', '@openelement/ui'],
      missingPackages: [],
    },
  } as ReleaseStateDocument;
}

function evidence(latest = VERSION): RegistryEvidence {
  return { distTags: { latest, alpha: latest }, versions: [PREVIOUS, latest] };
}

function queryFor(
  answers: Record<string, RegistryEvidence | Error>,
  fallback: RegistryEvidence | Error = evidence(),
): DriftQuery {
  return (name: string) => {
    const answer = answers[name] ?? fallback;
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  };
}

const e404 = new Error(
  'npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/@openelement%2flegacy - Not found',
);
const offline = new Error(
  'npm view @openelement/ui dist-tags --json failed: npm error code ENOTFOUND\n' +
    'npm error network request to https://registry.npmjs.org/@openelement%2fui failed',
);
const forbidden = new Error(
  'npm view @openelement/ui dist-tags --json failed: npm error code E403\nnpm error 403 Forbidden',
);

async function run(answers: Record<string, RegistryEvidence | Error> = {}) {
  return await runRegistryDriftCheck({
    document: stateDocument(),
    display: display(),
    query: queryFor(answers),
  });
}

test('registry drift: agreeing display and tracked block pass', async () => {
  const result = await run({ '@openelement/legacy': e404 });
  expect(result.failures).toEqual([]);
  expect(result.skipped).toEqual(false);
  // Five probes, three distinct packages: protocol and ui are each queried by
  // the display layer AND by the tracked registry block, legacy only by the
  // display layer. The reported count is the package count, not the probe
  // count.
  expect(result.verifiedPackages).toEqual(3);
  expect(result.unverifiedPackages).toEqual(0);
  const verdict = driftVerdict(result, { allowOffline: false });
  expect(verdict.status).toEqual('pass');
  expect(verdict.exitCode).toEqual(0);
  expect(verdict.lines.join('\n')).toContain('all 3 distinct required packages');
});

test('registry drift: a displayed version the registry does not serve fails', async () => {
  const result = await run({
    '@openelement/protocol': evidence(PREVIOUS),
    '@openelement/legacy': e404,
  });
  expect(result.failures.join('\n')).toContain('display drift: @openelement/protocol');
  expect(driftVerdict(result, { allowOffline: false }).exitCode).toEqual(1);
  // The local non-qualifying mode never turns a PROVEN drift green.
  expect(driftVerdict(result, { allowOffline: true }).exitCode).toEqual(1);
});

test('registry drift: a tracked dist-tag that disagrees fails', async () => {
  const document = stateDocument();
  document.packages[1]!.registry = { latest: VERSION, alpha: PREVIOUS };
  const result = await runRegistryDriftCheck({
    document,
    display: display(),
    query: queryFor({ '@openelement/legacy': e404 }),
  });
  expect(result.failures.join('\n')).toContain('registry drift: @openelement/ui dist-tag alpha');
  expect(driftVerdict(result, { allowOffline: true }).exitCode).toEqual(1);
});

test('registry drift: an unreachable registry fails the release gate by default', async () => {
  const result = await run({ '@openelement/legacy': e404, '@openelement/ui': offline });
  expect(result.failures).toEqual([]);
  expect(result.skipped).toEqual(true);
  // Distinct packages, not probes: ui failed both of its probes but counts
  // once as unverified; protocol and legacy answered and are verified.
  expect(result.verifiedPackages).toEqual(2);
  expect(result.unverifiedPackages).toEqual(1);
  expect(isOfflineFailure(offline.message)).toEqual(true);

  const strict = driftVerdict(result, { allowOffline: false });
  expect(strict.status).toEqual('fail');
  expect(strict.exitCode).toEqual(1);
  expect(strict.lines.join('\n')).toContain('must not pass an unverified display');

  const local = driftVerdict(result, { allowOffline: true });
  expect(local.status).toEqual('skip');
  expect(local.exitCode).toEqual(0);
  expect(local.lines.join('\n')).toContain('non-qualifying local run');
  expect(local.lines.join('\n')).toContain('2 distinct package(s) had at least one answered probe');
});

test('registry drift: E403 is a hard failure, never an offline skip', async () => {
  await expect(run({ '@openelement/legacy': e404, '@openelement/ui': forbidden })).rejects.toThrow(
    'E403',
  );
  expect(isOfflineFailure(forbidden.message)).toEqual(false);
  expect(isMissingPackageFailure(forbidden.message)).toEqual(false);
});

test('registry drift: a later network failure does not erase a proven drift', async () => {
  const result = await run({
    '@openelement/protocol': evidence(PREVIOUS),
    '@openelement/legacy': e404,
    '@openelement/ui': offline,
  });
  expect(result.skipped).toEqual(true);
  expect(result.failures.join('\n')).toContain('display drift: @openelement/protocol');
  expect(driftVerdict(result, { allowOffline: true }).exitCode).toEqual(1);
});

test('registry drift: E404 for a tracked published package is a failure, not a skip', async () => {
  await expect(run({ '@openelement/ui': e404, '@openelement/legacy': e404 })).rejects.toThrow(
    'E404',
  );
  expect(isMissingPackageFailure(e404.message)).toEqual(true);
});

test('registry drift: a missing display constant fails closed instead of an empty pass', () => {
  expect(() => readDisplayProjection('export const PUBLISHED_LATEST = {};')).toThrow(
    'PUBLISHED_LATEST declaration not found',
  );
  expect(() =>
    readDisplayProjection(
      'export const PUBLISHED_LATEST: Readonly<Record<string, string>> = {\n};\n' +
        'export const UNRELEASED_PACKAGES: readonly string[] = [];',
    ),
  ).toThrow('carries no entries');
});
