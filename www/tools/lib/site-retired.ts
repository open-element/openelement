/**
 * Neutral site retired-URL domain library (no process exits, no diagnostics).
 *
 * The retired set is DERIVED, not listed. `site-baseline-routes.json` is a
 * committed snapshot of the public route tree at the last released baseline,
 * and retired = baseline routes minus the routes the current tree serves.
 * The normal path is deterministic and offline: it reads that manifest and
 * scans the filesystem; it never resolves a ref, fetches a remote, or needs
 * `.git` to exist. Refreshing the snapshot is a deliberate, separate action
 * (`refreshBaseline`, Git-based) run when a release baseline moves.
 *
 * `site-redirects.json` maps each retired path to its successor and is
 * validated in both directions — an unmapped retirement and a stale mapping
 * entry are both errors — with locale prefixes expanded by the callers from
 * SITE_LOCALES and fragment targets verified against the real slugified
 * heading ids via the shared slugifyHeadingId (not a second implementation).
 *
 * Consumers: the check shell (diagnostics + exit status), the redirects
 * emitter, and the built-output link checker. This file must not import any
 * check-* module or exit the process.
 */
import { fromFileUrl, join } from '@std/path';
import { scanRoutes } from '../../../packages/router/src/vite/internal/ssg/route-scanner.ts';
import { fileToRoutePath } from '../../lib/route-path.ts';
import { slugifyHeadingId, stripHtmlToText } from '../../app/site-ui/article-body.ts';
import { SITE_LOCALES } from '../../app/site-ui/link.ts';

const repoRoot = fromFileUrl(new URL('../../../', import.meta.url));
const routesRel = 'www/app/routes';
const tablePath = join(repoRoot, 'www/tools/site-redirects.json');
const baselinePath = join(repoRoot, 'www/tools/site-baseline-routes.json');

/** Locales the site serves, typed for content-file resolution. */
const CONTENT_LOCALES = SITE_LOCALES as readonly ('en' | 'zh')[];

export interface RedirectMapping {
  from: string;
  to: string;
  status: number;
  /** zh successor when the translated heading id differs; absent means the locale-expanded `to`. */
  toZh?: string;
}

export interface BaselineManifest {
  /** Provenance of the snapshot: the ref it was taken from and its commit. */
  baseline: { ref: string; sha: string };
  /** Every public route path the baseline tree served. */
  routes: string[];
  /** title/navLabel strings the retired routes carried, for label gates. */
  retiredTitles: string[];
}

async function git(args: string[]): Promise<{ code: number; out: string; err: string }> {
  const command = new Deno.Command('git', {
    args,
    cwd: repoRoot,
    stdout: 'piped',
    stderr: 'piped',
  });
  const { code, stdout, stderr } = await command.output();
  const decode = new TextDecoder().decode.bind(new TextDecoder());
  return { code, out: decode(stdout).trim(), err: decode(stderr).trim() };
}

async function routePathsIn(dir: string): Promise<Set<string>> {
  const entries = await scanRoutes(dir);
  const paths = new Set<string>();
  for (const entry of entries) {
    const path = fileToRoutePath(entry.filePath);
    if (path) paths.add(path);
  }
  return paths;
}

/** Validate a parsed baseline manifest (pure; the loader only adds file IO). */
export function parseBaselineManifest(parsed: unknown, sourceLabel: string): BaselineManifest {
  const manifest = (parsed ?? {}) as Partial<BaselineManifest>;
  if (
    typeof manifest.baseline?.ref !== 'string' ||
    typeof manifest.baseline?.sha !== 'string' ||
    !Array.isArray(manifest.routes) ||
    !manifest.routes.every((route) => typeof route === 'string' && route.startsWith('/')) ||
    !Array.isArray(manifest.retiredTitles) ||
    !manifest.retiredTitles.every((title) => typeof title === 'string')
  ) {
    throw new Error(`${sourceLabel} is malformed`);
  }
  return manifest as BaselineManifest;
}

export async function loadBaselineManifest(): Promise<BaselineManifest> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await Deno.readTextFile(baselinePath));
  } catch {
    throw new Error(`cannot read ${baselinePath}; refresh it with --refresh --base <ref>`);
  }
  return parseBaselineManifest(parsed, baselinePath);
}

/** Retired routes for the current tree, from the committed baseline snapshot. */
export async function retiredRoutes(): Promise<
  { manifest: BaselineManifest; retired: Set<string> }
> {
  const manifest = await loadBaselineManifest();
  const head = await routePathsIn(join(repoRoot, routesRel));
  const retired = new Set(manifest.routes.filter((route) => !head.has(route)));
  return { manifest, retired };
}

/** Validate a parsed redirect table (pure; the loader only adds file IO). */
export function parseRedirectTable(parsed: unknown, sourceLabel: string): RedirectMapping[] {
  const list = (parsed as { redirects?: unknown } | null | undefined)?.redirects;
  if (!Array.isArray(list)) throw new Error(`${sourceLabel} must hold { redirects: [...] }`);
  const mappings: RedirectMapping[] = [];
  for (const entry of list as unknown[]) {
    const { from, to, toZh, status } = entry as Partial<RedirectMapping>;
    if (
      typeof from !== 'string' || !from.startsWith('/') || from.startsWith('/zh/') ||
      typeof to !== 'string' || !to.startsWith('/') || to.startsWith('/zh/') ||
      (toZh !== undefined &&
        (typeof toZh !== 'string' || !toZh.startsWith('/') || toZh.startsWith('/zh/'))) ||
      status !== 301
    ) {
      throw new Error(
        `${sourceLabel}: bad mapping (want unprefixed from/to/toZh and status 301): ${
          JSON.stringify(entry)
        }`,
      );
    }
    mappings.push(toZh === undefined ? { from, to, status } : { from, to, toZh, status });
  }
  return mappings;
}

export async function loadRedirectTable(): Promise<RedirectMapping[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await Deno.readTextFile(tablePath));
  } catch {
    throw new Error(`cannot read ${tablePath}`);
  }
  return parseRedirectTable(parsed, tablePath);
}

function stripFragment(path: string): { route: string; fragment: string } {
  const hash = path.indexOf('#');
  return hash < 0
    ? { route: path, fragment: '' }
    : { route: path.slice(0, hash), fragment: path.slice(hash + 1) };
}

/** Content file backing a collection route, for fragment verification. */
function contentFileFor(route: string, locale: 'en' | 'zh'): string | null {
  const suffix = locale === 'zh' ? '.zh.md' : '.md';
  if (route === '/architecture') {
    return join(repoRoot, `www/content/docs/architecture/architecture${suffix}`);
  }
  const guide = /^\/guide\/([a-z0-9-]+)$/.exec(route);
  if (guide) return join(repoRoot, `www/content/docs/guide/${guide[1]}${suffix}`);
  const arch = /^\/architecture\/([a-z0-9-]+)$/.exec(route);
  if (arch) return join(repoRoot, `www/content/docs/architecture/${arch[1]}${suffix}`);
  return null;
}

/**
 * Content-file candidates for a route across the layouts this repository has
 * used. The baseline snapshot is old by definition, so it must read files
 * from the layout that existed then (`www/content/...`), while current-tree
 * fragment checks read today's layout (`www/content/docs/...`). The refresh
 * path probes both; the ordered `docs/` first keeps today's layout
 * authoritative when both exist.
 */
function contentFileCandidates(route: string, locale: 'en' | 'zh'): string[] {
  const suffix = locale === 'zh' ? '.zh.md' : '.md';
  const roots = ['www/content/docs', 'www/content'];
  if (route === '/architecture') {
    return roots.map((root) => `${root}/architecture/architecture${suffix}`);
  }
  const guide = /^\/guide\/([a-z0-9-]+)$/.exec(route);
  if (guide) return roots.map((root) => `${root}/guide/${guide[1]}${suffix}`);
  const arch = /^\/architecture\/([a-z0-9-]+)$/.exec(route);
  if (arch) return roots.map((root) => `${root}/architecture/${arch[1]}${suffix}`);
  return [];
}

function stripMarkdownInline(text: string): string {
  const dequoted = text
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~]+/g, '');
  return stripHtmlToText(dequoted);
}

/** All h2/h3 ids a document renders, via the shared allocator. */
async function documentHeadingIds(contentFile: string): Promise<Set<string>> {
  const source = await Deno.readTextFile(contentFile);
  const usedIds = new Set<string>();
  const ids = new Set<string>();
  for (const line of source.split('\n')) {
    const heading = /^(#{2,3})\s+(.*)$/.exec(line);
    if (!heading) continue;
    ids.add(slugifyHeadingId(stripMarkdownInline(heading[2]).trim(), usedIds));
  }
  return ids;
}

/**
 * Titles (and navLabels) the retired routes carried at the baseline, for
 * gates that must not resurrect them as link labels. Reads the committed
 * snapshot — no Git access on the normal path.
 */
export async function retiredContentTitles(): Promise<Set<string>> {
  const { manifest } = await retiredRoutes();
  return new Set(manifest.retiredTitles);
}

/**
 * title/navLabel strings the current content tree serves. A link label equal
 * to a surviving page's own title is correct pointing, not a resurrection,
 * so label gates subtract these from the retired set.
 */
export async function currentContentTitles(): Promise<Set<string>> {
  const titles = new Set<string>();
  for (const collection of ['guide', 'architecture']) {
    for await (const entry of Deno.readDir(join(repoRoot, `www/content/docs/${collection}`))) {
      if (!entry.isFile || !entry.name.endsWith('.md')) continue;
      const source = await Deno.readTextFile(
        join(repoRoot, `www/content/docs/${collection}/${entry.name}`),
      );
      for (const field of ['title', 'navLabel']) {
        const match = new RegExp('^' + field + ":\\s*'([^']*)'", 'm').exec(source);
        if (match) titles.add(match[1]);
      }
    }
  }
  return titles;
}

/** Validate the baseline snapshot against the redirect table and fragments. */
export async function collectRetiredUrlFailures(): Promise<
  { failures: string[]; baselineSha: string; retiredCount: number }
> {
  const { manifest, retired } = await retiredRoutes();
  const mappings = await loadRedirectTable();
  const mappedFrom = new Set(mappings.map((mapping) => mapping.from));
  const failures: string[] = [];
  for (const path of [...retired].sort()) {
    if (!mappedFrom.has(path)) failures.push(`retired with no mapping: ${path}`);
  }
  for (const mapping of mappings) {
    if (!retired.has(mapping.from)) failures.push(`stale mapping (not retired): ${mapping.from}`);
  }
  const head = await routePathsIn(join(repoRoot, routesRel));
  for (const mapping of mappings) {
    // The en target is the table literal; the zh target defaults to the
    // locale-expanded `to` unless toZh overrides it (translated heading ids
    // differ — e.g. #measured-output vs #实测输出 — so one shape cannot
    // serve both locales). Both sides validate independently.
    const targets = CONTENT_LOCALES.map((locale) => ({
      locale,
      raw: locale === 'zh' ? mapping.toZh ?? mapping.to : mapping.to,
    }));
    for (const { locale, raw } of targets) {
      const { route, fragment } = stripFragment(raw);
      if (!head.has(route)) {
        failures.push(`mapping target is not a route: ${raw}`);
        continue;
      }
      if (fragment) {
        const contentFile = contentFileFor(route, locale);
        if (!contentFile) {
          failures.push(`cannot verify fragment against non-collection route: ${raw}`);
          continue;
        }
        const ids = await documentHeadingIds(contentFile);
        if (!ids.has(fragment)) failures.push(`fragment #${fragment} missing in ${locale} ${raw}`);
      }
    }
  }
  // The snapshot's own provenance must stay coherent with the table: every
  // retired route contributes titles, and titles must not exist for routes
  // that are still served.
  if (retired.size > 0 && manifest.retiredTitles.length === 0) {
    failures.push(
      `baseline snapshot (${manifest.baseline.sha.slice(0, 12)}) has no retired titles recorded`,
    );
  }
  return { failures, baselineSha: manifest.baseline.sha, retiredCount: retired.size };
}

/**
 * Refresh the committed baseline snapshot from a Git ref. This is the only
 * Git-touching path in this module, and it is never part of the build:
 * run it deliberately when the release baseline advances.
 */
export async function refreshBaseline(ref: string): Promise<void> {
  const resolved = await git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  if (resolved.code !== 0 || !resolved.out) {
    throw new Error(
      `cannot resolve baseline ref ${ref}; fetch it first or pass an explicit revision`,
    );
  }
  const sha = resolved.out;
  const tmp = await Deno.makeTempDir({ prefix: 'retired-urls-base-' });
  let baseline: Set<string>;
  try {
    const archive = new Deno.Command('git', {
      args: ['archive', sha, routesRel],
      cwd: repoRoot,
      stdout: 'piped',
      stderr: 'null',
    });
    const { code, stdout } = await archive.output();
    if (code !== 0) throw new Error(`git archive of ${sha} failed`);
    await Deno.writeFile(join(tmp, 'routes.tar'), stdout);
    const untar = new Deno.Command('tar', {
      args: ['-x', '-f', join(tmp, 'routes.tar'), '-C', tmp],
      stdin: 'null',
      stdout: 'null',
      stderr: 'null',
    });
    const untarred = await untar.output();
    if (untarred.code !== 0) throw new Error('could not unpack the baseline route tree');
    baseline = await routePathsIn(join(tmp, routesRel));
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
  const head = await routePathsIn(join(repoRoot, routesRel));
  const retired = [...baseline].filter((route) => !head.has(route)).sort();
  const titles = new Set<string>();
  for (const route of retired) {
    for (const locale of CONTENT_LOCALES) {
      // Probe every historical layout; old baselines predate the
      // content/docs/ move, so a single hardcoded path would silently
      // contribute zero titles (a dead label gate).
      let shown: { code: number; out: string } = { code: 1, out: '' };
      for (const rel of contentFileCandidates(route, locale)) {
        shown = await git(['show', `${sha}:${rel}`]);
        if (shown.code === 0) break;
      }
      if (shown.code !== 0) continue;
      for (const field of ['title', 'navLabel']) {
        const match = new RegExp(`^${field}:\\s*'([^']*)'`, 'm').exec(shown.out);
        if (match) titles.add(match[1]);
      }
    }
  }
  const manifest: BaselineManifest = {
    baseline: { ref, sha },
    routes: [...baseline].sort(),
    retiredTitles: [...titles].sort(),
  };
  await Deno.writeTextFile(baselinePath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `baseline snapshot refreshed from ${ref} (${sha.slice(0, 12)}): ` +
      `${manifest.routes.length} routes, ${retired.length} retired, ${manifest.retiredTitles.length} titles.`,
  );
}
