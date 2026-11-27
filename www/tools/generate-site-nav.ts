/**
 * Generate the site navigation data module.
 *
 * Router 1.0 deliberately does not synthesize layout nav data (the
 * generated entry carries empty defaults); the Site owns its own navigation,
 * and this generator projects the two nav sources into
 * `www/app/data/_generated-nav-data.ts` for the layout:
 *
 *   navSections — grouped sidebar tree consumed by the open-layout sidebar
 *   headerNav   — the curated top-level header links, filtered to real routes
 *
 * One source per route kind, no duplication:
 *
 *   article routes (/guide/*, /architecture/*) — content frontmatter via the
 *     same loader/schema as `_generated-guide-data.ts`: `order` sorts within
 *     the section, `section` groups the entry (defaulted per collection) and
 *     `navLabel` (falling back to `title`) labels it. zh entries supply
 *     `labelZh` from the same fields.
 *   the remaining static routes (/docs, /changelog, …) — `export const meta =
 *     { section, label, order }` in the route module.
 *
 * Two generation-time guards, both fail-closed:
 *
 *   headerNav targets — a curated header link whose route left the tree;
 *   membership       — every canonical route in the four section lists must
 *     resolve to a route module, and no other route enters the global tree.
 *
 * `--check` regenerates in memory and fails on drift. The module is generated
 * (gitignored) and rebuilt before the site build.
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { loadCollectionData } from '../lib/content.ts';
import { fileToRoutePath } from '../lib/route-path.ts';
import { articleCollections } from '../content-collections.ts';

const siteRoot = fileURLToPath(new URL('../../www/', import.meta.url));
const routesDir = join(siteRoot, 'app/routes');
const outFile = join(siteRoot, 'app/data/_generated-nav-data.ts');

/**
 * Canonical global sidebar groups. Their path membership and order are fixed
 * here so every route presents the same information architecture.
 */
const SECTION_ORDER = ['LEARN', 'GUIDES', 'REFERENCE', 'PROJECT'];
const SECTION_PATHS: Readonly<Record<string, readonly string[]>> = {
  LEARN: [
    '/guide/getting-started',
    '/guide/tutorial',
    '/guide/core-concepts',
    '/guide/islands-and-ssr',
    '/architecture',
    '/architecture/dsd',
  ],
  GUIDES: [
    '/guide/styling',
    '/guide/routing-and-data',
    '/guide/mdx',
    '/guide/i18n',
    '/guide/configuration',
    '/guide/error-handling',
    '/guide/security',
    '/guide/deployment',
    '/guide/testing',
    '/guide/recipe-form-actions',
    '/guide/recipe-theming',
    '/guide/recipe-island-strategies',
  ],
  REFERENCE: [
    '/reference',
    '/guide/api',
    '/errors',
    '/guide/compiled-grammar',
    '/guide/glossary',
    '/architecture/web-component-admission',
  ],
  PROJECT: ['/roadmap', '/changelog', '/contributing', '/architecture/design-system'],
};
const ROUTE_ORDER = new Map(
  Object.values(SECTION_PATHS).flatMap((paths) =>
    paths.map((path, index) => [path, index] as const),
  ),
);
const ROUTE_LABELS: Readonly<Record<string, { en: string; zh: string }>> = {
  '/guide/api': { en: 'Route handlers', zh: '路由处理器' },
  '/architecture/web-component-admission': { en: 'WC admission tiers', zh: 'WC 准入等级' },
  '/changelog': { en: 'Changelog', zh: '更新日志' },
};

/** Localized group headings. */
const SECTION_ZH: Readonly<Record<string, string>> = {
  LEARN: '学习',
  GUIDES: '指南',
  REFERENCE: '参考',
  PROJECT: '项目',
};

/**
 * Curated header links; each must resolve to a scanned static route.
 *
 * The documentation and editorial blog are the two top-level destinations.
 */
const HEADER_NAV: ReadonlyArray<{ path: string; label: string }> = [
  { path: '/docs', label: 'Docs' },
  { path: '/blog', label: 'Blog' },
];

/** zh header labels keyed by path (they name sections, not page titles). */
const HEADER_NAV_ZH: Readonly<Record<string, string>> = {
  '/docs': '文档',
  '/blog': '博客',
};

/**
 * zh labels for nav routes that have no content-collection entry. Guide and
 * architecture pages take their zh label from the collection frontmatter
 * title (single source of truth); these static pages declare theirs here.
 */
const ROUTE_LABEL_ZH: Readonly<Record<string, string>> = {
  '/reference': 'API 参考',
  '/errors': '错误码',
  '/roadmap': '路线图',
  '/contributing': '参与贡献',
};

interface RouteMeta {
  section: string;
  label: string;
  order: number;
}

interface ContentNavMeta extends RouteMeta {
  labelZh?: string;
}

/** Label shown in the sidebar: explicit short label, else the page title. */
function navLabel(frontmatter: Record<string, unknown>): string {
  return typeof frontmatter.navLabel === 'string'
    ? frontmatter.navLabel
    : String(frontmatter.title ?? '');
}

function parseMeta(source: string): RouteMeta | undefined {
  const object = /export const meta\s*=\s*\{([^}]*)\}/.exec(source)?.[1];
  if (!object) return undefined;
  const section = /section:\s*'([^']*)'/.exec(object)?.[1];
  const label = /label:\s*'([^']*)'/.exec(object)?.[1];
  const order = /order:\s*(-?\d+)/.exec(object)?.[1];
  if (label === undefined || order === undefined) return undefined;
  return { section: section ?? '', label, order: Number(order) };
}

interface NavItem {
  path: string;
  label: string;
  labelZh?: string;
  order: number;
}

/**
 * Nav metadata from the content collections: the same loader, schema and
 * locale-suffix transform that produce `_generated-guide-data.ts` /
 * `_generated-architecture-data.ts`, so the sidebar can never drift from the
 * page's own frontmatter. Markdown rendering is skipped (only frontmatter is
 * consumed here).
 */
async function collectContentNav(): Promise<Map<string, ContentNavMeta>> {
  const nav = new Map<string, ContentNavMeta>();
  const labelsZh = new Map<string, string>();
  for (const name of ['guide', 'architecture'] as const) {
    const collection = articleCollections[name];
    const entries = await loadCollectionData(name, {
      ...collection,
      contentDir: join(siteRoot, collection.contentDir),
      markdown: (content: string) => content,
    });
    for (const entry of entries) {
      // The collection overview article owns the collection root URL: the
      // article-route generator emits `index.tsx` when the slug equals the
      // collection name (generate-site-article-routes.ts, `routeFile:
      // slug === collection ? 'index.tsx' : …`), so `/architecture` is served
      // by `architecture/architecture.md`. Projecting the raw slug would key
      // it as `/architecture/architecture` — a URL that only exists as a
      // redirect — so the entry could never join the sidebar tree and the
      // page lost its own current-page state (P2 audit D10).
      const path =
        entry.slug === name ? collection.basePath : `${collection.basePath}/${entry.slug}`;
      const label = navLabel(entry.frontmatter);
      if (entry.locale === 'zh') {
        labelsZh.set(path, label);
        continue;
      }
      nav.set(path, {
        section: sectionFor(path),
        label,
        order: Number(entry.frontmatter.order ?? 0),
      });
    }
  }
  for (const [path, labelZh] of labelsZh) {
    const item = nav.get(path);
    if (item) item.labelZh = labelZh;
  }
  return nav;
}

function sectionFor(path: string): string {
  return SECTION_ORDER.find((section) => SECTION_PATHS[section].includes(path)) ?? '';
}

async function collect(
  contentNav: Map<string, ContentNavMeta>,
): Promise<{ routes: string[]; sections: Map<string, NavItem[]> }> {
  const routes: string[] = [];
  const sections = new Map<string, NavItem[]>();
  for (const entry of await readdir(routesDir, { recursive: true, withFileTypes: true })) {
    if (entry.isDirectory() || !entry.name.endsWith('.tsx')) continue;
    const entryPath = `${entry.parentPath}/${entry.name}`;
    const relativePath = entryPath.slice(routesDir.length + 1);
    const path = fileToRoutePath(relativePath);
    if (!path) continue;
    routes.push(path);
    const fromContent = contentNav.get(path);
    const meta = fromContent ?? parseMeta(await readFile(entryPath, 'utf8'));
    if (!meta || path === '/docs') continue;
    const labelZh = fromContent ? fromContent.labelZh : ROUTE_LABEL_ZH[path];
    const section = sectionFor(path);
    if (!section) continue;
    const list = sections.get(section) ?? [];
    const customLabel = ROUTE_LABELS[path];
    list.push({
      path,
      label: customLabel?.en ?? meta.label,
      ...(customLabel?.zh || labelZh ? { labelZh: customLabel?.zh ?? labelZh } : {}),
      order: ROUTE_ORDER.get(path) ?? meta.order,
    });
    sections.set(section, list);
  }
  for (const list of sections.values()) {
    list.sort((a, b) => a.order - b.order || (a.label < b.label ? -1 : 1));
  }
  return { routes, sections };
}

function render(sections: Map<string, NavItem[]>, routes: string[]): string {
  const orderedSections: Array<{ section: string; sectionZh?: string; items: NavItem[] }> = [];
  for (const section of SECTION_ORDER) {
    const items = sections.get(section);
    if (items?.length) orderedSections.push({ section, items });
  }
  // Any section not in the canonical order (or the nameless group) is appended
  // deterministically so a new section cannot silently disappear.
  for (const [section, items] of [...sections.entries()].sort()) {
    if (SECTION_ORDER.includes(section)) continue;
    if (items.length) orderedSections.push({ section, items });
  }
  const headerNav = HEADER_NAV.filter((link) => routes.includes(link.path)).map((link) => ({
    href: link.path,
    label: link.label,
    ...(HEADER_NAV_ZH[link.path] ? { labelZh: HEADER_NAV_ZH[link.path] } : {}),
  }));
  const missing = HEADER_NAV.filter((link) => !routes.includes(link.path));
  if (missing.length > 0) {
    throw new Error(
      `headerNav targets missing routes: ${missing.map((link) => link.path).join(', ')}`,
    );
  }
  return `// Auto-generated by www/tools/generate-site-nav.ts from route meta - do not edit.
import type { HeaderNavLink, NavSection } from '../site-ui/open-layout-navigation.ts';

export const navSections: NavSection[] = ${JSON.stringify(
    orderedSections.map((section) => ({
      section: section.section,
      ...(SECTION_ZH[section.section] ? { sectionZh: SECTION_ZH[section.section] } : {}),
      items: section.items.map((item) => ({
        path: item.path,
        label: item.label,
        ...(item.labelZh ? { labelZh: item.labelZh } : {}),
      })),
    })),
    null,
    2,
  )};

export const headerNav: HeaderNavLink[] = ${JSON.stringify(headerNav, null, 2)};
`;
}

const contentNav = await collectContentNav();
const { routes, sections } = await collect(contentNav);

const missingCanonicalPaths = Object.values(SECTION_PATHS)
  .flat()
  .filter((path) => !routes.includes(path));
if (missingCanonicalPaths.length) {
  throw new Error(`Canonical nav routes are missing: ${missingCanonicalPaths.join(', ')}`);
}

// Static-map drift guard: a zh label for a route that left the nav (renamed
// or removed) must fail here, not silently stop applying.
const navPaths = new Set([...sections.values()].flat().map((item) => item.path));
const staleZhKeys = Object.keys(ROUTE_LABEL_ZH).filter((path) => !navPaths.has(path));
if (staleZhKeys.length > 0) {
  throw new Error(`ROUTE_LABEL_ZH keys no longer in nav: ${staleZhKeys.join(', ')}`);
}

const generated = render(sections, routes);
const check = process.argv.slice(2).includes('--check');

if (check) {
  let current = '';
  try {
    current = await readFile(outFile, 'utf8');
  } catch {
    // Missing file is drift; fall through to the mismatch path.
  }
  if (current !== generated) {
    console.error(
      'site nav drift: regenerate with pnpm --filter @openelement/www run generate:nav',
    );
    process.exit(1);
  }
  console.log('site nav check passed.');
} else {
  await writeFile(outFile, generated);
  console.log(`site nav written: ${routes.length} routes, ${sections.size} sections.`);
}
