/**
 * Static CSS/JS cost report for one built tree (alpha15 S lane, S-C2/S-15 and
 * the K→S comparison S-C3/S-16).
 *
 * One script, one measurement recipe, so two revisions are compared under
 * identical conditions: raw bytes, gzip -9 bytes (the same algorithm on both
 * sides), file counts, HTML bytes, and the two CSS-granularity facts the S lane
 * owns — how many unique selectors exist versus how many rule occurrences the
 * delivered sheets carry, and whether any two delivered sheets are byte-equal.
 *
 * Usage:
 *   node tools/release/css-cost-report.ts --dist tests/fixtures/site-light-probe/dist --label K
 *   node tools/release/css-cost-report.ts --dist <dir> --json
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, relative } from 'node:path';
import process from 'node:process';

interface FileCost {
  readonly path: string;
  readonly raw: number;
  readonly gzip: number;
}

interface CssBreakdown {
  readonly files: readonly FileCost[];
  readonly rawTotal: number;
  readonly gzipTotal: number;
  readonly ruleOccurrences: number;
  readonly uniqueSelectors: number;
  readonly duplicatedSheets: readonly string[];
  readonly selectorsInMultipleFiles: readonly string[];
}

interface Report {
  readonly dist: string;
  readonly label: string;
  readonly css: CssBreakdown;
  readonly js: { files: readonly FileCost[]; rawTotal: number; gzipTotal: number };
  readonly html: { files: readonly FileCost[]; rawTotal: number };
  readonly server: { files: number; rawTotal: number };
  readonly counts: {
    cssAssets: number;
    jsFiles: number;
    htmlFiles: number;
    islandChunks: number;
    islandManifests: number;
  };
}

/** Every file under `dir`, recursively, with its raw/gzip sizes. */
function walk(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}

function cost(path: string, rel: string): FileCost {
  const bytes = readFileSync(path);
  return { path: rel, raw: bytes.byteLength, gzip: gzipSync(bytes, { level: 9 }).byteLength };
}

/** The rule selectors of a flat component sheet (comments stripped). */
function selectorsOf(css: string): string[] {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('{')
    .slice(0, -1)
    .map((part) => (part.split('}').pop() ?? '').replace(/\s+/g, ' ').trim())
    .filter((selector) => selector !== '')
    .map((selector) => selector.replace(/\s*,\s*/g, ','));
}

function cssBreakdown(distDir: string): CssBreakdown {
  const dir = join(distDir, 'client', 'assets');
  const files = walk(dir).filter((path) => path.endsWith('.css'));
  const costs = files.map((path) => cost(path, relative(distDir, path)));
  const byContent = new Map<string, string[]>();
  const selectorOwners = new Map<string, string[]>();
  let ruleOccurrences = 0;
  for (const path of files) {
    const text = readFileSync(path, 'utf8');
    const rel = relative(distDir, path);
    byContent.set(text, [...(byContent.get(text) ?? []), rel]);
    for (const selector of selectorsOf(text)) {
      ruleOccurrences += 1;
      selectorOwners.set(selector, [...(selectorOwners.get(selector) ?? []), rel]);
    }
  }
  return {
    files: costs,
    rawTotal: costs.reduce((sum, file) => sum + file.raw, 0),
    gzipTotal: costs.reduce((sum, file) => sum + file.gzip, 0),
    ruleOccurrences,
    uniqueSelectors: selectorOwners.size,
    duplicatedSheets: [...byContent.values()].filter((group) => group.length > 1).flat(),
    selectorsInMultipleFiles: [...selectorOwners.entries()]
      .filter(([, group]) => new Set(group).size > 1)
      .map(([selector]) => selector),
  };
}

function buildReport(distDir: string, label: string): Report {
  const css = cssBreakdown(distDir);
  const jsFiles = [
    ...walk(join(distDir, 'client')).filter((path) => path.endsWith('.js')),
    ...walk(join(distDir, 'islands')).filter((path) => path.endsWith('.js')),
  ];
  const js = jsFiles.map((path) => cost(path, relative(distDir, path)));
  const htmlFiles = walk(distDir).filter(
    (path) => path.endsWith('.html') && !path.includes(`${join('client')}`),
  );
  const html = htmlFiles.map((path) => cost(path, relative(distDir, path)));
  const serverFiles = walk(join(distDir, 'server'));
  const server = {
    files: serverFiles.length,
    rawTotal: serverFiles.reduce((sum, path) => sum + statSync(path).size, 0),
  };
  return {
    dist: distDir,
    label,
    css,
    js: {
      files: js,
      rawTotal: js.reduce((sum, file) => sum + file.raw, 0),
      gzipTotal: js.reduce((sum, file) => sum + file.gzip, 0),
    },
    html: { files: html, rawTotal: html.reduce((sum, file) => sum + file.raw, 0) },
    server,
    counts: {
      cssAssets: css.files.length,
      jsFiles: js.length,
      htmlFiles: html.length,
      islandChunks: walk(join(distDir, 'client', 'islands')).filter((path) => path.endsWith('.js'))
        .length,
      islandManifests: walk(join(distDir, 'island-manifests')).length,
    },
  };
}

function kib(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function printReport(report: Report): void {
  console.log(`# CSS cost report — ${report.label} (${report.dist})`);
  console.log('');
  console.log('## Delivered CSS assets (raw / gzip -9)');
  for (const file of report.css.files) {
    console.log(`  ${file.path}  ${file.raw} B / ${file.gzip} B`);
  }
  console.log(
    `  TOTAL css: ${report.css.rawTotal} B raw / ${report.css.gzipTotal} B gzip ` +
      `(${report.counts.cssAssets} asset(s))`,
  );
  console.log(
    `  granularity: ${report.css.ruleOccurrences} rule occurrence(s), ` +
      `${report.css.uniqueSelectors} unique selector(s), ` +
      `${report.css.duplicatedSheets.length} byte-equal sheet(s), ` +
      `${report.css.selectorsInMultipleFiles.length} selector(s) in >1 sheet`,
  );
  console.log('');
  console.log('## Delivered JS');
  for (const file of report.js.files) {
    console.log(`  ${file.path}  ${file.raw} B / ${file.gzip} B`);
  }
  console.log(
    `  TOTAL js: ${report.js.rawTotal} B raw / ${report.js.gzipTotal} B gzip (${report.counts.jsFiles} file(s))`,
  );
  console.log('');
  console.log('## HTML / SSR artifacts');
  console.log(`  html: ${report.html.rawTotal} B raw over ${report.counts.htmlFiles} file(s)`);
  console.log(
    `  server bundle: ${kib(report.server.rawTotal)} over ${report.server.files} file(s)`,
  );
  console.log(`  island chunks: ${report.counts.islandChunks}`);
  console.log(`  island manifests: ${report.counts.islandManifests}`);
}

const args = process.argv.slice(2);
const flag = (name: string, fallback?: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const dist = flag('dist');
if (!dist) {
  console.error('usage: css-cost-report.ts --dist <dir> [--label name] [--json]');
  process.exit(2);
}
const report = buildReport(dist, flag('label', dist) ?? dist);
if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
else printReport(report);
