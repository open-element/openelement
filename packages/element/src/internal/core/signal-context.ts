/**
 * Community Context Protocol transport backed by consumer-local Signals.
 * Browser event propagation owns provider discovery; no OpenElement ancestry
 * walk or provider Signal crosses the interoperability boundary.
 */

import type { Unsubscribe, WritableSignal } from '../protocol/signal.ts';
import { signal } from '../signal/index.ts';

export const CONTEXT_REQUEST_EVENT = 'context-request';

/** A typed context token: protocol identity (`key`) plus its default value. */
export interface Context<T> {
  /** Strict-equality protocol identity shared with vanilla and Lit consumers. */
  readonly key: symbol;
  readonly defaultValue: T;
}

export type ContextCallback<T> = (value: T, unsubscribe?: Unsubscribe) => void;

export interface ContextRequest<T = unknown> extends Event {
  readonly context: unknown;
  readonly contextTarget: Element;
  readonly callback: ContextCallback<T>;
  readonly subscribe: boolean;
}

export class ContextRequestEvent<T> extends Event implements ContextRequest<T> {
  readonly context: unknown;
  readonly contextTarget: Element;
  readonly callback: ContextCallback<T>;
  readonly subscribe: boolean;

  constructor(
    context: unknown,
    contextTarget: Element,
    callback: ContextCallback<T>,
    subscribe = false,
  ) {
    super(CONTEXT_REQUEST_EVENT, { bubbles: true, composed: true });
    this.context = context;
    this.contextTarget = contextTarget;
    this.callback = callback;
    this.subscribe = subscribe;
  }
}

interface ProviderRecord<T> {
  value: WritableSignal<T>;
  listener: EventListener;
  dispose: Unsubscribe;
}

const providers = new WeakMap<HTMLElement, Map<symbol, ProviderRecord<unknown>>>();
const consumedSignalCleanups = new WeakMap<WritableSignal<unknown>, Unsubscribe>();

/** Create a typed context token shared between provider and consumer elements. */
export function createContext<T>(key: symbol, defaultValue: T): Context<T> {
  return Object.freeze({ key, defaultValue });
}

function providerRecord<T>(host: HTMLElement, context: Context<T>, initial: T): ProviderRecord<T> {
  let hostProviders = providers.get(host);
  if (!hostProviders) {
    hostProviders = new Map();
    providers.set(host, hostProviders);
  }
  const existing = hostProviders.get(context.key) as ProviderRecord<T> | undefined;
  if (existing) return existing;

  const value = signal(initial);
  const listener: EventListener = (event) => {
    const request = event as ContextRequest<T>;
    if (
      request.context !== context.key ||
      typeof request.callback !== 'function' ||
      typeof request.subscribe !== 'boolean'
    )
      return;
    event.stopImmediatePropagation();
    const current = value.value;
    if (!request.subscribe) {
      request.callback(current);
      return;
    }
    let subscribing = true;
    const unsubscribe = value.subscribe((next) => {
      if (subscribing && Object.is(next, current)) return;
      request.callback(next);
    });
    subscribing = false;
    request.callback(current, unsubscribe);
  };
  host.addEventListener(CONTEXT_REQUEST_EVENT, listener);
  const record: ProviderRecord<T> = {
    value,
    listener,
    dispose: () => {
      host.removeEventListener(CONTEXT_REQUEST_EVENT, listener);
      hostProviders!.delete(context.key);
      if (hostProviders!.size === 0) providers.delete(host);
    },
  };
  hostProviders.set(context.key, record as ProviderRecord<unknown>);
  return record;
}

/** Provide a plain protocol value; the provider Signal remains OE-private. */
export function provideContext<T>(host: HTMLElement, context: Context<T>, value: T): Unsubscribe {
  const provider = providerRecord(host, context, value);
  provider.value.value = value;
  return provider.dispose;
}

/** Dispatch one Community Context Protocol request and return its cleanup. */
export function requestContext<T>(
  host: HTMLElement,
  context: Context<T>,
  callback: ContextCallback<T>,
  subscribe = true,
): Unsubscribe {
  let providerUnsubscribe: Unsubscribe | undefined;
  const event = new ContextRequestEvent<T>(
    context.key,
    host,
    (value, unsubscribe) => {
      if (unsubscribe) providerUnsubscribe = unsubscribe;
      callback(value);
    },
    subscribe,
  );
  host.dispatchEvent(event);
  return () => {
    const unsubscribe = providerUnsubscribe;
    providerUnsubscribe = undefined;
    unsubscribe?.();
  };
}

/** Consumer-local reactive projection of a protocol context value. */
export function consumeContext<T>(context: Context<T>, host?: HTMLElement): WritableSignal<T> {
  const local = signal(context.defaultValue);
  if (host) {
    const cleanup = requestContext(host, context, (value) => {
      local.value = value;
    });
    consumedSignalCleanups.set(local as WritableSignal<unknown>, cleanup);
  }
  return local;
}

/** Internal lifecycle hook for releasing a protocol subscription. */
export function releaseConsumedContext(signalValue: WritableSignal<unknown>): void {
  const cleanup = consumedSignalCleanups.get(signalValue);
  if (!cleanup) return;
  consumedSignalCleanups.delete(signalValue);
  cleanup();
}
