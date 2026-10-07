/**
 * Doc-figures gate: the Measured-output numbers in comparison.md/.zh.md
 * must equal a fresh measurement of www/dist.
 *
 * Both sides derive — figure expectations come from regexing the two doc
 * files (never a hand list here), actuals from dist (html count, sitemap
 * locs, manifests, pagefind entry, chunk raw+gzip bytes, per-route
 * payloads). A route payload is the eager download closure: the route's
 * manifest chunk set plus `client.js`, closed over the static-import edges
 * the client build records in dist/client/.vite/manifest.json — so shared
 * chunks that ride along on every page are counted no matter which chunk
 * file hosts them. Byte-size totals from `du` are deliberately NOT gated:
 * platform du accounting differs between macOS and Linux runners.
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir, readFile, stat } from 'node:fs/promises';
import process from 'node:process';
import { commandOutput } from '../../tools/repo/node-command.ts';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const dist = join(repoRoot, 'www/dist');
const docs = [
  join(repoRoot, 'www/content/docs/architecture/comparison.md'),
  join(repoRoot, 'www/content/docs/architecture/comparison.zh.md'),
];

const failures: string[] = [];
function check(name: string, expected: number, actual: number, tolerance = 0): void {
  // gzip bytes vary across platforms (header OS byte, mtime) for identical
  // input, so gzip rows carry a ±3% tolerance. Raw chunk bytes have the
  // same class of variance across runner images (2026-09-20: identical
  // tree recorded at 78176, measured 78243 and 78412 on two CI runners),
  // so chunk-raw rows carry the ±1% tolerance the summed payload rows
  // below already use. Content changes still move the exact html-count,
  // locs, and manifest rows. Retirement condition: when the island build
  // is deterministic across runner images again, restore the exact compare.
  const ok =
    tolerance > 0
      ? Math.abs(expected - actual) <= Math.ceil(expected * tolerance)
      : expected === actual;
  if (!ok) failures.push(`${name}: doc says ${expected}, dist measures ${actual}`);
}

async function gzipSize(file: string): Promise<number> {
  // Must be gzip -9: the doc figures are measured that way and
  // CompressionStream would produce different bytes.
  const child = await commandOutput('gzip', {
    args: ['-9', '-c', file],
    stdin: 'null',
    stdout: 'piped',
    stderr: 'null',
  });
  const { code, stdout } = child;
  if (code !== 0) throw new Error(`gzip -9 failed for ${file}`);
  return stdout.length;
}

const distFiles = new Map<string, string>();
for (const entry of await readdir(dist, { recursive: true, withFileTypes: true })) {
  if (entry.isDirectory()) continue;
  distFiles.set(
    `${entry.parentPath}/${entry.name}`.slice(dist.length + 1),
    `${entry.parentPath}/${entry.name}`,
  );
}
const distHtml = [...distFiles.keys()].filter((path) => path.endsWith('.html'));
const sitemap = await readFile(join(dist, 'sitemap.xml'), 'utf8');
const sitemapLocs = (sitemap.match(/<loc>/g) ?? []).length;
const manifestPaths = [...distFiles.keys()].filter(
  (path) => path.startsWith('island-manifests/') && path.endsWith('.json'),
);
const manifests = await Promise.all(
  manifestPaths.map(async (path) => JSON.parse(await readFile(join(dist, path), 'utf8'))),
);
const tagCounts = new Map<string, number>();
let manifestEntries = 0;
for (const manifest of manifests) {
  for (const island of manifest.islands as Array<{ tagName: string }>) {
    tagCounts.set(island.tagName, (tagCounts.get(island.tagName) ?? 0) + 1);
    manifestEntries++;
  }
}
const entryJson = JSON.parse(await readFile(join(dist, 'pagefind/pagefind-entry.json'), 'utf8'));
const fragmentFiles = [...distFiles.keys()].filter((path) => path.startsWith('pagefind/fragment/'));

const chunkSize = new Map<string, { raw: number; gzip: number }>();
for (const [rel, abs] of distFiles) {
  const match = /^client\/islands\/(.+)$/.exec(rel);
  if (match?.[0].endsWith('.js')) {
    chunkSize.set(match[1]!, {
      raw: (await stat(abs)).size,
      gzip: await gzipSize(abs),
    });
  }
}
function chunkStem(docName: string): string {
  // Doc names are either the full filename (`client.js`) or the emitted
  // chunk stem without its content hash (`island-open-layout`).
  const hits = [...chunkSize.keys()].filter(
    (file) =>
      file === docName ||
      (!docName.endsWith('.js') && file.startsWith(`${docName}-`) && file.endsWith('.js')),
  );
  if (hits.length !== 1) {
    failures.push(`chunk ${docName}: want exactly one dist file, found ${hits.length}`);
  }
  return hits[0] ?? docName;
}

/**
 * The client build's Vite manifest (dist/client/.vite/manifest.json), read as
 * a static-import graph over site-absolute chunk URLs. `client.js` and the
 * island chunks carry static imports (shared runtime chunks, chunk-level
 * de-duplication), so a route's real download is its manifest chunk set plus
 * everything those files eagerly import — measured as the closure, the number
 * stays honest no matter which chunk file the bundler hosts shared code in.
 * Dynamic imports are deliberately not followed: the strategy loader's
 * dynamic edges are exactly the manifest chunkUrls, already seeds here.
 */
interface ViteManifestEntry {
  file?: string;
  imports?: string[];
}
const eagerImports = new Map<string, string[]>();
{
  const manifestPath = join(dist, 'client/.vite/manifest.json');
  let parsed: Record<string, ViteManifestEntry>;
  try {
    parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, ViteManifestEntry>;
  } catch (cause) {
    failures.push(
      `client build manifest unreadable: ${manifestPath} (${(cause as Error).message})`,
    );
    parsed = {};
  }
  const urlByKey = new Map<string, string>();
  for (const [key, entry] of Object.entries(parsed)) {
    if (entry.file) urlByKey.set(key, `/client/${entry.file}`);
  }
  for (const [key, entry] of Object.entries(parsed)) {
    const url = urlByKey.get(key);
    if (!url) continue;
    const deps: string[] = [];
    for (const dep of entry.imports ?? []) {
      const depUrl = urlByKey.get(dep);
      if (!depUrl) {
        failures.push(`client manifest import target missing: ${key} -> ${dep}`);
        continue;
      }
      deps.push(depUrl);
    }
    eagerImports.set(url, deps);
  }
}
function eagerClosure(seeds: string[]): Set<string> {
  const closure = new Set<string>(seeds);
  const queue = [...closure];
  while (queue.length > 0) {
    for (const dep of eagerImports.get(queue.pop() ?? '') ?? []) {
      if (!closure.has(dep)) {
        closure.add(dep);
        queue.push(dep);
      }
    }
  }
  return closure;
}
async function routePayload(route: string): Promise<{ bytes: number; chunks: number }> {
  const manifest = manifests.find((item) => item.route === route);
  if (!manifest) {
    failures.push(`no island manifest for route ${route}`);
    return { bytes: -1, chunks: -1 };
  }
  const urls = eagerClosure([
    ...(manifest.islands as Array<{ chunkUrl: string }>).map((island) => island.chunkUrl),
    '/client/islands/client.js',
  ]);
  let bytes = 0;
  for (const url of urls) {
    const abs = distFiles.get(url.replace(/^\//, ''));
    if (!abs) {
      failures.push(`chunk file missing for ${url}`);
      continue;
    }
    bytes += (await stat(abs)).size;
  }
  return { bytes, chunks: urls.size };
}

for (const docPath of docs) {
  const text = await readFile(docPath, 'utf8');
  const short = docPath.slice(repoRoot.length).replace(/^\//, '');
  const scope = `${short}: `;
  const zh = docPath.endsWith('.zh.md');
  const num = (pattern: RegExp): number => {
    const match = pattern.exec(text);
    if (!match) {
      failures.push(`figure missing in doc ${short}: ${pattern}`);
      return -1;
    }
    return Number(match[1].replaceAll(',', ''));
  };
  check(
    scope + 'html files',
    num(zh ? /\|\s*预渲染文档\s*\|\s*(\d+)/ : /\|\s*Pre-rendered documents\s*\|\s*(\d+)/),
    distHtml.length,
  );
  check(
    scope + 'sitemap locs',
    num(
      zh ? /\|\s*`sitemap\.xml` URL 数\s*\|\s*(\d+)/ : /\|\s*URLs in `sitemap\.xml`\s*\|\s*(\d+)/,
    ),
    sitemapLocs,
  );
  check(
    scope + 'manifests',
    num(zh ? /\|\s*island manifest\s*\|\s*(\d+)/ : /\|\s*Island manifests\s*\|\s*(\d+)/),
    manifestPaths.length,
  );
  check(
    scope + 'per-locale pages',
    num(zh ? /每个语言 (\d+) 页/ : /(\d+) pages per locale/),
    entryJson.languages.en.page_count,
  );
  check(
    scope + 'fragments',
    num(zh ? /，(\d+) 个 fragment/ : /, (\d+) fragments/),
    fragmentFiles.length,
  );
  const pair = zh
    ? /(\d+) 个 island 标签、(\d+) 条记录/.exec(text)
    : /(\d+) island tags in (\d+) entries/.exec(text);
  if (!pair) failures.push(`tag/entry figure missing in doc ${short}`);
  else {
    check(scope + 'island tags', Number(pair[1]), tagCounts.size);
    check(scope + 'manifest entries', Number(pair[2]), manifestEntries);
  }
  const railOrder = [...text.matchAll(/open-page-rail[`\s]+(?:on|出现在)\s*(\d+)/g)].map((m) =>
    Number(m[1]),
  );
  const codeOrder = [...text.matchAll(/open-code-block[`\s]+(?:on|出现在)\s*(\d+)/g)].map((m) =>
    Number(m[1]),
  );
  if (railOrder.length > 0) {
    check(scope + 'rail pages', railOrder[0], tagCounts.get('open-page-rail') ?? -2);
  }
  if (codeOrder.length > 0) {
    check(scope + 'code-block pages', codeOrder[0], tagCounts.get('open-code-block') ?? -2);
  }
  for (const row of text.matchAll(
    /\|\s*`([^`(|]+?)`(?:\([^)]*\))?\s*\|\s*([\d,]+)\s*\|\s*([\d,]+)\s*\|/g,
  )) {
    const name = row[1].trim();
    if (!/^(client\.js|element-runtime|island-|open-)/.test(name)) continue;
    const sizes = chunkSize.get(chunkStem(name));
    if (!sizes) continue;
    check(scope + `chunk ${name} raw`, Number(row[2].replaceAll(',', '')), sizes.raw, 0.01);
    check(scope + `chunk ${name} gzip`, Number(row[3].replaceAll(',', '')), sizes.gzip, 0.03);
  }
  for (const row of text.matchAll(/\|\s*`([^`]+)`\s*\|\s*([\d,]+) B\s*\|\s*(\d+)\s*\|/g)) {
    const payload = await routePayload(row[1]);
    check(scope + `payload ${row[1]}`, Number(row[2].replaceAll(',', '')), payload.bytes, 0.01);
    check(scope + `chunks ${row[1]}`, Number(row[3]), payload.chunks);
  }
}

if (failures.length > 0) {
  console.error('doc figures check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('doc figures check passed.');
