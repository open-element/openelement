/**
 * The page documents and stylesheet one SSG run generated.
 *
 * Why a record rather than a wipe: the output directory also holds files this
 * build does not own — Vite's `public/` copy, the client bundle, the island
 * manifests, and whatever the host's own tooling writes beside the pages — so
 * pruning uses the preceding run's record of generated output. Publishing
 * uses the new record written after the route files have their final names.
 *
 * The record lives inside the output directory it describes, and every path it
 * carries is validated to resolve inside that directory before it is touched —
 * a truncated, stale, or hand-edited record cannot reach outside.
 */
import { lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'pathe';
import { normalizeSeparators } from '@openelement/element/build-utils';
import { ssgViewTransitionStyleHash } from '../paths.ts';
import { publicFileDigest } from '../publish-manifest.ts';

/** Framework-owned, inside the output directory it describes. */
export const SSG_PAGE_MANIFEST = '.openelement/ssg-pages.json';

const MANIFEST_VERSION = 1;

interface SsgOutputManifest {
  pages: string[];
  viewTransitionStyle?: string;
}

/**
 * The previous run's output paths relative to the output directory. A missing
 * or unreadable record prevents pruning, as on a first build.
 */
export function readSsgOutputManifest(outDir: string): SsgOutputManifest {
  try {
    const raw = readFileSync(join(outDir, SSG_PAGE_MANIFEST), 'utf8');
    const parsed = JSON.parse(raw) as {
      version?: unknown;
      pages?: unknown;
      viewTransitionStyle?: unknown;
    };
    if (parsed.version !== MANIFEST_VERSION || !Array.isArray(parsed.pages)) return { pages: [] };
    const pages = parsed.pages.filter((page): page is string => typeof page === 'string');
    const style = parsed.viewTransitionStyle;
    return typeof style === 'string' && ssgViewTransitionStyleHash(style) !== undefined
      ? { pages, viewTransitionStyle: style }
      : { pages };
  } catch {
    return { pages: [] };
  }
}

/**
 * Resolve one recorded path against the output directory, or `null` when it
 * escapes — which is the answer for absolute paths, `..` traversal, and the
 * output directory itself.
 */
function insideOutDir(root: string, page: string): string | null {
  if (page === '') return null;
  const target = resolve(root, page);
  const rel = relative(root, target);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  return target;
}

function pruneViewTransitionStyle(root: string, path: string): boolean {
  try {
    const file = join(normalize(realpathSync(root)), path);
    // A public file copied over the old asset, or a symlink in its place,
    // belongs to the host. Only remove the recorded stylesheet bytes.
    if (!lstatSync(file).isFile() || normalize(realpathSync(file)) !== file) return false;
    if (publicFileDigest(readFileSync(file)).slice(0, 12) !== ssgViewTransitionStyleHash(path)) {
      return false;
    }
    rmSync(file, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete the files a previous run generated. Returns the relative paths it
 * removed, so a caller (and a test) can see exactly what the prune touched.
 */
export function pruneSsgOutput(outDir: string): string[] {
  const root = resolve(outDir);
  const removed: string[] = [];
  const { pages, viewTransitionStyle } = readSsgOutputManifest(outDir);
  for (const page of pages) {
    const target = insideOutDir(root, page);
    if (target === null) continue;
    try {
      rmSync(target, { force: true });
      removed.push(relative(root, target));
    } catch {
      // A page that cannot be removed is left for the run to overwrite; the
      // build's own write is the authority on its content either way.
    }
  }
  if (viewTransitionStyle && pruneViewTransitionStyle(root, viewTransitionStyle)) {
    removed.push(viewTransitionStyle);
  }
  return removed;
}

/** Record this run's output, replacing whatever the previous run recorded. */
export function writeSsgOutputManifest(
  outDir: string,
  pages: readonly string[],
  viewTransitionStyle: string | undefined,
): void {
  const root = resolve(outDir);
  const recorded = new Set<string>();
  for (const page of pages) {
    const target = resolve(root, page);
    const rel = relative(root, target);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) continue;
    recorded.add(normalizeSeparators(rel));
  }
  const manifestPath = join(root, SSG_PAGE_MANIFEST);
  mkdirSync(dirname(manifestPath), { recursive: true });
  const manifest = { version: MANIFEST_VERSION, pages: [...recorded].sort(), viewTransitionStyle };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}
