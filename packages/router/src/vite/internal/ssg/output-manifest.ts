/**
 * The page documents and stylesheet one SSG run generated.
 *
 * Why a record rather than a wipe: the output directory also holds files this
 * build does not own — Vite's `public/` copy, the client bundle, the island
 * manifests, and whatever the host's own tooling writes beside the pages — so
 * page pruning uses the preceding run's record of generated documents.
 * Publishing uses the new record written after the routes have their final
 * names. The immutable stylesheet stays reusable in the working directory
 * and reaches the public snapshot only when the current run lists it.
 *
 * The record lives inside the output directory it describes, and every path it
 * carries is validated to resolve inside that directory before it is touched —
 * a truncated, stale, or hand-edited record cannot reach outside.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'pathe';
import { normalizeSeparators } from '@openelement/element/build-utils';
import { ssgViewTransitionStyleHash } from '../paths.ts';

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

/**
 * Delete the page documents a previous run generated. Returns the relative paths it
 * removed, so a caller (and a test) can see exactly what the prune touched.
 */
export function pruneSsgOutput(outDir: string): string[] {
  const root = resolve(outDir);
  const removed: string[] = [];
  const { pages } = readSsgOutputManifest(outDir);
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
