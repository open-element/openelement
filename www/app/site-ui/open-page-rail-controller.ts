/** Browser-only TOC scrollspy used by the open-page-rail island. */

type RailHost = HTMLElement;

interface RailState {
  observer: IntersectionObserver | null;
  links: HTMLAnchorElement[];
  intersecting: Set<string>;
}

const states = new WeakMap<RailHost, RailState>();

function railLinks(host: RailHost): HTMLAnchorElement[] {
  const root = host.shadowRoot ?? host;
  return [...root.querySelectorAll<HTMLAnchorElement>('nav.links a[href^="#"]')];
}

function markCurrent(state: RailState, hash: string): void {
  for (const link of state.links) {
    const current = link.getAttribute('href') === hash;
    const marked = link.getAttribute('aria-current') === 'location';
    if (current && !marked) link.setAttribute('aria-current', 'location');
    else if (!current && marked) link.removeAttribute('aria-current');
  }
}

/** Deep-link-aware seed: the last rail target at or above the band top wins. */
function seedCurrent(state: RailState, targets: Map<string, Element>, firstHash: string): void {
  // Same band the observer watches: top = 15% of viewport height.
  const bandTop = globalThis.innerHeight * 0.15;
  let current = firstHash;
  for (const [hash, target] of targets) {
    // Map insertion order is rail order is document order: stop at the
    // first target below the band. (If rail order ever decouples from
    // document order, take the max-top match instead of breaking.)
    if (target.getBoundingClientRect().top <= bandTop) current = hash;
    else break;
  }
  markCurrent(state, current);
}

function refreshFromIntersections(state: RailState, targets: Map<string, Element>): void {
  if (state.intersecting.size === 0) return; // keep the last mark, never flash blank
  let best: string | null = null;
  let bestTop = Infinity;
  for (const hash of state.intersecting) {
    const top = targets.get(hash)?.getBoundingClientRect().top ?? Infinity;
    if (top < bestTop) {
      bestTop = top;
      best = hash;
    }
  }
  if (best) markCurrent(state, best);
}

function viteDevMode(): boolean {
  // import.meta.env exists only in Vite-built output; optional access keeps
  // SSR evaluation (Deno has no import.meta.env) quiet by construction.
  return (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV ?? false;
}

export function installRailScrollspy(host: RailHost): void {
  if (states.has(host) || typeof IntersectionObserver === 'undefined') return;
  const links = railLinks(host);
  const targets = new Map<string, Element>();
  let firstHash = '';
  for (const link of links) {
    const hash = link.getAttribute('href') ?? '';
    const id = hash.slice(1);
    if (!id || targets.has(hash)) continue;
    if (!firstHash) firstHash = hash;
    // Sections live in the article light DOM (or the shell for #start).
    // getElementById does not pierce shadow roots: if article content ever
    // moves into one, the rail silently dies — hence the dev warning below.
    const target = document.getElementById(id);
    if (target) targets.set(hash, target);
  }
  const state: RailState = { observer: null, links, intersecting: new Set() };
  // Register before any early return: an empty target set is deterministic
  // for this host, so re-entering must stay a no-op rather than rescanning.
  states.set(host, state);
  if (targets.size === 0) {
    if (viteDevMode()) {
      console.warn(
        '[open-page-rail] scrollspy found no section targets: getElementById does not pierce shadow roots.',
      );
    }
    return;
  }
  const byTarget = new Map<Element, string>();
  for (const [hash, target] of targets) byTarget.set(target, hash);
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const hash = byTarget.get(entry.target);
        if (!hash) continue;
        if (entry.isIntersecting) state.intersecting.add(hash);
        else state.intersecting.delete(hash);
      }
      refreshFromIntersections(state, targets);
    },
    { rootMargin: '-15% 0px -70% 0px' },
  );
  for (const target of targets.values()) observer.observe(target);
  state.observer = observer;
  seedCurrent(state, targets, firstHash);
}

export function uninstallRailScrollspy(host: RailHost): void {
  const state = states.get(host);
  if (!state) return;
  state.observer?.disconnect();
  states.delete(host);
}
