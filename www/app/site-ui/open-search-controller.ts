/** Browser-only behavior used by the open-search island. */
import { stripLocalePrefix } from '@openelement/site-ui/link.ts';

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

interface SearchState {
  pagefind: PagefindModule | null;
  loaded: boolean;
  searchSequence: number;
  keydown: (event: KeyboardEvent) => void;
}

type SearchHost = HTMLElement;

const states = new WeakMap<SearchHost, SearchState>();

function overlay(host: SearchHost): HTMLElement | null {
  return host.querySelector<HTMLElement>('.overlay');
}

function input(host: SearchHost): HTMLInputElement | null {
  return host.querySelector<HTMLInputElement>('.search-input');
}

function results(host: SearchHost): HTMLElement | null {
  return host.querySelector<HTMLElement>('.results');
}

function emptyResult(message: string): HTMLElement {
  const node = document.createElement('div');
  node.className = 'empty';
  node.textContent = message;
  return node;
}

function showMessage(host: SearchHost, message: string): void {
  results(host)?.replaceChildren(emptyResult(message));
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
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : 'Home';
}

function renderHits(host: SearchHost, hits: PagefindResultData[]): void {
  const container = results(host);
  if (!container) return;
  const fragment = document.createDocumentFragment();
  for (const hit of hits) {
    const link = document.createElement('a');
    link.className = 'result item';
    link.href = hit.url;
    link.addEventListener('click', () => closeSearch(host), { once: true });

    const section = document.createElement('div');
    section.className = 'item-section';
    section.textContent = sectionFor(hit.url);
    const title = document.createElement('div');
    title.className = 'item-title';
    title.textContent = hit.meta?.title || hit.url;
    const text = document.createElement('div');
    text.className = 'item-text';
    text.textContent = plainExcerpt(hit.excerpt ?? '');

    link.append(section, title, text);
    fragment.append(link);
  }
  container.replaceChildren(fragment);
}

async function runSearch(host: SearchHost): Promise<void> {
  const state = states.get(host);
  const query = input(host)?.value.trim() ?? '';
  if (!state || query.length < 2) {
    showMessage(host, 'Type at least 2 characters to search');
    return;
  }
  if (!state.pagefind) return;

  const sequence = ++state.searchSequence;
  try {
    const response = await state.pagefind.search(query);
    const hits = await Promise.all(response.results.slice(0, 10).map((result) => result.data()));
    if (sequence !== state.searchSequence) return;
    if (hits.length === 0) {
      showMessage(host, `No results found for “${query}”`);
      return;
    }
    renderHits(host, hits);
  } catch {
    // Keep the previous result list when an individual Pagefind chunk fails.
  }
}

async function loadPagefind(host: SearchHost): Promise<void> {
  const state = states.get(host);
  if (!state || state.loaded) return;
  state.loaded = true;
  try {
    const pagefindUrl = '/pagefind/pagefind.js';
    const module = (await import(/* @vite-ignore */ pagefindUrl)) as PagefindModule;
    await module.init?.();
    state.pagefind = module;
    await runSearch(host);
  } catch {
    state.loaded = false;
    showMessage(host, 'Search index not found — run deno task build to generate it');
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
  showMessage(host, 'Type at least 2 characters to search');
}

export function closeSearchOnBackdrop(host: SearchHost, event: Event): void {
  const inPanel = event.composedPath().some((node) =>
    node instanceof Element && node.classList.contains('panel')
  );
  if (!inPanel) closeSearch(host);
}

export function searchFromInput(host: SearchHost): void {
  void runSearch(host);
}
