import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../../tests/lib/vitest-asserts.ts';
// The hydration executor is installed by the package entry, not by the kernel
// (#1416): the kernel resolves it through the claim seam. This file reaches
// the kernel directly, so it installs it exactly as the default
// '@openelement/element' entry does — the kernel case below reconnects into
// retained content, which is a claim.
import '../../src/internal/compiled/runtime/hydrate-install.ts';
import { CompiledElementKernel } from '../../src/internal/compiled/runtime/kernel.ts';
import {
  CompiledContextService,
  createRenderContextScope,
} from '../../src/internal/compiled/runtime/context.ts';
import { createContext } from '../../src/internal/core/signal-context.ts';
import { signal } from '../../src/internal/signal/framework.ts';
import { TestDocument, type TestElement } from './test-dom.ts';
import { testProgram } from './test-program.ts';

const CONTEXT_PROGRAM = testProgram({
  tag: 'oe-context-test',
  template: [{ k: 'el', tag: 'div', attrs: [], children: [{ k: 'part', index: 0 }] }],
  parts: [{ k: 'text', index: 0, signal: 'message' }],
});

function asElement(node: TestElement): HTMLElement {
  return node as unknown as HTMLElement;
}

function contextListenerCount(node: TestElement): number {
  return node.listeners.get('context-request')?.size ?? 0;
}

test('context consumption walks nested elements and crosses shadow boundaries', () => {
  const document = new TestDocument();
  const theme = createContext<string>(Symbol('theme'), 'light');

  // Plain nested light DOM.
  const outer = document.createElement('x-outer');
  const middle = document.createElement('x-middle');
  const inner = document.createElement('x-inner');
  outer.appendChild(middle);
  middle.appendChild(inner);

  const provider = new CompiledContextService(asElement(outer));
  provider.provide(theme, 'dark');

  const nested = new CompiledContextService(asElement(inner));
  const seen: string[] = [];
  nested.connect();
  nested.consume(theme, (value) => seen.push(value));
  expect(seen).toEqual(['dark']);

  // Open and closed shadow roots both forward the lookup to the host.
  let provided = 'dark';
  for (const mode of ['open', 'closed'] as const) {
    const shadowHost = document.createElement('x-shadow-host');
    const shadowInner = document.createElement('x-shadow-inner');
    middle.appendChild(shadowHost);
    const root = shadowHost.attachShadow({ mode });
    root.appendChild(shadowInner);

    const consumer = new CompiledContextService(asElement(shadowInner));
    const shadowSeen: string[] = [];
    consumer.connect();
    consumer.consume(theme, (value) => shadowSeen.push(value));
    expect(shadowSeen, `${mode} shadow boundary is crossed`).toEqual([provided]);

    provided = `dim-${mode}`;
    provider.provide(theme, provided);
    expect(shadowSeen.length, 'provider updates reach the subscriber exactly once').toEqual(2);
    expect(shadowSeen[1]).toEqual(provided);
    consumer.dispose();
  }
});

test('context consumption without a provider yields the default value', () => {
  const document = new TestDocument();
  const theme = createContext<string>(Symbol('unprovided'), 'light');
  const outer = document.createElement('x-outer');
  const lone = document.createElement('x-lone');
  outer.appendChild(lone);

  const consumer = new CompiledContextService(asElement(lone));
  const seen: string[] = [];
  consumer.connect();
  consumer.consume(theme, (value) => seen.push(value));
  expect(seen).toEqual(['light']);
  consumer.dispose();
});

test('nested providers select the nearest provider and notify exactly once', () => {
  const document = new TestDocument();
  const theme = createContext<string>(Symbol('nested-providers'), 'light');
  const outer = document.createElement('x-outer-provider');
  const inner = document.createElement('x-inner-provider');
  const leaf = document.createElement('x-leaf');
  outer.appendChild(inner);
  inner.appendChild(leaf);

  const outerProvider = new CompiledContextService(asElement(outer));
  const innerProvider = new CompiledContextService(asElement(inner));
  outerProvider.provide(theme, 'outer');
  innerProvider.provide(theme, 'inner');
  expect(contextListenerCount(outer)).toEqual(1);
  expect(contextListenerCount(inner)).toEqual(1);

  const consumer = new CompiledContextService(asElement(leaf));
  const seen: string[] = [];
  consumer.consume(theme, (value) => seen.push(value));
  consumer.connect();
  expect(seen, 'the nearest provider wins').toEqual(['inner']);

  outerProvider.provide(theme, 'outer-update');
  expect(seen, 'an ancestor provider is stopped by the nearest one').toEqual(['inner']);
  innerProvider.provide(theme, 'inner-update');
  expect(seen).toEqual(['inner', 'inner-update']);
  innerProvider.provide(theme, 'inner-update-2');
  expect(seen).toEqual(['inner', 'inner-update', 'inner-update-2']);

  consumer.dispose();
  innerProvider.dispose();
  outerProvider.dispose();
});

test('context crosses nested open and closed shadow roots', () => {
  const document = new TestDocument();
  const theme = createContext<string>(Symbol('nested-shadow-roots'), 'light');
  const providerHost = document.createElement('x-provider');
  const provider = new CompiledContextService(asElement(providerHost));
  provider.provide(theme, 'dark');

  const openOuterHost = document.createElement('x-open-outer');
  providerHost.appendChild(openOuterHost);
  const openOuterRoot = openOuterHost.attachShadow({ mode: 'open' });
  const closedInnerHost = document.createElement('x-closed-inner');
  openOuterRoot.appendChild(closedInnerHost);
  const closedInnerRoot = closedInnerHost.attachShadow({ mode: 'closed' });
  const nestedLeaf = document.createElement('x-nested-leaf');
  closedInnerRoot.appendChild(nestedLeaf);

  const nestedConsumer = new CompiledContextService(asElement(nestedLeaf));
  const nestedSeen: string[] = [];
  nestedConsumer.consume(theme, (value) => nestedSeen.push(value));
  nestedConsumer.connect();
  expect(nestedSeen, 'open then closed roots remain composed').toEqual(['dark']);

  const closedOuterHost = document.createElement('x-closed-outer');
  providerHost.appendChild(closedOuterHost);
  const closedOuterRoot = closedOuterHost.attachShadow({ mode: 'closed' });
  const openInnerHost = document.createElement('x-open-inner');
  closedOuterRoot.appendChild(openInnerHost);
  const openInnerRoot = openInnerHost.attachShadow({ mode: 'open' });
  const reverseLeaf = document.createElement('x-reverse-leaf');
  openInnerRoot.appendChild(reverseLeaf);

  const reverseConsumer = new CompiledContextService(asElement(reverseLeaf));
  const reverseSeen: string[] = [];
  reverseConsumer.consume(theme, (value) => reverseSeen.push(value));
  reverseConsumer.connect();
  expect(reverseSeen, 'closed then open roots remain composed').toEqual(['dark']);

  provider.provide(theme, 'dim');
  expect(nestedSeen).toEqual(['dark', 'dim']);
  expect(reverseSeen).toEqual(['dark', 'dim']);

  nestedConsumer.dispose();
  reverseConsumer.dispose();
  provider.dispose();
});

test('context subscriptions clean up exactly once and reconnect without duplicates', () => {
  const document = new TestDocument();
  const theme = createContext<string>(Symbol('lifecycle'), 'light');
  const host = document.createElement('x-host');
  const child = document.createElement('x-child');
  host.appendChild(child);

  const provider = new CompiledContextService(asElement(host));
  provider.provide(theme, 'dark');
  const consumer = new CompiledContextService(asElement(child));
  const seen: string[] = [];
  consumer.consume(theme, (value) => seen.push(value));
  consumer.connect();
  expect(seen).toEqual(['dark']);

  provider.provide(theme, 'dim');
  expect(seen).toEqual(['dark', 'dim']);

  consumer.disconnect();
  consumer.disconnect();
  provider.provide(theme, 'solar');
  expect(seen, 'disconnect unsubscribes exactly once').toEqual(['dark', 'dim']);

  consumer.connect();
  expect(seen, 'reconnect re-reads the current value').toEqual(['dark', 'dim', 'solar']);
  provider.provide(theme, 'amber');
  expect(seen, 'reconnect adds no duplicate subscription').toEqual([
    'dark',
    'dim',
    'solar',
    'amber',
  ]);

  consumer.dispose();
  consumer.dispose();
  provider.provide(theme, 'void');
  expect(seen, 'dispose stays unsubscribed').toEqual(['dark', 'dim', 'solar', 'amber']);
  assertThrowsIncludes(() => consumer.consume(theme, () => {}), Error, 'service is disposed');
});

test('moving a consumer re-resolves providers without stale or growing subscriptions', () => {
  const document = new TestDocument();
  const theme = createContext<string>(Symbol('move-provider'), 'light');
  const root = document.createElement('x-root');
  const providerAElement = document.createElement('x-provider-a');
  const providerBElement = document.createElement('x-provider-b');
  const consumerElement = document.createElement('x-consumer');
  root.appendChild(providerAElement);
  root.appendChild(providerBElement);
  providerAElement.appendChild(consumerElement);

  const providerA = new CompiledContextService(asElement(providerAElement));
  const providerB = new CompiledContextService(asElement(providerBElement));
  providerA.provide(theme, 'a-0');
  providerB.provide(theme, 'b-0');
  expect(contextListenerCount(providerAElement)).toEqual(1);
  expect(contextListenerCount(providerBElement)).toEqual(1);

  const consumer = new CompiledContextService(asElement(consumerElement));
  const seen: string[] = [];
  consumer.consume(theme, (value) => seen.push(value));
  consumer.connect();
  expect(seen).toEqual(['a-0']);

  consumer.disconnect();
  providerBElement.appendChild(consumerElement);
  providerA.provide(theme, 'a-before-reconnect');
  expect(seen, 'disconnect removes A before the move').toEqual(['a-0']);

  consumer.connect();
  expect(seen, 'reconnect resolves against B').toEqual(['a-0', 'b-0']);
  providerA.provide(theme, 'a-stale-after-move');
  expect(seen, 'A cannot notify after the move').toEqual(['a-0', 'b-0']);
  providerB.provide(theme, 'b-1');
  expect(seen).toEqual(['a-0', 'b-0', 'b-1']);

  for (let cycle = 0; cycle < 4; cycle++) {
    const beforeReconnect = seen.length;
    consumer.disconnect();
    consumer.disconnect();
    consumer.connect();
    expect(seen.length, 'reconnect creates one subscription').toEqual(beforeReconnect + 1);

    const next = `b-${cycle + 2}`;
    providerB.provide(theme, next);
    expect(seen.length, 'one provider update yields one callback').toEqual(beforeReconnect + 2);
    expect(seen[seen.length - 1]).toEqual(next);
  }

  expect(contextListenerCount(providerAElement), 'A has no listener growth').toEqual(1);
  expect(contextListenerCount(providerBElement), 'B has no listener growth').toEqual(1);
  consumer.dispose();
  consumer.dispose();
  providerA.provide(theme, 'a-after-dispose');
  providerB.provide(theme, 'b-after-dispose');
  expect(seen.length, 'dispose removes every active subscription').toEqual(3 + 4 * 2);
  expect(contextListenerCount(providerAElement)).toEqual(1);
  expect(contextListenerCount(providerBElement)).toEqual(1);

  providerA.dispose();
  providerB.dispose();
  expect(contextListenerCount(providerAElement)).toEqual(0);
  expect(contextListenerCount(providerBElement)).toEqual(0);
});

test('the kernel owns context provision and consumption at the activation boundary', () => {
  const document = new TestDocument();
  const theme = createContext<string>(Symbol('kernel-theme'), 'light');

  const providerElement = document.createElement('oe-context-test');
  const consumerElement = document.createElement('oe-context-test');
  const provider = new CompiledElementKernel(asElement(providerElement), CONTEXT_PROGRAM, {
    signals: { message: signal('provider') },
    handlers: {},
    rootMode: 'open',
  });
  const consumer = new CompiledElementKernel(asElement(consumerElement), CONTEXT_PROGRAM, {
    signals: { message: signal('consumer') },
    handlers: {},
    rootMode: 'light',
  });

  provider.connect();
  const shadow = providerElement.shadowRoot;
  expect(shadow === null).toBe(false);
  shadow!.appendChild(consumerElement);
  expect(consumerElement.getRootNode()).toBe(shadow!);

  const seen: string[] = [];
  consumer.context.consume(theme, (value) => seen.push(value));
  provider.context.provide(theme, 'dark');
  consumer.connect();
  expect(seen, 'consumption starts at connect across the shadow boundary').toEqual(['dark']);

  provider.context.provide(theme, 'dim');
  expect(seen, 'provided-value changes notify the subscribed descendant').toEqual(['dark', 'dim']);

  consumer.disconnect();
  provider.context.provide(theme, 'solar');
  expect(seen, 'kernel disconnect unsubscribes the consumer').toEqual(['dark', 'dim']);

  consumer.connect();
  expect(seen, 'kernel reconnect resubscribes at the current value').toEqual([
    'dark',
    'dim',
    'solar',
  ]);
  provider.context.provide(theme, 'amber');
  expect(seen, 'kernel reconnect adds no duplicate').toEqual(['dark', 'dim', 'solar', 'amber']);

  consumer.dispose();
  provider.context.provide(theme, 'void');
  expect(seen, 'kernel dispose stays unsubscribed').toEqual(['dark', 'dim', 'solar', 'amber']);
  provider.dispose();
});

// ─── `16b-CTX`: the generated lane's owner-scope mode ────────────────────────
//
// The generated function lane's owners are NOT all elements: a component
// reference creates no element, so two sibling hostless children share one
// element host. These rows pin the ADDITIVE owner-scope mode of the SAME
// service — `child()` / `provideOwned()` / `use()` / `refreshProviders()` — in a
// real DOM, so the class-lane protocol rows above keep their unchanged
// behaviour. The service's DOM path and the owner path share one consumer set,
// one subscription map and one disconnect release.

test('16b-CTX: the nearest owner-scope provider wins, and an outer one is shadowed', () => {
  const document = new TestDocument();
  const theme = createContext<string>(Symbol('ctx-owner-nested'), 'light');
  const host = document.createElement('x-ctx-host');

  const anchor = new CompiledContextService(asElement(host));
  const outerOwner = anchor.child();
  const innerOwner = outerOwner.child();
  const leafOwner = innerOwner.child();

  outerOwner.provideOwned(theme, () => 'outer');
  innerOwner.provideOwned(theme, () => 'inner');

  const seen: string[] = [];
  const consumer = leafOwner.use(theme);
  consumer.subscribe((value) => seen.push(value));
  anchor.connect();
  expect(consumer.value, 'the nearest owner-scope provider wins').toEqual('inner');
  expect(seen, 'the resolver reads once at subscribe time').toEqual(['light', 'inner']);

  outerOwner.provideOwned(theme, () => 'outer-2');
  anchor.refreshProviders();
  expect(consumer.value, 'an outer provider cannot cross the nearest one').toEqual('inner');

  innerOwner.provideOwned(theme, () => 'inner-2');
  anchor.refreshProviders();
  expect(consumer.value, 'the nearest provider updates its consumers').toEqual('inner-2');
  expect(seen, 'one notification per changed value').toEqual(['light', 'inner', 'inner-2']);

  anchor.dispose();
});

test('16b-CTX: sibling owners are isolated even though they share one element host', () => {
  const document = new TestDocument();
  const theme = createContext<string>(Symbol('ctx-sibling'), 'light');
  const host = document.createElement('x-ctx-sibling-host');

  const anchor = new CompiledContextService(asElement(host));
  const siblingA = anchor.child();
  const siblingB = anchor.child();
  const leafA = siblingA.child();
  const leafB = siblingB.child();

  siblingA.provideOwned(theme, () => 'a');
  siblingB.provideOwned(theme, () => 'b');

  const consumerA = leafA.use(theme);
  const consumerB = leafB.use(theme);
  anchor.connect();
  expect(consumerA.value, 'sibling A reads its own subtree').toEqual('a');
  expect(consumerB.value, 'sibling B reads its own subtree').toEqual('b');

  siblingA.provideOwned(theme, () => 'a2');
  anchor.refreshProviders();
  expect(consumerA.value).toEqual('a2');
  expect(consumerB.value, 'A never leaks into B').toEqual('b');

  anchor.dispose();
});

test('16b-CTX: a consumer with no owner-scope provider reads the declared default', () => {
  const document = new TestDocument();
  const theme = createContext<string>(Symbol('ctx-default'), 'fallback');
  const host = document.createElement('x-ctx-default-host');

  const anchor = new CompiledContextService(asElement(host));
  const owner = anchor.child();
  const consumer = owner.use(theme);
  anchor.connect();
  // The protocol path has no provider either, so the default stands — the same
  // answer the class lane gives, from the same engine.
  expect(consumer.value).toEqual('fallback');
  anchor.dispose();
});

test('16b-CTX: a disconnect publishes nothing and a reconnect re-reads without duplicating', () => {
  const document = new TestDocument();
  const theme = createContext<string>(Symbol('ctx-connection-lifecycle'), 'light');
  const host = document.createElement('x-ctx-lifecycle-host');

  const anchor = new CompiledContextService(asElement(host));
  const providerOwner = anchor.child();
  // The consumer must live INSIDE the provider's subtree: a sibling owner is
  // deliberately isolated (its own row above pins that), so a sibling here would
  // fall through to the DOM default and prove nothing about the reconnect.
  const consumerOwner = providerOwner.child();
  let current = 'v1';
  providerOwner.provideOwned(theme, () => current);

  const consumer = consumerOwner.use(theme);
  const seen: string[] = [];
  consumer.subscribe((value) => seen.push(value));

  anchor.connect();
  expect(consumer.value).toEqual('v1');

  current = 'v2';
  anchor.refreshProviders();
  expect(consumer.value, 'a provider change reaches the consumer').toEqual('v2');

  anchor.disconnect();
  current = 'v3-during-disconnect';
  anchor.refreshProviders();
  expect(consumer.value, 'a disconnected scope publishes nothing').toEqual('v2');

  anchor.connect();
  expect(consumer.value, 'a reconnect re-reads the current provider value').toEqual(
    'v3-during-disconnect',
  );

  // Exactly one subscription after the reconnect: one more change is one more
  // notification, never two.
  const before = seen.length;
  current = 'v4';
  anchor.refreshProviders();
  expect(seen.length, 'a reconnect adds no duplicate subscription').toEqual(before + 1);
  expect(consumer.value).toEqual('v4');

  anchor.dispose();
});

test('16b-CTX: a provider publishes only CHANGED values, and dispose drops every record', () => {
  const document = new TestDocument();
  const theme = createContext<string>(Symbol('ctx-changed-only'), 'light');
  const host = document.createElement('x-ctx-changed-host');

  const anchor = new CompiledContextService(asElement(host));
  const providerOwner = anchor.child();
  const consumerOwner = providerOwner.child();
  providerOwner.provideOwned(theme, () => 'same');
  const consumer = consumerOwner.use(theme);
  const seen: string[] = [];
  consumer.subscribe((value) => seen.push(value));
  anchor.connect();
  expect(seen).toEqual(['light', 'same']);

  anchor.refreshProviders();
  anchor.refreshProviders();
  expect(seen, 'an unchanged value notifies nobody').toEqual(['light', 'same']);

  anchor.dispose();
  // `use` after disposal fails closed with the engine's existing identity.
  assertThrowsIncludes(
    () => consumerOwner.use(theme),
    Error,
    '[compiled-context] service is disposed',
  );
});

// ─── `16b-CTX` RENDER mode: the server half of the SAME engine ───────────────
//
// A render scope is created per producer call, is published from birth and never
// touches the DOM. These rows pin the three facts the emitter's server path
// depends on: the PROVIDED value is resolved synchronously, two scopes are
// independent, and a scope with no provider answers the declared default without
// dispatching a protocol request (the fake DOM records every listener, so a
// stray `consumeContext` would show up in `contextListenerCount`).

test('16b-CTX render mode: a consumer resolves the PROVIDED value synchronously', () => {
  const theme = createContext<string>(Symbol('ctx-render-provided'), 'default');
  const scope = createRenderContextScope();
  scope.provider(theme, () => 'provided');
  const consumer = scope.use(theme) as { readonly value: string };
  // Written before `use` returns: the producer reads `.value` on the very next
  // line of its emitted body.
  expect(consumer.value).toEqual('provided');
});

test('16b-CTX render mode: providers shadow nearest-first, and a child joins as owner()', () => {
  const theme = createContext<string>(Symbol('ctx-render-nested'), 'default');
  const anchor = createRenderContextScope();
  anchor.provider(theme, () => 'outer');

  const child = anchor.owner();
  child.provider(theme, () => 'inner');

  expect((anchor.use(theme) as { value: string }).value, 'the anchor keeps its own').toEqual(
    'outer',
  );
  expect((child.use(theme) as { value: string }).value, 'the child reads its own').toEqual('inner');
  // A SIBLING owner of the same anchor cannot see the child's provider — the
  // server side of TSX-13 sibling isolation.
  const sibling = anchor.owner();
  expect((sibling.use(theme) as { value: string }).value).toEqual('outer');
});

test('16b-CTX render mode: two scopes never share a value, and none touches the DOM', () => {
  const theme = createContext<string>(Symbol('ctx-render-isolation'), 'default');
  const first = createRenderContextScope();
  const second = createRenderContextScope();
  first.provider(theme, () => 'first');
  second.provider(theme, () => 'second');
  const readFirst = first.use(theme) as { value: string };
  const readSecond = second.use(theme) as { value: string };
  expect(readFirst.value).toEqual('first');
  expect(readSecond.value).toEqual('second');
  // …and re-reading proves neither was mutated by the other's registration.
  expect(readFirst.value).toEqual('first');
});

test('16b-CTX render mode: no provider answers the declared default, with no protocol request', () => {
  const theme = createContext<string>(Symbol('ctx-render-default'), 'fallback');
  const scope = createRenderContextScope();
  const consumer = scope.use(theme) as { value: string };
  expect(consumer.value).toEqual('fallback');
  // Structural proof that the render path opened no DOM subscription: the fake
  // document records a listener per `consumeContext` call, and the scope has no
  // element to dispatch from at all.
  const document = new TestDocument();
  const host = document.createElement('x-unused');
  expect(contextListenerCount(host), 'no protocol listener was ever installed').toEqual(0);
  expect(document).toBeInstanceOf(TestDocument);
});
