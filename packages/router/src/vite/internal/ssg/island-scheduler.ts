/**
 * island-scheduler.ts - Island strategy scheduling (single owner, #606).
 *
 * This module is the ONE owner of island load/visibility scheduling in the
 * browser (#606): `load`/`only` islands import immediately, `idle` islands
 * defer to browser idle time, `visible` islands import when any instance
 * enters the viewport, and `media` islands wait for a matching media query —
 * located by a deep, shadow-root-aware query because
 * islands live inside page-element DSD shadow roots where a light-DOM
 * querySelectorAll never looks (#562). defineIsland() in @openelement/element
 * carries no scheduling of its own: an island module only evaluates after
 * this scheduler decided to import it, so defineIsland() registers on
 * evaluation.
 *
 * The generated client entry imports this module through the
 * virtual:open-client-runtime specifier (resolved by build-client.ts) and the
 * bundler wires it in: there is no parallel string copy to drift, and the
 * logic carries normal unit tests (__tests__/island-scheduler.test.ts). The
 * module stays import-free and touches browser globals only through the
 * injected deps, so it bundles into any consumer build unchanged.
 */

/** Minimal logger surface shared with the generated client entry. */
interface SchedulerLogger {
  warn: (...args: unknown[]) => void;
}

interface MediaQueryListLike {
  matches: boolean;
  addEventListener?: (type: 'change', listener: (event: MediaQueryListLike) => void) => void;
  addListener?: (listener: (event: MediaQueryListLike) => void) => void;
}

export interface IslandSchedulerDeps {
  log: SchedulerLogger;
  win: Window & typeof globalThis;
  doc: Document;
  /** Tag name -> dynamic import factory; entries are nulled once loaded. */
  map: Record<string, (() => Promise<unknown>) | null>;
  /** Island tag names per hydration strategy bucket. */
  strategies: {
    load: readonly string[];
    idle: readonly string[];
    visible: readonly string[];
    /** Tags whose capability is gated by `mediaQueries`. */
    media?: readonly string[];
    only: readonly string[];
  };
  /** One matchMedia result per media-gated tag. Missing entries fail closed. */
  mediaQueries?: Record<string, MediaQueryListLike | null | undefined>;
  /**
   * Runs (macrotask-deferred) after any island module resolves. The enhance
   * layer uses it to rescan submit roots for late-hydrating islands (#584);
   * null when the page has no data-open-enhance forms (#597).
   */
  onIslandLoaded: (() => void) | null;
}

export interface IslandScheduler {
  /**
   * Re-scan for client:visible island elements and observe any new ones.
   * The enhance layer calls this after every morph: a replaced island is a
   * new element and gets a fresh observer (#562). No-op without visible tags.
   */
  observeVisible: () => void;
}

export function createIslandScheduler(deps: IslandSchedulerDeps): IslandScheduler {
  const log = deps.log;
  const win = deps.win;
  const doc = deps.doc;
  const map = deps.map;
  const strategies = deps.strategies;

  function load(tag: string): void {
    const factory = map[tag];
    if (factory) {
      factory().then(() => {
        // #584: late-hydrating islands create their shadow roots after the
        // ready-time scan; let the enhance layer rescan so enhanced forms
        // inside them are heard.
        if (deps.onIslandLoaded) {
          win.setTimeout(() => {
            if (deps.onIslandLoaded) deps.onIslandLoaded();
          }, 0);
        }
      }).catch((e: unknown) => log.warn(tag, e));
      map[tag] = null;
    }
  }

  function onReady(fn: () => void): void {
    if (doc.readyState === 'loading') {
      doc.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  function dispatchReady(strategy: string, tags: readonly string[]): void {
    // #605: EVERY non-empty strategy bucket fires open:ready as its loads are
    // initiated — load/only used to stay silent while idle/visible fired.
    doc.dispatchEvent(
      new win.CustomEvent('open:ready', {
        detail: { strategy: strategy, islands: tags },
      }),
    );
  }

  // client:load islands - import immediately
  const loadTags = strategies.load;
  loadTags.forEach(load);
  if (loadTags.length > 0) dispatchReady('load', loadTags);

  // client:only islands - import immediately, no DSD/SSR expected
  const onlyTags = strategies.only;
  onlyTags.forEach(load);
  if (onlyTags.length > 0) dispatchReady('only', onlyTags);

  // client:visible islands - load when their element enters viewport
  const visibleTags = strategies.visible;
  // Element -> observer, so a detached island can be released (it can never
  // intersect again) and a remove/reinsert before intersection is re-observed
  // instead of being skipped forever (#1039).
  const observedEls = new Map<Element, IntersectionObserver>();

  function queryAllDeep(root: ParentNode, tag: string, out: Element[]): void {
    // Islands live inside page-element shadow roots; a plain
    // document.querySelectorAll never sees them (#562).
    const found = root.querySelectorAll(tag);
    for (let i = 0; i < found.length; i++) out.push(found[i]);
    const all = root.querySelectorAll('*');
    for (let j = 0; j < all.length; j++) {
      const shadow = (all[j] as HTMLElement).shadowRoot;
      if (shadow) queryAllDeep(shadow, tag, out);
    }
  }

  function observeVisible(): void {
    if (visibleTags.length === 0) return;
    if (typeof win.IntersectionObserver !== 'function') {
      visibleTags.forEach(load);
      dispatchReady('visible', visibleTags);
      return;
    }
    // Release detached islands before scanning: their observers can never
    // fire again, and keeping them referenced leaks the whole subtree.
    // isConnected is compared strictly so non-DOM test doubles (which do
    // not implement it) are left alone.
    for (const [el, obs] of observedEls) {
      if (el.isConnected === false) {
        obs.disconnect();
        observedEls.delete(el);
      }
    }
    visibleTags.forEach((tag) => {
      if (!map[tag]) return;
      const els: Element[] = [];
      queryAllDeep(doc, tag, els);
      els.forEach((el) => {
        // Re-observable after a morph: a replaced island is a new element and
        // gets a fresh observer (#562).
        if (observedEls.has(el)) return;
        const Observer = win.IntersectionObserver;
        const obs = new Observer((entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              load(tag);
              dispatchReady('visible', [tag]);
              obs.disconnect();
              observedEls.delete(el);
            }
          });
        }, { rootMargin: '200px' });
        observedEls.set(el, obs);
        obs.observe(el);
      });
    });
  }

  if (visibleTags.length > 0) onReady(observeVisible);

  // client:media islands - import when their declarative media query matches.
  // The generated entry creates these MediaQueryList values before
  // constructing the scheduler. Delivery is one-shot per tag; subsequent
  // route morphs see the native custom-element constructor already registered.
  const mediaTags = strategies.media ?? [];
  const mediaReady = new Set<string>();

  const dispatchMedia = (tag: string): void => {
    if (mediaReady.has(tag) || !map[tag]) return;
    mediaReady.add(tag);
    load(tag);
    dispatchReady('media', [tag]);
  };

  for (const tag of mediaTags) {
    const query = deps.mediaQueries?.[tag];
    if (!query) {
      log.warn(`Media island "${tag}" has no supported matchMedia result; delivery skipped`);
      continue;
    }
    if (query.matches) dispatchMedia(tag);
    const listener = (event: MediaQueryListLike): void => {
      if (event.matches) dispatchMedia(tag);
    };
    if (query.addEventListener) query.addEventListener('change', listener);
    else if (query.addListener) query.addListener(listener);
  }

  // client:idle islands - defer to browser idle
  const idleTags = strategies.idle;
  if (idleTags.length > 0) {
    const deferred = (): void => {
      idleTags.forEach(load);
      dispatchReady('idle', idleTags);
    };
    const schedule: (fn: () => void) => unknown = win.requestIdleCallback ||
      win.requestAnimationFrame ||
      ((fn) => win.setTimeout(fn, 50));
    schedule(deferred);
  }

  return { observeVisible: observeVisible };
}
