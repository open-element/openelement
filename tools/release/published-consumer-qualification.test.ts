import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../tests/lib/vitest-asserts.ts';
import {
  admitsRelease,
  cdnAvailabilityDecision,
  classifyRegistryResponse,
  fail,
  NODE_RUNTIME_SMOKE_SOURCE,
  npmAvailabilityDecision,
  parseConsumerSmokeOptions,
  parseQualificationOptions,
  pass,
  type RegistryFetcher,
  releaseGateExitCode,
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

// Canonical release-gate verdict contract tests (#1216, A10.8), formerly
// tools/gate-verdict.test.ts. Only PASS admits a release; UNKNOWN (infra
// uncertainty) and FAIL always fail closed; SKIP_ALLOWED admits only when
// release policy explicitly allows a skip.

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

// Hostile decision-logic tests for the consumer smoke (#1216, A10.8 / H6),
// formerly tools/consumer-smoke.test.ts. Only a CONFIRMED registry 200 whose
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
  // `@openelement/router/vite` is Deno-toolchain surface (module top levels
  // assume the Deno global): importing it from plain node fails, so the node
  // smoke must never reference it — only the Deno smoke may.
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
    'deno smoke covers the vite entry',
  ).toBeTruthy();
});
