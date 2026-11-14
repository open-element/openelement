import { expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { assertRejectsIncludes, assertThrowsIncludes } from '../../tests/lib/vitest-asserts.ts';
import { VITE_DEV_PIN } from '../repo/deps-vite-check.ts';
import {
  admitsRelease,
  assertPackageManagerNeutralManifest,
  assertStarterIsPackageManagerNeutral,
  cdnAvailabilityDecision,
  classifyRegistryResponse,
  fail,
  NODE_RUNTIME_SMOKE_SOURCE,
  nodeConsumerManifest,
  npmAvailabilityDecision,
  parseConsumerSmokeOptions,
  parseQualificationOptions,
  pass,
  type RegistryFetcher,
  releaseGateExitCode,
  releaseLineVitePin,
  type ReleaseLineVitePin,
  skipAllowed,
  unknown,
  VITE_SMOKE_SOURCE,
} from './published-consumer-qualification.ts';

test('published-consumer qualification defaults to the current published package line', () => {
  expect(
    parseQualificationOptions([], { OPEN_ELEMENT_PUBLISHED_VERSION: '0.41.0-alpha.14' }),
  ).toEqual({
    mode: 'all',
    reportPath: 'published-consumer-report.json',
    version: '0.41.0-alpha.14',
  });
});

test('published-consumer qualification accepts an explicit version and isolated mode', () => {
  expect(
    parseQualificationOptions(
      ['--mode', 'starter', '--version', '0.41.0-alpha.15', '--report', 'artifacts/report.json'],
      {},
    ),
  ).toEqual({
    mode: 'starter',
    reportPath: 'artifacts/report.json',
    version: '0.41.0-alpha.15',
  });
});

test('published-consumer qualification rejects an unknown mode', () => {
  assertThrowsIncludes(
    () => parseQualificationOptions(['--mode', 'browser'], {}),
    Error,
    '--mode must be starter, runtime, or all',
  );
});

test('runtime-mode node-consumer manifest pins vite explicitly (router/vite needs it; an optional peer is never auto-installed)', () => {
  const manifest = nodeConsumerManifest('1.0.0-alpha.8');
  expect(manifest.dependencies).toEqual({
    '@openelement/element': '1.0.0-alpha.8',
    '@openelement/router': '1.0.0-alpha.8',
  });
  // The `./vite` subpath top-level-imports vite; the published router declares
  // it only as an optional peer, so the manifest must carry the canonical pin.
  expect(manifest.devDependencies.vite).toEqual(VITE_DEV_PIN);
});

test('consumer-smoke options: --local smokes the workspace with no CDN or Nitro probes', () => {
  expect(parseConsumerSmokeOptions(['--smoke', '--local'], '1.0.0-alpha.1')).toEqual({
    local: true,
    version: '1.0.0-alpha.1',
    versionProvided: false,
    runJsDelivr: false,
    runNitro: false,
  });
});

test('consumer-smoke options: an explicit version enables CDN and Nitro probes unless local', () => {
  expect(parseConsumerSmokeOptions(['--smoke', '--version', '1.0.0-alpha.1'], '0.0.0')).toEqual({
    local: false,
    version: '1.0.0-alpha.1',
    versionProvided: true,
    runJsDelivr: true,
    runNitro: true,
  });
  expect(
    parseConsumerSmokeOptions(['--smoke', '--local', '--version', '1.0.0-alpha.1'], '0.0.0'),
  ).toEqual({
    local: true,
    version: '1.0.0-alpha.1',
    versionProvided: true,
    runJsDelivr: false,
    runNitro: false,
  });
});

test('consumer-smoke options: an empty --version falls back to the workspace version', () => {
  // Unset workflow inputs arrive as an empty string and must not count as an
  // explicit npm version.
  expect(parseConsumerSmokeOptions(['--smoke', '--version', ''], '1.0.0-alpha.1')).toEqual({
    local: false,
    version: '1.0.0-alpha.1',
    versionProvided: false,
    runJsDelivr: false,
    runNitro: false,
  });
  // Explicit probe flags still apply without a version.
  expect(
    parseConsumerSmokeOptions(['--smoke', '--version', '', '--jsdelivr'], '1.0.0-alpha.1')
      .runJsDelivr,
  ).toEqual(true);
});

// Canonical release-gate verdict contract tests (#1216, A10.8). Only PASS
// admits a release; UNKNOWN (infra uncertainty) and FAIL always fail closed;
// SKIP_ALLOWED admits only when release policy explicitly allows a skip.

test('gate-verdict: only PASS admits a release by default', () => {
  expect(admitsRelease(pass('confirmed'))).toEqual(true);
  expect(admitsRelease(fail('confirmed absence'))).toEqual(false);
  expect(admitsRelease(unknown('registry timeout'))).toEqual(false);
  expect(admitsRelease(skipAllowed('infra absent locally'))).toEqual(false);
});

test('gate-verdict: SKIP_ALLOWED admits only when release policy explicitly allows skips', () => {
  const skip = skipAllowed('policy-sanctioned skip');
  expect(admitsRelease(skip, { allowSkip: false })).toEqual(false);
  expect(admitsRelease(skip, { allowSkip: true })).toEqual(true);
  // Policy never rescues FAIL or UNKNOWN.
  expect(admitsRelease(fail('x'), { allowSkip: true })).toEqual(false);
  expect(admitsRelease(unknown('x'), { allowSkip: true })).toEqual(false);
});

test('gate-verdict: exit code is 0 only for admitted verdicts', () => {
  expect(releaseGateExitCode(pass('ok'))).toEqual(0);
  expect(releaseGateExitCode(fail('no'))).toEqual(1);
  expect(releaseGateExitCode(unknown('timeout'))).toEqual(1);
  expect(releaseGateExitCode(skipAllowed('skip'))).toEqual(1);
  expect(releaseGateExitCode(skipAllowed('skip'), { allowSkip: true })).toEqual(0);
});

test('gate-verdict: decisions carry a human-readable reason', () => {
  expect(pass('p').reason).toEqual('p');
  expect(fail('f').reason).toEqual('f');
  expect(unknown('u').reason).toEqual('u');
  expect(skipAllowed('s').reason).toEqual('s');
});

// Hostile decision-logic tests for the consumer smoke (#1216, A10.8 / H6).
// Only a CONFIRMED registry 200 whose
// body confirms the exact version may admit the release. Confirmed absence
// (404) is FAIL; every infra uncertainty — timeout, DNS/network exception,
// 5xx, redirect, malformed or inconsistent payload — is UNKNOWN and fails
// closed (non-zero exit). No path may turn infra uncertainty into PASS or
// SKIP.

const NAME = '@openelement/element';
const VERSION = '1.0.0-alpha.1';

function fetcherReturning(status: number, body: unknown): RegistryFetcher {
  return () => Promise.resolve({ status, body: String(body) });
}

function fetcherThrowing(error: Error): RegistryFetcher {
  return () => Promise.reject(error);
}

test('consumer-smoke registry probe: confirmed 200 with matching version is the only PASS', async () => {
  const decision = await npmAvailabilityDecision(
    NAME,
    VERSION,
    fetcherReturning(200, JSON.stringify({ name: NAME, version: VERSION })),
  );
  expect(decision.verdict).toEqual('PASS');
  expect(admitsRelease(decision)).toEqual(true);
  expect(releaseGateExitCode(decision)).toEqual(0);
});

test('consumer-smoke registry probe: confirmed 404 is FAIL (not a silent skip)', async () => {
  const decision = await npmAvailabilityDecision(NAME, VERSION, fetcherReturning(404, '{}'));
  expect(decision.verdict).toEqual('FAIL');
  expect(releaseGateExitCode(decision)).toEqual(1);
});

test('consumer-smoke registry probe: 5xx is UNKNOWN and fails closed', async () => {
  for (const status of [500, 502, 503]) {
    const decision = await npmAvailabilityDecision(
      NAME,
      VERSION,
      fetcherReturning(status, 'upstream error'),
    );
    expect(decision.verdict, `status ${status}`).toEqual('UNKNOWN');
    expect(releaseGateExitCode(decision)).toEqual(1);
  }
});

test('consumer-smoke registry probe: redirects and other statuses are UNKNOWN', async () => {
  for (const status of [301, 403, 418]) {
    const decision = await npmAvailabilityDecision(NAME, VERSION, fetcherReturning(status, ''));
    expect(decision.verdict, `status ${status}`).toEqual('UNKNOWN');
    expect(admitsRelease(decision)).toEqual(false);
  }
});

test('consumer-smoke registry probe: DNS/network exception is UNKNOWN and fails closed', async () => {
  const decision = await npmAvailabilityDecision(
    NAME,
    VERSION,
    fetcherThrowing(new TypeError('getaddrinfo ENOTFOUND registry.npmjs.org')),
  );
  expect(decision.verdict).toEqual('UNKNOWN');
  expect(releaseGateExitCode(decision)).toEqual(1);
});

test('consumer-smoke registry probe: timeout is UNKNOWN and fails closed', async () => {
  const decision = await npmAvailabilityDecision(
    NAME,
    VERSION,
    fetcherThrowing(new DOMException('The operation timed out', 'TimeoutError')),
  );
  expect(decision.verdict).toEqual('UNKNOWN');
  expect(releaseGateExitCode(decision)).toEqual(1);
});

test('consumer-smoke registry probe: malformed JSON on 200 is UNKNOWN, never PASS', async () => {
  const decision = await npmAvailabilityDecision(
    NAME,
    VERSION,
    fetcherReturning(200, '<!DOCTYPE html><title>proxy error</title>'),
  );
  expect(decision.verdict).toEqual('UNKNOWN');
  expect(releaseGateExitCode(decision)).toEqual(1);
});

test('consumer-smoke registry probe: 200 whose payload does not confirm the version is UNKNOWN', async () => {
  for (const body of ['{}', JSON.stringify({ version: '0.0.0-other' }), '[]', '"ok"', '42']) {
    const decision = await npmAvailabilityDecision(NAME, VERSION, fetcherReturning(200, body));
    expect(decision.verdict, `body ${body}`).toEqual('UNKNOWN');
    expect(admitsRelease(decision)).toEqual(false);
  }
});

test('consumer-smoke registry classification: pure classifier mirrors the probe verdicts', () => {
  expect(
    classifyRegistryResponse(NAME, VERSION, 200, JSON.stringify({ version: VERSION })).verdict,
  ).toEqual('PASS');
  expect(classifyRegistryResponse(NAME, VERSION, 404, '{}').verdict).toEqual('FAIL');
  expect(classifyRegistryResponse(NAME, VERSION, 500, '').verdict).toEqual('UNKNOWN');
  expect(classifyRegistryResponse(NAME, VERSION, 200, 'not json').verdict).toEqual('UNKNOWN');
});

test('consumer-smoke CDN probe: package published but CDN artifact missing is FAIL', async () => {
  const decision = await cdnAvailabilityDecision(VERSION, fetcherReturning(404, 'Not found'));
  expect(decision.verdict).toEqual('FAIL');
  expect(releaseGateExitCode(decision)).toEqual(1);
});

test('consumer-smoke CDN probe: CDN 5xx / network failure is UNKNOWN and fails closed', async () => {
  const serverError = await cdnAvailabilityDecision(VERSION, fetcherReturning(503, ''));
  expect(serverError.verdict).toEqual('UNKNOWN');
  expect(releaseGateExitCode(serverError)).toEqual(1);

  const networkError = await cdnAvailabilityDecision(
    VERSION,
    fetcherThrowing(new TypeError('network unreachable')),
  );
  expect(networkError.verdict).toEqual('UNKNOWN');
  expect(releaseGateExitCode(networkError)).toEqual(1);
});

test('consumer-smoke CDN probe: confirmed 200 with a non-empty export is PASS; empty body is FAIL', async () => {
  const ok = await cdnAvailabilityDecision(VERSION, fetcherReturning(200, 'export{/* esm */};'));
  expect(ok.verdict).toEqual('PASS');
  expect(releaseGateExitCode(ok)).toEqual(0);

  const empty = await cdnAvailabilityDecision(VERSION, fetcherReturning(200, '   \n '));
  expect(empty.verdict).toEqual('FAIL');
  expect(releaseGateExitCode(empty)).toEqual(1);
});

test('consumer-smoke: no hostile registry input maps to PASS or SKIP — every uncertainty exits non-zero', async () => {
  const hostile: Array<[string, RegistryFetcher]> = [
    ['404', fetcherReturning(404, '{}')],
    ['500', fetcherReturning(500, '')],
    ['timeout', fetcherThrowing(new DOMException('timed out', 'TimeoutError'))],
    ['dns', fetcherThrowing(new TypeError('ENOTFOUND'))],
    ['malformed', fetcherReturning(200, '{')],
    ['version-mismatch', fetcherReturning(200, JSON.stringify({ version: '9.9.9' }))],
  ];
  for (const [label, fetcher] of hostile) {
    const registry = await npmAvailabilityDecision(NAME, VERSION, fetcher);
    expect(registry.verdict === 'PASS' || registry.verdict === 'SKIP_ALLOWED', label).toEqual(
      false,
    );
    expect(releaseGateExitCode(registry), label).toEqual(1);
  }
});

test('consumer-smoke: no hostile CDN input maps to PASS or SKIP — every uncertainty exits non-zero', async () => {
  // The CDN serves JS text, not JSON: body shape is not evidence. Only status,
  // non-emptiness and probe success classify the verdict.
  const hostile: Array<[string, RegistryFetcher]> = [
    ['404-artifact-missing', fetcherReturning(404, 'Not found')],
    ['500', fetcherReturning(500, '')],
    ['timeout', fetcherThrowing(new DOMException('timed out', 'TimeoutError'))],
    ['dns', fetcherThrowing(new TypeError('ENOTFOUND'))],
    ['empty-200', fetcherReturning(200, '  ')],
  ];
  for (const [label, fetcher] of hostile) {
    const cdn = await cdnAvailabilityDecision(VERSION, fetcher);
    expect(cdn.verdict === 'PASS' || cdn.verdict === 'SKIP_ALLOWED', label).toEqual(false);
    expect(releaseGateExitCode(cdn), label).toEqual(1);
  }
});

test('node runtime smoke stays on the plain-Node core surface', () => {
  // The plain-Node smoke covers the framework core only; the `router/vite`
  // build entry has its own smoke surface (vite-entry.mjs, run on the same
  // node host) and must not be pulled in here — and no node-side smoke may
  // reference the Deno global.
  expect(
    !NODE_RUNTIME_SMOKE_SOURCE.includes('router/vite'),
    'node smoke imports router/vite',
  ).toBeTruthy();
  expect(!NODE_RUNTIME_SMOKE_SOURCE.includes('Deno'), 'node smoke references Deno').toBeTruthy();
  expect(
    NODE_RUNTIME_SMOKE_SOURCE.includes("from '@openelement/router'"),
    'node smoke covers the router core',
  ).toBeTruthy();
  expect(
    VITE_SMOKE_SOURCE.includes("from '@openelement/router/vite'"),
    'vite smoke covers the vite entry',
  ).toBeTruthy();
});

// Scaffold package-manager-neutrality guard (alpha15+): both starter legs run
// `pnpm install` inside the scaffolded project, so the harness must know the
// shipped form before it runs anything. The Vite+ catalog form is retired —
// the scaffold pins `vite` itself (at its own release's version), declares no
// `packageManager`, carries no pnpm-only `catalog:`/`vite-plus` specifier, and
// ships NO pnpm-workspace.yaml. A create-side regression to any of those makes
// the generated project installable only under pnpm; the guard must name it
// before the install runs.

const repoRoot = join(import.meta.dirname!, '..', '..');
const scaffoldManifestTemplate = () =>
  readFile(join(repoRoot, 'packages', 'create', 'templates', 'package.json.tmpl'), 'utf8');

/** A release-line record, as {@link releaseLineVitePin} returns one. */
const releaseLine = (pin: string, source = 'test release line'): ReleaseLineVitePin => ({
  pin,
  source,
});

test('neutrality guard accepts the create template shipped manifest', async () => {
  // The real template payload (placeholders included — the `${...}` tokens sit
  // in string values, so it parses as JSON) must satisfy the guard, so a
  // create-side drift in the vite pin, the packageManager field, or a
  // reintroduced catalog specifier fails here, on the repo surface. The
  // working tree is the "release line" only because this file is not released:
  // the guard is driven by the pin it is handed, and the working tree's pin is
  // the one `deps:vite-check` holds the template to.
  const template = await scaffoldManifestTemplate();
  expect(() =>
    assertPackageManagerNeutralManifest(
      template,
      'template starter',
      releaseLine(VITE_DEV_PIN, 'packages/create/templates/package.json.tmpl (working tree)'),
    ),
  ).not.toThrow();
});

test('neutrality guard judges a published starter against its own release line (#1717)', () => {
  // alpha.15 shipped vite 8.0.16; `main` moved to 8.1.6 afterwards (#1683).
  // The published starter IS the alpha.15 artifact, so alpha.15's record is
  // what judges it — anchoring the check to the working tree made every
  // qualification run of an older release fail by construction.
  const alpha15 = releaseLine(
    '8.0.16',
    'v1.0.0-alpha.15:packages/create/templates/package.json.tmpl',
  );
  expect(() =>
    assertPackageManagerNeutralManifest(
      JSON.stringify({ devDependencies: { vite: '8.0.16' } }),
      'Published starter',
      alpha15,
    ),
  ).not.toThrow();
  // Still exact, in both directions: the release line is a record, not a floor.
  assertThrowsIncludes(
    () =>
      assertPackageManagerNeutralManifest(
        JSON.stringify({ devDependencies: { vite: VITE_DEV_PIN } }),
        'Published starter',
        alpha15,
      ),
    Error,
    "expected the release's starter pin 8.0.16 (v1.0.0-alpha.15:",
  );
});

test('neutrality guard rejects a scaffold whose vite pin drifts from its release', () => {
  const err = assertThrowsIncludes(
    () =>
      assertPackageManagerNeutralManifest(
        JSON.stringify({ devDependencies: { vite: '8.0.17' } }),
        'drifted starter',
        releaseLine(VITE_DEV_PIN),
      ),
    Error,
    `expected the release's starter pin ${VITE_DEV_PIN}`,
  );
  expect(err.message).toContain('drifted starter');
  // A range is the same violation: the generated project must pin one version.
  assertThrowsIncludes(
    () =>
      assertPackageManagerNeutralManifest(
        JSON.stringify({ devDependencies: { vite: '^8.0.0' } }),
        'ranged starter',
        releaseLine(VITE_DEV_PIN),
      ),
    Error,
    `expected the release's starter pin ${VITE_DEV_PIN}`,
  );
});

test('neutrality guard rejects the retired Vite+ manifest forms', () => {
  // The alpha.14 form: the pnpm-only catalog protocol plus the vite-plus
  // toolchain dependency the catalog resolved.
  assertThrowsIncludes(
    () =>
      assertPackageManagerNeutralManifest(
        JSON.stringify({ devDependencies: { vite: VITE_DEV_PIN, 'vite-plus': 'catalog:' } }),
        'vite-plus starter',
        releaseLine(VITE_DEV_PIN),
      ),
    Error,
    'still declares the retired Vite+ dependency: vite-plus=catalog:',
  );
  // A manifest that keeps only the specifier is the same regression.
  assertThrowsIncludes(
    () =>
      assertPackageManagerNeutralManifest(
        JSON.stringify({ devDependencies: { vite: `catalog:vite` } }),
        'catalog starter',
        releaseLine(VITE_DEV_PIN),
      ),
    Error,
    `expected the release's starter pin ${VITE_DEV_PIN}`,
  );
});

test('neutrality guard rejects a packageManager pin on the scaffold', () => {
  // vp's selection order is packageManager → lockfile → default pnpm, so a
  // surviving field would pick the manager for the user again.
  assertThrowsIncludes(
    () =>
      assertPackageManagerNeutralManifest(
        JSON.stringify({ packageManager: 'pnpm@12.8.1', devDependencies: { vite: VITE_DEV_PIN } }),
        'pinned starter',
        releaseLine(VITE_DEV_PIN),
      ),
    Error,
    'pins a package manager (packageManager=pnpm@12.8.1)',
  );
});

test('neutrality guard fails closed when the scaffold ships a pnpm-specific file', async () => {
  const scaffold = await mkdtemp(join(tmpdir(), 'pcq-neutral-guard-file-'));
  await writeFile(
    join(scaffold, 'package.json'),
    JSON.stringify({ devDependencies: { vite: VITE_DEV_PIN } }),
  );
  await writeFile(
    join(scaffold, 'pnpm-workspace.yaml'),
    'catalog:\n  vite-plus: 1.1.0\noverrides:\n',
  );
  const err = await assertRejectsIncludes(
    () =>
      assertStarterIsPackageManagerNeutral(
        scaffold,
        'regressed starter',
        releaseLine(VITE_DEV_PIN),
      ),
    Error,
    'ships a pnpm-workspace.yaml',
  );
  expect(err.message).toContain('regressed starter');
});

test('neutrality guard passes the neutral scaffold in place', async () => {
  const scaffold = await mkdtemp(join(tmpdir(), 'pcq-neutral-guard-ok-'));
  await writeFile(
    join(scaffold, 'package.json'),
    JSON.stringify({ devDependencies: { vite: VITE_DEV_PIN } }),
  );
  await assertStarterIsPackageManagerNeutral(
    scaffold,
    'neutral starter',
    releaseLine(VITE_DEV_PIN),
  );
  // The same directory with a workspace file added is exactly the regression.
  await writeFile(join(scaffold, 'pnpm-workspace.yaml'), 'packages: []\n');
  await assertRejectsIncludes(
    () =>
      assertStarterIsPackageManagerNeutral(scaffold, 'neutral starter', releaseLine(VITE_DEV_PIN)),
    Error,
    'must carry no pnpm-specific file',
  );
});

// The release line itself: the qualification's expected pin is a fact about a
// release tag, so it is read from git and never from a tracked copy (#1717).
// A scratch repository proves all three paths hermetically — the T7 tag, the
// absence of a compatibility candidate, and the fail-closed miss — without
// depending on which tags this checkout happens to have fetched.

async function scratchReleaseRepo(): Promise<{
  repo: string;
  repin: (pin: string) => Promise<void>;
  git: (...args: string[]) => void;
}> {
  const repo = await mkdtemp(join(tmpdir(), 'pcq-release-line-'));
  const templatePath = join(repo, 'packages', 'create', 'templates', 'package.json.tmpl');
  await mkdir(dirname(templatePath), { recursive: true });
  const git = (...args: string[]) => {
    execFileSync(
      'git',
      ['-C', repo, '-c', 'user.name=pcq', '-c', 'user.email=pcq@test.invalid', ...args],
      { stdio: 'pipe' },
    );
  };
  git('init', '-q');
  const repin = async (pin: string) => {
    await writeFile(templatePath, JSON.stringify({ devDependencies: { vite: pin } }, null, 2));
  };
  await repin('8.0.16');
  git('add', '.');
  git('commit', '-qm', 'the release');
  return { repo, repin, git };
}

test('release line is read from the release tag, not the working tree', async () => {
  const { repo, repin, git } = await scratchReleaseRepo();
  // T7 form: one tag per shipped package; `create` carries the template.
  git('tag', 'create-v0.0.1');
  // The working tree moves on after the release, exactly as `main` did after
  // alpha.15 shipped.
  await repin('9.9.9');

  const template = 'packages/create/templates/package.json.tmpl';
  expect(await releaseLineVitePin('0.0.1', repo)).toEqual({
    pin: '8.0.16',
    source: `create-v0.0.1:${template}`,
  });
  // The retired umbrella tag is NOT a candidate: alpha.1–alpha.14 predate the
  // neutral form, so their starter has no pin to compare and a fallback would
  // be a compatibility path with no reachable use.
  git('tag', 'v0.0.2');
  const err = await assertRejectsIncludes(
    () => releaseLineVitePin('0.0.2', repo),
    Error,
    'no release-line record for 0.0.2',
  );
  expect(err.message).toContain('git fetch --tags origin');
});

test('release line fails closed on a tag whose template pins no exact vite', async () => {
  const { repo, repin, git } = await scratchReleaseRepo();
  await repin('^8.0.0');
  git('commit', '-qam', 'a range is not a pin');
  git('tag', 'create-v0.0.4');
  const err = await assertRejectsIncludes(
    () => releaseLineVitePin('0.0.4', repo),
    Error,
    'does not pin an exact vite version (devDependencies.vite=^8.0.0)',
  );
  expect(err.message).toContain('0.0.4');
});
