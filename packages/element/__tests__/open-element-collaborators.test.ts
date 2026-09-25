import { assert, assertEquals } from '@std/assert';
import { ElementParams } from '../src/open-element-params.ts';
import { LifetimeScope } from '../src/internal/compiled/lifetime-scope.ts';
import { attachFormInternals } from '../src/open-element-form.ts';

// ─── ElementParams (#904) ────────────────────────────────────────────

class ParamsHost {
  #attributes = new Map<string, string>();
  get tagName() {
    return 'x-test';
  }
  getAttribute(name: string): string | null {
    return this.#attributes.get(name) ?? null;
  }
}

Deno.test('params: attribute parsed into reactive box', () => {
  const host = new ParamsHost() as unknown as HTMLElement;
  (host as { getAttribute(name: string): string | null }).getAttribute = (name) =>
    name === 'params' ? '{"id":"7"}' : null;
  const params = new ElementParams();
  assert(params.syncFromAttribute(host));
  assertEquals(params.value, { id: '7' });
});

Deno.test('params: missing attribute is a no-op', () => {
  const host = new ParamsHost() as unknown as HTMLElement;
  const params = new ElementParams();
  assert(!params.syncFromAttribute(host));
  assertEquals(params.value, {});
});

Deno.test('params: oversized attribute logs instead of throwing', () => {
  const host = new ParamsHost() as unknown as HTMLElement;
  (host as { getAttribute(name: string): string | null }).getAttribute = () =>
    `{"pad":"${'x'.repeat(64 * 1024)}"}`;
  const params = new ElementParams();
  // The guard throws OpenElementError internally; syncFromAttribute catches it.
  assert(params.syncFromAttribute(host));
  assertEquals(params.value, {});
});

Deno.test('params: non-string-map JSON warns and falls back to an empty object (#1036)', () => {
  // "null" / "[1,2]" / '{"a":1}' all JSON.parse cleanly but are not route
  // params; `params.id` on null throws a TypeError downstream. Reject anything
  // that is not a flat string→string map.
  for (const bad of ['null', '[1,2]', '{"a":1}', '{"a":null}', '{"a":{"b":"1"}}', '"text"', '42']) {
    const host = new ParamsHost() as unknown as HTMLElement;
    (host as { getAttribute(name: string): string | null }).getAttribute = (name) =>
      name === 'params' ? bad : null;
    const params = new ElementParams();
    assert(params.syncFromAttribute(host));
    assertEquals(params.value, {}, `expected {} for ${bad}`);
  }
});

Deno.test('params: setter copies, getter returns the copy', () => {
  const params = new ElementParams();
  const source = { a: '1' };
  params.value = source;
  source.a = 'mutated';
  assertEquals(params.value, { a: '1' });
});

// ─── LifetimeScope (#1458) ───────────────────────────────────────────

Deno.test('lifecycle: dispose aborts the signal and next activation starts fresh', () => {
  const lifecycle = new LifetimeScope();
  const first = lifecycle.signal;
  lifecycle.dispose();
  assert(first.aborted);
  assert(!new LifetimeScope().signal.aborted);
});

Deno.test('lifecycle: setTimeout is cleared on dispose', async () => {
  const lifecycle = new LifetimeScope();
  let fired = false;
  lifecycle.setTimeout(() => {
    fired = true;
  }, 10);
  lifecycle.dispose();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert(!fired, 'timer must be cleared on dispose');
});

Deno.test('lifecycle: setTimeout fires when not disposed', async () => {
  const lifecycle = new LifetimeScope();
  let fired = false;
  lifecycle.setTimeout(() => {
    fired = true;
  }, 5);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert(fired);
});

// ─── attachFormInternals (#904) ──────────────────────────────────────

Deno.test('form: attaches internals only when opted in', () => {
  const fakeInternals = {} as ElementInternals;
  const withAttach = {
    attachInternals: () => fakeInternals,
  };
  assertEquals(attachFormInternals(withAttach, { formAssociated: true }), fakeInternals);
  assertEquals(attachFormInternals(withAttach, {}), undefined);
  assertEquals(attachFormInternals({}, { formAssociated: true }), undefined);
});
