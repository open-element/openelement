/** Browser-only TOC scrollspy used by the open-page-rail island. */

type RailHost = HTMLElement;

interface RailState {
  observer: IntersectionObserver | null;
}

const states = new WeakMap<RailHost, RailState>();

function railLinks(host: RailHost): HTMLAnchorElement[] {
  const root = host.shadowRoot ?? host;
  return [...root.querySelectorAll<HTMLAnchorElement>('nav.links a[href^="#"]')];
}

function markCurrent(host: RailHost, hash: string): void {
  for (const link of railLinks(host)) {
    if (link.getAttribute('href') === hash) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  }
}

export function installRailScrollspy(host: RailHost): void {
  if (states.has(host) || typeof IntersectionObserver === 'undefined') return;
  const targets = new Map<string, Element>();
  for (const link of railLinks(host)) {
    const hash = link.getAttribute('href') ?? '';
    const id = hash.slice(1);
    if (!id || targets.has(hash)) continue;
    // Sections live in the article light DOM (or the shell for #start).
    const target = document.getElementById(id);
    if (target) targets.set(hash, target);
  }
  if (targets.size === 0) return;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        for (const [hash, target] of targets) {
          if (target === entry.target) markCurrent(host, hash);
        }
      }
    },
    { rootMargin: '-15% 0px -70% 0px' },
  );
  for (const target of targets.values()) observer.observe(target);
  states.set(host, { observer });
}

export function uninstallRailScrollspy(host: RailHost): void {
  const state = states.get(host);
  if (!state) return;
  state.observer?.disconnect();
  states.delete(host);
}
