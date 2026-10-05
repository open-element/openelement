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

export interface PagefindResultData {
  url: string;
  meta?: { title?: string };
  excerpt?: string;
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
  text: string;
}

/** The island element with its compiled property surface (open-search.tsx). */
export type SearchHost = HTMLElement & {
  locale: string;
  message: string;
  hasHits: boolean;
  hits: SearchHit[];
  searching: boolean;
};

/**
 * Static element ids of the combobox graph (open-search.tsx renders them).
 * One island ships per page (the app shell header), so the fixed strings are
 * unambiguous and stable across hydration.
 */
export const IDS = {
  control: 'open-search-control',
  input: 'open-search-input',
  positioner: 'open-search-positioner',
  content: 'open-search-results',
  label: 'open-search-results-label',
} as const;

export function overlay(host: SearchHost): HTMLElement | null {
  return host.querySelector<HTMLElement>('.overlay');
}

export function input(host: SearchHost): HTMLInputElement | null {
  return host.querySelector<HTMLInputElement>('.search-input');
}

export function showMessage(host: SearchHost, message: string): void {
  host.hits = [];
  host.hasHits = false;
  host.searching = false;
  // :empty guard: the empty box must never render blank — fall back to the
  // idle copy when a caller passes nothing.
  host.message = message || searchChromeStrings(searchLocale()).emptyMessage;
}

/** The page locale is the <html lang> contract (seo-meta.spec.ts pins it). */
export function searchLocale(): SiteLocale {
  return document.documentElement.lang.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
