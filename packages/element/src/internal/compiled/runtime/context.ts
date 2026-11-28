/**
 * context.ts - Kernel-owned Community Context Protocol lifecycle service.
 *
 * One compiled element instance owns its context consumption: consumers
 * registered through this service subscribe while the element is connected,
 * unsubscribe exactly once on disconnect, and resubscribe without duplicates
 * on reconnect. Browser composed-event propagation owns provider discovery;
 * protocol callbacks carry plain values into a consumer-local Signal.
 *
 * `16b-CTX` — the generated function lane's scope tree
 * -----------------------------------------------------
 *
 * The generated lane needs one thing the Community Context Protocol alone cannot
 * express: an owner tree with HOSTLESS owners. A generated component reference
 * creates no element, so two sibling hostless children share one element host;
 * anchoring their providers on that host would expose one sibling's value to the
 * other across the boundary the owner tree says it must not cross.
 *
 * The owner-scope path is therefore an ADDITIVE mode of THIS service, not a
 * second engine: it shares {@linkcode CompiledContextService.connect} /
 * {@linkcode CompiledContextService.disconnect} /
 * {@linkcode CompiledContextService.dispose}, the one consumer set, the one
 * subscription map and the one exactly-once release rule. Only the resolution
 * STEP differs, and a provider record is the same idea the protocol path already
 * keeps (a private `WritableSignal` per key that a repeated provide writes
 * instead of replacing).
 *
 * - {@linkcode CompiledContextService.child} — one child scope per generated
 *   component owner (hostless children included).
 * - {@linkcode CompiledContextService.provideOwned} — a provider intent whose
 *   value is a THUNK. Registration is per-owner and publication is
 *   connection-scoped: a disconnect leaves no live provider, and a reconnect
 *   republishes from the retained intent without double-registering.
 * - {@linkcode CompiledContextService.use} — a consumer whose value lives in ONE
 *   persistent consumer-local Signal. A generated tracked slot reads `.value`,
 *   so a provider change refreshes it through the lane's existing subscription
 *   channel and a reconnect re-reads the nearest provider into the SAME object.
 * - {@linkcode CompiledContextService.refreshProviders} — this runtime's ONE
 *   "provider changed" event: re-read the published thunks and republish the
 *   changed values. The generated lane deliberately has no author `computed`, so
 *   a declared-property commit is what "change" means, and the shell raises it.
 * - The constructor's optional `findParent` resolver is how a generated element's
 *   anchor scope finds the nearest generated ANCESTOR element's anchor. It is
 *   consulted on every connect and when a previously unavailable ancestor
 *   publishes. A move re-resolves the tree, and a late anchor changes the bridge
 *   without dropping the already-connected consumer's signal.
 * - {@linkcode CompiledContextService.forRender} — the RENDER (server/SSG) mode
 *   of the SAME service. A render scope is created per producer call, is
 *   connection-published from birth, and never consults the DOM: it resolves
 *   `use` from the owner-scope records its own render registered and falls back
 *   to the declared default. That is why a consumer-reading component is
 *   serializable: server bytes and client value are produced by ONE rule.
 */

import {
  consumeContext,
  type Context,
  provideContext,
  releaseConsumedContext,
} from '../../core/signal-context.ts';
import { signal } from '../../signal/framework.ts';
import type { Unsubscribe, WritableSignal } from '@openelement/protocol/signal';
// Single error dialect (#1386 item 3): context lifecycle failures carry codes.
import { ContextErrorCode, raiseFrameworkError } from '@openelement/protocol/errors';

/** Raise one context-service lifecycle failure with its catalogued code. */
function fail(code: string, message: string): never {
  raiseFrameworkError('csr', code, message);
}

interface ContextConsumer {
  context: Context<unknown>;
  notify: (value: unknown) => void;
}

/**
 * `16b-CTX` — the three-call adapter generated code talks to, in BOTH phases.
 *
 * - `use(token)` — one consumer-local signal, resolved from the nearest provider
 *   the scope can see (and seeded from the declared default when there is none).
 * - `provider(token, read)` — one owner-scope provider whose value is a THUNK.
 * - `owner()` — a CHILD owner scope of this one.
 *
 * Client (`contextChannelFor` over the element's anchor) and server
 * (`createRenderContextScope`) hand out the SAME shape, so the emitter writes one
 * spelling and the phase decides which scope backs it. That is the whole reason
 * a consumer-reading component can be serialized: the byte-producing code is
 * identical on both sides, so the rendered value and the claimed value cannot be
 * produced by two different rules.
 */
export interface ContextScopeChannel {
  use(token: { readonly key: symbol; readonly defaultValue: unknown }): unknown;
  provider(
    token: { readonly key: symbol; readonly defaultValue: unknown },
    read: () => unknown,
  ): void;
  owner(): ContextScopeChannel;
}

/** One memoised adapter per service, so identity is stable. */
const contextChannels = new WeakMap<CompiledContextService, ContextScopeChannel>();

/**
 * The stable channel for one scope. Memoised, because a repeated read must not
 * build a second owner chain.
 */
export function contextChannelFor(scope: CompiledContextService): ContextScopeChannel {
  const existing = contextChannels.get(scope);
  if (existing !== undefined) return existing;
  const channel: ContextScopeChannel = {
    use: (token) => scope.use(token as { readonly key: symbol; readonly defaultValue: unknown }),
    provider: (token, read) => {
      scope.provideOwned(token as { readonly key: symbol; readonly defaultValue: unknown }, read);
    },
    owner: () => contextChannelFor(scope.child()),
  };
  contextChannels.set(scope, channel);
  return channel;
}

/**
 * Create the RENDER-mode owner scope one SSR producer call owns (`16b-CTX`).
 *
 * This is the server half of the same service, not a second engine:
 *
 * - the scope is created PER PRODUCER CALL, so two concurrent renders never
 *   share a provider value, a consumer signal or an owner chain. There is no
 *   module-level "current render" and no global registry — the channel is
 *   threaded through the producer's own argument list;
 * - a provider PUBLISHES the moment it is registered (`provideOwned` writes the
 *   thunk's value), so a consumer declared after it resolves exactly the value
 *   the client will resolve from the same provider on connect;
 * - a consumer resolves its value AT DECLARATION TIME from the nearest published
 *   owner-scope provider, then falls back to the context's declared default. It
 *   never subscribes: a render has no connection and no later write, and the
 *   returned signal is read synchronously by the producer;
 * - the scope never opens a protocol (`consumeContext`) subscription, so no DOM
 *   is consulted and no element is required.
 *
 * The declared default is the lawful fallback here for the same reason it is on
 * the client: a `Context` token cannot exist without a default (`createContext`
 * requires one), so "no provider and no default" is not a representable state.
 */
export function createRenderContextScope(): ContextScopeChannel {
  return contextChannelFor(CompiledContextService.forRender());
}

/**
 * One owner-scope provider intent (`16b-CTX`).
 *
 * `read` is a VALUE THUNK, not a snapshot: the shell republishes on connect and
 * after a declared-row commit, so a provider whose expression reads a live props
 * getter observes the new value with no second reactivity model.
 */
interface OwnedProvider {
  /** Protocol identity compared by strict equality, like the DOM path. */
  readonly key: symbol;
  readonly read: () => unknown;
  /**
   * The one signal this provider's consumers subscribe to. It is created once
   * per provider intent and REUSED by a repeated registration, so a consumer
   * that resolved earlier observes the new value instead of a second
   * subscription.
   */
  readonly value: WritableSignal<unknown>;
  /**
   * True once this connection has written a value from `read`. A disconnected
   * scope publishes nothing, so a consumer in a detached subtree cannot resolve
   * a value from it.
   */
  published: boolean;
}

export class CompiledContextService {
  /**
   * The DOM element protocol-mode consumers dispatch from. `null` in RENDER
   * mode, where no protocol request is ever dispatched: that is the structural
   * guarantee that a server render cannot touch an element.
   */
  #element: HTMLElement | null;
  #consumers = new Set<ContextConsumer>();
  #subscriptions = new Map<ContextConsumer, Unsubscribe>();
  #providerCleanups = new Map<Context<unknown>, Unsubscribe>();
  /** `16b-CTX` owner-scope providers of THIS scope, by protocol identity. */
  #ownedProviders = new Map<symbol, OwnedProvider>();
  /** One step up the generated owner tree; null for the tree root. */
  #parent: CompiledContextService | null = null;
  #children = new Set<CompiledContextService>();
  /** Resolves the generated anchor's owner-tree parent on connect or relink. */
  #findParent: (() => CompiledContextService | null) | null;
  #onConnection: ((connected: boolean) => void) | null;
  #connected = false;
  #disposed = false;
  /**
   * `16b-CTX` RENDER mode: this scope answers consumers from its owner-scope
   * records immediately, without a connection and without the DOM. Only
   * {@linkcode CompiledContextService.forRender} sets it, and such a scope is
   * never connected, disconnected or given a parent resolver — it is one
   * request's owner tree, created and dropped by one producer call.
   */
  #render = false;

  /**
   * @param element the DOM element a protocol-mode consumer dispatches from
   *   (the generated element host, or the nearest ancestor host for a hostless
   *   component owner); `null` for a render scope, which never dispatches.
   * @param findParent optional owner-tree parent resolver, consulted at connect or relink.
   * @param onConnection optional generated anchor registration after providers publish.
   */
  constructor(
    element: HTMLElement | null,
    findParent: (() => CompiledContextService | null) | null = null,
    onConnection: ((connected: boolean) => void) | null = null,
  ) {
    this.#element = element;
    this.#findParent = findParent;
    this.#onConnection = onConnection;
  }

  /**
   * Create one child owner scope (`16b-CTX`).
   *
   * The child is connected, disconnected and disposed with this scope's cascade,
   * so the shell drives exactly one anchor service per generated element and
   * every hostless component owner is one child of that chain. A consumer in a
   * child resolves `child → parent → …`, which is the "nearest owning component"
   * rule for an owner tree whose inner nodes are not elements.
   */
  child(): CompiledContextService {
    if (this.#disposed) {
      fail(ContextErrorCode.SERVICE_DISPOSED, '[compiled-context] service is disposed');
    }
    const child = new CompiledContextService(this.#element);
    if (this.#render) {
      // A render child is a render scope too: no element, no protocol path, and
      // published from birth. Inheriting the mode is what makes a server-side
      // depth-1 hostless owner behave exactly like its client counterpart
      // (`owner()`), with no second rule.
      child.#render = true;
      child.#connected = true;
    }
    child.#parent = this;
    this.#children.add(child);
    if (this.#connected && !child.#connected) child.connect();
    return child;
  }

  /**
   * Create the RENDER-mode owner scope (`16b-CTX`): no element, no connection,
   * no parent resolver.
   *
   * The scope is PUBLISHED from birth, so `provideOwned` writes a provider's
   * value as soon as it registers and `use` resolves immediately. It is one
   * value per call, which is what makes two concurrent server renders
   * independent: each producer invocation builds its own scope and there is no
   * module-level "current render" to leak one request into another.
   *
   * The element argument is `null` and the protocol fallback is therefore
   * unreachable: a render scope never calls `consumeContext`, so no DOM access
   * can happen by construction (see {@linkcode CompiledContextService.#subscribe}).
   */
  static forRender(): CompiledContextService {
    const scope = new CompiledContextService(null, null);
    scope.#render = true;
    scope.#connected = true;
    return scope;
  }

  /** The owner-tree parent, or null for the root of a generated owner tree. */
  get parent(): CompiledContextService | null {
    return this.#parent;
  }

  /** Provide a context value to the descendants of the owning element. */
  provide<T>(context: Context<T>, value: T): void {
    const element = this.#element;
    if (element === null) {
      // Protocol providing is a DOM operation (it dispatches from an element);
      // a render scope has no element and the generated lane never calls it.
      fail(
        ContextErrorCode.SERVICE_DISPOSED,
        '[compiled-context] a protocol provider needs an element to provide from',
      );
    }
    const cleanup = provideContext(element, context, value);
    this.#providerCleanups.set(context as Context<unknown>, cleanup);
  }

  /**
   * Register one owner-scope provider whose value is read from `read`
   * (`16b-CTX`).
   *
   * The intent is registered immediately but PUBLISHED by the connection
   * lifecycle: {@linkcode connect} publishes it, {@linkcode disconnect} drops
   * the published value (the record and its signal survive, so a reconnect
   * republishes), and a declared-property commit re-reads it through
   * {@linkcode refreshProviders}. A descendant consumer resolves to the NEAREST
   * published record, so an inner provider shadows an outer one for its subtree
   * and a sibling subtree cannot see either.
   *
   * A repeated registration for the same token REPLACES this scope's record and
   * keeps its signal, which is the same replacement rule
   * `provideContext` applies to a repeated DOM provide.
   *
   * In RENDER mode the scope is published from birth, so this writes the thunk's
   * value immediately — that is what lets a consumer declared after the provider
   * read the PROVIDED value at render time instead of the declared default.
   */
  provideOwned<T>(context: Context<T>, read: () => T): void {
    if (this.#disposed) {
      fail(ContextErrorCode.SERVICE_DISPOSED, '[compiled-context] service is disposed');
    }
    const existing = this.#ownedProviders.get(context.key);
    const provider: OwnedProvider = {
      key: context.key,
      read: read as () => unknown,
      value: (existing?.value ?? signal<unknown>(context.defaultValue)) as WritableSignal<unknown>,
      published: false,
    };
    this.#ownedProviders.set(context.key, provider);
    if (this.#connected) this.#publishOwned(provider);
  }

  /**
   * Re-read every PUBLISHED owner-scope provider thunk and republish the CHANGED
   * ones (`16b-CTX`), cascading down this scope's descendants.
   *
   * This is the generated lane's ONE "provider changed" event. A generated
   * component has no author `computed` and no per-value signal graph, so the
   * change channel it has is a declared-property commit; the shell calls this
   * from there. An unchanged value is skipped, so a consumer is not notified for
   * a write that changed nothing. This method is a no-op while disconnected: a
   * disconnected scope publishes nothing and its records are republished from
   * their thunks on connect.
   */
  refreshProviders(): void {
    if (!this.#connected || this.#disposed) return;
    for (const provider of this.#ownedProviders.values()) {
      if (!provider.published) continue;
      const next = provider.read();
      if (Object.is(provider.value.value, next)) continue;
      provider.value.value = next;
    }
    for (const child of [...this.#children]) child.refreshProviders();
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

  /**
   * Consume an owner-scope context value into ONE persistent consumer-local
   * Signal (`16b-CTX`).
   *
   * The returned signal is seeded with the context default and written by the
   * per-connection bridge, exactly like the callback form: it starts on connect,
   * ends exactly once on disconnect and re-resolves on every reconnect. The
   * SIGNAL is the caller's to keep — a generated `useContext` declaration
   * aliases it out of the retained setup record, so a reconnect re-reads the
   * nearest provider into the SAME object and a tracked slot keeps one
   * subscription target for the whole element lifetime.
   *
   * In RENDER mode the signal is written SYNCHRONOUSLY, before this method
   * returns: the value the server renders is the value the nearest published
   * provider holds at that point in the producer's walk, so a tracked slot reads
   * the PROVIDED value rather than the default.
   *
   * Registration after disposal fails closed with the service-disposed code;
   * registration while disconnected is legal and the bridge starts on connect.
   */
  use<T>(context: Context<T>): WritableSignal<T> {
    if (this.#disposed) {
      fail(ContextErrorCode.SERVICE_DISPOSED, '[compiled-context] service is disposed');
    }
    const local = signal<T>(context.defaultValue);
    const consumer: ContextConsumer = {
      context: context as Context<unknown>,
      notify: (value) => {
        local.value = value as T;
      },
    };
    this.#consumers.add(consumer);
    if (this.#connected) this.#subscribe(consumer);
    return local;
  }

  /** Subscribe every registered consumer; called when the element connects. */
  connect(): void {
    if (this.#disposed) {
      fail(ContextErrorCode.SERVICE_DISPOSED, '[compiled-context] service is disposed');
    }
    if (this.#connected) return;
    this.#connected = true;
    // Owner-tree parent first: a reconnect after a DOM move must resolve against
    // the CURRENT tree, exactly like the consumer bridge re-resolves its
    // provider. An anchor scope supplies the resolver; a hostless child scope
    // already knows its creating owner.
    this.#linkParent();
    // Providers, then consumers, then descendants. Order matters: a consumer in
    // this scope resolves against a provider published by an ANCESTOR (already
    // connected, because the cascade is top-down), and a descendant must resolve
    // against both.
    for (const provider of this.#ownedProviders.values()) this.#publishOwned(provider);
    if (!this.#connected) return;
    this.#onConnection?.(true);
    for (const consumer of this.#consumers) this.#subscribe(consumer);
    for (const child of [...this.#children]) child.connect();
  }

  /** Unsubscribe every consumer exactly once; safe to call repeatedly. */
  disconnect(): void {
    if (!this.#connected) return;
    this.#connected = false;
    this.#onConnection?.(false);
    for (const child of [...this.#children]) child.disconnect();
    const subscriptions = [...this.#subscriptions.values()];
    this.#subscriptions.clear();
    for (const unsubscribe of subscriptions) unsubscribe();
    // `16b-CTX`: a disconnected provider publishes nothing, so a stale value
    // cannot answer a consumer of a scope that is off the tree. The intent and
    // its signal survive (a reconnect republishes), and this flag is what tells
    // the two states apart.
    for (const provider of this.#ownedProviders.values()) provider.published = false;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.disconnect();
    for (const child of [...this.#children]) child.dispose();
    this.#children.clear();
    for (const cleanup of this.#providerCleanups.values()) cleanup();
    this.#providerCleanups.clear();
    this.#consumers.clear();
    this.#ownedProviders.clear();
    const previous = this.#parent;
    if (previous !== null) previous.#children.delete(this);
    this.#parent = null;
    this.#disposed = true;
  }

  /** A connected generated ancestor became available after this scope mounted. */
  relinkParent(): void {
    if (this.#connected && this.#linkParent()) this.#rebindConsumers();
  }

  #linkParent(): boolean {
    if (this.#findParent === null) return false;
    const parent = this.#findParent();
    if (parent === this.#parent) return false;
    if (this.#parent !== null) this.#parent.#children.delete(this);
    this.#parent = parent;
    if (parent !== null) parent.#children.add(this);
    return true;
  }

  #rebindConsumers(): void {
    for (const consumer of this.#consumers) {
      if (!this.#connected) return;
      const previous = this.#subscriptions.get(consumer);
      this.#subscriptions.delete(consumer);
      previous?.();
      if (this.#connected) this.#subscribe(consumer);
    }
    for (const child of [...this.#children]) {
      if (child.#connected && child.#parent === this) child.#rebindConsumers();
    }
  }

  /** Read one intent's value into its signal and mark it published. */
  #publishOwned(provider: OwnedProvider): void {
    provider.value.value = provider.read();
    provider.published = true;
  }

  /**
   * The nearest PUBLISHED owner-scope provider for `key`, searched from this
   * scope up the owner chain.
   */
  #resolveOwned(key: symbol): OwnedProvider | undefined {
    const provider = this.#ownedProviders.get(key);
    if (provider !== undefined && provider.published) return provider;
    return this.#parent === null ? undefined : this.#parent.#resolveOwned(key);
  }

  #subscribe(consumer: ContextConsumer): void {
    // Owner-scope mode: when this scope or an ancestor published an owner-scope
    // provider for the token, the bridge is one subscription to that record's
    // signal. Otherwise the Community Context Protocol path answers, so a
    // generated consumer still sees a class-lane provider through the DOM, and
    // the context default applies when neither answers.
    const owned = this.#resolveOwned(consumer.context.key);
    if (owned !== undefined) {
      const snapshot = owned.value.value;
      if (this.#render) {
        // `16b-CTX` RENDER mode: a render has no later write, so the value is
        // read ONCE and no subscription is opened. That keeps a producer call
        // allocation-only and guarantees two concurrent renders cannot be
        // coupled through a shared subscription.
        consumer.notify(snapshot);
        return;
      }
      this.#bridgeSignal(consumer, owned.value);
      return;
    }
    if (this.#render) {
      // `16b-CTX` RENDER mode: there is no DOM and no connection, so the
      // protocol path is unreachable by construction. The declared default is
      // the lawful answer — a `Context` token cannot exist without one
      // (`createContext` requires a default), so "no provider and no default" is
      // not a representable state and needs no diagnostic. The consumer keeps
      // its default-seeded signal and opens NO subscription.
      consumer.notify(consumer.context.defaultValue);
      return;
    }
    // Protocol mode requires the element the request is dispatched from; a
    // render scope never reaches here (`#render` returned above), so this is
    // the client-only branch and the element is present.
    const element = this.#element;
    if (element === null) {
      fail(
        ContextErrorCode.SERVICE_DISPOSED,
        '[compiled-context] a protocol consumer needs an element to dispatch from',
      );
    }
    if (!this.#connected) return;
    const local = consumeContext(consumer.context, element);
    this.#bridgeSignal(consumer, local, () => releaseConsumedContext(local));
  }

  #bridgeSignal(
    consumer: ContextConsumer,
    source: WritableSignal<unknown>,
    releaseSource?: Unsubscribe,
  ): void {
    let subscribing = true;
    const unsubscribe = source.subscribe((value) => {
      if (!subscribing) consumer.notify(value);
    });
    subscribing = false;
    const release = releaseSource
      ? () => {
          unsubscribe();
          releaseSource();
        }
      : unsubscribe;
    if (!this.#connected || this.#subscriptions.has(consumer)) {
      release();
      return;
    }
    // Publishing a value can synchronously remove the host. Install the
    // cleanup first so that disconnect can release this exact bridge.
    this.#subscriptions.set(consumer, release);
    consumer.notify(source.value);
  }
}
