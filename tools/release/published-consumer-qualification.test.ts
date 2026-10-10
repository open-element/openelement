import { expect, test } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertRejectsIncludes, assertThrowsIncludes } from '../../tests/lib/vitest-asserts.ts';
import { VITE_DEV_PIN } from '../repo/deps-vite-check.ts';
import {
  admitsRelease,
  assertStarterCarriesVitePlusWorkspace,
  assertVitePlusWorkspaceYaml,
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
  skipAllowed,
  unknown,
  VITE_PLUS_WORKSPACE_FRAGMENTS,
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

// Scaffold workspace-form guard (the alpha.14 Vite+ catalog): both starter
// legs run `pnpm install` inside the scaffolded project, whose manifest asks
// for `vite-plus: "catalog:"` — a spec that resolves ONLY through the
// scaffold's own pnpm-workspace.yaml catalog block. A harness step that
// replaces or drops that file strands the spec and pnpm dies with
// ERR_PNPM_CATALOG_ENTRY_NOT_FOUND_FOR_SPEC (the alpha.14 published-consumers
// failure). The guard must name the lost catalog before the install runs.

const repoRoot = join(import.meta.dirname!, '..', '..');
const scaffoldWorkspaceTemplate = () =>
  readFile(join(repoRoot, 'packages', 'create', 'templates', 'pnpm-workspace.yaml.tmpl'), 'utf8');

test('starter workspace guard accepts the create template shipped form', async () => {
  // The real template payload (placeholders included — the fragments do not
  // touch the version lines) must satisfy the guard, so a create-side drift
  // away from the anchored fragments fails here, on the repo surface.
  const template = await scaffoldWorkspaceTemplate();
  for (const fragment of VITE_PLUS_WORKSPACE_FRAGMENTS) {
    expect(template, `template must carry ${fragment}`).toContain(fragment);
  }
  expect(() => assertVitePlusWorkspaceYaml(template, 'template starter')).not.toThrow();
});

test('starter workspace guard rejects the harness clobber that lost the catalog in CI', () => {
  // tests/lib/qualify-harness/workspace-alias.ts installAppDependencies wrote
  // a bare `packages: []` over the scaffold's file before installing — the
  // exact alpha.14 published-consumers failure. The guard must fail naming
  // the missing catalog pair (not pnpm's resolver error), with the caller's
  // context legible in the message.
  const err = assertThrowsIncludes(
    () => assertVitePlusWorkspaceYaml('packages: []\n', 'clobbered starter'),
    Error,
    'is not the Vite+ form: missing npm:@voidzero-dev/vite-plus-core@1.1.0',
  );
  expect(err.message).toContain('clobbered starter');
  expect(err.message).toContain('catalog must travel with the scaffold');
});

test('starter workspace guard rejects a catalog stripped of the vite override', () => {
  // Full catalog entry, no `vite@*: "catalog:"` override: the guard must name
  // the override specifically (the first fragment check that fails).
  assertThrowsIncludes(
    () =>
      assertVitePlusWorkspaceYaml(
        'catalog:\n  vite: npm:@voidzero-dev/vite-plus-core@1.1.0\n  vite-plus: 1.1.0\n',
        'stripped',
      ),
    Error,
    'missing vite@*: "catalog:"',
  );
});

test('starter workspace guard fails closed when the scaffold ships no workspace file', async () => {
  const emptyScaffold = await mkdtemp(join(tmpdir(), 'pcq-workspace-guard-empty-'));
  await assertRejectsIncludes(
    () => assertStarterCarriesVitePlusWorkspace(emptyScaffold, 'bare starter'),
    Error,
    'missing pnpm-workspace.yaml',
  );
});

test('starter workspace guard passes the scaffold file in place beside package.json', async () => {
  const scaffold = await mkdtemp(join(tmpdir(), 'pcq-workspace-guard-ok-'));
  await writeFile(join(scaffold, 'pnpm-workspace.yaml'), await scaffoldWorkspaceTemplate());
  await assertStarterCarriesVitePlusWorkspace(scaffold, 'in-place starter');
});
