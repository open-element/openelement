import { CompiledContextService, contextChannelFor } from '../runtime/context.ts';

const connectedScopes = new WeakMap<HTMLElement, CompiledContextService>();
const waitingScopes = new WeakMap<HTMLElement, Set<CompiledContextService>>();

/** A lazy element-lifetime context anchor shared by its setup and recipe. */
export function createGeneratedElementContext(element: HTMLElement): {
  readonly scope: Pick<
    CompiledContextService,
    'connect' | 'disconnect' | 'dispose' | 'refreshProviders'
  >;
  readonly channel: ReturnType<typeof contextChannelFor>;
} {
  const waitingOn: HTMLElement[] = [];

  function clearWaiters(): void {
    for (const host of waitingOn) {
      const waiting = waitingScopes.get(host);
      waiting?.delete(scope);
      if (waiting?.size === 0) waitingScopes.delete(host);
    }
    waitingOn.length = 0;
  }

  function findParent(): CompiledContextService | null {
    clearWaiters();
    if (!element.isConnected) return null;
    let node: Node | null = element.parentNode;
    while (node !== null) {
      if (node instanceof HTMLElement) {
        const parent = connectedScopes.get(node);
        if (parent !== undefined) return parent;
        // An unupgraded custom host can insert a nearer scope later.
        if (node.localName.includes('-')) {
          let waiting = waitingScopes.get(node);
          if (waiting === undefined) waitingScopes.set(node, (waiting = new Set()));
          waiting.add(scope);
          waitingOn.push(node);
        }
      }
      node = node instanceof ShadowRoot ? node.host : node.parentNode;
    }
    return null;
  }

  const scope = new CompiledContextService(element, findParent, (connected) => {
    if (!connected) {
      clearWaiters();
      if (connectedScopes.get(element) === scope) connectedScopes.delete(element);
      return;
    }
    if (!element.isConnected) return;
    connectedScopes.set(element, scope);
    if (!waitingScopes.has(element)) return;
    // Give the generated host's synchronous mount a chance to complete or
    // roll back before subscribers below an already-connected DOM remap.
    queueMicrotask(() => {
      if (connectedScopes.get(element) !== scope) return;
      for (const waiting of [...(waitingScopes.get(element) ?? [])]) waiting.relinkParent();
    });
  });
  return { scope, channel: contextChannelFor(scope) };
}
