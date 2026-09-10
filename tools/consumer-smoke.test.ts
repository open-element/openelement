/**
 * Hostile decision-logic tests for consumer-smoke (#1216, A10.8 / H6).
 *
 * The npm availability probe is a release gate in the published-consumer
 * workflow. Only a
 * CONFIRMED registry 200 whose body confirms the exact version may admit the
 * release. Confirmed absence (404) is FAIL; every infra uncertainty —
 * timeout, DNS/network exception, 5xx, redirect, malformed or inconsistent
 * payload — is UNKNOWN and fails closed (non-zero exit). No path may turn
 * infra uncertainty into PASS or SKIP.
 */

import { assertEquals } from '@std/assert';
import { admitsRelease, releaseGateExitCode } from './gate-verdict.ts';
import {
  cdnAvailabilityDecision,
  classifyRegistryResponse,
  npmAvailabilityDecision,
  type RegistryFetcher,
} from './consumer-smoke.ts';

const NAME = '@openelement/element';
const VERSION = '1.0.0-alpha.1';

function fetcherReturning(status: number, body: unknown): RegistryFetcher {
  return () => Promise.resolve({ status, body: String(body) });
}

function fetcherThrowing(error: Error): RegistryFetcher {
  return () => Promise.reject(error);
}

Deno.test('consumer-smoke registry probe: confirmed 200 with matching version is the only PASS', async () => {
  const decision = await npmAvailabilityDecision(
    NAME,
    VERSION,
    fetcherReturning(200, JSON.stringify({ name: NAME, version: VERSION })),
  );
  assertEquals(decision.verdict, 'PASS');
  assertEquals(admitsRelease(decision), true);
  assertEquals(releaseGateExitCode(decision), 0);
});

Deno.test('consumer-smoke registry probe: confirmed 404 is FAIL (not a silent skip)', async () => {
  const decision = await npmAvailabilityDecision(NAME, VERSION, fetcherReturning(404, '{}'));
  assertEquals(decision.verdict, 'FAIL');
  assertEquals(releaseGateExitCode(decision), 1);
});

Deno.test('consumer-smoke registry probe: 5xx is UNKNOWN and fails closed', async () => {
  for (const status of [500, 502, 503]) {
    const decision = await npmAvailabilityDecision(
      NAME,
      VERSION,
      fetcherReturning(status, 'upstream error'),
    );
    assertEquals(decision.verdict, 'UNKNOWN', `status ${status}`);
    assertEquals(releaseGateExitCode(decision), 1);
  }
});

Deno.test('consumer-smoke registry probe: redirects and other statuses are UNKNOWN', async () => {
  for (const status of [301, 403, 418]) {
    const decision = await npmAvailabilityDecision(NAME, VERSION, fetcherReturning(status, ''));
    assertEquals(decision.verdict, 'UNKNOWN', `status ${status}`);
    assertEquals(admitsRelease(decision), false);
  }
});

Deno.test('consumer-smoke registry probe: DNS/network exception is UNKNOWN and fails closed', async () => {
  const decision = await npmAvailabilityDecision(
    NAME,
    VERSION,
    fetcherThrowing(new TypeError('getaddrinfo ENOTFOUND registry.npmjs.org')),
  );
  assertEquals(decision.verdict, 'UNKNOWN');
  assertEquals(releaseGateExitCode(decision), 1);
});

Deno.test('consumer-smoke registry probe: timeout is UNKNOWN and fails closed', async () => {
  const decision = await npmAvailabilityDecision(
    NAME,
    VERSION,
    fetcherThrowing(new DOMException('The operation timed out', 'TimeoutError')),
  );
  assertEquals(decision.verdict, 'UNKNOWN');
  assertEquals(releaseGateExitCode(decision), 1);
});

Deno.test('consumer-smoke registry probe: malformed JSON on 200 is UNKNOWN, never PASS', async () => {
  const decision = await npmAvailabilityDecision(
    NAME,
    VERSION,
    fetcherReturning(200, '<!DOCTYPE html><title>proxy error</title>'),
  );
  assertEquals(decision.verdict, 'UNKNOWN');
  assertEquals(releaseGateExitCode(decision), 1);
});

Deno.test('consumer-smoke registry probe: 200 whose payload does not confirm the version is UNKNOWN', async () => {
  for (const body of ['{}', JSON.stringify({ version: '0.0.0-other' }), '[]', '"ok"', '42']) {
    const decision = await npmAvailabilityDecision(NAME, VERSION, fetcherReturning(200, body));
    assertEquals(decision.verdict, 'UNKNOWN', `body ${body}`);
    assertEquals(admitsRelease(decision), false);
  }
});

Deno.test('consumer-smoke registry classification: pure classifier mirrors the probe verdicts', () => {
  assertEquals(
    classifyRegistryResponse(NAME, VERSION, 200, JSON.stringify({ version: VERSION })).verdict,
    'PASS',
  );
  assertEquals(classifyRegistryResponse(NAME, VERSION, 404, '{}').verdict, 'FAIL');
  assertEquals(classifyRegistryResponse(NAME, VERSION, 500, '').verdict, 'UNKNOWN');
  assertEquals(classifyRegistryResponse(NAME, VERSION, 200, 'not json').verdict, 'UNKNOWN');
});

Deno.test('consumer-smoke CDN probe: package published but CDN artifact missing is FAIL', async () => {
  const decision = await cdnAvailabilityDecision(VERSION, fetcherReturning(404, 'Not found'));
  assertEquals(decision.verdict, 'FAIL');
  assertEquals(releaseGateExitCode(decision), 1);
});

Deno.test('consumer-smoke CDN probe: CDN 5xx / network failure is UNKNOWN and fails closed', async () => {
  const serverError = await cdnAvailabilityDecision(VERSION, fetcherReturning(503, ''));
  assertEquals(serverError.verdict, 'UNKNOWN');
  assertEquals(releaseGateExitCode(serverError), 1);

  const networkError = await cdnAvailabilityDecision(
    VERSION,
    fetcherThrowing(new TypeError('network unreachable')),
  );
  assertEquals(networkError.verdict, 'UNKNOWN');
  assertEquals(releaseGateExitCode(networkError), 1);
});

Deno.test('consumer-smoke CDN probe: confirmed 200 with a non-empty export is PASS; empty body is FAIL', async () => {
  const ok = await cdnAvailabilityDecision(VERSION, fetcherReturning(200, 'export{/* esm */};'));
  assertEquals(ok.verdict, 'PASS');
  assertEquals(releaseGateExitCode(ok), 0);

  const empty = await cdnAvailabilityDecision(VERSION, fetcherReturning(200, '   \n '));
  assertEquals(empty.verdict, 'FAIL');
  assertEquals(releaseGateExitCode(empty), 1);
});

Deno.test('consumer-smoke: no hostile registry input maps to PASS or SKIP — every uncertainty exits non-zero', async () => {
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
    assertEquals(registry.verdict === 'PASS' || registry.verdict === 'SKIP_ALLOWED', false, label);
    assertEquals(releaseGateExitCode(registry), 1, label);
  }
});

Deno.test('consumer-smoke: no hostile CDN input maps to PASS or SKIP — every uncertainty exits non-zero', async () => {
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
    assertEquals(cdn.verdict === 'PASS' || cdn.verdict === 'SKIP_ALLOWED', false, label);
    assertEquals(releaseGateExitCode(cdn), 1, label);
  }
});
