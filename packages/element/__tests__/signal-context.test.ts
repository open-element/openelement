/** Community Context Protocol transport conformance without ancestry walking. */

import { expect, test } from 'vitest';
import {
  ContextConsumer as LitContextConsumer,
  ContextProvider as LitContextProvider,
  createContext as createLitContext,
} from '@lit/context';
import {
  consumeContext,
  CONTEXT_REQUEST_EVENT,
  type ContextRequest,
  ContextRequestEvent,
  createContext,
  provideContext,
  releaseConsumedContext,
} from '../src/internal/core/signal-context.ts';
import { TestDocument, type TestElement } from './compiled-runtime/test-dom.ts';

function asElement(node: TestElement): HTMLElement {
  return node as unknown as HTMLElement;
}

/** Provider-side listeners currently attached for the context protocol. */
function contextListenerCount(node: TestElement): number {
  return node.listeners.get(CONTEXT_REQUEST_EVENT)?.size ?? 0;
}

interface LitController {
  hostConnected?(): void;
  hostDisconnected?(): void;
  hostUpdate?(): void;
  hostUpdated?(): void;
}

type LitHost = HTMLElement & {
  addController(controller: LitController): void;
  removeController(controller: LitController): void;
  requestUpdate(): void;
  readonly updateComplete: Promise<boolean>;
};

function asLitHost(node: TestElement): LitHost {
  const host = asElement(node) as LitHost;
  host.addController = () => {};
  host.removeController = () => {};
  host.requestUpdate = () => {};
  Object.defineProperty(host, 'updateComplete', { value: Promise.resolve(true) });
  return host;
}

test('signal-context: OE provider and consumer interoperate through a composed request', () => {
  const document = new TestDocument();
  const context = createContext(Symbol('count'), 0);
  const provider = document.createElement('x-provider');
  const shadowHost = document.createElement('x-shadow-host');
  const consumer = document.createElement('x-consumer');
  provider.appendChild(shadowHost);
  shadowHost.attachShadow({ mode: 'closed' }).appendChild(consumer);

  provideContext(asElement(provider), context, 42);
  const local = consumeContext(context, asElement(consumer));
  expect(local.value).toEqual(42);
});

test('signal-context: vanilla provider supplies plain values to an OE consumer', () => {
  const document = new TestDocument();
  const context = createContext(Symbol('vanilla-provider'), 'fallback');
  const provider = document.createElement('x-provider');
  const consumer = document.createElement('x-consumer');
  provider.appendChild(consumer);
  provider.addEventListener(CONTEXT_REQUEST_EVENT, (event: unknown) => {
    const request = event as ContextRequest<string>;
    if (request.context !== context.key) return;
    (event as Event).stopImmediatePropagation();
    request.callback('vanilla');
  });

  expect(consumeContext(context, asElement(consumer)).value).toEqual('vanilla');
});

test('signal-context: OE provider supplies plain values to a vanilla consumer', () => {
  const document = new TestDocument();
  const context = createContext(Symbol('vanilla-consumer'), 'fallback');
  const provider = document.createElement('x-provider');
  const consumer = document.createElement('x-consumer');
  provider.appendChild(consumer);
  provideContext(asElement(provider), context, 'open-element');
  let value = 'missing';
  consumer.dispatchEvent(
    new ContextRequestEvent<string>(context.key, asElement(consumer), (next) => (value = next)),
  );
  expect(value).toEqual('open-element');
});

test('signal-context: protocol identity uses strict equality and defaults are consumer-local', () => {
  const document = new TestDocument();
  const providerContext = createContext(Symbol('theme'), 'provider-default');
  const otherContext = createContext(Symbol('theme'), 'consumer-default');
  const provider = document.createElement('x-provider');
  const consumer = document.createElement('x-consumer');
  provider.appendChild(consumer);
  provideContext(asElement(provider), providerContext, 'dark');

  const first = consumeContext(otherContext, asElement(consumer));
  const second = consumeContext(otherContext, asElement(consumer));
  first.value = 'local-only';
  expect(first.value).toEqual('local-only');
  expect(second.value).toEqual('consumer-default');
});

test('signal-context: OE provider interoperates with a real @lit/context consumer', () => {
  const document = new TestDocument();
  const key = Symbol('oe-to-lit');
  const context = createContext(key, 'fallback');
  const litContext = createLitContext<string>(key);
  const provider = document.createElement('x-provider');
  const consumerElement = document.createElement('x-consumer');
  provider.appendChild(consumerElement);
  const seen: string[] = [];
  const consumer = new LitContextConsumer(asLitHost(consumerElement), {
    context: litContext,
    subscribe: true,
    callback: (value) => seen.push(value),
  });

  provideContext(asElement(provider), context, 'open-element');
  consumer.hostConnected();
  expect(seen).toEqual(['open-element']);
  provideContext(asElement(provider), context, 'updated');
  expect(seen).toEqual(['open-element', 'updated']);
  consumer.hostDisconnected();
  provideContext(asElement(provider), context, 'detached');
  expect(seen).toEqual(['open-element', 'updated']);
});

test('signal-context: release detaches a hosted consumer bridge and is idempotent', () => {
  const document = new TestDocument();
  const context = createContext(Symbol('release'), 'initial');
  const provider = document.createElement('x-provider');
  const consumer = document.createElement('x-consumer');
  provider.appendChild(consumer);
  provideContext(asElement(provider), context, 'first');

  const local = consumeContext(context, asElement(consumer));
  expect(local.value).toEqual('first');
  provideContext(asElement(provider), context, 'second');
  expect(local.value).toEqual('second');

  releaseConsumedContext(local);
  releaseConsumedContext(local);
  provideContext(asElement(provider), context, 'after-release');
  expect(local.value, 'a released bridge receives no provider updates').toEqual('second');

  // The documented reconnect shape: consume a fresh bridge after releasing
  // the previous one, so repeated connect/disconnect cycles add no bridge.
  const reconnected = consumeContext(context, asElement(consumer));
  expect(reconnected.value, 'a new bridge reads the current provider value').toEqual(
    'after-release',
  );
  releaseConsumedContext(reconnected);
  provideContext(asElement(provider), context, 'after-second-release');
  expect(reconnected.value).toEqual('after-release');

  // A signal created without a host has no bridge; releasing it is a no-op.
  const standalone = consumeContext(context);
  standalone.value = 'local';
  releaseConsumedContext(standalone);
  expect(standalone.value).toEqual('local');
});

test('signal-context: repeated provide keeps one listener and retires old handles idempotently', () => {
  const document = new TestDocument();
  const context = createContext(Symbol('repeated-provide'), 'default');
  const provider = document.createElement('x-provider');
  const consumer = document.createElement('x-consumer');
  provider.appendChild(consumer);

  const firstRelease = provideContext(asElement(provider), context, 'first');
  expect(contextListenerCount(provider)).toEqual(1);
  const secondRelease = provideContext(asElement(provider), context, 'second');
  expect(contextListenerCount(provider), 'a repeated provide replaces the listener').toEqual(1);
  expect(secondRelease, 'each provide owns its own handle').not.toBe(firstRelease);

  const local = consumeContext(context, asElement(consumer));
  expect(local.value, 'the replacement keeps the current value').toEqual('second');
  const extraBridge = consumeContext(context, asElement(consumer));
  expect(extraBridge.value).toEqual('second');

  // A retired handle stays inert: it must not remove the live listener or the
  // replacement mapping, and repeating it is also safe.
  firstRelease();
  firstRelease();
  expect(contextListenerCount(provider)).toEqual(1);
  releaseConsumedContext(extraBridge);

  const thirdRelease = provideContext(asElement(provider), context, 'third');
  expect(contextListenerCount(provider), 'the third provide still replaces, never appends').toEqual(
    1,
  );
  expect(local.value, 'an earlier subscriber observes later provides').toEqual('third');
  secondRelease();
  secondRelease();
  expect(contextListenerCount(provider), 'the retired second handle is a no-op').toEqual(1);

  thirdRelease();
  thirdRelease();
  expect(contextListenerCount(provider), 'the current handle releases exactly once').toEqual(0);
});

test('signal-context: release stops delivery and a later provide re-arms the host', () => {
  const document = new TestDocument();
  const context = createContext(Symbol('reconnect-provide'), 'default');
  const provider = document.createElement('x-provider');
  const consumer = document.createElement('x-consumer');
  provider.appendChild(consumer);

  const firstRelease = provideContext(asElement(provider), context, 'first');
  const local = consumeContext(context, asElement(consumer));
  expect(local.value).toEqual('first');

  // The documented reconnect shape: release the consumer bridge, then the
  // provider provides again; the fresh bridge reads the new value.
  releaseConsumedContext(local);
  const secondRelease = provideContext(asElement(provider), context, 'second');
  expect(contextListenerCount(provider)).toEqual(1);
  const reconnected = consumeContext(context, asElement(consumer));
  expect(reconnected.value, 'a reconnect after re-provide reads the new value').toEqual('second');
  releaseConsumedContext(reconnected);

  firstRelease();
  expect(
    contextListenerCount(provider),
    'the first handle was already retired by the second provide',
  ).toEqual(1);

  secondRelease();
  secondRelease();
  expect(contextListenerCount(provider), 'release removes the request listener').toEqual(0);

  const afterRelease = consumeContext(context, asElement(consumer));
  expect(afterRelease.value, 'a released provider no longer delivers').toEqual('default');
});

test('signal-context: a throwing release stays registered and is retryable exactly once', () => {
  const document = new TestDocument();
  const context = createContext(Symbol('retryable-release'), 'initial');
  const provider = document.createElement('x-provider');
  const consumer = document.createElement('x-consumer');
  provider.appendChild(consumer);
  let attempts = 0;
  const cleanup = () => {
    attempts += 1;
    if (attempts === 1) throw new Error('provider unsubscribe failed');
  };
  // A vanilla provider can hand the consumer any unsubscribe; this one throws
  // on its first call, the shape a provider teardown can have transiently.
  provider.addEventListener(CONTEXT_REQUEST_EVENT, (event: unknown) => {
    const request = event as ContextRequest<string>;
    if (request.context !== context.key) return;
    (event as Event).stopImmediatePropagation();
    request.callback('bridged', cleanup);
  });
  const local = consumeContext(context, asElement(consumer));
  expect(local.value).toEqual('bridged');

  // The failed cleanup propagates verbatim AND leaves the bridge registered:
  // the caller can retry from a later teardown instead of leaking a bridge
  // whose bookkeeping was already dropped.
  expect(() => releaseConsumedContext(local)).toThrow('provider unsubscribe failed');
  expect(attempts).toEqual(1);

  releaseConsumedContext(local);
  expect(attempts).toEqual(2);

  // After the successful release the entry is gone: a repeated call is a
  // no-op and never runs the cleanup a third time.
  releaseConsumedContext(local);
  expect(attempts).toEqual(2);
});

test('signal-context: releaseConsumedContext is exported from the public surface', async () => {
  const surface = await import('../src/public-surface.ts');
  expect(typeof surface.releaseConsumedContext).toEqual('function');
});

test('signal-context: real @lit/context provider interoperates with an OE consumer', () => {
  const document = new TestDocument();
  const key = Symbol('lit-to-oe');
  const context = createContext(key, 'fallback');
  const litContext = createLitContext<string>(key);
  const providerElement = document.createElement('x-provider');
  const consumerElement = document.createElement('x-consumer');
  providerElement.appendChild(consumerElement);
  const provider = new LitContextProvider(asLitHost(providerElement), {
    context: litContext,
    initialValue: 'lit',
  });
  provider.hostConnected();

  const local = consumeContext(context, asElement(consumerElement));
  expect(local.value).toEqual('lit');
  provider.setValue('updated');
  expect(local.value).toEqual('updated');
  releaseConsumedContext(local);
  provider.setValue('detached');
  expect(local.value).toEqual('updated');
});
