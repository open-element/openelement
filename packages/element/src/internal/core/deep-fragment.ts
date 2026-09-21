/** Framework-level fragment navigation across nested shadow roots (#1090). */

let installed = false;
let currentTarget: HTMLElement | null = null;

function decodeFragmentId(id: string): string | null {
  try {
    return decodeURIComponent(id.replace(/^#/, ''));
  } catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }
}

/**
 * Resolve `id` (a `#hash` or bare id) against `root` and, when the id is not
 * in that root's own tree, recurse into every nested shadow root. Returns the
 * first match or `null`; a malformed percent-encoded id is not an error.
 */
export function deepGetElementById(
  id: string,
  root: Document | ShadowRoot = document,
): HTMLElement | null {
  const decoded = decodeFragmentId(id);
  if (decoded === null) return null;
  const direct = root.getElementById(decoded);
  if (direct) return direct as HTMLElement;
  for (const element of root.querySelectorAll('*')) {
    if (!element.shadowRoot) continue;
    const nested = deepGetElementById(decoded, element.shadowRoot);
    if (nested) return nested;
  }
  return null;
}

function anchorFromEvent(event: MouseEvent): HTMLAnchorElement | null {
  for (const target of event.composedPath()) {
    if (typeof (target as { closest?: unknown })?.closest !== 'function') continue;
    const anchor = (target as Element).closest('a[href]');
    if (anchor) return anchor as HTMLAnchorElement;
  }
  return null;
}

function scrollToHash(hash: string, behavior: ScrollBehavior): HTMLElement | null {
  if (hash.length <= 1) return null;
  const target = deepGetElementById(hash);
  if (!target) return null;
  currentTarget?.removeAttribute('data-open-target');
  target.setAttribute('data-open-target', '');
  currentTarget = target;
  target.scrollIntoView({ behavior, block: 'start' });
  return target;
}

export interface DeepFragmentOptions {
  /** Set false before installation to opt out for an application. */
  enabled?: boolean;
}

/**
 * Install (once per document) framework-level fragment navigation: a
 * same-document anchor click whose target lives inside a nested shadow root
 * scrolls to it and pushes the hash instead of being dropped by the browser.
 * `{ enabled: false }` opts an application out.
 */
export function ensureDeepFragmentNavigation(options: DeepFragmentOptions = {}): void {
  if (installed || options.enabled === false || typeof document === 'undefined') return;
  installed = true;

  const scrollCurrent = () => scrollToHash(location.hash, 'auto');
  document.addEventListener('click', (event) => {
    const mouse = event as MouseEvent;
    if (
      event.defaultPrevented || mouse.button !== 0 || mouse.metaKey || mouse.ctrlKey ||
      mouse.shiftKey || mouse.altKey
    ) return;
    const anchor = anchorFromEvent(mouse);
    if (!anchor || anchor.target || anchor.hasAttribute('download')) return;
    const url = new URL(anchor.href, location.href);
    const fragmentId = decodeFragmentId(url.hash);
    if (
      !url.hash || url.origin !== location.origin || url.pathname !== location.pathname ||
      url.search !== location.search || fragmentId === null || document.getElementById(fragmentId)
    ) return;
    const reduced = typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;
    const target = scrollToHash(url.hash, reduced ? 'auto' : 'smooth');
    if (!target) return;
    event.preventDefault();
    history.pushState(null, '', url.hash);
  }, true);

  addEventListener('hashchange', scrollCurrent);
  addEventListener('popstate', scrollCurrent);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scrollCurrent, { once: true });
  } else {
    queueMicrotask(scrollCurrent);
  }
}

/** @internal */
export function isDeepFragmentNavigationInstalled(): boolean {
  return installed;
}
