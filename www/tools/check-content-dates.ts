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
import { fromFileUrl, join } from '@std/path';
import { SITE_LOCALES } from '../site-config.ts';

export const COLLECTIONS = ['guide', 'architecture'] as const;

/** Stamp for an article whose date is not known yet; the render layer hides it. */
export const UNCOMMITTED = 'uncommitted';

const repoRoot = fromFileUrl(new URL('../../', import.meta.url));
const contentRoot = join(repoRoot, 'www/content/docs');
const manifestFile = join(repoRoot, 'www/lib/content-dates.json');

/** Whether `value` is a real calendar date written as `YYYY-MM-DD`. */
export function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Round-trip through Date: out-of-range components normalize onto another
  // date (2026-02-30 -> 2026-03-02, month 13 -> next January), so a mismatch
  // is an impossible calendar date. setUTCFullYear (not the Date constructor)
  // keeps four-digit years 0000-0099 literal instead of mapping them to 1900s.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * Directory reader seam: `Deno.readDir` in production, a fake tree in tests
 * (which keeps the unit tests filesystem-permission-free).
 */
export type DirReader = (path: string) => AsyncIterable<Deno.DirEntry>;

/** Article keys (`<collection>/<slug>`) of the markdown files under `root`. */
export async function collectDocKeys(
  root: string = contentRoot,
  readDir: DirReader = Deno.readDir,
): Promise<Set<string>> {
  const keys = new Set<string>();
  for (const collection of COLLECTIONS) {
    for await (const entry of readDir(join(root, collection))) {
      if (!entry.isFile || !entry.name.endsWith('.md')) continue;
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
  if (Deno.args.length > 0) {
    console.error(
      `content-dates: unexpected argument(s) ${Deno.args.map((arg) => `'${arg}'`).join(' ')}. ` +
        'This check is read-only: the manifest is hand-maintained and there is no --write mode.',
    );
    Deno.exit(2);
  }
  let raw: string;
  try {
    raw = await Deno.readTextFile(manifestFile);
  } catch (error) {
    console.error(`content-dates: cannot read ${manifestFile}: ${String(error)}`);
    Deno.exit(1);
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(raw);
  } catch (error) {
    console.error(`content-dates: ${manifestFile} is not valid JSON: ${String(error)}`);
    Deno.exit(1);
  }
  const docKeys = await collectDocKeys();
  const problems = validateManifest(manifest, docKeys);
  if (problems.length > 0) {
    console.error(
      'content-dates check failed (the hand-maintained manifest must match the docs tree):',
    );
    for (const problem of problems) console.error(`- ${problem}`);
    Deno.exit(1);
  }
  console.log(
    `content dates check passed (${docKeys.size} articles, ${SITE_LOCALES.join('/')} stamps each).`,
  );
}

if (import.meta.main) await main();
