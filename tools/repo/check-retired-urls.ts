/**
 * Fail closed on retired public URLs with no redirect mapping.
 *
 * The retired set is DERIVED, not listed: the framework's own route scanner
 * runs against the baseline tree (default origin/main, --base to override)
 * and HEAD, and retired = baseline minus head. site-redirects.json maps each
 * retired path to its successor and is validated in both directions — an
 * unmapped retirement and a stale mapping entry are both errors — with
 * locale prefixes expanded from SITE_LOCALES (never written in the table)
 * and fragment targets verified against the real slugified heading ids via
 * the shared slugifyHeadingId (not a second implementation).
 *
 * The table loader is importable (emit-site-redirects.ts reuses it); only
 * the main guard exits.
 */
import { fromFileUrl, join, resolve } from '@std/path';
import { scanRoutes } from '../../packages/router/src/vite/internal/ssg/route-scanner.ts';
import { fileToRoutePath } from '../../www/lib/route-path.ts';
import { slugifyHeadingId } from '../../www/app/site-ui/article-body.ts';

const repoRoot = fromFileUrl(new URL('../../', import.meta.url));
const routesRel = 'www/app/routes';
const tablePath = join(repoRoot, 'tools/repo/site-redirects.json');

export interface RedirectMapping {
  from: string;
  to: string;
  status: number;
  /** zh successor when the translated heading id differs; absent means the locale-expanded `to`. */
  toZh?: string;
}

function fail(message: string): never {
  console.error(`retired-url:check: ${message}`);
  Deno.exit(1);
}

async function git(args: string[]): Promise<{ code: number; out: string }> {
  const command = new Deno.Command('git', {
    args,
    cwd: repoRoot,
    stdout: 'piped',
    stderr: 'null',
  });
  const { code, stdout } = await command.output();
  return { code, out: new TextDecoder().decode(stdout).trim() };
}

/** Resolve the baseline ref to a commit, fetching it first when absent. */
export async function resolveBase(ref: string): Promise<string> {
  const direct = await git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  if (direct.code === 0 && direct.out) return direct.out;
  if (ref.startsWith('origin/')) {
    const branch = ref.slice('origin/'.length);
    const fetched = await git(['fetch', 'origin', branch]);
    if (fetched.code === 0) {
      const retry = await git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
      if (retry.code === 0 && retry.out) return retry.out;
    }
  }
  fail(`cannot resolve baseline ref ${ref} (fetch it first or pass --base)`);
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

/** Routes present in the baseline tree but gone from HEAD. */
export async function deriveRetiredUrls(baseRef: string): Promise<Set<string>> {
  const sha = await resolveBase(baseRef);
  const tmp = await Deno.makeTempDir({ prefix: 'retired-urls-base-' });
  try {
    const archive = new Deno.Command('git', {
      args: ['archive', sha, routesRel],
      cwd: repoRoot,
      stdout: 'piped',
      stderr: 'null',
    });
    const { code, stdout } = await archive.output();
    if (code !== 0) fail(`git archive of ${sha} failed`);
    await Deno.writeFile(join(tmp, 'routes.tar'), stdout);
    const untar = new Deno.Command('tar', {
      args: ['-x', '-f', join(tmp, 'routes.tar'), '-C', tmp],
      stdin: 'null',
      stdout: 'null',
      stderr: 'null',
    });
    const untarred = await untar.output();
    if (untarred.code !== 0) fail('could not unpack the baseline route tree');
    const baseline = await routePathsIn(join(tmp, routesRel));
    const head = await routePathsIn(join(repoRoot, routesRel));
    return new Set([...baseline].filter((path) => !head.has(path)));
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
}

export async function loadRedirectTable(): Promise<RedirectMapping[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await Deno.readTextFile(tablePath));
  } catch {
    fail(`cannot read ${tablePath}`);
  }
  const list = (parsed as { redirects?: unknown }).redirects;
  if (!Array.isArray(list)) fail(`${tablePath} must hold { redirects: [...] }`);
  const mappings: RedirectMapping[] = [];
  for (const entry of list as unknown[]) {
    const { from, to, toZh, status } = entry as Partial<RedirectMapping>;
    if (
      typeof from !== 'string' || !from.startsWith('/') || from.startsWith('/zh/') ||
      typeof to !== 'string' || !to.startsWith('/') || to.startsWith('/zh/') ||
      (toZh !== undefined && (typeof toZh !== 'string' || !toZh.startsWith('/') || toZh.startsWith('/zh/'))) ||
      status !== 301
    ) {
      fail(`bad mapping (want unprefixed from/to/toZh and status 301): ${JSON.stringify(entry)}`);
    }
    mappings.push(toZh === undefined ? { from, to, status } : { from, to, toZh, status });
  }
  return mappings;
}

function stripFragment(path: string): { route: string; fragment: string } {
  const hash = path.indexOf('#');
  return hash < 0 ? { route: path, fragment: '' } : { route: path.slice(0, hash), fragment: path.slice(hash + 1) };
}

/** Content file backing a collection route, for fragment verification. */
function contentFileFor(route: string, locale: 'en' | 'zh'): string | null {
  const suffix = locale === 'zh' ? '.zh.md' : '.md';
  if (route === '/architecture') return join(repoRoot, `www/content/docs/architecture/architecture${suffix}`);
  const guide = /^\/guide\/([a-z0-9-]+)$/.exec(route);
  if (guide) return join(repoRoot, `www/content/docs/guide/${guide[1]}${suffix}`);
  const arch = /^\/architecture\/([a-z0-9-]+)$/.exec(route);
  if (arch) return join(repoRoot, `www/content/docs/architecture/${arch[1]}${suffix}`);
  return null;
}

function stripMarkdownInline(text: string): string {
  return text
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~]+/g, '')
    .replace(/<[^>]+>/g, '');
}

/** All h2/h3 ids a document renders, via the shared allocator. */
async function documentHeadingIds(contentFile: string): Promise<Set<string>> {
  const source = await Deno.readTextFile(contentFile);
  const seen = new Map<string, number>();
  const ids = new Set<string>();
  for (const line of source.split('\n')) {
    const heading = /^(#{2,3})\s+(.*)$/.exec(line);
    if (!heading) continue;
    ids.add(slugifyHeadingId(stripMarkdownInline(heading[2]).trim(), seen));
  }
  return ids;
}

/**
 * Titles (and navLabels) the retired routes carried on the baseline, for
 * gates that must not resurrect them as link labels. Route-only pages
 * (no content file) contribute nothing.
 */
export async function retiredContentTitles(baseRef = 'origin/main'): Promise<Set<string>> {
  const sha = await resolveBase(baseRef);
  const retired = await deriveRetiredUrls(baseRef);
  const titles = new Set<string>();
  for (const route of retired) {
    for (const locale of ['en', 'zh'] as const) {
      const abs = contentFileFor(route, locale);
      if (!abs) continue;
      const rel = abs.slice(repoRoot.length + 1);
      const shown = await git(['show', `${sha}:${rel}`]);
      if (shown.code !== 0) continue;
      for (const field of ['title', 'navLabel']) {
        const match = new RegExp(`^${field}:\\s*'([^']*)'`, 'm').exec(shown.out);
        if (match) titles.add(match[1]);
      }
    }
  }
  return titles;
}

export async function checkRetiredUrls(baseRef: string): Promise<void> {
  const retired = await deriveRetiredUrls(baseRef);
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
    const targets = [
      { locale: 'en' as const, raw: mapping.to },
      { locale: 'zh' as const, raw: mapping.toZh ?? mapping.to },
    ];
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
  if (failures.length > 0) {
    for (const failure of failures) console.error(`- ${failure}`);
    Deno.exit(1);
  }
  console.log(
    retired.size === 0 ? 'no retired urls' : `retired urls ok: ${retired.size} retired, all mapped.`,
  );
}

function baseRefFromArgs(args: string[]): string {
  const flag = args.indexOf('--base');
  if (flag >= 0 && args[flag + 1]) return args[flag + 1];
  return 'origin/main';
}

if (import.meta.main) {
  await checkRetiredUrls(baseRefFromArgs(Deno.args));
}
