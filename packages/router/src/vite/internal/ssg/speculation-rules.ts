import type { SpeculationRulesOptions } from '@openelement/protocol/ssg';
import { quoteGeneratedJavaScriptValue } from './codegen-literals.ts';

interface SpeculationRoute {
  path: string;
  type: string;
}

/** Build explicit or route-derived Speculation Rules JSON. */
export function buildSpeculationRulesJson(
  options: SpeculationRulesOptions,
  routes?: SpeculationRoute[],
): string {
  if (options.prerender?.length || options.prefetch?.length) {
    const rules: Record<string, unknown[]> = {};
    if (options.prerender?.length) {
      rules.prerender = options.prerender.map((pattern) => ({
        where: { href_matches: pattern },
        ...(options.eagerness && options.eagerness !== 'moderate'
          ? { eagerness: options.eagerness }
          : {}),
      }));
    }
    if (options.prefetch?.length) {
      rules.prefetch = options.prefetch.map((pattern) => ({
        where: { href_matches: pattern },
      }));
    }
    addExclusions(rules, options.exclude ?? []);
    return quoteGeneratedJavaScriptValue(rules, 2);
  }

  if (!routes?.length) return '';
  const staticPaths = routes
    .filter((route) => route.type === 'page' && !route.path.includes(':'))
    .map((route) => route.path);
  if (!staticPaths.length) return '';

  const prerenderPaths = staticPaths.filter((path) => path.split('/').filter(Boolean).length <= 1);
  const prefetchPaths = staticPaths
    .filter((path) => path.split('/').filter(Boolean).length > 1)
    // Match the page itself AND its sub-paths (#798): '/blog/post/*' alone
    // never matches '/blog/post', so the nested-page prefetch was inert.
    .flatMap((path) => [path, `${path}/*`]);
  const rules: Record<string, unknown[]> = {};
  if (prerenderPaths.length) {
    rules.prerender = prerenderPaths.map((pattern) =>
      pattern === '/'
        ? { source: 'list', urls: ['/'], eagerness: 'moderate' }
        : { where: { href_matches: pattern }, eagerness: 'conservative' },
    );
  }
  if (prefetchPaths.length) {
    rules.prefetch = prefetchPaths.map((pattern) => ({ where: { href_matches: pattern } }));
  }
  addExclusions(
    rules,
    // Defensive: the only production caller (internal/ssg/ssg-render.ts)
    // passes page routes only, so this API-route exclusion currently never
    // fires. Kept so future callers that hand in the full route table get
    // correct behavior (#847).
    routes.filter((route) => route.type === 'api').map((route) => `${route.path}/*`),
  );
  return quoteGeneratedJavaScriptValue(rules, 2);
}

/** Eagerness schedule for speculation rules (protocol union, #1561 default conservative). */
export type SpeculationEagerness = 'immediate' | 'moderate' | 'conservative';

/**
 * Resource prefetch hints (`<link rel="prefetch">`) for the island chunks of
 * the pages one page links to (#1561). Speculation Rules `prefetch` targets
 * document URLs only — it does not prefetch arbitrary sub-resources — so
 * island JS/CSS chunks use the platform's resource prefetch channel instead.
 * Each URL emits `<link rel="prefetch" as="fetch" href="...">` which the
 * browser fetches into its HTTP cache at low priority; the module loader's
 * later fetch for the same URL is then a cache hit. Unsupported browsers
 * treat prefetch links as a no-op hint (they are never render-blocking).
 */
export function buildIslandPrefetchLinks(chunkUrls: readonly string[]): string {
  if (!chunkUrls.length) return '';
  return chunkUrls
    .map((url) => `<link rel="prefetch" as="fetch" href="${url}" data-open-island-prefetch>`)
    .join('\n');
}

function addExclusions(rules: Record<string, unknown[]>, patterns: string[]): void {
  if (!patterns.length) return;
  const orMatches = patterns.map((pattern) => ({ href_matches: pattern }));
  for (const key of ['prerender', 'prefetch']) {
    for (const rule of (rules[key] ?? []) as Record<string, unknown>[]) {
      if (rule.where && typeof rule.where === 'object') {
        (rule.where as Record<string, unknown>).not = { or_matches: orMatches };
      }
    }
  }
}
