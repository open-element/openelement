/**
 * Typed Content Graph (#1157, B2.4): normalized entry, source-location,
 * locale, reference and fingerprint schemas plus the fail-closed validators
 * and deterministic queries consumed by documentation routes, navigation,
 * search and SEO tooling.
 *
 * This module is pure: adapters (./content-graph-adapters.ts) own all IO and
 * produce the `ContentGraph` value validated and serialized here. Identical
 * inputs must serialize to byte-identical output — `serializeContentGraph`
 * sorts every array and object key and never emits absolute paths.
 */

export const CONTENT_GRAPH_SCHEMA_VERSION = 1;

export type EntryKind =
  | 'article'
  | 'blog-post'
  | 'doc'
  | 'api-package'
  | 'custom-element'
  | 'roadmap-entry'
  | 'release';

/** Repo-relative location of the source a graph entry derives from. */
export interface SourceLocation {
  path: string;
  line?: number;
}

/** A locale alternate of an entry, pointing at the alternate's entry id. */
export interface LocaleAlternate {
  locale: string;
  id: string;
}

/** A normalized reference from one entry to another entry or public route. */
export interface EntryReference {
  kind: 'entry' | 'route';
  target: string;
  line?: number;
}

export interface GraphEntry {
  /** Unique stable id, e.g. `article:guide/getting-started:en`. */
  id: string;
  kind: EntryKind;
  /** Primary locale of this entry (`en` for locale-neutral kinds). */
  locale: string;
  source: SourceLocation;
  /** Other locales of the same logical content, sorted by locale. */
  alternates: LocaleAlternate[];
  /** Outgoing internal references, sorted by kind/target/line. */
  references: EntryReference[];
  /** Canonical (default-locale) public route, when the entry is routable. */
  route?: string;
  /** SHA-256 hex of the entry's canonical source content. */
  fingerprint: string;
  /** Kind-specific payload (frontmatter, exports, compiler metadata). */
  data: Record<string, unknown>;
}

export interface ContentGraph {
  version: number;
  generated: 'deterministic';
  entries: GraphEntry[];
}

export interface GraphFailure {
  file: string;
  message: string;
}

function compareReferences(left: EntryReference, right: EntryReference): number {
  return left.kind.localeCompare(right.kind) ||
    left.target.localeCompare(right.target) ||
    (left.line ?? 0) - (right.line ?? 0);
}

/** Deep-sort object keys so JSON.stringify output is input-order independent. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      out[key] = canonicalize(source[key]);
    }
    return out;
  }
  return value;
}

/**
 * Serialize a graph deterministically: entries sorted by id, alternates by
 * locale, references by kind/target/line, and all payload keys sorted.
 * Identical inputs produce byte-identical output.
 */
export function serializeContentGraph(graph: ContentGraph): string {
  const entries = [...graph.entries].sort((a, b) => a.id.localeCompare(b.id)).map((entry) => {
    const serialized: Record<string, unknown> = {
      id: entry.id,
      kind: entry.kind,
      locale: entry.locale,
      source: canonicalize(entry.source),
      alternates: [...entry.alternates].sort((a, b) => a.locale.localeCompare(b.locale)),
      references: [...entry.references].sort(compareReferences),
    };
    if (entry.route !== undefined) serialized.route = entry.route;
    serialized.fingerprint = entry.fingerprint;
    serialized.data = canonicalize(entry.data);
    return serialized;
  });
  return JSON.stringify(
    { version: CONTENT_GRAPH_SCHEMA_VERSION, generated: 'deterministic', entries },
    null,
    2,
  ) + '\n';
}

export interface ValidateOptions {
  /** Every public route the website serves, canonical (default-locale) form. */
  routes: readonly string[];
  /** Locales the site builds; the first entry is the default locale. */
  locales: readonly string[];
}

function entryFile(entry: GraphEntry): string {
  return entry.source.path;
}

/**
 * Fail-closed graph validation. Duplicate ids, references to entries or
 * routes the graph does not know, and locale-alternate lies (orphan
 * non-default locales, asymmetric pairs, byte-identical "translations") are
 * all hard failures.
 */
export function validateContentGraph(
  graph: ContentGraph,
  options: ValidateOptions,
): GraphFailure[] {
  const failures: GraphFailure[] = [];
  const byId = new Map<string, GraphEntry>();
  const defaultLocale = options.locales[0];

  for (const entry of graph.entries) {
    const existing = byId.get(entry.id);
    if (existing) {
      failures.push({
        file: entryFile(entry),
        message: `duplicate entry id '${entry.id}' (also sourced from ${entryFile(existing)})`,
      });
    } else {
      byId.set(entry.id, entry);
    }
  }

  const routeSet = new Set(options.routes);
  for (const entry of graph.entries) {
    if (entry.route !== undefined) routeSet.add(entry.route);
  }
  for (const entry of graph.entries) {
    for (const reference of entry.references) {
      if (reference.kind === 'entry') {
        if (!byId.has(reference.target)) {
          failures.push({
            file: entryFile(entry),
            message: `broken entry reference '${reference.target}'` +
              (reference.line ? ` at line ${reference.line}` : ''),
          });
        }
      } else if (!routeSet.has(reference.target)) {
        failures.push({
          file: entryFile(entry),
          message: `broken route reference '${reference.target}'` +
            (reference.line ? ` at line ${reference.line}` : ''),
        });
      }
    }
  }

  for (const entry of graph.entries) {
    if (entry.alternates.length === 0) {
      // A localized entry with no default-locale alternate is an orphan: any
      // alternate link to the default locale would be false.
      if (entry.locale !== defaultLocale && options.locales.includes(entry.locale)) {
        failures.push({
          file: entryFile(entry),
          message: `orphan ${entry.locale} entry: no ${defaultLocale} alternate exists`,
        });
      }
      continue;
    }
    for (const alternate of entry.alternates) {
      const target = byId.get(alternate.id);
      if (!target) {
        failures.push({
          file: entryFile(entry),
          message: `false locale alternate '${alternate.id}': no such entry`,
        });
        continue;
      }
      if (target.locale !== alternate.locale) {
        failures.push({
          file: entryFile(entry),
          message:
            `false locale alternate '${alternate.id}': entry locale is '${target.locale}', not '${alternate.locale}'`,
        });
      }
      if (!target.alternates.some((back) => back.id === entry.id)) {
        failures.push({
          file: entryFile(entry),
          message: `asymmetric locale alternate: '${alternate.id}' does not link back`,
        });
      }
      if (target.fingerprint === entry.fingerprint) {
        failures.push({
          file: entryFile(entry),
          message:
            `locale alternate '${alternate.id}' is byte-identical — a duplicated untranslated source`,
        });
      }
    }
  }

  return failures;
}

// ─── deterministic queries ──────────────────────────────────────────────────

/** One routable documentation page projection for route generation. */
export interface DocRoute {
  route: string;
  locale: string;
  id: string;
}

/** All routes a documentation entry serves, one row per built locale. */
export function docRoutes(graph: ContentGraph, locales: readonly string[]): DocRoute[] {
  const defaultLocale = locales[0];
  const rows: DocRoute[] = [];
  for (const entry of graph.entries) {
    if (entry.route === undefined) continue;
    rows.push({ route: entry.route, locale: entry.locale, id: entry.id });
    for (const alternate of entry.alternates) {
      if (alternate.locale === defaultLocale) continue;
      rows.push({
        route: `/${alternate.locale}${entry.route}`,
        locale: alternate.locale,
        id: alternate.id,
      });
    }
  }
  return rows.sort((a, b) => a.route.localeCompare(b.route));
}

/** Per-route locale availability for navigation and SEO alternates. */
export function localeAvailability(graph: ContentGraph): Record<string, string[]> {
  const availability: Record<string, string[]> = {};
  for (const entry of graph.entries) {
    if (entry.route === undefined) continue;
    const locales = [entry.locale, ...entry.alternates.map((alternate) => alternate.locale)]
      .sort();
    const existing = availability[entry.route];
    availability[entry.route] = existing ? [...new Set([...existing, ...locales])].sort() : locales;
  }
  return Object.fromEntries(
    Object.entries(availability).sort(([left], [right]) => left.localeCompare(right)),
  );
}

/** One search record per routable entry (Pagefind indexes built HTML; these
 *  records are the graph-side truth for title/kind/locale per route). */
export interface SearchRecord {
  route: string;
  locale: string;
  title: string;
  kind: EntryKind;
}

export function searchRecords(graph: ContentGraph): SearchRecord[] {
  const records: SearchRecord[] = [];
  for (const entry of graph.entries) {
    if (entry.route === undefined) continue;
    const title = typeof entry.data.title === 'string' ? entry.data.title : entry.id;
    records.push({ route: entry.route, locale: entry.locale, title, kind: entry.kind });
  }
  return records.sort((a, b) => a.route.localeCompare(b.route) || a.locale.localeCompare(b.locale));
}

/** Per-route SEO truth: title, description and hreflang alternates. */
export interface SeoEntry {
  route: string;
  locale: string;
  title: string;
  description: string;
  /** locale -> localized route, including the entry's own locale. */
  alternates: Record<string, string>;
}

export function seoEntries(graph: ContentGraph, locales: readonly string[]): SeoEntry[] {
  const defaultLocale = locales[0];
  // Group locale variants of one logical route, then emit one row per served
  // route: the canonical path for the default locale, `/<locale><path>` for
  // every real alternate.
  const groups = new Map<string, GraphEntry[]>();
  for (const entry of graph.entries) {
    if (entry.route === undefined) continue;
    const group = groups.get(entry.route) ?? [];
    group.push(entry);
    groups.set(entry.route, group);
  }
  const entries: SeoEntry[] = [];
  for (const [route, group] of groups) {
    const byLocale = new Map(group.map((entry) => [entry.locale, entry]));
    const served = [...byLocale.keys()].sort();
    const alternates = Object.fromEntries(
      served.map((locale) => [locale, locale === defaultLocale ? route : `/${locale}${route}`]),
    );
    for (const locale of served) {
      const entry = byLocale.get(locale)!;
      entries.push({
        route: alternates[locale],
        locale,
        title: typeof entry.data.title === 'string' ? entry.data.title : entry.id,
        description: typeof entry.data.lede === 'string' ? entry.data.lede : '',
        alternates,
      });
    }
  }
  return entries.sort((a, b) => a.route.localeCompare(b.route));
}
