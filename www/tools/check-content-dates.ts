/**
 * Validate the hand-maintained content-dates manifest against the docs tree.
 *
 * `www/lib/content-dates.json` records, per guide/architecture article and per
 * locale, the date the article's source was last meaningfully updated. It is
 * maintained by hand: this check never runs Git, never writes, and has no
 * regeneration mode. It keeps the manifest honest by failing closed when:
 *
 * - a docs article (`www/content/docs/{guide,architecture}/*.md`) has no
 *   manifest entry (a `.zh.md` file folds onto its English key);
 * - a manifest entry names an article the docs tree no longer has;
 * - an entry is missing a site locale (en/zh), or carries an unknown one;
 * - a stamp is not a string, or is neither `uncommitted` nor a real
 *   `YYYY-MM-DD` calendar date (2026-02-30 is rejected).
 *
 * The site build consumes the manifest read-only
 * (`generate-site-content-data.ts` projects it into
 * `_generated-content-meta.ts`) and hides the `uncommitted` sentinel instead
 * of showing a machine-local date.
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { SITE_LOCALES } from '../site-config.ts';
import { isCalendarDate } from './lib/calendar-date.ts';
import { readFile } from 'node:fs/promises';
import process from 'node:process';

export { isCalendarDate };

export const COLLECTIONS = ['guide', 'architecture'] as const;

/** Stamp for an article whose date is not known yet; the render layer hides it. */
export const UNCOMMITTED = 'uncommitted';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const contentRoot = join(repoRoot, 'www/content/docs');
const manifestFile = join(repoRoot, 'www/lib/content-dates.json');

/**
 * The subset of a node directory entry the scanner reads. The seam exists so
 * unit tests can fake the tree without touching the filesystem.
 */
export type DirEntry = Pick<Dirent, 'name' | 'isFile' | 'isDirectory' | 'isSymbolicLink'>;

/** Production reader: node readdir with file types (the pre-port directory API). */
export async function* readDirEntries(path: string): AsyncIterable<DirEntry> {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    yield entry;
  }
}

export type DirReader = (path: string) => AsyncIterable<DirEntry>;

/** Article keys (`<collection>/<slug>`) of the markdown files under `root`. */
export async function collectDocKeys(
  root: string = contentRoot,
  readDir: DirReader = readDirEntries,
): Promise<Set<string>> {
  const keys = new Set<string>();
  for (const collection of COLLECTIONS) {
    for await (const entry of readDir(join(root, collection))) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const slug = entry.name.replace(/\.zh\.md$/, '').replace(/\.md$/, '');
      keys.add(`${collection}/${slug}`);
    }
  }
  return keys;
}

/**
 * Every problem that makes `manifest` invalid for `docKeys`: missing or extra
 * articles, missing or unknown locales, non-string stamps, and impossible
 * calendar dates. An empty array means the manifest is valid.
 */
export function validateManifest(
  manifest: unknown,
  docKeys: ReadonlySet<string>,
  locales: readonly string[] = SITE_LOCALES,
): string[] {
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    return ['manifest must be a JSON object'];
  }
  const rawArticles = (manifest as { articles?: unknown }).articles;
  if (typeof rawArticles !== 'object' || rawArticles === null || Array.isArray(rawArticles)) {
    return ['manifest.articles must be a JSON object'];
  }
  const articles = rawArticles as Record<string, unknown>;
  const problems: string[] = [];

  for (const key of [...docKeys].sort()) {
    if (!(key in articles)) {
      problems.push(
        `${key}: missing from the manifest (add an entry with ${locales.join(' and ')} stamps)`,
      );
    }
  }
  for (const key of Object.keys(articles).sort()) {
    if (!docKeys.has(key)) {
      problems.push(`${key}: no article at www/content/docs/${key}.md`);
    }
  }
  for (const key of [...docKeys].sort()) {
    const entry = articles[key];
    if (entry === undefined) continue;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      problems.push(`${key}: entry must be an object with ${locales.join('/')} stamps`);
      continue;
    }
    const stamps = entry as Record<string, unknown>;
    for (const locale of locales) {
      if (!(locale in stamps)) {
        problems.push(`${key}: missing '${locale}' stamp`);
        continue;
      }
      const stamp = stamps[locale];
      if (typeof stamp !== 'string') {
        problems.push(`${key}.${locale}: stamp must be a string, got ${typeof stamp}`);
        continue;
      }
      if (stamp !== UNCOMMITTED && !isCalendarDate(stamp)) {
        problems.push(
          `${key}.${locale}: '${stamp}' is not a YYYY-MM-DD calendar date or '${UNCOMMITTED}'`,
        );
      }
    }
    for (const locale of Object.keys(stamps).sort()) {
      if (!locales.includes(locale)) {
        problems.push(`${key}.${locale}: unknown locale (the site builds ${locales.join(', ')})`);
      }
    }
  }
  return problems;
}

async function main(): Promise<void> {
  if (process.argv.slice(2).length > 0) {
    console.error(
      `content-dates: unexpected argument(s) ${process.argv
        .slice(2)
        .map((arg) => `'${arg}'`)
        .join(' ')}. ` +
        'This check is read-only: the manifest is hand-maintained and there is no --write mode.',
    );
    process.exit(2);
  }
  let raw: string;
  try {
    raw = await readFile(manifestFile, 'utf8');
  } catch (error) {
    console.error(`content-dates: cannot read ${manifestFile}: ${String(error)}`);
    process.exit(1);
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(raw);
  } catch (error) {
    console.error(`content-dates: ${manifestFile} is not valid JSON: ${String(error)}`);
    process.exit(1);
  }
  const docKeys = await collectDocKeys();
  const problems = validateManifest(manifest, docKeys);
  if (problems.length > 0) {
    console.error(
      'content-dates check failed (the hand-maintained manifest must match the docs tree):',
    );
    for (const problem of problems) console.error(`- ${problem}`);
    process.exit(1);
  }
  console.log(
    `content dates check passed (${docKeys.size} articles, ${SITE_LOCALES.join('/')} stamps each).`,
  );
}

if (import.meta.main) await main();
