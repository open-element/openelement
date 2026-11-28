import {
  ensureDeepFragmentNavigation,
  ensurePreHydrationClickCapture,
} from './element-document-services.ts';
import { createIslandSchedulerWithStrategies } from './island-scheduler.ts';
import type { IslandSchedulerDeps } from './island-scheduler.ts';
import type { observeFormEnhancement } from './form-enhancement-loader.ts';
import {
  ISLAND_CATALOGUE_SCRIPT_TYPE,
  type IslandCatalogueEntry,
} from './document-island-catalogue.ts';

interface DocumentIslandOptions {
  bootstrapUrl: string;
  preload: <T>(
    load: () => Promise<T>,
    css: readonly string[] | undefined,
    importerUrl: string,
  ) => Promise<T>;
  idleFallbackTimeoutMs: number;
  strategies: Parameters<typeof createIslandSchedulerWithStrategies>[1];
  actionHeader?: string;
  observeFormEnhancement?: typeof observeFormEnhancement;
}

export function startDocumentIslands(options: DocumentIslandOptions): void {
  const scripts = [
    ...document.querySelectorAll<HTMLScriptElement>('body > script[type="module"][src]'),
  ];
  const bootstrap = scripts.findLast((script) => script.src === options.bootstrapUrl);
  const script = bootstrap?.previousElementSibling;
  const catalogue = script?.matches(`script[type="${ISLAND_CATALOGUE_SCRIPT_TYPE}"]`)
    ? (JSON.parse(script.textContent || '[]') as IslandCatalogueEntry[])
    : [];
  const tags: string[] = [];
  const map: IslandSchedulerDeps['map'] = Object.create(null);
  const strategies = { load: [], idle: [], visible: [], media: [], only: [] } as Record<
    IslandCatalogueEntry[1],
    string[]
  >;
  const mediaQueries: NonNullable<IslandSchedulerDeps['mediaQueries']> = Object.create(null);
  const shared = new Map<string, NonNullable<IslandSchedulerDeps['map'][string]>>();

  ensureDeepFragmentNavigation();
  for (const [tag, strategy, activationUrl, query, css] of catalogue) {
    tags.push(tag);
    strategies[strategy].push(tag);
    if (strategy === 'media' && query != null && typeof window.matchMedia === 'function') {
      mediaQueries[tag] = window.matchMedia(query);
    }

    let factory = shared.get(activationUrl);
    if (!factory) {
      let pending: Promise<unknown> | undefined;
      factory = () =>
        (pending ??= options
          .preload(() => import(/* @vite-ignore */ activationUrl), css, options.bootstrapUrl)
          .then((module) => module?.default(tag)));
      shared.set(activationUrl, factory);
    }
    map[tag] = factory;
  }

  // Install before the scheduler can start imports or upgrade existing hosts.
  ensurePreHydrationClickCapture(document, tags);
  const log = { warn: (...args: unknown[]) => console.warn('[openElement]', ...args) };
  let scanEnhancement: (() => void) | undefined;
  const scheduler = createIslandSchedulerWithStrategies(
    {
      log,
      win: window,
      doc: document,
      map,
      strategies,
      mediaQueries,
      idleFallbackTimeoutMs: options.idleFallbackTimeoutMs,
      onIslandLoaded: options.observeFormEnhancement ? () => scanEnhancement?.() : null,
    },
    options.strategies,
  );
  if (options.observeFormEnhancement && options.actionHeader) {
    scanEnhancement = options.observeFormEnhancement({
      log,
      tags,
      actionHeader: options.actionHeader,
      win: window,
      doc: document,
      observeVisible: scheduler.observeVisible,
    });
  }
}
