/**
 * Shared, Zag-free surface of the open-search island: types, element ids, and
 * the small DOM/text helpers both the controller (open-search-controller.ts)
 * and the lazily loaded runtime module (open-search-combobox.ts) need.
 *
 * This module must never import @zag-js/* (the controller is part of the
 * always-shipped island payload) and keeps to the lightest helpers — the
 * search pipeline's locale/section mapping lives in the lazy module with its
 * only consumer.
 */
import type { SiteLocale } from '../../site-config.ts';
import { searchChromeStrings } from './chrome-strings.ts';

/** Search intent shared with the classic head script, on the specific SSR host. */
export const SEARCH_OPEN_INTENT_KEY = 'openelement.site.search-open-intent';

export interface PagefindResultData {
  url: string;
  meta?: { title?: string };
  excerpt?: string;
  /** Full page text (ZWS-delimited in zh); the excerpt builder's source. */
  raw_content?: string;
}

export interface PagefindSearchResult {
  data: () => Promise<PagefindResultData>;
}

export interface PagefindModule {
  init?: () => Promise<void>;
  search: (query: string) => Promise<{ results: PagefindSearchResult[] }>;
}

/** One rendered search hit; the island view maps this array declaratively. */
export interface SearchHit {
  key: string;
  href: string;
  section: string;
  title: string;
  /** The excerpt is split around the matched term. */
  text: string;
  before: string;
  match: string;
  after: string;
}

/** The island element with its compiled property surface (open-search.tsx). */
export type SearchHost = HTMLElement & {
  locale: string;
  message: string;
  resultCount: string;
  hasHits: boolean;
  hits: SearchHit[];
  searching: boolean;
};

/**
 * Static element ids of the combobox graph (open-search.tsx renders them).
 * One island ships per page (the layout header), so the fixed strings are
 * unambiguous and stable across hydration.
 */
export const IDS = {
  control: 'open-search-control',
  input: 'open-search-input',
  clear: 'open-search-clear',
  close: 'open-search-close',
  positioner: 'open-search-positioner',
  content: 'open-search-results',
  label: 'open-search-results-label',
  count: 'open-search-count',
  status: 'open-search-status',
} as const;

export function overlay(host: SearchHost): HTMLElement | null {
  return host.querySelector<HTMLElement>('.overlay');
}

export function input(host: SearchHost): HTMLInputElement | null {
  return host.querySelector<HTMLInputElement>('.search-input');
}

/**
 * The polite live region. It is SSR-rendered empty and only ever written with
 * textContent, so a result count or state message is announced without
 * inserting markup into the dialog.
 */
export function announce(host: SearchHost, message: string): void {
  const region = host.querySelector<HTMLElement>(`#${IDS.status}`);
  if (region && region.textContent !== message) region.textContent = message;
}

export function showMessage(host: SearchHost, message: string): void {
  // No-op guards: every write to the compiled props record schedules a view
  // refresh. Re-writing the same idle state on open/close used to replace
  // the recovery subtree a beat later, dropping focus to <body> while a
  // keyboard reader was tabbing through it.
  if (host.hits.length > 0) host.hits = [];
  if (host.hasHits) host.hasHits = false;
  if (host.searching) host.searching = false;
  if (host.resultCount) host.resultCount = '';
  // :empty guard: the empty box must never render blank — fall back to the
  // idle copy when a caller passes nothing.
  const next = message || searchChromeStrings(searchLocale()).emptyMessage;
  if (host.message !== next) host.message = next;
}

/** The page locale is the <html lang> contract (seo-meta.spec.ts pins it). */
export function searchLocale(): SiteLocale {
  return document.documentElement.lang.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
