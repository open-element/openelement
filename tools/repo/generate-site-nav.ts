/**
 * Generate the site navigation data module.
 *
 * Router 1.0 deliberately does not synthesize app-shell nav data (the
 * generated entry carries empty defaults); the Site owns its own navigation,
 * and this generator projects the two nav sources into
 * `www/app/data/_generated-nav-data.ts` for the app shell:
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
 *   the remaining static routes (/docs, /blog, …) — `export const meta =
 *     { section, label, order }` in the route module.
 *
 * `--check` regenerates in memory and fails on drift. The module is generated
 * (gitignored) and rebuilt before the site build.
 */
import { walk } from '@std/fs/walk';
import { fromFileUrl, join } from '@std/path';
import { loadCollectionData } from '../../www/lib/content.ts';
import { articleCollections } from '../../www/content-collections.ts';

const siteRoot = fromFileUrl(new URL('../../www/', import.meta.url));
const routesDir = join(siteRoot, 'app/routes');
const outFile = join(siteRoot, 'app/data/_generated-nav-data.ts');

const SECTION_ORDER = [
  'Quick Start',
  'Guide',
  'Core',
  'Production',
  'Principles',
  'Reference',
  'History',
  'Project',
];

/** zh group headings; '' is the nameless group the consumer labels "Project". */
const SECTION_ZH: Readonly<Record<string, string>> = {
  'Quick Start': '快速开始',
  'Guide': '指南',
  'Core': '核心',
  'Production': '生产',
  'Principles': '原则',
  'Reference': '参考',
  'History': '历史',
  '': '项目',
};

/**
 * Curated header links; each must resolve to a scanned static route.
 *
 * Alpha keeps the smallest possible top bar: the Docs hub (/docs) is the
 * single entrance to the guide and architecture trees, and Blog is the one
 * separate stream. API reference, roadmap and changelog are reachable from
 * the docs hub and the footer. A Playground entry is planned for a later
 * release (mature framework sites run two to four top-level links; see
 * lit.dev and svelte.dev).
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
  '/docs': '文档',
  '/apilist': 'API 参考',
  '/blog': '博客',
  '/roadmap': '路线图',
  '/changelog': '更新日志',
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

function fileToRoutePath(relativePath: string): string | undefined {
  const withoutExtension = relativePath.replace(/\.tsx?$/, '');
  const segments = withoutExtension.split('/');
  const mapped: string[] = [];
  for (const segment of segments) {
    if (segment === 'index') continue;
    if (segment.startsWith('[')) return undefined; // dynamic routes are not nav
    mapped.push(segment);
  }
  return `/${mapped.join('/')}`;
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
      const path = `${collection.basePath}/${entry.slug}`;
      const label = navLabel(entry.frontmatter);
      if (entry.locale === 'zh') {
        labelsZh.set(path, label);
        continue;
      }
      nav.set(path, {
        section: String(entry.frontmatter.section ?? ''),
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

async function collect(
  contentNav: Map<string, ContentNavMeta>,
): Promise<{ routes: string[]; sections: Map<string, NavItem[]> }> {
  const routes: string[] = [];
  const sections = new Map<string, NavItem[]>();
  for await (const entry of walk(routesDir, { exts: ['.tsx'], includeDirs: false })) {
    const relativePath = entry.path.slice(routesDir.length + 1);
    const path = fileToRoutePath(relativePath);
    if (!path) continue;
    routes.push(path);
    const fromContent = contentNav.get(path);
    const meta = fromContent ?? parseMeta(await Deno.readTextFile(entry.path));
    if (!meta) continue;
    const labelZh = fromContent ? fromContent.labelZh : ROUTE_LABEL_ZH[path];
    const list = sections.get(meta.section) ?? [];
    list.push({ path, label: meta.label, ...(labelZh ? { labelZh } : {}), order: meta.order });
    sections.set(meta.section, list);
  }
  for (const list of sections.values()) {
    list.sort((a, b) => a.order - b.order || (a.label < b.label ? -1 : 1));
  }
  return { routes, sections };
}

function render(
  sections: Map<string, NavItem[]>,
  routes: string[],
): string {
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
  return `// Auto-generated by tools/repo/generate-site-nav.ts from route meta - do not edit.
import type { HeaderNavLink, NavSection } from '../site-ui/open-layout-navigation.ts';

export const navSections: NavSection[] = ${
    JSON.stringify(
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
    )
  };

export const headerNav: HeaderNavLink[] = ${JSON.stringify(headerNav, null, 2)};
`;
}

const contentNav = await collectContentNav();
const { routes, sections } = await collect(contentNav);

// Static-map drift guard: a zh label for a route that left the nav (renamed
// or removed) must fail here, not silently stop applying.
const navPaths = new Set([...sections.values()].flat().map((item) => item.path));
const staleZhKeys = Object.keys(ROUTE_LABEL_ZH).filter((path) => !navPaths.has(path));
if (staleZhKeys.length > 0) {
  throw new Error(`ROUTE_LABEL_ZH keys no longer in nav: ${staleZhKeys.join(', ')}`);
}

const generated = render(sections, routes);
const check = Deno.args.includes('--check');

if (check) {
  let current = '';
  try {
    current = await Deno.readTextFile(outFile);
  } catch {
    // Missing file is drift; fall through to the mismatch path.
  }
  if (current !== generated) {
    console.error('site nav drift: regenerate with deno task --cwd tools/repo generate:site-nav');
    Deno.exit(1);
  }
  console.log('site nav check passed.');
} else {
  await Deno.writeTextFile(outFile, generated);
  console.log(`site nav written: ${routes.length} routes, ${sections.size} sections.`);
}
