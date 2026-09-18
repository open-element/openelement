/**
 * Doc-figures gate: the Measured-output numbers in comparison.md/.zh.md
 * must equal a fresh measurement of www/dist.
 *
 * Both sides derive — figure expectations come from regexing the two doc
 * files (never a hand list here), actuals from dist (html count, sitemap
 * locs, manifests, pagefind entry, chunk raw+gzip bytes, per-route
 * payloads). Byte-size totals from `du` are deliberately NOT gated:
 * platform du accounting differs between macOS and Linux runners.
 */
import { walk } from '@std/fs/walk';
import { fromFileUrl, join } from '@std/path';

const repoRoot = fromFileUrl(new URL('../../', import.meta.url));
const dist = join(repoRoot, 'www/dist');
const docs = [
  join(repoRoot, 'www/content/docs/architecture/comparison.md'),
  join(repoRoot, 'www/content/docs/architecture/comparison.zh.md'),
];

const failures: string[] = [];
function check(name: string, expected: number, actual: number, tolerance = 0): void {
  // gzip bytes vary across platforms (header OS byte, mtime) for identical
  // input, so gzip rows carry a ±3% tolerance. This loses nothing: any
  // content change already moves the exact raw-bytes assertion beside it.
  const ok = tolerance > 0
    ? Math.abs(expected - actual) <= Math.ceil(expected * tolerance)
    : expected === actual;
  if (!ok) failures.push(`${name}: doc says ${expected}, dist measures ${actual}`);
}

async function gzipSize(file: string): Promise<number> {
  // Must be gzip -9: the doc figures are measured that way and
  // CompressionStream would produce different bytes.
  const child = new Deno.Command('gzip', {
    args: ['-9', '-c', file],
    stdin: 'null',
    stdout: 'piped',
    stderr: 'null',
  });
  const { code, stdout } = await child.output();
  if (code !== 0) throw new Error(`gzip -9 failed for ${file}`);
  return stdout.length;
}

const distFiles = new Map<string, string>();
for await (const entry of walk(dist, { includeDirs: false })) {
  distFiles.set(entry.path.slice(dist.length + 1), entry.path);
}
const distHtml = [...distFiles.keys()].filter((path) => path.endsWith('.html'));
const sitemap = await Deno.readTextFile(join(dist, 'sitemap.xml'));
const sitemapLocs = (sitemap.match(/<loc>/g) ?? []).length;
const manifestPaths = [...distFiles.keys()].filter((path) =>
  path.startsWith('island-manifests/') && path.endsWith('.json')
);
const manifests = await Promise.all(
  manifestPaths.map(async (path) => JSON.parse(await Deno.readTextFile(join(dist, path)))),
);
const tagCounts = new Map<string, number>();
let manifestEntries = 0;
for (const manifest of manifests) {
  for (const island of manifest.islands as Array<{ tagName: string }>) {
    tagCounts.set(island.tagName, (tagCounts.get(island.tagName) ?? 0) + 1);
    manifestEntries++;
  }
}
const entryJson = JSON.parse(await Deno.readTextFile(join(dist, 'pagefind/pagefind-entry.json')));
const fragmentFiles = [...distFiles.keys()].filter((path) => path.startsWith('pagefind/fragment/'));

const chunkSize = new Map<string, { raw: number; gzip: number }>();
for (const [rel, abs] of distFiles) {
  const match = /^client\/islands\/(.+)\.js$/.exec(rel);
  if (match) {
    chunkSize.set(match[1], {
      raw: (await Deno.stat(abs)).size,
      gzip: await gzipSize(abs),
    });
  }
}
function chunkStem(docName: string): string {
  const hits = [...chunkSize.keys()].filter((stem) =>
    stem === docName || stem.startsWith(`${docName}-`)
  );
  if (hits.length !== 1) {
    failures.push(`chunk ${docName}: want exactly one dist file, found ${hits.length}`);
  }
  return hits[0] ?? docName;
}
function routePayload(route: string): { bytes: number; chunks: number } {
  const manifest = manifests.find((item) => item.route === route);
  if (!manifest) {
    failures.push(`no island manifest for route ${route}`);
    return { bytes: -1, chunks: -1 };
  }
  const urls = new Set<string>([
    ...(manifest.islands as Array<{ chunkUrl: string }>).map((island) => island.chunkUrl),
    '/client/islands/client.js',
  ]);
  let bytes = 0;
  for (const url of urls) {
    const stem = url.split('/').at(-1)?.replace(/\.js$/, '') ?? '';
    const sizes = chunkSize.get(stem);
    if (!sizes) failures.push(`chunk file missing for ${url}`);
    else bytes += sizes.raw;
  }
  return { bytes, chunks: urls.size };
}

for (const docPath of docs) {
  const text = await Deno.readTextFile(docPath);
  const short = docPath.slice(repoRoot.length + 1);
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
    Number(m[1])
  );
  const codeOrder = [...text.matchAll(/open-code-block[`\s]+(?:on|出现在)\s*(\d+)/g)].map((m) =>
    Number(m[1])
  );
  if (railOrder.length > 0) {
    check(scope + 'rail pages', railOrder[0], tagCounts.get('open-page-rail') ?? -2);
  }
  if (codeOrder.length > 0) {
    check(scope + 'code-block pages', codeOrder[0], tagCounts.get('open-code-block') ?? -2);
  }
  for (
    const row of text.matchAll(
      /\|\s*`([^`(|]+?)`(?:\([^)]*\))?\s*\|\s*([\d,]+)\s*\|\s*([\d,]+)\s*\|/g,
    )
  ) {
    const name = row[1].trim();
    if (!/^(client\.js|island-|open-)/.test(name)) continue;
    const stem = name === 'client.js' ? 'client' : name;
    const sizes = chunkSize.get(chunkStem(stem));
    if (!sizes) continue;
    check(scope + `chunk ${name} raw`, Number(row[2].replaceAll(',', '')), sizes.raw);
    check(scope + `chunk ${name} gzip`, Number(row[3].replaceAll(',', '')), sizes.gzip, 0.03);
  }
  for (const row of text.matchAll(/\|\s*`([^`]+)`\s*\|\s*([\d,]+) B\s*\|\s*(\d+)\s*\|/g)) {
    const payload = routePayload(row[1]);
    check(scope + `payload ${row[1]}`, Number(row[2].replaceAll(',', '')), payload.bytes);
    check(scope + `chunks ${row[1]}`, Number(row[3]), payload.chunks);
  }
}

if (failures.length > 0) {
  console.error('doc figures check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  Deno.exit(1);
}
console.log('doc figures check passed.');
