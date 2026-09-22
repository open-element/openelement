/**
 * context.ts - Kernel-owned Community Context Protocol lifecycle service.
 *
 * One compiled element instance owns its context consumption: consumers
 * registered through this service subscribe while the element is connected,
 * unsubscribe exactly once on disconnect, and resubscribe without duplicates
 * on reconnect. Browser composed-event propagation owns provider discovery;
 * protocol callbacks carry plain values into a consumer-local Signal.
 */

import {
  consumeContext,
  type Context,
  provideContext,
  releaseConsumedContext,
} from '../../core/signal-context.ts';
import type { Unsubscribe } from '../../protocol/signal.ts';
// Single error dialect (#1386 item 3): context lifecycle failures carry codes.
import { ContextErrorCode, frameworkError } from '../../protocol/errors.ts';

/** Raise one context-service lifecycle failure with its catalogued code. */
function fail(code: string, message: string): never {
  throw frameworkError(code, message, { phase: 'csr' });
}

interface ContextConsumer {
  context: Context<unknown>;
  notify: (value: unknown) => void;
}

export class CompiledContextService {
  #element: HTMLElement;
  #consumers = new Set<ContextConsumer>();
  #subscriptions = new Map<ContextConsumer, Unsubscribe>();
  #providerCleanups = new Map<Context<unknown>, Unsubscribe>();
  #connected = false;
  #disposed = false;

  constructor(element: HTMLElement) {
    this.#element = element;
  }

  /** Provide a context value to the descendants of the owning element. */
  provide<T>(context: Context<T>, value: T): void {
    const cleanup = provideContext(this.#element, context, value);
    this.#providerCleanups.set(context as Context<unknown>, cleanup);
  }

  /**
   * Consume a context value from the nearest ancestor provider, falling back
   * to the context default. The subscription is owned by this element
   * instance: it starts on connect, ends exactly once on disconnect, and is
   * re-resolved against the DOM tree on every reconnect.
   */
  consume<T>(context: Context<T>, notify: (value: T) => void): void {
    if (this.#disposed) {
      fail(ContextErrorCode.SERVICE_DISPOSED, '[compiled-context] service is disposed');
    }
    const consumer: ContextConsumer = {
      context: context as Context<unknown>,
      notify: notify as (value: unknown) => void,
    };
    this.#consumers.add(consumer);
    if (this.#connected) this.#subscribe(consumer);
  }

  /** Subscribe every registered consumer; called when the element connects. */
  connect(): void {
    if (this.#disposed) {
      fail(ContextErrorCode.SERVICE_DISPOSED, '[compiled-context] service is disposed');
    }
    if (this.#connected) return;
    this.#connected = true;
    for (const consumer of this.#consumers) this.#subscribe(consumer);
  }

  /** Unsubscribe every consumer exactly once; safe to call repeatedly. */
  disconnect(): void {
    if (!this.#connected) return;
    this.#connected = false;
    const subscriptions = [...this.#subscriptions.values()];
    this.#subscriptions.clear();
    for (const unsubscribe of subscriptions) unsubscribe();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.disconnect();
    for (const cleanup of this.#providerCleanups.values()) cleanup();
    this.#providerCleanups.clear();
    this.#consumers.clear();
    this.#disposed = true;
  }

  #subscribe(consumer: ContextConsumer): void {
    const local = consumeContext(consumer.context, this.#element);
    const unsubscribeLocal = local.subscribe(consumer.notify);
    this.#subscriptions.set(consumer, () => {
      unsubscribeLocal();
      releaseConsumedContext(local);
    });
  }
}
