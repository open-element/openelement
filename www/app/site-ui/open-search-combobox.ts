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

/** zh display names for the known first path segments; unknown segments pass through. */
const ZH_SECTIONS: Record<string, string> = {
  guide: '指南',
  architecture: '架构',
  blog: '博客',
  docs: '文档',
  reference: 'API 参考',
  roadmap: '路线图',
  changelog: '更新日志',
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
    indexMissing: 'Search index not found — run pnpm --dir www run pagefind to generate it',
  },
  zh: {
    noResults: (query: string) => `未找到“${query}”的相关结果`,
    indexMissing: '未找到搜索索引——请运行 pnpm --dir www run pagefind 生成',
  },
};

function copy(): { noResults: (query: string) => string; indexMissing: string } {
  return COPY[searchLocale()] ?? COPY.en;
}

function plainExcerpt(excerpt: string): string {
  const entities: Record<string, string> = {
    lt: '<',
    gt: '>',
    amp: '&',
    quot: '"',
    '#39': "'",
  };
  return excerpt
    .replace(/<\/?mark>/g, '')
    .replace(/&(lt|gt|amp|quot|#39);/g, (match, name: string) => entities[name] ?? match);
}

/** Project raw Pagefind data into the declarative hit view-models. */
function toHit(hit: { url: string; meta?: { title?: string }; excerpt?: string }): SearchHit {
  return {
    key: hit.url,
    href: hit.url,
    section: sectionFor(hit.url),
    title: hit.meta?.title || hit.url,
    text: plainExcerpt(hit.excerpt ?? ''),
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
      offset: { mainAxis: 6 },
    },
    onInputValueChange(details) {
      // Only real typing drives Pagefind; machine-driven value writes
      // (selection clear, close reset) come back with reason 'script'.
      if (details.reason === 'input-change' || details.reason === undefined) {
        runtime.runSearch(host);
      }
    },
    onOpenChange(details) {
      const target = overlay(host);
      if (details.open) {
        if (target) target.hidden = false;
        runtime.loadIndex(host);
      } else if (target && !target.hidden) {
        callbacks.onClose(host);
      }
    },
  }));
  machine.start();

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
    if (positioner && typeof positionerStyle === 'string') {
      for (const declaration of positionerStyle.split(';')) {
        const separator = declaration.indexOf(':');
        if (separator === -1) continue;
        positioner.style.setProperty(
          declaration.slice(0, separator).trim(),
          declaration.slice(separator + 1).trim(),
        );
      }
    }
    apply('content', `#${IDS.content}`, api.getContentProps());
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
      showMessage(nextHost, copy().indexMissing);
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
      showMessage(nextHost, searchChromeStrings(searchLocale()).emptyMessage);
      runtime.syncHits(nextHost, []);
      return;
    }
    // Loading skeleton: the index loads once, asynchronously. When no results
    // are on screen, mark the round searching so the view holds a skeleton
    // instead of stale content; a re-search over visible hits keeps them
    // until the new round lands (no skeleton flash). The sequence guard keeps
    // a slow round from overwriting a newer one.
    if (!nextHost.hasHits) nextHost.searching = true;
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
          runtime.syncHits(nextHost, []);
          return;
        }
        nextHost.hits = hits.map(toHit);
        nextHost.hasHits = true;
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
      if (api.open) api.setOpen(false, 'script');
      api.setInputValue('', 'script');
    },
    runSearch,
    loadIndex,
    syncHits(nextHost, hits) {
      machine.updateProps({
        collection: combobox.collection({
          items: hits.map((hit) => ({ value: hit.key, label: hit.title })),
        }),
      });
      scheduleSync();
    },
    teardown() {
      // From here on no continuation of this runtime acts: queries drop,
      // queued syncs flush no-ops, and the host's pipeline goes away so a
      // reconnect builds a fresh one (stale index completions compare
      // against the captured pipeline and are dropped — they cannot
      // pollute the new install).
      disposed = true;
      ownedPipeline.searchSequence++;
      if (pipelines.get(host) === ownedPipeline) pipelines.delete(host);
      unsubscribe();
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
