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
