/**
 * The open-search runtime — DYNAMICALLY IMPORTED.
 *
 * This module carries every byte the idle site can defer: the @zag-js/*
 * combobox stack (state machine + ARIA + positioning via @zag-js/popper,
 * which wraps @floating-ui/dom) AND the Pagefind search pipeline. The
 * controller (open-search-controller.ts) pulls it in on the first dialog
 * open; zero runtime bytes ship to a reader who never opens search — that is
 * what holds the site's client-JS SLO (www/site-budget.ts).
 *
 * Division of ownership: the machine owns the widget's open/highlight state
 * and the whole ARIA graph (role=combobox input, role=listbox results,
 * aria-activedescendant); this module owns the search pipeline (index load,
 * query rounds, hit projection); the controller owns the dialog-level modal
 * state.
 */
import * as combobox from '@zag-js/combobox';
import { normalizeProps, spreadProps, VanillaMachine } from '@zag-js/vanilla';
import { stripLocalePrefix } from '#site-ui/link.ts';
import {
  announce,
  IDS,
  input,
  overlay,
  searchLocale,
  showMessage,
  type PagefindModule,
  type SearchHit,
  type SearchHost,
} from './open-search-shared.ts';
import { searchChromeStrings } from './chrome-strings.ts';
import { buildSearchExcerpt } from './open-search-excerpt.ts';

/** zh display names for the known first path segments; unknown segments pass through. */
const ZH_SECTIONS: Record<string, string> = {
  guide: '指南',
  architecture: '架构',
  docs: '文档',
  reference: 'API 参考',
  roadmap: '路线图',
  changelog: '发布状态',
  blog: '博客',
};

function sectionFor(url: string): string {
  const first = stripLocalePrefix(url).split('/').filter(Boolean)[0] ?? '';
  if (searchLocale() === 'zh') return ZH_SECTIONS[first] ?? (first === '' ? '首页' : first);
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : 'Home';
}

/** spreadProps scopes its per-node attr diff by this id. */
const MACHINE_SCOPE = 'open-search';

export interface RuntimeCallbacks {
  /** The controller's dialog close (machine dismissals funnel here). */
  onClose: (host: SearchHost) => void;
}

export interface SearchRuntime {
  /** Open the combobox popup (the dialog-open path). */
  open: () => void;
  /** Close the popup and reset the machine's input mirror. */
  close: () => void;
  /** Load (once) and run a Pagefind round against the field's value. */
  runSearch: (host: SearchHost) => void;
  /** Load the Pagefind index if it is not loaded yet. */
  loadIndex: (host: SearchHost) => void;
  /**
   * Re-apply machine props and mirror the rendered hits into the machine's
   * collection, so keyboard traversal walks the list the view shows.
   */
  syncHits: (host: SearchHost, hits: SearchHit[]) => void;
  /**
   * Teardown: remove listeners AND every machine-written attribute — the
   * compiled runtime re-claims its SSR markup when the host re-connects and
   * fails closed on any attribute the program does not declare.
   */
  teardown: () => void;
}

/** Per-host search-pipeline state (index handle + in-flight round guard). */
interface PipelineState {
  pagefind: PagefindModule | null;
  loaded: boolean;
  searchSequence: number;
  /**
   * How many times the Pagefind entry has been imported. Each retry imports
   * a fresh URL: a failed dynamic import stays failed in the module map for
   * its exact specifier, so only a cache-busting query turns the next open
   * into a real network retry instead of a memoized rejection.
   */
  loadAttempts: number;
}

const pipelines = new WeakMap<SearchHost, PipelineState>();

/**
 * Dynamic search-time messages. Chrome copy (trigger label, placeholder, …)
 * is server-rendered by the island in the page locale via
 * searchChromeStrings — nothing here rewrites it at runtime.
 */
const COPY: Record<string, { noResults: (query: string) => string; indexMissing: string }> = {
  en: {
    noResults: (query: string) => `No results found for “${query}”`,
    // When the index is missing, show readers a recovery message. The build
    // command lives in the console warning for maintainers.
    indexMissing: 'Search is unavailable right now. Browse the docs index, or try again shortly.',
  },
  zh: {
    noResults: (query: string) => `未找到“${query}”的相关结果`,
    indexMissing: '搜索暂时不可用。请浏览文档索引，或稍后再试。',
  },
};

function copy(): { noResults: (query: string) => string; indexMissing: string } {
  return COPY[searchLocale()] ?? COPY.en;
}

/**
 * The input's aria-activedescendant points to a rendered option while the
 * machine has a highlight and the dialog is open. Closing keeps the previous highlight in Zag's context (the
 * machine deliberately remembers it across open/close); clearing it here
 * makes the next synchronous prop spread REMOVE the attribute. A direct
 * removeAttribute is also issued because the close path must be correct even
 * if no prop flush follows (for example when the runtime is torn down).
 */
function clearActiveDescendant(host: SearchHost): void {
  const field = input(host);
  if (field?.hasAttribute('aria-activedescendant')) field.removeAttribute('aria-activedescendant');
}

/**
 * Project raw Pagefind data into the declarative hit view models.
 * `buildSearchExcerpt` owns the sentence boundary, metadata stripping, and
 * match split. The view renders the three strings using a `<mark>`.
 */
function toHit(
  hit: { url: string; meta?: { title?: string }; excerpt?: string; raw_content?: string },
  query: string,
): SearchHit {
  const excerpt = buildSearchExcerpt(
    hit.raw_content ?? '',
    query,
    searchLocale(),
    hit.excerpt ?? '',
  );
  return {
    key: hit.url,
    href: hit.url,
    section: sectionFor(hit.url),
    title: hit.meta?.title || hit.url,
    text: excerpt.text,
    before: excerpt.before,
    match: excerpt.match,
    after: excerpt.after,
  };
}

export function connectSearchRuntime(host: SearchHost, callbacks: RuntimeCallbacks): SearchRuntime {
  let pipeline = pipelines.get(host);
  if (!pipeline) {
    pipeline = { pagefind: null, loaded: false, searchSequence: 0, loadAttempts: 0 };
    pipelines.set(host, pipeline);
  }
  const ownedPipeline = pipeline;
  /**
   * Set by teardown. Every async continuation (query rounds, the Pagefind
   * import, queued syncs) checks it before touching the DOM, so work
   * scheduled by a removed runtime can never act on a reconnected host.
   */
  let disposed = false;

  const machine = new VanillaMachine(combobox.machine, () => ({
    id: MACHINE_SCOPE,
    ids: IDS,
    getRootNode: () => host.getRootNode(),
    placeholder: host.getAttribute('placeholder') ?? '',
    // Typing opens the popup; the machine's collection mirrors the rendered
    // hits (syncHits). Enter on a highlighted anchor item walks the machine's
    // default navigate (clickIfLink) — one navigation path shared with
    // pointer clicks on the result links.
    openOnClick: false,
    loopFocus: true,
    positioning: {
      placement: 'bottom-start' as const,
      sameWidth: true,
      strategy: 'fixed' as const,
      // Place the popover flush with the panel so the surface is continuous.
      offset: { mainAxis: 0 },
    },
    onInputValueChange(details) {
      // Only real typing drives Pagefind; machine-driven value writes
      // (selection clear, close reset) come back with reason 'script'.
      if (details.reason === 'input-change' || details.reason === undefined) {
        // Search first, then ensure the index is on its way. Already-loaded
        // runtimes answer from the cached module (loadIndex no-ops); a cold
        // runtime gets its skeleton from runSearch's pre-load branch and the
        // load's completion re-drives the same query (see loadIndex).
        runtime.runSearch(host);
        runtime.loadIndex(host);
      }
    },
    // Moving focus from the input to the close button, a suggestion chip, or
    // the docs link keeps the dialog open.
    // Zag's content-scoped focus-outside would otherwise close the popup — and
    // onOpenChange's false branch closes the whole dialog — before Tab can
    // reach those controls. Pointer/focus outside the whole host still closes.
    onFocusOutside(event) {
      const target = event.detail.target;
      const dialog = host.querySelector('.panel');
      if (dialog && target instanceof Node && dialog.contains(target)) event.preventDefault();
    },
    onInteractOutside(event) {
      const target = event.detail.target;
      const dialog = host.querySelector('.panel');
      if (dialog && target instanceof Node && dialog.contains(target)) event.preventDefault();
    },
    onOpenChange(details) {
      const target = overlay(host);
      if (details.open) {
        if (target) target.hidden = false;
        // The idle hint ("type at least 2 characters") is already in the
        // server-rendered tree, and every close restores it. Re-running the
        // empty query here only rewrote the same host props and scheduled a
        // render that could land on top of the reader tabbing through the
        // recovery controls (focus fell to <body>, so the trap restarted at
        // the input). Only a non-empty field has a query worth re-driving.
        // Wait for the first query before fetching the index.
        if ((input(host)?.value.trim().length ?? 0) >= 2) runtime.runSearch(host);
      } else if (target && !target.hidden) {
        callbacks.onClose(host);
      }
    },
  }));
  machine.start();

  /**
   * Create the in-field clear control with the lazy runtime. The input is
   * unavailable until it connects, so deferring this button keeps the
   * always-shipped search island smaller.
   */
  const clearControl = host.ownerDocument.createElement('button');
  clearControl.type = 'button';
  clearControl.id = IDS.clear;
  clearControl.className = 'search-clear';
  // Give the field-clear control a text label to distinguish it from the
  // dialog close icon.
  const clearLabel = searchChromeStrings(searchLocale()).clearLabel;
  clearControl.setAttribute('aria-label', clearLabel);
  clearControl.textContent = clearLabel;
  clearControl.title = clearLabel;
  const onClear = (): void => {
    const field = input(host);
    if (!field) return;
    field.value = '';
    field.focus({ preventScroll: true });
    field.dispatchEvent(new Event('input', { bubbles: true }));
  };
  clearControl.addEventListener('click', onClear);
  const control = host.querySelector(`#${IDS.control}`);
  const closeControl = host.querySelector(`#${IDS.close}`);
  if (control && closeControl) control.insertBefore(clearControl, closeControl);

  const cleanups = new Map<string, () => void>();
  /**
   * Attribute snapshot per machine-touched node (see teardown): spreadProps's
   * own cleanup removes listeners only.
   */
  const touched = new Map<string, { node: Element; original: Set<string> }>();

  /** Coalesce machine ticks into one microtask prop application. */
  let syncQueued = false;
  const scheduleSync = (): void => {
    if (syncQueued || disposed) return;
    syncQueued = true;
    queueMicrotask(() => {
      syncQueued = false;
      // The flush can land after teardown removed the machine's listeners;
      // a post-teardown flush must not re-apply attributes.
      if (disposed) return;
      sync();
    });
  };

  const unsubscribe = machine.subscribe(() => scheduleSync());

  /** Check whether more results remain below the scrollable list. */
  const syncResultsOverflow = (): void => {
    if (disposed) return;
    const list = host.querySelector<HTMLElement>(`#${IDS.content}`);
    if (!list) return;
    const more = list.scrollHeight - list.scrollTop - list.clientHeight > 2;
    if (more) list.setAttribute('data-scrollable', '');
    else list.removeAttribute('data-scrollable');
  };

  const onResultsScroll = (event: Event): void => {
    const target = event.target;
    if (target instanceof HTMLElement && target.id === IDS.content) syncResultsOverflow();
  };
  host.addEventListener('scroll', onResultsScroll, true);

  /**
   * The standard property keys this runtime last wrote onto the positioner
   * from the shell style. The shell key set varies with the machine state
   * (e.g. `pointer-events` appears only in the unpositioned string —
   * toStyleString skips undefined values), and a per-declaration write never
   * removes a key, so the diff in sync() clears the vanished ones. `--*`
   * custom properties are never tracked: they belong to @zag-js/popper's
   * imperative writes into the same style attribute.
   */
  let positionerShell: { node: Element; keys: Set<string> } | null = null;

  const sync = (): void => {
    const api = combobox.connect(machine.service, normalizeProps);
    const apply = (key: string, selector: string, props: Record<string, unknown>) => {
      const node = host.querySelector(selector);
      if (!node) return;
      if (!touched.has(key)) {
        touched.set(key, { node, original: new Set(node.getAttributeNames()) });
      }
      cleanups.get(key)?.();
      cleanups.set(key, spreadProps(node, props, MACHINE_SCOPE));
      return node;
    };
    apply('control', `#${IDS.control}`, api.getControlProps());
    // The DOM input owns its value: the machine's inputValue lags one
    // microtask behind the user's keystroke (the machine learns it from the
    // input event payload), so re-applying `value` here would wipe the
    // character the browser just inserted. Every other input prop — role,
    // aria-*, the keydown/focus/change listeners — still comes from the
    // machine; the controller clears the field explicitly on close.
    const inputProps: Record<string, unknown> = { ...api.getInputProps() };
    delete inputProps.value;
    apply('input', `#${IDS.input}`, inputProps);
    // Zag double-writes the positioner's style: the static shell comes in via
    // getPositionerProps() while @zag-js/popper writes --x/--y/--reference-width/
    // --z-index imperatively into the same style attribute — some of those
    // writes are memoized one-shots. A wholesale style replacement (the
    // setAttribute path spreadProps uses) erases them for good, so the shell
    // lands per declaration and both writers' values coexist.
    const positionerProps: Record<string, unknown> = { ...api.getPositionerProps() };
    const positionerStyle = positionerProps.style;
    delete positionerProps.style;
    const positioner = apply('positioner', `#${IDS.positioner}`, positionerProps);
    // HTMLElement narrowing: the style declarations below need CSSStyleDeclaration.
    if (positioner instanceof HTMLElement && typeof positionerStyle === 'string') {
      if (positionerShell?.node !== positioner) {
        positionerShell = { node: positioner, keys: new Set() };
      }
      const shellKeys = positionerShell.keys;
      const written = new Set<string>();
      for (const declaration of positionerStyle.split(';')) {
        const separator = declaration.indexOf(':');
        if (separator === -1) continue;
        const property = declaration.slice(0, separator).trim();
        positioner.style.setProperty(property, declaration.slice(separator + 1).trim());
        written.add(property);
      }
      // The shell's ownership covers keys it stopped emitting: a standard
      // property absent from the current shell string was written by an
      // earlier sync and must go. Custom properties are popper's — untouched.
      for (const key of shellKeys) {
        if (!written.has(key) && !key.startsWith('--')) positioner.style.removeProperty(key);
      }
      shellKeys.clear();
      for (const key of written) shellKeys.add(key);
    }
    const content = apply('content', `#${IDS.content}`, api.getContentProps());
    // The machine owns role=listbox on the results surface, but the role is
    // only valid while option children exist: the idle ("type at least 2
    // characters") and no-results states render a status message, not
    // options, and axe's aria-required-children (critical) fires on a
    // listbox without option/group children (P2 audit D2). Populate the role
    // with the same options the view actually shows: absent until Pagefind
    // returns, restored when the hit anchors render. Both directions are
    // written explicitly because spreadProps diffs attributes against its own
    // snapshot and cannot observe a manual override.
    if (content instanceof HTMLElement) {
      const hasOptions = content.querySelector('a.result') !== null;
      if (hasOptions) {
        if (content.getAttribute('role') !== 'listbox') content.setAttribute('role', 'listbox');
      } else {
        content.removeAttribute('role');
      }
    }
    apply('label', `#${IDS.label}`, api.getLabelProps());
    // Per-hit option props: the anchors are declaratively rendered by the
    // island, so they are (re)spread after every render that changed them.
    const stale = [...cleanups.keys()].filter((key) => key.startsWith('item:'));
    for (const key of stale) {
      cleanups.get(key)?.();
      cleanups.delete(key);
      touched.delete(key);
    }
    for (const node of host.querySelectorAll<HTMLAnchorElement>('a.result')) {
      const hit = host.hits.find((candidate) => candidate.href === node.getAttribute('href'));
      if (!hit) continue;
      const key = `item:${hit.key}`;
      if (!touched.has(key)) {
        touched.set(key, { node, original: new Set(node.getAttributeNames()) });
      }
      cleanups.get(key)?.();
      cleanups.set(
        key,
        spreadProps(
          node,
          api.getItemProps({ item: { value: hit.key, label: hit.title } }),
          MACHINE_SCOPE,
        ),
      );
    }
    // The rendered hit list is committed after this sync's prop flush; one
    // frame later the scroller has its final rows and can tell the fade
    // whether a whole row remains below the fold.
    globalThis.requestAnimationFrame(syncResultsOverflow);
  };

  async function loadIndex(nextHost: SearchHost): Promise<void> {
    const state = pipelines.get(nextHost);
    if (!state || state !== ownedPipeline || disposed || state.loaded) return;
    state.loaded = true;
    try {
      const attempt = ++state.loadAttempts;
      const pagefindUrl =
        attempt === 1 ? '/pagefind/pagefind.js' : `/pagefind/pagefind.js?retry=${attempt}`;
      const module = (await import(/* @vite-ignore */ pagefindUrl)) as PagefindModule;
      // The index is segmented per language (pagefind-entry.json lists en and
      // zh separately). Pagefind's init() selects the segment from
      // document.documentElement.lang — the same source the copy above uses —
      // so a zh page searches the zh segment with no extra filtering here.
      await module.init?.();
      // The load outlives dialog closes; it must still belong to THIS
      // runtime's pipeline. A teardown deleted the pipeline and a reconnect
      // created a fresh one — the stale module never writes into the new
      // install (the new install runs its own import; the browser cache
      // dedupes the bytes).
      const current = pipelines.get(nextHost);
      if (disposed || current !== ownedPipeline) return;
      state.pagefind = module;
      // A close between the load starting and finishing invalidates the
      // session that requested it: cache the module, but do not start a
      // search for a closed dialog (the next open re-drives it).
      if (overlay(nextHost)?.hidden !== false) return;
      runtime.runSearch(nextHost);
    } catch {
      // Only this pipeline's failure path may reset its own flag and message;
      // a teardown mid-load leaves the dead object alone.
      if (disposed || pipelines.get(nextHost) !== ownedPipeline) return;
      state.loaded = false;
      // The dialog may have closed while the fetch was failing — a closed
      // dialog must not receive the message either.
      if (overlay(nextHost)?.hidden !== false) return;
      // Show the localized recovery message in the UI and log the build
      // command once per failed index load.
      console.warn('[open-search] search index missing — run pnpm --dir www run pagefind');
      showMessage(nextHost, copy().indexMissing);
      // Clear results through the collection update so aria-activedescendant
      // cannot point to an option that no longer renders.
      runtime.syncHits(nextHost, []);
      announce(nextHost, copy().indexMissing);
    }
  }

  function runSearch(nextHost: SearchHost): void {
    const state = pipelines.get(nextHost);
    if (!state || state !== ownedPipeline || disposed) return;
    const query = input(nextHost)?.value.trim() ?? '';
    if (query.length < 2) {
      // Bump the sequence even on this early return: an in-flight request
      // must not land afterwards and re-fill the results.
      state.searchSequence++;
      const emptyMessage = searchChromeStrings(searchLocale()).emptyMessage;
      showMessage(nextHost, emptyMessage);
      announce(nextHost, emptyMessage);
      runtime.syncHits(nextHost, []);
      return;
    }
    // Loading skeleton: the index loads once, asynchronously. When no results
    // are on screen, mark the round searching so the view holds a skeleton
    // instead of stale content; a re-search over visible hits keeps them
    // until the new round lands (no skeleton flash). The sequence guard keeps
    // a slow round from overwriting a newer one.
    if (!nextHost.hasHits) nextHost.searching = true;
    announce(nextHost, searchChromeStrings(searchLocale()).loadingMessage);
    if (!state.pagefind) return;

    const sequence = ++state.searchSequence;
    void state.pagefind
      .search(query)
      .then((response) => Promise.all(response.results.slice(0, 10).map((result) => result.data())))
      .then((hits) => {
        // Stale round (a newer query superseded it, or a close/reopen moved
        // the sequence) or a torn-down runtime: drop the result instead of
        // writing it.
        if (
          sequence !== state.searchSequence ||
          disposed ||
          pipelines.get(nextHost) !== ownedPipeline
        ) {
          return;
        }
        nextHost.searching = false;
        if (hits.length === 0) {
          showMessage(nextHost, copy().noResults(query));
          announce(nextHost, copy().noResults(query));
          runtime.syncHits(nextHost, []);
          return;
        }
        const chrome = searchChromeStrings(searchLocale());
        nextHost.hits = hits.map((hit) => toHit(hit, query));
        nextHost.hasHits = true;
        nextHost.resultCount = chrome.resultCount(nextHost.hits.length);
        announce(nextHost, nextHost.resultCount);
        runtime.syncHits(nextHost, nextHost.hits);
      })
      .catch(() => {
        // A failed round keeps whatever the newest round owns: the CURRENT
        // round's failure keeps the previous result list and only clears its
        // own skeleton; a superseded round's failure must not clear a newer
        // round's skeleton.
        if (
          sequence !== state.searchSequence ||
          disposed ||
          pipelines.get(nextHost) !== ownedPipeline
        ) {
          return;
        }
        nextHost.searching = false;
      });
  }

  const runtime: SearchRuntime = {
    open() {
      machine.send({ type: 'OPEN' });
      sync();
    },
    close() {
      // Invalidate every in-flight round FIRST: any result landing after this
      // point is stale and must not re-fill the closed dialog.
      ownedPipeline.searchSequence++;
      const api = combobox.connect(machine.service, normalizeProps);
      // Clear the highlight on every dismissal (Esc, close button, backdrop, result navigation) so
      // the input cannot keep pointing at an option node after the overlay
      // is hidden. The prop spread that follows removes the attribute.
      api.clearHighlightValue();
      clearActiveDescendant(host);
      if (api.open) api.setOpen(false, 'script');
      api.setInputValue('', 'script');
    },
    runSearch,
    loadIndex,
    syncHits(nextHost, hits) {
      // A highlight is only meaningful while its option is in the
      // rendered set. When the list is cleared (close, idle, no results,
      // index failure) or replaced without the highlighted key, drop it
      // BEFORE the next prop spread so aria-activedescendant is removed
      // rather than re-established against a node that no longer exists.
      const api = combobox.connect(machine.service, normalizeProps);
      if (api.highlightedValue && !hits.some((hit) => hit.key === api.highlightedValue)) {
        api.clearHighlightValue();
        clearActiveDescendant(nextHost);
      }
      machine.updateProps({
        collection: combobox.collection({
          items: hits.map((hit) => ({ value: hit.key, label: hit.title })),
        }),
      });
      scheduleSync();
      // The view's keyed hit list commits on a later frame than the
      // microtask above. Re-spread once after that commit so the items
      // receive their role=option / id / aria wiring even when the first
      // flush ran against the previous (empty) row set.
      globalThis.requestAnimationFrame(() => {
        if (!disposed) sync();
      });
    },
    teardown() {
      // From here on no continuation of this runtime acts: queries drop,
      // queued syncs flush no-ops, and the host's pipeline goes away so a
      // reconnect builds a fresh one (stale index completions compare
      // against the captured pipeline and are dropped — they cannot
      // pollute the new install).
      disposed = true;
      ownedPipeline.searchSequence++;
      clearActiveDescendant(host);
      if (pipelines.get(host) === ownedPipeline) pipelines.delete(host);
      unsubscribe();
      host.removeEventListener('scroll', onResultsScroll, true);
      clearControl.removeEventListener('click', onClear);
      clearControl.remove();
      for (const cleanup of cleanups.values()) cleanup();
      cleanups.clear();
      for (const { node, original } of touched.values()) {
        for (const name of node.getAttributeNames()) {
          if (!original.has(name)) node.removeAttribute(name);
        }
      }
      touched.clear();
      machine.stop();
    },
  };
  return runtime;
}
