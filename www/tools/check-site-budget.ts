/**
 * Report-only site budget checker (T10 R7).
 *
 * The enforced SLO (www/site-budget.ts `SITE_BUDGET`) covers island and client
 * JS only. The 2026-10-18 audit showed where the rest of a page load actually
 * goes — CSS is the largest single bucket (~43 KB gzipped per page, two
 * stylesheets), the generated /reference page is 15x the median HTML, and
 * the build had no baseline for page media.
 *
 * This tool measures the built tree and prints actual vs
 * `SITE_BUDGET_REPORT_ONLY`. It exits 0 by default: the figures are single
 * machine measurements, so a red gate would be noise until a CI baseline and a
 * tolerance policy exist. `--strict` flips it to a failing comparison, so
 * promoting the check later is one gate line, not a rewrite.
 *
 * Measurement rules (documented because the numbers are the point):
 *   - HTML bytes are gzip -9 via node:zlib (in-process; same level the doc
 *     figures use through the gzip CLI);
 *   - a page's CSS is every `rel=stylesheet` it links, gzipped and summed;
 *   - fonts are every font binary the artifact ships, raw (woff2 is already
 *     compressed, so gzip would only report container overhead);
 *   - media counts only same-origin files referenced by built pages.
 *
 * Usage:
 *   node www/tools/check-site-budget.ts [--dist www/dist] [--strict] [--json out.json]
 */
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import process from 'node:process';
import { SITE_BUDGET_REPORT_ONLY } from '../site-budget.ts';

export interface SiteBudgetMetrics {
  /** Gzipped HTML bytes of the median page (the generated mega-page excluded). */
  htmlMedianBytes: number;
  /** Gzipped HTML bytes of the largest page. */
  htmlMaxBytes: number;
  /** Route of the largest page, for the report. */
  htmlMaxRoute: string;
  /** Gzipped bytes of the stylesheets the median page links. */
  cssBytes: number;
  /** Raw bytes of every font file in the artifact. */
  fontBytes: number;
  /** Raw bytes of same-origin media referenced by built pages. */
  mediaBytes: number;
}

export interface BudgetRow {
  dimension: string;
  actual: number;
  baseline: number;
  /** actual/baseline, e.g. 1.04 = 4% over. */
  ratio: number;
  over: boolean;
}

const FONT_RE = /\.(?:woff2?|ttf|otf)$/iu;

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/**
 * Compare measured metrics against the report-only baselines. Pure, so the
 * unit test can drive it with synthetic metrics.
 */
export function evaluateSiteBudget(
  metrics: SiteBudgetMetrics,
  budget: typeof SITE_BUDGET_REPORT_ONLY = SITE_BUDGET_REPORT_ONLY,
  tolerance = 0.05,
): BudgetRow[] {
  const rows: Array<[string, number, number]> = [
    ['html median (gzip)', metrics.htmlMedianBytes, budget.htmlMedianKB * 1024],
    ['html max (gzip)', metrics.htmlMaxBytes, budget.htmlMaxKB * 1024],
    ['first-view css (gzip)', metrics.cssBytes, budget.cssKB * 1024],
    ['fonts (raw)', metrics.fontBytes, budget.fontKB * 1024],
    ['page media (raw)', metrics.mediaBytes, budget.mediaKB * 1024],
  ];
  return rows.map(([dimension, actual, baseline]) => ({
    dimension,
    actual,
    baseline,
    ratio: baseline === 0 ? 0 : actual / baseline,
    over: actual > baseline * (1 + tolerance),
  }));
}

const attr = (tag: string, name: string): string | null =>
  new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'iu').exec(tag)?.[1] ?? null;

/** Measure a built tree. Exported for tests and for the CLI below. */
export async function collectSiteBudget(dist: string): Promise<SiteBudgetMetrics> {
  const files = new Map<string, number>();
  for (const entry of await readdir(dist, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const absolute = join(entry.parentPath, entry.name);
    files.set(absolute.slice(dist.length + 1), (await stat(absolute)).size);
  }

  const gzipCache = new Map<string, number>();
  const gzipOf = async (rel: string): Promise<number> => {
    const cached = gzipCache.get(rel);
    if (cached !== undefined) return cached;
    let value = 0;
    try {
      value = gzipSync(await readFile(join(dist, rel)), { level: 9 }).length;
    } catch {
      value = 0;
    }
    gzipCache.set(rel, value);
    return value;
  };

  const htmlPages: Array<{ rel: string; gzip: number; css: number }> = [];
  let mediaBytes = 0;
  for (const rel of files.keys()) {
    if (!rel.endsWith('.html')) continue;
    const html = await readFile(join(dist, rel), 'utf8');
    const sheets = [...html.matchAll(/<link\b[^>]*>/gi)]
      .map((match) => match[0])
      .filter((tag) => (attr(tag, 'rel') ?? '').includes('stylesheet'))
      .map((tag) => attr(tag, 'href'))
      .filter((href): href is string => Boolean(href) && !href!.startsWith('http'))
      .map((href) => href!.slice(1).split('?')[0]!);
    let css = 0;
    for (const sheet of sheets) css += await gzipOf(sheet);
    for (const match of html.matchAll(/<(?:img|source|video|audio)\b[^>]*>/gi)) {
      const src = attr(match[0], 'src') ?? attr(match[0], 'poster');
      if (!src || src.startsWith('http') || src.startsWith('data:')) continue;
      mediaBytes += files.get(src.slice(1).split('?')[0]!) ?? 0;
    }
    // The generated mega-page is reported through the max row, not the median.
    if (rel !== 'reference/index.html') {
      htmlPages.push({ rel, gzip: await gzipOf(rel), css });
    } else {
      htmlPages.push({ rel, gzip: await gzipOf(rel), css });
    }
  }

  const contentPages = htmlPages.filter((page) => page.rel !== 'reference/index.html');
  const largest = htmlPages.reduce((acc, page) => (page.gzip > acc.gzip ? page : acc), {
    rel: 'none',
    gzip: 0,
    css: 0,
  });
  const fontBytes = [...files.entries()]
    .filter(([rel]) => FONT_RE.test(rel))
    .reduce((sum, [, bytes]) => sum + bytes, 0);

  return {
    htmlMedianBytes: median(contentPages.map((page) => page.gzip)),
    htmlMaxBytes: largest.gzip,
    htmlMaxRoute: `/${largest.rel
      .replace(/index\.html$/, '')
      .replace(/\.html$/, '')
      .replace(/\/$/, '')}`,
    cssBytes: median(contentPages.map((page) => page.css)),
    fontBytes,
    mediaBytes,
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const dist = args.includes('--dist')
    ? args[args.indexOf('--dist') + 1]!
    : fileURLToPath(new URL('../dist', import.meta.url));
  const strict = args.includes('--strict');
  const metrics = await collectSiteBudget(dist);
  const rows = evaluateSiteBudget(metrics);
  console.log(`site budget (report-only) — dist: ${dist}`);
  console.log(`  largest page: ${metrics.htmlMaxRoute} (${metrics.htmlMaxBytes} B gzip)`);
  let over = 0;
  for (const row of rows) {
    const pct =
      row.baseline === 0 ? 'no baseline' : `${((row.ratio - 1) * 100).toFixed(1)}% vs baseline`;
    const flag = row.over ? 'OVER' : 'ok  ';
    if (row.over) over++;
    console.log(
      `  ${flag} ${row.dimension.padEnd(22)} actual=${String(row.actual).padStart(9)} B ` +
        `baseline=${String(row.baseline).padStart(9)} B (${pct})`,
    );
  }
  if (over > 0) {
    console.log(
      `  ${over} dimension(s) above baseline +5%. Report-only: this is a signal to ` +
        're-baseline or investigate, not a failure.',
    );
  }
  if (args.includes('--json')) {
    const out = args[args.indexOf('--json') + 1]!;
    await writeFile(out, JSON.stringify({ metrics, rows }, null, 1));
    console.log(`  json written: ${out}`);
  }
  if (strict && over > 0) process.exit(1);
}
