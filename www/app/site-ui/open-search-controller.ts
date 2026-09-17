/** Browser-only behavior used by the open-search island. */
import { stripLocalePrefix } from '@openelement/site-ui/link.ts';
import { searchChromeStrings } from './chrome-strings.ts';

interface PagefindResultData {
  url: string;
  meta?: { title?: string };
  excerpt?: string;
}

interface PagefindSearchResult {
  data: () => Promise<PagefindResultData>;
}

interface PagefindModule {
  init?: () => Promise<void>;
  search: (query: string) => Promise<{ results: PagefindSearchResult[] }>;
}

/** One rendered search hit; the island view maps this array declaratively. */
export interface SearchHit {
  key: string;
  href: string;
  section: string;
  title: string;
  text: string;
}

interface SearchState {
  pagefind: PagefindModule | null;
  loaded: boolean;
  searchSequence: number;
  keydown: (event: KeyboardEvent) => void;
}

/** The island element with its compiled property surface (open-search.tsx). */
type SearchHost = HTMLElement & {
  locale: string;
  message: string;
  hasHits: boolean;
  hits: SearchHit[];
  searching: boolean;
};

const states = new WeakMap<SearchHost, SearchState>();

/**
 * Dynamic search-time messages. Chrome copy (trigger label, placeholder, …)
 * is server-rendered by the island in the page locale via
 * searchChromeStrings — nothing here rewrites it at runtime.
 * English strings are pinned verbatim by www/e2e/search.spec.ts — do not
 * reword them without updating that spec.
 */
interface SearchCopy {
  noResults: (query: string) => string;
  indexMissing: string;
}

const COPY: Record<'en' | 'zh', SearchCopy> = {
  en: {
    noResults: (query: string) => `No results found for “${query}”`,
    indexMissing: 'Search index not found — run deno task build to generate it',
  },
  zh: {
    noResults: (query: string) => `未找到“${query}”的相关结果`,
    indexMissing: '未找到搜索索引——请运行 deno task build 生成',
  },
};

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

/** The page locale is the <html lang> contract (seo-meta.spec.ts pins it). */
function searchLocale(): 'en' | 'zh' {
  return document.documentElement.lang.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function copy(): SearchCopy {
  return COPY[searchLocale()];
}

function overlay(host: SearchHost): HTMLElement | null {
  return host.querySelector<HTMLElement>('.overlay');
}

function input(host: SearchHost): HTMLInputElement | null {
  return host.querySelector<HTMLInputElement>('.search-input');
}

function showMessage(host: SearchHost, message: string): void {
  host.hits = [];
  host.hasHits = false;
  host.searching = false;
  // :empty guard: the empty box must never render blank — fall back to the
  // idle copy when a caller passes nothing.
  host.message = message || copy().empty;
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

function sectionFor(url: string): string {
  const first = stripLocalePrefix(url).split('/').filter(Boolean)[0] ?? '';
  if (searchLocale() === 'zh') return ZH_SECTIONS[first] ?? (first === '' ? '首页' : first);
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : 'Home';
}

/** Project raw Pagefind data into the declarative hit view-models. */
function toHit(hit: PagefindResultData): SearchHit {
  return {
    key: hit.url,
    href: hit.url,
    section: sectionFor(hit.url),
    title: hit.meta?.title || hit.url,
    text: plainExcerpt(hit.excerpt ?? ''),
  };
}

async function runSearch(host: SearchHost): Promise<void> {
  const state = states.get(host);
  const query = input(host)?.value.trim() ?? '';
  if (!state || query.length < 2) {
    showMessage(host, searchChromeStrings(searchLocale()).emptyMessage);
    return;
  }
  // Loading skeleton: the index loads once, asynchronously. When no results
  // are on screen, mark the round searching so the view holds a skeleton
  // instead of stale content; a re-search over visible hits keeps them until
  // the new round lands (no skeleton flash). The sequence guard keeps a slow
  // round from overwriting a newer one.
  if (!host.hasHits) host.searching = true;
  if (!state.pagefind) return;

  const sequence = ++state.searchSequence;
  try {
    const response = await state.pagefind.search(query);
    const hits = await Promise.all(response.results.slice(0, 10).map((result) => result.data()));
    if (sequence !== state.searchSequence) return;
    host.searching = false;
    if (hits.length === 0) {
      showMessage(host, copy().noResults(query));
      return;
    }
    host.hits = hits.map(toHit);
    host.hasHits = true;
  } catch {
    // Keep the previous result list when an individual Pagefind chunk fails.
    host.searching = false;
  }
}

async function loadPagefind(host: SearchHost): Promise<void> {
  const state = states.get(host);
  if (!state || state.loaded) return;
  state.loaded = true;
  try {
    const pagefindUrl = '/pagefind/pagefind.js';
    const module = (await import(/* @vite-ignore */ pagefindUrl)) as PagefindModule;
    // The index is segmented per language (pagefind-entry.json lists en and
    // zh separately). Pagefind's init() selects the segment from
    // document.documentElement.lang — the same source the copy above uses —
    // so a zh page searches the zh segment with no extra filtering here.
    await module.init?.();
    state.pagefind = module;
    await runSearch(host);
  } catch {
    state.loaded = false;
    showMessage(host, copy().indexMissing);
  }
}

export function installSearch(host: SearchHost): void {
  if (states.has(host)) return;
  const keydown = (event: KeyboardEvent): void => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      overlay(host)?.hidden ? openSearch(host) : closeSearch(host);
    } else if (event.key === 'Escape' && !overlay(host)?.hidden) {
      closeSearch(host);
    }
  };
  states.set(host, { pagefind: null, loaded: false, searchSequence: 0, keydown });
  globalThis.addEventListener('keydown', keydown);
}

export function uninstallSearch(host: SearchHost): void {
  const state = states.get(host);
  if (!state) return;
  globalThis.removeEventListener('keydown', state.keydown);
  states.delete(host);
}

export function openSearch(host: SearchHost): void {
  const target = overlay(host);
  if (!target) return;
  target.hidden = false;
  void loadPagefind(host);
  requestAnimationFrame(() => input(host)?.focus());
}

export function closeSearch(host: SearchHost): void {
  const target = overlay(host);
  if (target) target.hidden = true;
  const field = input(host);
  if (field) field.value = '';
  const state = states.get(host);
  if (state) state.searchSequence++;
  showMessage(host, copy().empty);
}

export function closeSearchOnBackdrop(host: SearchHost, event: Event): void {
  const inPanel = event.composedPath().some((node) =>
    node instanceof Element && node.classList.contains('panel')
  );
  if (!inPanel) closeSearch(host);
}

/**
 * Result-click dismissal, delegated from the results container: the compiled
 * list Region cannot carry per-item event handlers, so the view binds one
 * onClick on `.results` and this handler closes the search when the click
 * lands on a result link (the old per-link once-listener's contract).
 */
export function closeSearchFromResults(host: SearchHost, event: Event): void {
  const onResult = event.composedPath().some((node) =>
    node instanceof Element && node.classList.contains('result')
  );
  if (onResult) closeSearch(host);
}

export function searchFromInput(host: SearchHost): void {
  void runSearch(host);
}
