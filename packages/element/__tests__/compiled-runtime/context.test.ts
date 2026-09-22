import { assertEquals, assertStrictEquals, assertThrows } from '@std/assert';
// The claim executor is installed by the package entry, not by the kernel
// (#1416): the kernel resolves it through the claim seam. This file reaches
// the kernel directly, so it installs it exactly as the default
// '@openelement/element' entry does — the kernel case below reconnects into
// retained content, which is a claim.
import '../../src/internal/compiled/runtime/claim-install.ts';
import { CompiledElementKernel } from '../../src/internal/compiled/runtime/kernel.ts';
import { CompiledContextService } from '../../src/internal/compiled/runtime/context.ts';
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

Deno.test('context consumption walks nested elements and crosses shadow boundaries', () => {
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
  assertEquals(seen, ['dark']);

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
    assertEquals(shadowSeen, [provided], `${mode} shadow boundary is crossed`);

    provided = `dim-${mode}`;
    provider.provide(theme, provided);
    assertEquals(shadowSeen.length, 2, 'provider updates reach the subscriber exactly once');
    assertEquals(shadowSeen[1], provided);
    consumer.dispose();
  }
});

Deno.test('context consumption without a provider yields the default value', () => {
  const document = new TestDocument();
  const theme = createContext<string>(Symbol('unprovided'), 'light');
  const outer = document.createElement('x-outer');
  const lone = document.createElement('x-lone');
  outer.appendChild(lone);

  const consumer = new CompiledContextService(asElement(lone));
  const seen: string[] = [];
  consumer.connect();
  consumer.consume(theme, (value) => seen.push(value));
  assertEquals(seen, ['light']);
  consumer.dispose();
});

Deno.test('nested providers select the nearest provider and notify exactly once', () => {
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
  assertEquals(contextListenerCount(outer), 1);
  assertEquals(contextListenerCount(inner), 1);

  const consumer = new CompiledContextService(asElement(leaf));
  const seen: string[] = [];
  consumer.consume(theme, (value) => seen.push(value));
  consumer.connect();
  assertEquals(seen, ['inner'], 'the nearest provider wins');

  outerProvider.provide(theme, 'outer-update');
  assertEquals(seen, ['inner'], 'an ancestor provider is stopped by the nearest one');
  innerProvider.provide(theme, 'inner-update');
  assertEquals(seen, ['inner', 'inner-update']);
  innerProvider.provide(theme, 'inner-update-2');
  assertEquals(seen, ['inner', 'inner-update', 'inner-update-2']);

  consumer.dispose();
  innerProvider.dispose();
  outerProvider.dispose();
});

Deno.test('context crosses nested open and closed shadow roots', () => {
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
  assertEquals(nestedSeen, ['dark'], 'open then closed roots remain composed');

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
  assertEquals(reverseSeen, ['dark'], 'closed then open roots remain composed');

  provider.provide(theme, 'dim');
  assertEquals(nestedSeen, ['dark', 'dim']);
  assertEquals(reverseSeen, ['dark', 'dim']);

  nestedConsumer.dispose();
  reverseConsumer.dispose();
  provider.dispose();
});

Deno.test('context subscriptions clean up exactly once and reconnect without duplicates', () => {
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
  assertEquals(seen, ['dark']);

  provider.provide(theme, 'dim');
  assertEquals(seen, ['dark', 'dim']);

  consumer.disconnect();
  consumer.disconnect();
  provider.provide(theme, 'solar');
  assertEquals(seen, ['dark', 'dim'], 'disconnect unsubscribes exactly once');

  consumer.connect();
  assertEquals(seen, ['dark', 'dim', 'solar'], 'reconnect re-reads the current value');
  provider.provide(theme, 'amber');
  assertEquals(seen, ['dark', 'dim', 'solar', 'amber'], 'reconnect adds no duplicate subscription');

  consumer.dispose();
  consumer.dispose();
  provider.provide(theme, 'void');
  assertEquals(seen, ['dark', 'dim', 'solar', 'amber'], 'dispose stays unsubscribed');
  assertThrows(() => consumer.consume(theme, () => {}), Error, 'service is disposed');
});

Deno.test('moving a consumer re-resolves providers without stale or growing subscriptions', () => {
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
  assertEquals(contextListenerCount(providerAElement), 1);
  assertEquals(contextListenerCount(providerBElement), 1);

  const consumer = new CompiledContextService(asElement(consumerElement));
  const seen: string[] = [];
  consumer.consume(theme, (value) => seen.push(value));
  consumer.connect();
  assertEquals(seen, ['a-0']);

  consumer.disconnect();
  providerBElement.appendChild(consumerElement);
  providerA.provide(theme, 'a-before-reconnect');
  assertEquals(seen, ['a-0'], 'disconnect removes A before the move');

  consumer.connect();
  assertEquals(seen, ['a-0', 'b-0'], 'reconnect resolves against B');
  providerA.provide(theme, 'a-stale-after-move');
  assertEquals(seen, ['a-0', 'b-0'], 'A cannot notify after the move');
  providerB.provide(theme, 'b-1');
  assertEquals(seen, ['a-0', 'b-0', 'b-1']);

  for (let cycle = 0; cycle < 4; cycle++) {
    const beforeReconnect = seen.length;
    consumer.disconnect();
    consumer.disconnect();
    consumer.connect();
    assertEquals(seen.length, beforeReconnect + 1, 'reconnect creates one subscription');

    const next = `b-${cycle + 2}`;
    providerB.provide(theme, next);
    assertEquals(seen.length, beforeReconnect + 2, 'one provider update yields one callback');
    assertEquals(seen[seen.length - 1], next);
  }

  assertEquals(contextListenerCount(providerAElement), 1, 'A has no listener growth');
  assertEquals(contextListenerCount(providerBElement), 1, 'B has no listener growth');
  consumer.dispose();
  consumer.dispose();
  providerA.provide(theme, 'a-after-dispose');
  providerB.provide(theme, 'b-after-dispose');
  assertEquals(seen.length, 3 + 4 * 2, 'dispose removes every active subscription');
  assertEquals(contextListenerCount(providerAElement), 1);
  assertEquals(contextListenerCount(providerBElement), 1);

  providerA.dispose();
  providerB.dispose();
  assertEquals(contextListenerCount(providerAElement), 0);
  assertEquals(contextListenerCount(providerBElement), 0);
});

Deno.test('the kernel owns context provision and consumption at the activation boundary', () => {
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
  assertStrictEquals(shadow === null, false);
  shadow!.appendChild(consumerElement);
  assertStrictEquals(consumerElement.getRootNode(), shadow!);

  const seen: string[] = [];
  consumer.context.consume(theme, (value) => seen.push(value));
  provider.context.provide(theme, 'dark');
  consumer.connect();
  assertEquals(seen, ['dark'], 'consumption starts at connect across the shadow boundary');

  provider.context.provide(theme, 'dim');
  assertEquals(seen, ['dark', 'dim'], 'provided-value changes notify the subscribed descendant');

  consumer.disconnect();
  provider.context.provide(theme, 'solar');
  assertEquals(seen, ['dark', 'dim'], 'kernel disconnect unsubscribes the consumer');

  consumer.connect();
  assertEquals(
    seen,
    ['dark', 'dim', 'solar'],
    'kernel reconnect resubscribes at the current value',
  );
  provider.context.provide(theme, 'amber');
  assertEquals(seen, ['dark', 'dim', 'solar', 'amber'], 'kernel reconnect adds no duplicate');

  consumer.dispose();
  provider.context.provide(theme, 'void');
  assertEquals(seen, ['dark', 'dim', 'solar', 'amber'], 'kernel dispose stays unsubscribed');
  provider.dispose();
});
