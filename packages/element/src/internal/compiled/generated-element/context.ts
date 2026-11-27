import { CompiledContextService, contextChannelFor } from '../runtime/context.ts';

const elementScopes = new WeakMap<HTMLElement, CompiledContextService>();

/**
 * Walk ancestors with an existing context scope, crossing the shadow boundary
 * through its host. Elements that have not used context are transparent.
 */
function nearestGeneratedContextScope(element: HTMLElement): CompiledContextService | null {
  let node: Node | null = element.parentNode;
  while (node !== null) {
    if (node instanceof HTMLElement) {
      const candidate = elementScopes.get(node);
      if (candidate !== undefined) return candidate;
    }
    node = node instanceof ShadowRoot ? node.host : node.parentNode;
  }
  return null;
}

/** A lazy element-lifetime context anchor shared by its setup and recipe. */
export function createGeneratedElementContext(element: HTMLElement): {
  readonly scope: Pick<
    CompiledContextService,
    'connect' | 'disconnect' | 'dispose' | 'refreshProviders'
  >;
  readonly channel: ReturnType<typeof contextChannelFor>;
} {
  const scope = new CompiledContextService(element, () => nearestGeneratedContextScope(element));
  elementScopes.set(element, scope);
  return { scope, channel: contextChannelFor(scope) };
}
