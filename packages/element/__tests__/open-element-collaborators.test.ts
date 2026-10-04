import { expect, test } from 'vitest';
import { ElementParams } from '../src/open-element-params.ts';
import { LifetimeScope } from '../src/internal/compiled/lifetime-scope.ts';
import { attachFormInternals } from '../src/open-element-form.ts';
// The claim executor is installed by the package entry, not by the kernel
// (#1416); the kernel case below reconnects into retained content, which is a
// claim. This file reaches the kernel directly, so it installs it exactly as
// the default '@openelement/element' entry does.
import '../src/internal/compiled/runtime/claim-install.ts';
import { CompiledElementKernel } from '../src/internal/compiled/runtime/kernel.ts';
import { signal } from '../src/internal/signal/framework.ts';
import { TestDocument } from './compiled-runtime/test-dom.ts';
import { testProgram } from './compiled-runtime/test-program.ts';

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

test('params: attribute parsed into reactive box', () => {
  const host = new ParamsHost() as unknown as HTMLElement;
  (host as { getAttribute(name: string): string | null }).getAttribute = (name) =>
    name === 'params' ? '{"id":"7"}' : null;
  const params = new ElementParams();
  expect(params.syncFromAttribute(host)).toBeTruthy();
  expect(params.value).toEqual({ id: '7' });
});

test('params: missing attribute is a no-op', () => {
  const host = new ParamsHost() as unknown as HTMLElement;
  const params = new ElementParams();
  expect(!params.syncFromAttribute(host)).toBeTruthy();
  expect(params.value).toEqual({});
});

test('params: oversized attribute logs instead of throwing', () => {
  const host = new ParamsHost() as unknown as HTMLElement;
  (host as { getAttribute(name: string): string | null }).getAttribute = () =>
    `{"pad":"${'x'.repeat(64 * 1024)}"}`;
  const params = new ElementParams();
  // The guard throws OpenElementError internally; syncFromAttribute catches it.
  expect(params.syncFromAttribute(host)).toBeTruthy();
  expect(params.value).toEqual({});
});

test('params: non-string-map JSON warns and falls back to an empty object (#1036)', () => {
  // "null" / "[1,2]" / '{"a":1}' all JSON.parse cleanly but are not route
  // params; `params.id` on null throws a TypeError downstream. Reject anything
  // that is not a flat string→string map.
  for (const bad of ['null', '[1,2]', '{"a":1}', '{"a":null}', '{"a":{"b":"1"}}', '"text"', '42']) {
    const host = new ParamsHost() as unknown as HTMLElement;
    (host as { getAttribute(name: string): string | null }).getAttribute = (name) =>
      name === 'params' ? bad : null;
    const params = new ElementParams();
    expect(params.syncFromAttribute(host)).toBeTruthy();
    expect(params.value, `expected {} for ${bad}`).toEqual({});
  }
});

test('params: setter copies, getter returns the copy', () => {
  const params = new ElementParams();
  const source = { a: '1' };
  params.value = source;
  source.a = 'mutated';
  expect(params.value).toEqual({ a: '1' });
});

// ─── LifetimeScope (#1458) ───────────────────────────────────────────

const KERNEL_PROGRAM = testProgram({
  tag: 'oe-collaborators-kernel',
  template: [{ k: 'el', tag: 'div', attrs: [], children: [{ k: 'part', index: 0 }] }],
  parts: [{ k: 'text', index: 0, signal: 'message' }],
});

test('lifecycle: dispose aborts the scope signal', () => {
  const lifecycle = new LifetimeScope();
  const first = lifecycle.signal;
  lifecycle.dispose();
  expect(first.aborted, 'the signal held by the disposed scope is aborted').toBeTruthy();
  expect(
    lifecycle.signal.aborted,
    'the disposed scope keeps reporting an aborted signal',
  ).toBeTruthy();
  expect(!lifecycle.active).toBeTruthy();
});

test('lifecycle: a kernel reconnect replaces the scope and starts a fresh live signal', () => {
  const document = new TestDocument();
  const element = document.createElement('oe-collaborators-kernel');
  const message = signal('first');
  const kernel = new CompiledElementKernel(element as unknown as HTMLElement, KERNEL_PROGRAM, {
    signals: { message },
    handlers: {},
    rootMode: 'open',
  });

  kernel.connect();
  const activation = kernel.lifecycle;
  const connectedSignal = activation.signal;
  kernel.disconnect();
  // Disconnect disposes the activation scope and replaces it (kernel.ts:252,
  // 258): the retained signal is aborted, the replacement is live and is a
  // different instance — the current signal of a disposed scope is itself
  // aborted (lifetime-scope.ts:42), so "aborted" alone cannot identify it.
  const replacement = kernel.lifecycle;
  expect(activation.disposed, 'disconnect disposes the activation scope').toBeTruthy();
  expect(connectedSignal.aborted, 'the disposed activation signal is aborted').toBeTruthy();
  expect(!replacement.disposed, 'the replacement scope is live').toBeTruthy();
  expect(!replacement.signal.aborted).toBeTruthy();
  expect(replacement).not.toBe(activation);
  expect(replacement.signal).not.toBe(connectedSignal);

  // Reconnect reuses the replacement scope — connect() never swaps the scope
  // (kernel.ts:177) — so the live signal observed after disconnect is the one
  // the reconnected activation runs against, and it is still un-aborted.
  kernel.connect();
  expect(kernel.lifecycle).toBe(replacement);
  expect(connectedSignal.aborted, 'the aborted signal stays aborted across reconnect').toBeTruthy();
  expect(!kernel.lifecycle.signal.aborted).toBeTruthy();

  kernel.disconnect();
  expect(
    replacement.disposed,
    'disconnect disposes the scope the reconnect activated',
  ).toBeTruthy();
  expect(kernel.lifecycle).not.toBe(replacement);
  expect(!kernel.lifecycle.signal.aborted, 'the third scope starts live').toBeTruthy();
});

test('lifecycle: setTimeout is cleared on dispose', async () => {
  const lifecycle = new LifetimeScope();
  let fired = false;
  lifecycle.setTimeout(() => {
    fired = true;
  }, 10);
  lifecycle.dispose();
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(!fired, 'timer must be cleared on dispose').toBeTruthy();
});

test('lifecycle: setTimeout fires when not disposed', async () => {
  const lifecycle = new LifetimeScope();
  let fired = false;
  lifecycle.setTimeout(() => {
    fired = true;
  }, 5);
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(fired).toBeTruthy();
});

// ─── attachFormInternals (#904) ──────────────────────────────────────

test('form: attaches internals only when opted in', () => {
  const fakeInternals = {} as ElementInternals;
  const withAttach = {
    attachInternals: () => fakeInternals,
  };
  expect(attachFormInternals(withAttach, { formAssociated: true })).toEqual(fakeInternals);
  expect(attachFormInternals(withAttach, {})).toEqual(undefined);
  expect(attachFormInternals({}, { formAssociated: true })).toEqual(undefined);
});
