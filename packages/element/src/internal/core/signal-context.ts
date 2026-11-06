/**
 * Community Context Protocol transport backed by consumer-local Signals.
 * Browser event propagation owns provider discovery; no OpenElement ancestry
 * walk or provider Signal crosses the interoperability boundary.
 */

import type { SignalLike, Unsubscribe, WritableSignal } from '@openelement/protocol/signal';
import { signal } from '../signal/index.ts';

export const CONTEXT_REQUEST_EVENT = 'context-request';

/** A typed context token: protocol identity (`key`) plus its default value. */
export interface Context<T> {
  /** Strict-equality protocol identity shared with vanilla and Lit consumers. */
  readonly key: symbol;
  readonly defaultValue: T;
}

type ContextCallback<T> = (value: T, unsubscribe?: Unsubscribe) => void;

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
const consumedSignalCleanups = new WeakMap<SignalLike<unknown>, Unsubscribe>();

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
  // A repeated provide REPLACES the host's record for this key. Dispose the
  // previous record before attaching the replacement, so its listener and
  // mapping cannot be orphaned while a second listener accumulates on the host.
  const previous = hostProviders.get(context.key) as ProviderRecord<T> | undefined;
  previous?.dispose();
  // dispose() drops the WeakMap entry when that was the host's last record;
  // re-attach the same map so the replacement below is not shadowed by a fresh
  // one (which would make the next provide miss this record and append again).
  providers.set(host, hostProviders);

  // Reuse the previous Signal: a consumer that subscribed before the repeated
  // provide must still observe the new value, exactly as the deduplicated shape
  // did when it kept a single record per key.
  const value = previous?.value ?? signal(initial);
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
      // A later provide retired this record: its handle is a stale no-op and
      // must leave the live listener and mapping untouched. This identity
      // check also makes a repeated release idempotent.
      if (hostProviders!.get(context.key) !== (record as ProviderRecord<unknown>)) return;
      host.removeEventListener(CONTEXT_REQUEST_EVENT, listener);
      hostProviders!.delete(context.key);
      if (hostProviders!.size === 0) providers.delete(host);
    },
  };
  hostProviders.set(context.key, record as ProviderRecord<unknown>);
  return record;
}

/**
 * Provide a plain protocol value; the provider Signal remains OE-private.
 *
 * The returned handle owns exactly one provider record. A repeated call for the
 * same host and {@linkcode Context.key} disposes the previous record (its
 * request listener and mapping) before publishing the replacement, so repeated
 * provides and reconnect cycles never accumulate listeners; the replaced handle
 * becomes a no-op. Releasing removes only the current record and is idempotent.
 */
export function provideContext<T>(host: HTMLElement, context: Context<T>, value: T): Unsubscribe {
  const provider = providerRecord(host, context, value);
  provider.value.value = value;
  return provider.dispose;
}

/**
 * Dispatch one Community Context Protocol request and return its cleanup.
 *
 * The cleanup is retryable: the captured provider unsubscribe is cleared only
 * AFTER it returns, so a provider whose teardown throws transiently can be
 * released again later. Clearing it first (the old shape) makes the bridge
 * unreleasable even when the caller keeps the cleanup and retries.
 */
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
    if (!unsubscribe) return;
    unsubscribe();
    providerUnsubscribe = undefined;
  };
}

/**
 * Consumer-local reactive projection of a protocol context value.
 *
 * When a `host` is given, the returned signal is bridged to the nearest
 * provider through one Community Context Protocol subscription. That bridge
 * is owned by the CALLER: a long-lived consumer must release it when it tears
 * down (typically `disconnectedCallback`) with
 * {@linkcode releaseConsumedContext}, exactly once. Releasing detaches the
 * provider bridge, so the provider no longer retains or updates the local
 * signal; the local signal itself stays usable with its last value. A call
 * after a successful release is a no-op, and a signal created without a
 * `host` has no bridge to release.
 */
export function consumeContext<T>(context: Context<T>, host?: HTMLElement): WritableSignal<T> {
  const local = signal(context.defaultValue);
  if (host) {
    const cleanup = requestContext(host, context, (value) => {
      local.value = value;
    });
    consumedSignalCleanups.set(local, cleanup);
  }
  return local;
}

/**
 * Release the provider bridge created by one hosted
 * {@linkcode consumeContext} call.
 *
 * The bridge is deregistered only AFTER its cleanup returns: a throwing
 * unsubscribe must not leave the signal in a state where the bridge is gone
 * from the bookkeeping but still attached to the provider (unretryable). If
 * cleanup throws, the entry stays registered and the error propagates
 * verbatim, so the caller can retry the release — for example from a
 * `disconnectedCallback` that runs again — once the provider's unsubscribe
 * succeeds. A second call after a successful release is a no-op, and a signal
 * without a bridge (including a signal created without a `host`) is always a
 * no-op.
 */
export function releaseConsumedContext(signalValue: SignalLike<unknown>): void {
  const cleanup = consumedSignalCleanups.get(signalValue);
  if (!cleanup) return;
  cleanup();
  consumedSignalCleanups.delete(signalValue);
}
