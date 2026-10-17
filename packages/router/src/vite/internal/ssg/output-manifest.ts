/**
 * The page documents one SSG run generated.
 *
 * Why a record rather than a wipe: the output directory also holds files this
 * build does not own — Vite's `public/` copy, the client bundle, the island
 * manifests, and whatever the host's own tooling writes beside the pages — so
 * "delete every .html in outDir" would be a delete-anything instruction aimed
 * at the user's own files. The record is instead the authoritative list that
 * both the clean-URL conversion and the next run's prune work from: a run
 * deletes exactly the pages the previous run generated and did not regenerate,
 * and nothing else.
 *
 * The record lives inside the output directory it describes, and every path it
 * carries is validated to resolve inside that directory before it is touched —
 * a truncated, stale, or hand-edited record cannot reach outside.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'pathe';
import { normalizeSeparators } from '@openelement/element/build-utils';

/** Framework-owned, inside the output directory it describes. */
export const SSG_PAGE_MANIFEST = '.openelement/ssg-pages.json';

const MANIFEST_VERSION = 1;

/**
 * The pages the previous run recorded, as paths relative to the output
 * directory. A missing or unreadable record is not an error: the first build
 * into a directory has none, and the only cost of losing it is that a stale
 * page survives one more run.
 */
export function readSsgPageManifest(outDir: string): string[] {
  let raw: string;
  try {
    raw = readFileSync(join(outDir, SSG_PAGE_MANIFEST), 'utf8');
  } catch {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; pages?: unknown };
    if (parsed.version !== MANIFEST_VERSION || !Array.isArray(parsed.pages)) return [];
    return parsed.pages.filter((page): page is string => typeof page === 'string');
  } catch {
    return [];
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
 * Delete the pages a previous run generated. Returns the relative paths it
 * removed, so a caller (and a test) can see exactly what the prune touched.
 */
export function pruneSsgPages(outDir: string): string[] {
  const root = resolve(outDir);
  const removed: string[] = [];
  for (const page of readSsgPageManifest(outDir)) {
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

/** Record this run's pages, replacing whatever the previous run recorded. */
export function writeSsgPageManifest(outDir: string, pages: readonly string[]): void {
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
  writeFileSync(
    manifestPath,
    `${JSON.stringify({ version: MANIFEST_VERSION, pages: [...recorded].sort() }, null, 2)}\n`,
    'utf8',
  );
}
