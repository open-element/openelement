/** Browser-only TOC scrollspy used by the open-page-rail island. */

type RailHost = HTMLElement;

interface RailState {
  stop: (() => void) | null;
  links: HTMLAnchorElement[];
  intersecting: Set<string>;
}

const states = new WeakMap<RailHost, RailState>();

function railLinks(host: RailHost): HTMLAnchorElement[] {
  const root = host.shadowRoot ?? host;
  // Structural selector: the outline is the desktop nav plus the nav inside
  // the mobile details; the alpha15 utility migration dropped the former
  // `nav.links` class, so the class hook is gone and `nav` is the contract.
  return [...root.querySelectorAll<HTMLAnchorElement>('nav a[href^="#"]')];
}

function markCurrent(state: RailState, hash: string): void {
  for (const link of state.links) {
    const current = link.getAttribute('href') === hash;
    const marked = link.getAttribute('aria-current') === 'location';
    if (current && !marked) link.setAttribute('aria-current', 'location');
    else if (!current && marked) link.removeAttribute('aria-current');
  }
}

/** The last rail target at or above the band top wins in the gaps. */
function markSectionAboveBand(state: RailState, targets: Map<string, Element>): void {
  // Same band the observer watches: top = 15% of viewport height.
  const bandTop = globalThis.innerHeight * 0.15;
  let current = targets.keys().next().value ?? '';
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
  else markSectionAboveBand(state, targets);
}

function viteDevMode(): boolean {
  // import.meta.env exists only in Vite-built output; optional access keeps
  // SSR evaluation (bare Node has no import.meta.env either) quiet by construction.
  return (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV ?? false;
}

export function installRailScrollspy(host: RailHost): void {
  if (states.has(host) || typeof IntersectionObserver === 'undefined') return;
  const links = railLinks(host);
  const targets = new Map<string, Element>();
  for (const link of links) {
    const hash = link.getAttribute('href') ?? '';
    const id = hash.slice(1);
    if (!id || targets.has(hash)) continue;
    // Sections live in the article light DOM (or the shell for #start).
    // getElementById does not pierce shadow roots: if article content ever
    // moves into one, the rail silently dies — hence the dev warning below.
    const target = document.getElementById(id);
    if (target) targets.set(hash, target);
  }
  const state: RailState = { stop: null, links, intersecting: new Set() };
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
      if (states.get(host) !== state) return;
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
  // A fragment jump can move a heading entirely across the observer band
  // without producing an intersection entry. Recheck geometry on scroll.
  let frame: number | null = null;
  const onScroll = (): void => {
    if (frame !== null) return;
    frame = globalThis.requestAnimationFrame(() => {
      frame = null;
      if (states.get(host) === state) refreshFromIntersections(state, targets);
    });
  };
  const onHashChange = (): void => {
    const hash = globalThis.location.hash;
    if (targets.has(hash)) markCurrent(state, hash);
    else refreshFromIntersections(state, targets);
  };
  globalThis.addEventListener('scroll', onScroll, { passive: true });
  globalThis.addEventListener('hashchange', onHashChange);
  state.stop = () => {
    observer.disconnect();
    globalThis.removeEventListener('scroll', onScroll);
    globalThis.removeEventListener('hashchange', onHashChange);
    if (frame !== null) globalThis.cancelAnimationFrame(frame);
  };
  for (const target of targets.values()) observer.observe(target);
  onHashChange();
}

export function uninstallRailScrollspy(host: RailHost): void {
  const state = states.get(host);
  if (!state) return;
  states.delete(host);
  state.stop?.();
  // Teardown must UNDO the marks, not just stop the observer: a disconnect
  // keeps the generated DOM (the LC-0 retained-region scope), so a leftover
  // `aria-current` survives into the next connect's claim and fails its
  // static-attribute-seed check (the marks are outside the authored seed).
  // Restoring the declared state here makes the retained DOM re-claimable
  // exactly like the first activation.
  markCurrent(state, '');
  state.intersecting.clear();
}
