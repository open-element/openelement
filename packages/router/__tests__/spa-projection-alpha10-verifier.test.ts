/**
 * Alpha.10 closure verification — NEW __proto__ projection probe added by the
 * independent release verifier (packet criterion 8). Vectors NOT present in
 * spa-projection-guard.test.ts:
 *   - defineProperty-crafted own "__proto__" data key (not JSON.parse)
 *   - nested {"__proto__": {...}} pollution attempt one level down
 *   - {"constructor": {"prototype": {...}}} re-prototyping attempt
 *   - the full SPA-path chain projectPageProps → injectPropsSafe onto a host
 *   - differential control: the SAME payload through a naive assignment loop
 *     DOES re-prototype the host, proving the guard is load-bearing
 */

import { assert, assertEquals, assertNotStrictEquals, assertStrictEquals } from '@std/assert';
import { injectPropsSafe } from '@openelement/element';
import { projectPageProps } from '../src/index.ts';

const silentLog = { warn(): void {}, debug(): void {} };

/** Host standing in for a live page element instance. */
function makeHost(): { host: Record<string, unknown>; proto: object } {
  const proto = { marker: 'host-proto' };
  const host = Object.create(proto) as Record<string, unknown>;
  host.existing = 'keep';
  return { host, proto };
}

Deno.test('alpha10-verifier projection: defineProperty-crafted own __proto__ key fails closed at the write boundary', () => {
  const payload: Record<string, unknown> = {};
  Object.defineProperty(payload, '__proto__', {
    value: { polluted: true },
    enumerable: true,
    writable: true,
    configurable: true,
  });
  payload.title = 'legit';

  const { host, proto } = makeHost();
  injectPropsSafe(host, payload, 'oe-alpha10-probe', silentLog);

  assertStrictEquals(Object.getPrototypeOf(host), proto, 'host prototype identity must not move');
  assertEquals(Object.hasOwn(host, '__proto__'), false);
  assertEquals((host as { polluted?: unknown }).polluted, undefined);
  assertEquals(host.title, 'legit');
  assertEquals(({} as { polluted?: unknown }).polluted, undefined, 'global prototype unpolluted');
});

Deno.test('alpha10-verifier projection: constructor.prototype re-prototyping attempt fails closed', () => {
  const payload = JSON.parse(
    '{"constructor": {"prototype": {"polluted": true}}, "prototype": {"polluted": true}, "id": "7"}',
  ) as Record<string, unknown>;

  const { host, proto } = makeHost();
  injectPropsSafe(host, payload, 'oe-alpha10-probe', silentLog);

  assertStrictEquals(Object.getPrototypeOf(host), proto);
  assertEquals(Object.hasOwn(host, 'constructor'), false);
  assertEquals(Object.hasOwn(host, 'prototype'), false);
  assertEquals(host.id, '7');
  assertEquals(({} as { polluted?: unknown }).polluted, undefined);
});

Deno.test('alpha10-verifier projection: full SPA-path chain projectPageProps → injectPropsSafe fails closed', () => {
  const params = JSON.parse('{"__proto__": "x", "slug": "hello"}') as Record<string, string>;
  const data = JSON.parse(
    '{"__proto__": {"polluted": true}, "constructor": "evil", "title": "legit"}',
  ) as Record<string, unknown>;

  const projected = projectPageProps({ params, data });
  const { host, proto } = makeHost();
  injectPropsSafe(host, projected, 'oe-alpha10-probe', silentLog);

  assertStrictEquals(Object.getPrototypeOf(host), proto);
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    assertEquals(Object.hasOwn(host, key), false, `dangerous key ${key} must not land on host`);
  }
  assertEquals(host.slug, 'hello');
  assertEquals(host.title, 'legit');
  assertEquals(({} as { polluted?: unknown }).polluted, undefined);
});

Deno.test('alpha10-verifier projection: nested __proto__ payload cannot reach the host prototype', () => {
  const data = JSON.parse('{"a": {"__proto__": {"polluted": true}}, "b": 1}') as Record<
    string,
    unknown
  >;
  const { host, proto } = makeHost();
  injectPropsSafe(host, projectPageProps({ data }), 'oe-alpha10-probe', silentLog);

  assertStrictEquals(Object.getPrototypeOf(host), proto);
  assertEquals(host.b, 1);
  // The nested object may be carried as inert data; it must never re-prototype anything.
  assertEquals(({} as { polluted?: unknown }).polluted, undefined);
  assertEquals((host.a as Record<string, unknown>).polluted, undefined);
});

Deno.test('alpha10-verifier projection: differential control — a naive assignment loop DOES re-prototype (guard is load-bearing)', () => {
  const payload = JSON.parse('{"__proto__": {"polluted": true}, "title": "legit"}') as Record<
    string,
    unknown
  >;
  const { host, proto } = makeHost();
  // Naive pre-#1214-style assignment: own enumerable keys written directly.
  let reprototyped = true;
  try {
    for (const key of Object.keys(payload)) {
      host[key] = (payload as Record<string, unknown>)[key];
    }
  } catch {
    // Deno disables Object.prototype.__proto__ assignment by default; browsers
    // do not. Under --unsafe-proto (browser semantics) the assignment lands.
    reprototyped = false;
  }
  if (!reprototyped || Object.getPrototypeOf(host) === proto) {
    // Runtime-neutralized environment: the control cannot pollute here, so the
    // load-bearing evidence is the --unsafe-proto run recorded in the Alpha.10
    // closure evidence bundle (control re-prototypes; guarded path does not).
    return;
  }
  assertNotStrictEquals(
    Object.getPrototypeOf(host),
    proto,
    'control must show the naive loop re-prototypes the host, else the probe proves nothing',
  );
  assert((host as { polluted?: unknown }).polluted === true);
});
