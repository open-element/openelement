/**
 * route-style-links.ts — per-route document stylesheet URLs for generated
 * LIGHT-root islands (Alpha16 retained stylesheet delivery).
 *
 * A light root has no SSR host producer: the document head is the only
 * delivery that styles it without JS. This module derives a build FACT — one
 * module walk (`walkModuleGraph` `recordGraph`) plus an in-memory per-route
 * closure, joined to the Phase 2 emitted assets. Keyed by `RouteEntry.path`,
 * it feeds the existing per-render document style sink; it never rewrites
 * HTML, infers styles at runtime, or adds a resolver/registry.
 *
 * Hand-off: the internal WeakMap carrier below, keyed by the build context.
 */

import { resolve } from 'pathe';
import type { RouteEntry } from '../../framework.ts';
import type { IslandStyleDeclaration } from '../island-style-declarations.ts';
import { resolveIslandDeliveryTags } from './delivery.ts';
import {
  walkModuleGraph,
  type ModuleWalkDiagnostic,
  type ModuleWalkResolver,
} from '../module-graph-walk.ts';

/** The per-root delivered tag sets a styled generated island declares. */
export interface GeneratedIslandStyleTags {
  readonly light: ReadonlySet<string>;
  readonly shadow: ReadonlySet<string>;
}

/**
 * The delivered tag sets of every styled generated island, split by root.
 * Delivery aliases go through the ONE existing resolver
 * ({@linkcode resolveIslandDeliveryTags}), so the primary/alias rules cannot
 * drift from the island scan, the client join or the admission plan.
 */
export function deliveredIslandStyleTags(
  declarations: readonly IslandStyleDeclaration[],
  islandMeta: Readonly<
    Record<string, { tags?: readonly string[]; tagNames?: readonly string[] } | undefined>
  >,
): GeneratedIslandStyleTags {
  const light = new Set<string>();
  const shadow = new Set<string>();
  for (const declaration of declarations) {
    const target = declaration.root === 'light' ? light : shadow;
    const meta = islandMeta[declaration.tagName];
    for (const tag of resolveIslandDeliveryTags(
      declaration.tagName,
      meta?.tags,
      meta?.tagNames,
      declaration.tagName,
    )) {
      target.add(tag);
    }
  }
  return { light, shadow };
}

/**
 * The per-tag DSD style-link entries the generated entry seeds.
 *
 * The emitted component-sheet URLs of every styled shadow island, plus the
 * app's shared utility sheet for the tags whose package manifest declares the
 * Tailwind requirement. The class lane carries that fact on the emitted class
 * (`static __oeUtilityClasses`); a generated host has no such static, so the
 * manifest declaration is the build-time authority and the entry appends the
 * one shared, content-addressed URL to exactly those tags.
 */
export function islandStyleEntryLinks(
  assets: ReadonlyMap<string, readonly string[]>,
  /**
   * Every styled generated island's tag — shadow AND light (F16).
   *
   * This used to be the SHADOW set only, because the entry seeded these URLs into
   * DSD templates. A LIGHT child nested inside a shadow tree needs its urls here
   * too: it owns no template, so its sheets belong to the ENCLOSING template, and
   * the enclosing producer finds them through this map (the runtime lift channel).
   * The shadow-only row was the reason a nested light card rendered unstyled.
   */
  styledTags: ReadonlySet<string>,
  utilitySheetUrls: readonly string[],
  utilityRequiredTags: ReadonlySet<string>,
): Array<[string, readonly string[]]> {
  const entries: Array<[string, readonly string[]]> = [];
  for (const [tag, urls] of assets) {
    if (!styledTags.has(tag)) continue;
    const links =
      utilityRequiredTags.has(tag) && utilitySheetUrls.length > 0
        ? [...urls, ...utilitySheetUrls]
        : [...urls];
    entries.push([tag, links]);
  }
  // A shadow component whose ONLY styling is utility classes has no authored
  // asset to appear in `assets` (P-2, 2026-11-21 — measured on the TSX-only
  // Tailwind probe). Its DSD template still needs the shared component sheet, so
  // the tag's entry is created here instead of being dropped for lack of an
  // authored URL.
  if (utilitySheetUrls.length > 0) {
    const emitted = new Set(entries.map(([tag]) => tag));
    for (const tag of utilityRequiredTags) {
      if (!styledTags.has(tag) || emitted.has(tag)) continue;
      entries.push([tag, [...utilitySheetUrls]]);
    }
  }
  return entries;
}

/** Stable code for the one graph boundary this fact reports. */
export const RouteStyleLinksDiagnosticCode = {
  /**
   * The walk stopped at its module bound, so a route closure may be partial.
   * A partial closure under-links a page (styled content without its sheet), so
   * the caller must treat this as a build failure rather than a green fact.
   */
  ROUTE_STYLE_WALK_TRUNCATED: 'OE_ROUTE_STYLE_WALK_TRUNCATED',
  /**
   * A static import inside a page route's module closure did not resolve. A
   * `null` answer is not proof of an external dependency (only the resolver's
   * explicit `external` verdict is), and the module behind it may reference a
   * styled light-root island — so the route fact is incomplete, never "no
   * edge".
   */
  ROUTE_STYLE_UNRESOLVED_IMPORT: 'OE_ROUTE_STYLE_UNRESOLVED_IMPORT',
  /**
   * A route references a tag the caller declared as a styled light-root island,
   * but the joined `islandStyleUrls` map has no URL for it. The two build
   * phases (Phase 2 asset join, this route fact) each fail closed on their own
   * inputs; a helper unit that receives an inconsistent pair must not silently
   * drop the sheet either.
   */
  ROUTE_STYLE_MISSING_ASSET_URLS: 'OE_ROUTE_STYLE_MISSING_ASSET_URLS',
} as const;

/**
 * The route→document-stylesheet URLs fact the entry seeds into the head.
 *
 * `key` is the route path exactly as `RouteEntry.path` / the generated route
 * info spells it. `value` is base-joined, deduplicated, deterministic
 * (referenced tag ascending, then the tag's emitted specifier order). A route
 * with no light-root styled island is absent; an absent key means "nothing to
 * seed", never "unknown".
 */
export interface RouteDocumentStyleLinks {
  readonly [routePath: string]: readonly string[];
}

export interface BuildRouteDocumentStyleLinksInput {
  /** Absolute project root (the app's own root). */
  root: string;
  /** The scanned routes; only `type: 'page'` non-special entries are seeds. */
  routes: readonly RouteEntry[];
  routesDir: string;
  /** The BUNDLER's resolver — the same one every discovery pass walks. */
  resolve: ModuleWalkResolver;
  /**
   * Every DELIVERED tag of a light-root generated island that declares
   * `IslandConfig.styles` (primary tag plus the manifest's one-to-many
   * `tags`/`tagNames` aliases). The closure is intersected with this set, so a
   * plain JSX reference to an unrelated custom element contributes nothing.
   */
  lightIslandTags: ReadonlySet<string>;
  /**
   * Route path -> the sheets a PAGE MODULE declares for itself (P-2b, 2026-11-21).
   *
   * A generated light page's own box rule is not an island's sheet, and no JSX
   * reference can carry it: the page module IS the root. The build registers that
   * declaration under the page's tag, so this map is the resolved form and the
   * route's link list starts from it instead of from a reference walk.
   */
  pageModuleStyleUrls?: ReadonlyMap<string, readonly string[]>;
  /** Delivered tag → emitted, base-joined stylesheet URLs from Phase 2. */
  islandStyleUrls: ReadonlyMap<string, readonly string[]>;
  /** The walk's module bound (production default when omitted). */
  maxModules?: number;
}

export interface BuildRouteDocumentStyleLinksResult {
  links: RouteDocumentStyleLinks;
  /**
   * The walk's reported boundaries (bound stop, per-module analysis failures,
   * unreadable sources, unresolved static imports) plus an inconsistent
   * tag→URL join. A non-empty list means the closure may be INCOMPLETE:
   * the caller reports each note and fails the build through the registry code
   * `RouteScanErrorCode.DOCUMENT_STYLE_LINKS_INCOMPLETE` — an under-linked
   * page would ship a styled island without its sheet.
   */
  notes: readonly ModuleWalkDiagnostic[];
  /** True when a reported boundary makes the derived map potentially partial. */
  incomplete: boolean;
}

/**
 * Derive the per-route document stylesheet URLs for light-root generated
 * islands. One bounded walk over the page-route seeds, then an in-memory
 * closure per route over the recorded edges; the empty case (no light-root
 * styled island anywhere) returns before walking at all.
 */
export async function buildRouteDocumentStyleLinks(
  input: BuildRouteDocumentStyleLinksInput,
): Promise<BuildRouteDocumentStyleLinksResult> {
  const links: Record<string, string[]> = {};
  if (input.lightIslandTags.size === 0) {
    // No light-root styled island exists: no walk, no links, zero output delta.
    return { links, notes: [], incomplete: false };
  }
  const pageRoutes = input.routes.filter((route) => route.type === 'page' && !route.special);
  if (pageRoutes.length === 0) {
    return { links, notes: [], incomplete: false };
  }
  const routeRoot = resolve(input.root, input.routesDir);
  const seedFiles = pageRoutes.map((route) => resolve(routeRoot, route.filePath));
  const walk = await walkModuleGraph(input.resolve, seedFiles, {
    maxModules: input.maxModules,
    recordGraph: true,
  });
  if (walk.graph === undefined) {
    // The walk owns the option; a missing graph with `recordGraph: true` is an
    // internal contract violation, not a route fact to guess around.
    throw new Error(
      '[openElement] walkModuleGraph returned no graph facts although recordGraph was requested; ' +
        'the route style-links fact cannot be derived.',
    );
  }
  const { edges, referencedTags } = walk.graph;
  const notes: ModuleWalkDiagnostic[] = [];
  if (walk.truncated) {
    notes.push({
      code: RouteStyleLinksDiagnosticCode.ROUTE_STYLE_WALK_TRUNCATED,
      message:
        'Route style-link discovery stopped at its module bound; some light-root island ' +
        'references may be missing from the route fact (reported, never silent).',
    });
  }
  notes.push(...walk.diagnostics);
  for (const edge of walk.graph.unresolvedEdges) {
    notes.push({
      code: RouteStyleLinksDiagnosticCode.ROUTE_STYLE_UNRESOLVED_IMPORT,
      file: edge.importer,
      message:
        `Static import "${edge.specifier}" in ${edge.importer} did not resolve. The unresolved ` +
        'module may reference a styled light-root island, so the route document stylesheet fact ' +
        'is incomplete (a null answer is not an external verdict).',
    });
  }

  for (const route of pageRoutes) {
    const seed = resolve(routeRoot, route.filePath);
    const tags = referencedLightTags(seed, edges, referencedTags, input.lightIslandTags);
    const pageModuleUrls = input.pageModuleStyleUrls?.get(route.path) ?? [];
    if (tags.length === 0 && pageModuleUrls.length === 0) continue;
    const urls: string[] = [];
    const seen = new Set<string>();
    for (const url of input.pageModuleStyleUrls?.get(route.path) ?? []) {
      if (seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
    }
    for (const tag of tags) {
      const tagUrls = input.islandStyleUrls.get(tag);
      if (tagUrls === undefined || tagUrls.length === 0) {
        // Defensive boundary, not a duplicate of the Phase 2 check: the helper
        // owns the "declared tag -> URL" join it was handed, and an absent or
        // empty entry is an inconsistent input, never "nothing to seed".
        notes.push({
          code: RouteStyleLinksDiagnosticCode.ROUTE_STYLE_MISSING_ASSET_URLS,
          file: seed,
          message:
            `Route ${JSON.stringify(route.path)} references light-root styled island <${tag}>, ` +
            'but the joined stylesheet map carries no URL for that tag; the route document ' +
            'stylesheet fact is incomplete.',
        });
        continue;
      }
      for (const url of tagUrls) {
        if (seen.has(url)) continue;
        seen.add(url);
        urls.push(url);
      }
    }
    if (urls.length > 0) links[route.path] = urls;
  }
  return { links, notes, incomplete: notes.length > 0 };
}

/** The light-root island tags a route's static module closure references. */
function referencedLightTags(
  seed: string,
  edges: ReadonlyMap<string, readonly string[]>,
  referencedTags: ReadonlyMap<string, readonly string[]>,
  lightIslandTags: ReadonlySet<string>,
): string[] {
  const found = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [seed];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    for (const tag of referencedTags.get(file) ?? []) {
      if (lightIslandTags.has(tag)) found.add(tag);
    }
    for (const edge of edges.get(file) ?? []) {
      if (!visited.has(edge)) stack.push(edge);
    }
  }
  return [...found].sort();
}

const linksByContext = new WeakMap<object, RouteDocumentStyleLinks>();
const EMPTY_LINKS: RouteDocumentStyleLinks = Object.freeze({});

/**
 * Record the route fact for THIS build context (build-internal hand-off; the
 * same context object every phase shares).
 */
export function setRouteDocumentStyleLinks(context: object, links: RouteDocumentStyleLinks): void {
  linksByContext.set(context, links);
}

/**
 * The route fact recorded for this build, or an empty map when the caller never
 * recorded one (dev/serve without a build: no emission, no links).
 */
export function routeDocumentStyleLinks(context: object): RouteDocumentStyleLinks {
  return linksByContext.get(context) ?? EMPTY_LINKS;
}
