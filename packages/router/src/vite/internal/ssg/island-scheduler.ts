/**
 * island-scheduler.ts - Island strategy scheduling (single owner, #606).
 *
 * This module is the ONE owner of island load/visibility scheduling in the
 * browser (#606): `load`/`only` islands import immediately, `idle` islands
 * defer to browser idle time, `visible` islands import when any instance
 * enters the viewport, and `media` islands wait for a matching media query —
 * located by a deep, shadow-root-aware query because
 * islands live inside page-element DSD shadow roots where a light-DOM
 * querySelectorAll never looks (#562). Island modules carry no scheduling of
 * their own: a module only evaluates after this scheduler decided to import
 * it, and the import registers the island's custom element as its side
 * effect.
 *
 * PAGE SCOPE (B2): an activation decision is also a page-scope decision. A
 * tag activates only when the current page actually carries a host for it
 * (deep query, #562). This is the runtime form of the fact the build already
 * records per page in the island manifests (#1561): "an island that a page
 * never reaches is never fetched" (guide/islands-and-ssr). Without it, an
 * `idle`/`load`/`only` bucket imported every declared island chunk on every
 * page, which also dragged the shared element runtime into pages whose island
 * manifest is empty. A tag with no host keeps its factory (nothing is
 * consumed), so a later decision — a media-query change, the post-morph
 * rescan (`observeVisible`), or the bounded late-host probe below — can still
 * activate it. `open:ready` fires per strategy with the tags this page
 * actually activated, never for a bucket that started no load here.
 *
 * LATE HOSTS: the ready-time read is not the last word. A third-party
 * component may create an island's host later, inside its own open shadow
 * root, after an async chunk of its own has landed — and on a page with no
 * enhanced forms and no `visible` island, nothing would ever rescan for it,
 * so the island stayed dead. The probe re-runs the same rescan on a bounded
 * schedule while this page still has an unconsumed declared factory, and
 * dispatches one `open:island-host-timeout` event (informational, never a
 * drop: the factory stays in the map) when the budget is spent. It adds no
 * new activation path — `load()`'s host gate stays the only one — so a page
 * with no host still fetches nothing.
 *
 * Two strategy transitions arm the probe because they are the only events
 * those pages ever get (FR-02): an idle attempt that completes with idle
 * factories still unconsumed arms it from the deferred step, and a media
 * query whose change listener turns matching while the tag is unconsumed
 * arms it from that listener. The probe is armed once per page and adds no
 * activation authority, so both hooks only decide "keep looking"; the
 * 9000 ms absolute cap is checked at every probe entry and every
 * continuation-window entry before any DOM scan or activation (FR-03).
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
   * Idle-hydration scheduling fallback in milliseconds when neither
   * `requestIdleCallback` nor `requestAnimationFrame` exists — the generated
   * entry serializes the element policy constant
   * (IDLE_FALLBACK_TIMEOUT_MS) at build time; this import-free module never
   * hard-codes the number.
   */
  idleFallbackTimeoutMs: number;
  /**
   * Runs (macrotask-deferred) after any island module resolves. The enhance
   * layer uses it to rescan submit roots for late-hydrating islands (#584);
   * null when the page has no data-open-enhance forms (#597).
   */
  onIslandLoaded: (() => void) | null;
}

export interface IslandScheduler {
  /**
   * The post-morph rescan (the enhance layer calls it after every morph):
   * re-run the eager buckets, re-arm the idle attempt while a factory is
   * still unconsumed, re-read the media matches, and observe new
   * client:visible hosts. A replaced visible island is a new element and
   * gets a fresh observer (#562); a host that arrived after its strategy's
   * opportunity was spent is activated here (#1544/B2 follow-up, F01).
   */
  observeVisible: () => void;
}

/**
 * Whether `root` currently carries a host for `tag` anywhere in the composed
 * tree. Islands live inside page-element DSD shadow roots (#562), so a
 * document query alone is never enough; the walk descends into every
 * element's shadow root and stops at the first match.
 */
function hasIslandHost(root: ParentNode, tag: string): boolean {
  if (root.querySelectorAll(tag).length > 0) return true;
  const all = root.querySelectorAll('*');
  for (let i = 0; i < all.length; i++) {
    const shadow = (all[i] as HTMLElement).shadowRoot;
    if (shadow && hasIslandHost(shadow, tag)) return true;
  }
  return false;
}

interface StrategyHooks {
  load(tag: string): boolean;
  startBucket(strategy: string, tags: readonly string[]): void;
  dispatchReady(strategy: string, tags: readonly string[]): void;
  armProbe(): void;
}

export function installVisibleStrategy(
  { doc, win, map, strategies }: IslandSchedulerDeps,
  { load, startBucket, dispatchReady }: Omit<StrategyHooks, 'armProbe'>,
): () => void {
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

  return function observeVisible(): void {
    if (visibleTags.length === 0) return;
    if (typeof win.IntersectionObserver !== 'function') {
      startBucket('visible', visibleTags);
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
        const obs = new Observer(
          (entries) => {
            entries.forEach((entry) => {
              if (entry.isIntersecting) {
                if (load(tag)) dispatchReady('visible', [tag]);
                obs.disconnect();
                observedEls.delete(el);
              }
            });
          },
          { rootMargin: '200px' },
        );
        observedEls.set(el, obs);
        obs.observe(el);
      });
    });
  };
}

export function installMediaStrategy(
  deps: IslandSchedulerDeps,
  { load, dispatchReady, armProbe }: Omit<StrategyHooks, 'startBucket'>,
) {
  const { strategies, log, map } = deps;
  // client:media islands - import when their declarative media query matches.
  // The generated entry creates these MediaQueryList values before
  // constructing the scheduler. Delivery is one-shot per tag; subsequent
  // route morphs see the native custom-element constructor already registered.
  const mediaTags = strategies.media ?? [];
  const mediaReady = new Set<string>();

  const dispatchMedia = (tag: string): void => {
    if (mediaReady.has(tag)) return;
    if (!load(tag)) return;
    mediaReady.add(tag);
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
      if (!event.matches) return;
      dispatchMedia(tag);
      // FR-02: this listener is the ONLY event a query that starts
      // non-matching ever produces, and dispatchMedia() is a no-op while the
      // page has no host. Without an arm here a host created after the
      // transition would never be discovered (the construction-time arm
      // could not see this tag). Arming is idempotent and adds no activation
      // authority: load() still owns the host gate.
      if (map[tag]) armProbe();
    };
    if (query.addEventListener) query.addEventListener('change', listener);
    else if (query.addListener) query.addListener(listener);
  }

  /**
   * Re-read the current match result for every media tag whose factory is
   * still in the map. A query that matched at construction made its one
   * activation attempt then; with no host on the page it was a no-op and the
   * factory stayed unconsumed. After a morph the host exists, and an
   * always-matching query never fires a later `change` event, so this rescan
   * is the only recovery path. The map entry remains the one-shot guard; the
   * `change` listener above keeps covering a query that starts matching later.
   */
  function rescan(): void {
    for (const tag of mediaTags) {
      if (!map[tag]) continue;
      if (deps.mediaQueries?.[tag]?.matches) dispatchMedia(tag);
    }
  }

  return {
    rescan,
    appendPending(add: (tag: string) => void): void {
      for (const tag of mediaTags) {
        if (deps.mediaQueries?.[tag]?.matches === true) add(tag);
      }
    },
  };
}

interface OptionalStrategies {
  visible?: typeof installVisibleStrategy;
  media?: typeof installMediaStrategy;
}

/** Generic entry point for callers without a build's strategy inventory. */
export function createIslandScheduler(deps: IslandSchedulerDeps): IslandScheduler {
  return createIslandSchedulerWithStrategies(deps, {
    visible: installVisibleStrategy,
    media: installMediaStrategy,
  });
}

/** The generated entry imports only the strategy installers its declared buckets require. */
export function createIslandSchedulerWithStrategies(
  deps: IslandSchedulerDeps,
  optional: OptionalStrategies,
): IslandScheduler {
  const log = deps.log;
  const win = deps.win;
  const doc = deps.doc;
  const map = deps.map;
  const strategies = deps.strategies;

  // ─── Late-host probe budget and state ───────────────────────────────────
  //
  // B2's page-scope gate reads the page ONCE, at module evaluation. A host a
  // third party creates later — inside its own open shadow root, or appended
  // to the light DOM after an async chunk lands — is invisible to that one
  // read, and on a page with no enhanced forms and no `visible` island the
  // post-morph rescan never runs at all, so the island stays dead forever.
  //
  // The probe below is the missing second and third look: a bounded, self
  // scheduled re-run of the SAME rescan (`observeVisible`). It never calls a
  // factory itself — `load()`'s host gate stays the only activation
  // authority — so "a page with no host fetches nothing" survives by
  // construction. The budget is a contract, not a tuning knob: it bounds how
  // much DOM work a page can be made to do by declaring islands it never
  // hosts. See the approved decision record for the rationale and the
  // per-attempt complexity argument.
  //
  // The probe functions live together near the end of this factory; the state
  // is declared here so `load()`'s resolution hook can never observe a
  // temporal-dead-zone binding.
  const LATE_HOST_MAX_ATTEMPTS = 6;
  const LATE_HOST_DELAYS_MS = [0, 25, 100, 250, 750, 1500];
  const LATE_HOST_WINDOW_MS = 3000;
  const LATE_HOST_MAX_WINDOWS = 3;
  const LATE_HOST_MAX_TOTAL_MS = 9000;
  let probeWindow = 0;
  let probeAttempt = 0;
  let probeStartTs = 0;
  let probeStartedAt = 0;
  let probePending = false;
  let probeTimer = 0;
  let probeAwaiting = false;
  let probeDone = false;
  let probeArmed = false;
  /**
   * Tags the probe has already handed to the rescan. A `visible` island whose
   * host exists is unconsumed until it intersects — a healthy state, not a
   * missing host — so without this the probe would re-find it every attempt
   * and eventually name it in a give-up event that says nothing is wrong.
   */
  const probeSettled = new Set<string>();

  /**
   * Wall clock for the probe's two time budgets, read through the injected
   * window so a DOM-free test can drive them; a real window always carries
   * the intrinsic.
   */
  function probeNow(): number {
    const source = win.Date as unknown as { now?: () => number } | undefined;
    return typeof source?.now === 'function' ? source.now() : Date.now();
  }

  /**
   * Start one island's import. Returns whether a load started HERE: false
   * when the tag was already consumed or when this page carries no host for
   * it (the page-scope decision in the module doc). The factory stays in the
   * map in the no-host case.
   */
  function load(tag: string): boolean {
    const factory = map[tag];
    if (!factory) return false;
    if (!hasIslandHost(doc, tag)) return false;
    factory()
      .then(() => {
        // An island module just landed: client code (often a third party's)
        // is still running, so a host it creates may still be coming. This
        // is the only late-host signal the runtime gets for free, and it is
        // what lets the probe's window cover a slow async chunk instead of
        // paying for a long unconditional wait.
        onIslandLoadActivity();
        // #584: late-hydrating islands create their shadow roots after the
        // ready-time scan; let the enhance layer rescan so enhanced forms
        // inside them are heard.
        if (deps.onIslandLoaded) {
          win.setTimeout(() => {
            if (deps.onIslandLoaded) deps.onIslandLoaded();
          }, 0);
        }
      })
      .catch((e: unknown) => log.warn(tag, e));
    map[tag] = null;
    return true;
  }

  /** Start and announce only the subset of a bucket this page can activate. */
  function startBucket(strategy: string, tags: readonly string[]): void {
    const activated = tags.filter(load);
    if (activated.length > 0) dispatchReady(strategy, activated);
  }

  function onReady(fn: () => void): void {
    if (doc.readyState === 'loading') {
      doc.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  function dispatchReady(strategy: string, tags: readonly string[]): void {
    // #605: EVERY strategy bucket that starts a load here fires open:ready as
    // its loads are initiated — the detail names exactly the activated tags.
    doc.dispatchEvent(
      new win.CustomEvent('open:ready', {
        detail: { strategy: strategy, islands: tags },
      }),
    );
  }

  // client:load islands - import immediately
  startBucket('load', strategies.load);

  // client:only islands - import immediately, no DSD/SSR expected
  startBucket('only', strategies.only);

  const observeVisible = optional.visible?.(deps, { load, startBucket, dispatchReady });
  const media = optional.media?.(deps, { load, dispatchReady, armProbe });

  function rescan(): void {
    // #1544/B2 follow-up: the ready-time scan is not the last word on the page
    // scope. An enhanced response morphs new HTML in, and this function is the
    // rescan the client runtime runs after every morph (#562). The first fix
    // revisited only the eager buckets, which left an idle/media HOST that
    // arrived after its strategy's one-shot opportunity was spent dead
    // forever: the morph-inserted element kept its defer-hydration marker and
    // never became interactive (F01). Re-run every unconsumed strategy here;
    // load() nulls its map entry when a load starts, so an already-activated
    // tag is skipped and open:ready keeps its one-event-per-activation shape.
    startBucket('load', strategies.load);
    startBucket('only', strategies.only);
    // Idle keeps its browser-idle semantics (the retry is scheduled, never
    // loaded synchronously); media re-reads the current match, since an
    // always-matching query has no future `change` event to recover on.
    rescanIdle();
    media?.rescan();
    observeVisible?.();
  }

  // client:idle islands - defer to browser idle
  const idleTags = strategies.idle;
  let idlePending = false;

  /**
   * Schedule one idle activation attempt through the environment's preferred
   * idle primitive (`requestIdleCallback` -> `requestAnimationFrame` -> the
   * injected policy timeout). `idlePending` makes repeated rescans share one
   * pending attempt instead of stacking callbacks.
   */
  function scheduleIdle(): void {
    if (idlePending) return;
    idlePending = true;
    const deferred = (): void => {
      idlePending = false;
      startBucket('idle', idleTags);
      // FR-02: the idle attempt was this page's only scheduled look for an
      // idle island. If a declared factory is still unconsumed, a host may
      // still arrive later — keep the late-host probe running for exactly
      // those tags. The idle load itself stays asynchronous (the probe only
      // rescans; load()'s host gate decides), and armProbe() is idempotent so
      // every other page shape keeps its no-timer behaviour.
      armProbe();
    };
    const schedule: (fn: () => void) => unknown =
      win.requestIdleCallback ||
      win.requestAnimationFrame ||
      ((fn) => win.setTimeout(fn, deps.idleFallbackTimeoutMs));
    schedule(deferred);
  }

  /**
   * The idle half of the post-morph rescan (F01): the construction-time idle
   * callback is almost always spent by the time a morph delivers the first
   * host, so a still-unconsumed factory means the attempt must be scheduled
   * again. Idle semantics survive because the retry goes through the same
   * idle primitive; a consumed tag is out of the map, so the rescan can never
   * double-load.
   */
  function rescanIdle(): void {
    if (idlePending) return;
    if (!idleTags.some((tag) => Boolean(map[tag]))) return;
    scheduleIdle();
  }

  if (idleTags.length > 0) scheduleIdle();

  // ─── The late-host probe ────────────────────────────────────────────────
  //
  // A bounded, self-scheduled re-run of the rescan above. It arms only while
  // this page carries a declared island whose factory is still unconsumed —
  // i.e. a tag the build delivered here but no host has answered for yet —
  // and disarms the moment every factory is consumed or the budget is spent.

  /**
   * The tags this page declared but has not activated yet, in bucket order.
   * Three exclusions:
   *
   * - a non-matching `media` tag is capability-gated, not missing a host, so
   *   searching for it would burn budget on a host we would refuse anyway;
   * - `map[tag] === null` is the consumed marker `load()` writes, and is the
   *   one-shot guard the whole scheduler already trusts;
   * - an `idle` tag is skipped while its own attempt is still outstanding:
   *   the browser has not been asked yet, so there is nothing to recover
   *   from and probing would just duplicate a scheduled attempt. When that
   *   attempt completes and the tag is still unconsumed, the deferred step
   *   arms this probe (FR-02): idle delivery keeps its own asynchronous
   *   scheduling, and a host created after the attempt is still discovered
   *   inside the same bounded budget. Arming from the deferred also cannot
   *   schedule a second idle step — this probe only rescans.
   */
  function pendingTags(): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const add = (tag: string): void => {
      if (!map[tag] || seen.has(tag) || probeSettled.has(tag)) return;
      seen.add(tag);
      out.push(tag);
    };
    for (const tag of strategies.load) add(tag);
    for (const tag of strategies.only) add(tag);
    for (const tag of strategies.visible) add(tag);
    if (!idlePending) {
      for (const tag of idleTags) add(tag);
    }
    media?.appendPending(add);
    return out;
  }

  /**
   * One fused composed-tree walk: which of `tags` has a host right now.
   *
   * The ready-time gate asks per tag; a probe repeats the question, so it
   * asks it for the whole pending set in a single traversal. Each visited
   * root costs two native queries — the tag selector list answers every
   * pending tag at once, and the `*` list is reused for the shadow descent —
   * which keeps one probe at the cost of one ready-time gate call rather than
   * one per pending tag. Descends through `shadowRoot`, so it sees any depth
   * of OPEN shadow root and stops silently at a closed one (the platform
   * exposes no entry point; the factory stays unconsumed, and the give-up
   * event names the tag). Results come back in `tags` order.
   */
  function collectHosts(root: ParentNode, tags: readonly string[]): string[] {
    const found: string[] = [];
    if (tags.length === 0) return found;
    const selector = tags.join(',');
    const pending = new Set(tags);
    const visit = (scope: ParentNode): void => {
      if (pending.size === 0) return;
      const hits = scope.querySelectorAll(selector);
      for (let i = 0; i < hits.length; i++) {
        const name = hits[i].localName;
        if (pending.delete(name)) found.push(name);
      }
      if (pending.size === 0) return;
      const all = scope.querySelectorAll('*');
      for (let j = 0; j < all.length; j++) {
        const shadow = (all[j] as HTMLElement).shadowRoot;
        if (shadow) visit(shadow);
      }
    };
    visit(root);
    return tags.filter((tag) => found.indexOf(tag) !== -1);
  }

  /** Queue one probe step. At most one timer is ever outstanding. */
  function scheduleProbe(delayMs: number): void {
    if (probePending || probeDone) return;
    try {
      probePending = true;
      probeTimer = win.setTimeout(() => {
        probePending = false;
        probe(probeNow());
      }, delayMs);
    } catch {
      // A host that will not give us a timer cannot run a timed probe; give
      // up quietly rather than throwing out of island scheduling. Nothing is
      // consumed, so a later morph rescan still activates the island.
      probePending = false;
      probeDone = true;
    }
  }

  /**
   * One probe step. Returns silently once disarmed; on each live step it
   * asks whether any pending tag has a host and, if so, hands the whole
   * question back to the one function that owns activation semantics.
   */
  function probe(now: number): void {
    if (probeDone) return;
    // The absolute wall-clock cap is the FIRST question of every probe entry
    // (FR-03): a page can be suspended or its timers throttled, so a step
    // scheduled inside the budget may run long after it. Past the cap this
    // must give up without any DOM scan or activation: a timer that wakes at
    // 10 s may not discover a host and let a window/attempt bound decide the
    // budget later. elapsedMs is therefore always >= the cap here.
    if (now - probeStartedAt >= LATE_HOST_MAX_TOTAL_MS) {
      probeAgeOut(now);
      return;
    }
    // The previous window ran out and nothing has loaded since: stop, and
    // say so. Waiting forever for an activity signal would make the give-up
    // diagnostic unreachable, which is exactly the silent-drop failure the
    // probe exists to prevent.
    if (probeAwaiting) {
      const stranded = pendingTags();
      probeDone = true;
      probeAwaiting = false;
      if (stranded.length > 0) giveUp(stranded, now);
      return;
    }
    const pending = pendingTags();
    if (pending.length === 0) {
      probeDone = true;
      return;
    }
    const hits = collectHosts(doc, pending);
    if (hits.length > 0) {
      // Settle only what was actually seen, and settle before the rescan: for
      // `load`/`only`/matching-`media` this is the activation itself, and for
      // `visible` it is the observer that now owns the tag. Either way the
      // probe has nothing left to discover for those tags, while a tag still
      // missing a host keeps its remaining budget.
      for (const tag of hits) probeSettled.add(tag);
      rescan();
      // Everything this page was waiting for just activated: stop here rather
      // than spend a further attempt rediscovering an empty pending set. A
      // partial hit keeps probing — the island that just landed may itself be
      // the component that creates the next late host.
      if (pendingTags().length === 0) {
        probeDone = true;
        return;
      }
    }
    probeAttempt++;
    if (probeAttempt >= LATE_HOST_MAX_ATTEMPTS || now - probeStartTs >= LATE_HOST_WINDOW_MS) {
      // Recomputed, not the attempt's opening set: a partial hit settled some
      // tags, and the diagnostic must name only what is genuinely stranded.
      endWindow(pendingTags(), now);
      return;
    }
    scheduleProbe(LATE_HOST_DELAYS_MS[probeAttempt]);
  }

  /**
   * The current window is spent. Spend another only if the page gives a
   * reason to: island modules still resolving means client code is still
   * running, which is the honest signal that a late host may still arrive.
   * The wait for that signal is itself bounded — a page whose islands all
   * settled before the window closed gets its diagnostic now, not never.
   */
  function endWindow(pending: readonly string[], now: number): void {
    if (probeWindow >= LATE_HOST_MAX_WINDOWS || now - probeStartedAt >= LATE_HOST_MAX_TOTAL_MS) {
      giveUp(pending, now);
      return;
    }
    probeAwaiting = true;
    // The wait is bounded on purpose: no activity means the diagnostic fires
    // from this timer rather than never.
    scheduleProbe(Math.min(LATE_HOST_WINDOW_MS, probeStartedAt + LATE_HOST_MAX_TOTAL_MS - now));
  }

  /**
   * An island factory resolved. Only meaningful while the probe is waiting
   * out a spent window: it opens a fresh one, which is what keeps a slow
   * third-party chunk inside the budget without widening the budget itself.
   */
  function onIslandLoadActivity(): void {
    if (probeDone || !probeAwaiting) return;
    const now = probeNow();
    // A continuation window is a probe entry too (FR-03). A page resumed from
    // a suspend/throttle can deliver this activity long after the absolute
    // cap; reopening a window here would schedule a scan the contract forbids
    // and could still activate a host the cap already ruled out. Retire the
    // chain with the same observable signal instead.
    if (now - probeStartedAt >= LATE_HOST_MAX_TOTAL_MS) {
      probeAgeOut(now);
      return;
    }
    probeAwaiting = false;
    probeWindow++;
    probeAttempt = 0;
    probeStartTs = now;
    // The spent window's give-up timer is replaced by the new window's first
    // step, so a fresh window never leaves the old deadline armed behind it.
    win.clearTimeout(probeTimer);
    probePending = false;
    scheduleProbe(0);
  }

  /**
   * The absolute wall-clock cap has passed. Every probe entry and every
   * continuation-window entry funnels here: retire the chain, leave the
   * factories unconsumed, and emit the same one give-up signal. No DOM scan
   * and no activation happens on this path — the cap is a hard stop, not a
   * question answered from the tree.
   */
  function probeAgeOut(now: number): void {
    const stranded = pendingTags();
    probeDone = true;
    probeAwaiting = false;
    win.clearTimeout(probeTimer);
    probePending = false;
    if (stranded.length > 0) giveUp(stranded, now);
  }

  /**
   * The budget is spent with factories still unconsumed. This is NOT a drop:
   * those factories stay in the map, so a media change or a later morph
   * rescan still activates them. It is also not automatically a failure — an
   * app may legitimately declare islands a page never hosts — so the signal
   * is an event a consumer can opt into, never a console warning on every
   * page. Treat `pending` as a hint to cross-check against the page's own
   * island manifest, never as an error by itself.
   */
  function giveUp(pending: readonly string[], now: number): void {
    probeDone = true;
    probeAwaiting = false;
    doc.dispatchEvent(
      new win.CustomEvent('open:island-host-timeout', {
        detail: {
          pending: pending,
          attempts: probeAttempt,
          elapsedMs: now - probeStartedAt,
        },
      }),
    );
  }

  /**
   * Start the one probe chain this page gets. Idempotent, and a no-op when
   * nothing is pending — so it is safe to call from every rescan.
   */
  function armProbe(): void {
    if (probeArmed || probeDone) return;
    if (pendingTags().length === 0) return;
    probeArmed = true;
    probeStartedAt = probeNow();
    probeStartTs = probeStartedAt;
    probeWindow = 1;
    scheduleProbe(0);
  }

  /**
   * The scheduler's public rescan, plus the arm. The arm only decides whether
   * the probe should be running, and arming twice is a no-op.
   */
  function rescanAndArm(): void {
    rescan();
    armProbe();
  }

  // Register the ready-time scan last: the rescan reads the media/idle state
  // above, and a synchronous `readyState` call must see it initialized.
  const hasVisible = strategies.visible.length > 0;
  if (hasVisible) onReady(rescanAndArm);

  // Arm last. When the ready-time visible scan is still waiting on
  // DOMContentLoaded, that scan owns the first look and this must not race it
  // — pre-empting it would attach observers before the document is ready and
  // break the deferral the ready scan promises. The arm rides that scan
  // instead: `rescanAndArm` runs it the moment DOMContentLoaded arrives. A
  // page with no islands and a page that hosted everything both leave here
  // with no timer at all.
  if (!hasVisible || doc.readyState !== 'loading') armProbe();

  return { observeVisible: rescanAndArm };
}
