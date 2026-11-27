/** Browser-only TOC scrollspy used by the open-page-rail island. */

type RailHost = HTMLElement;

interface RailState {
  stop: (() => void) | null;
  links: HTMLAnchorElement[];
  intersecting: Set<string>;
  status: HTMLElement | null;
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
  let label = '';
  for (const link of state.links) {
    const current = link.getAttribute('href') === hash;
    const marked = link.getAttribute('aria-current') === 'location';
    if (current && !label) label = link.textContent?.trim() ?? '';
    if (current && !marked) link.setAttribute('aria-current', 'location');
    else if (!current && marked) link.removeAttribute('aria-current');
  }
  if (state.status && state.status.textContent !== label) state.status.textContent = label;
}

/** The last rail target at or above the band top wins in the gaps. */
function markSectionAboveBand(
  state: RailState,
  targets: Map<string, Element>,
  bandTop = globalThis.innerHeight * 0.15,
): void {
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
  const summary = state.status?.parentElement;
  if (summary && summary.offsetHeight > 0) {
    // The same clearance also seats native fragments below the sticky menu.
    const heading = targets.values().next().value;
    const margin = heading
      ? Number.parseFloat(getComputedStyle(heading).scrollMarginBlockStart)
      : 0;
    markSectionAboveBand(state, targets, margin + 1);
    return;
  }
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

function enhanceOutline(
  details: HTMLDetailsElement,
  summary: HTMLElement,
  state: RailState,
  targets: Map<string, Element>,
): () => void {
  const status = document.createElement('span');
  status.className = 'rail-current';
  summary.append(status);
  state.status = status;

  const panel = details.querySelector('nav');
  const listeners = new AbortController();
  const options = { signal: listeners.signal };
  const closeOutside = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Node) || details.contains(target)) return;
    // WebKit may focus the enclosing landmark on pointerdown on a link.
    // Keep the panel open so pointerup can still reach the selected link.
    if (event.type === 'focusin' && target.contains(details)) return;
    details.open = false;
  };
  const selectSection = (event: MouseEvent): void => {
    if (
      !(event.target instanceof Element) ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    )
      return;
    const link = event.target.closest('a[href^="#"]');
    const target = targets.get(link?.getAttribute('href') ?? '');
    if (!(target instanceof HTMLElement)) return;
    // Let the native fragment action run while the selected link is still
    // rendered. WebKit cancels that action if its details closes during click.
    requestAnimationFrame(() => {
      if (listeners.signal.aborted || event.defaultPrevented) return;
      details.open = false;
      if (!target.hasAttribute('tabindex')) {
        target.tabIndex = -1;
        target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
      }
      target.focus({ preventScroll: true });
    });
  };
  const onEscape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !details.open) return;
    details.open = false;
    summary.focus({ preventScroll: true });
  };
  const revealPanel = (): void => {
    if (!details.open || !panel) return;
    const overflow = panel.getBoundingClientRect().bottom - globalThis.innerHeight + 8;
    if (overflow > 0) globalThis.scrollBy({ top: overflow, behavior: 'instant' });
  };
  details.setAttribute('data-outline-ready', '');
  details.addEventListener('click', selectSection, options);
  details.addEventListener('keydown', onEscape, options);
  details.addEventListener('toggle', revealPanel, options);
  document.addEventListener('pointerdown', closeOutside, options);
  document.addEventListener('focusin', closeOutside, options);
  return () => {
    details.removeAttribute('data-outline-ready');
    status.remove();
    listeners.abort();
  };
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
  const article = host.closest('open-reading-shell')?.querySelector('.article-content');
  const details = article ? host.querySelector('details') : null;
  const summary = details?.querySelector('summary');
  const state: RailState = { stop: null, links, intersecting: new Set(), status: null };
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
  const restoreOutline =
    details && summary ? enhanceOutline(details, summary, state, targets) : null;
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
    let hash = globalThis.location.hash;
    try {
      hash = decodeURIComponent(hash);
    } catch {
      // Use the raw fragment if it contains an invalid escape sequence.
    }
    if (targets.has(hash)) markCurrent(state, hash);
    else refreshFromIntersections(state, targets);
  };
  globalThis.addEventListener('scroll', onScroll, { passive: true });
  globalThis.addEventListener('hashchange', onHashChange);
  state.stop = () => {
    restoreOutline?.();
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
