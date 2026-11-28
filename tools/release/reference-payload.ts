import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { brotliCompress, constants, gzip } from 'node:zlib';
import { promisify } from 'node:util';
import type { Manifest } from 'vite';
import {
  BROWSER_ENTRY_GRAPH_ARTIFACT_FILE,
  type BrowserEntryGraphArtifact,
  evaluateBrowserEntryGraphArtifact,
} from '../../packages/router/src/vite/internal/browser-entry-graph-artifact.ts';
import { ISLAND_CATALOGUE_SCRIPT_TYPE } from '../../packages/router/src/vite/internal/ssg/document-island-catalogue.ts';
import type { PageIslandManifest } from '../../packages/router/src/vite/internal/ssg/island-manifest.ts';
import { clientChunkUrl, clientImportGraph, payloadClosure } from './payload-closure.ts';

export const REFERENCE_GZIP_LIMITS = {
  sharedRuntime: 13_437,
  referenceIsland: 2_000,
  home: 17_071,
} as const;

const gzip9 = promisify(gzip);
const brotli = promisify(brotliCompress);

function readJson<T>(file: string): Promise<T> {
  return readFile(file, 'utf8').then((text) => JSON.parse(text) as T);
}

interface ByteSizes {
  raw: number;
  gzip: number;
  brotli: number;
}

function documentScripts(html: string) {
  // This is the reference starter's emitted HTML. Fail if it starts shipping
  // inline code, whose gzip transfer cannot be separated from the HTML.
  const urls = new Set<string>();
  const activations = new Map<string, string>();
  let hasCatalogue = false;
  // HTML accepts whitespace, a slash, and ignored attributes on a script end
  // tag. A quoted attribute value can itself contain a greater-than sign.
  const scripts =
    /<script(?=[\t\n\f\r />])([^>]*)>([\s\S]*?)<\/script(?=[\t\n\f\r />])(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
  for (const [, attributes, content] of html.matchAll(scripts)) {
    const type = htmlAttribute(attributes, 'type')?.toLowerCase();
    if (type === ISLAND_CATALOGUE_SCRIPT_TYPE) {
      if (hasCatalogue) throw new Error('Reference home has two island catalogues');
      hasCatalogue = true;
      const rows: unknown = JSON.parse(content);
      if (!Array.isArray(rows)) throw new Error('Reference home island catalogue must be an array');
      for (const row of rows) {
        if (
          !Array.isArray(row) ||
          typeof row[0] !== 'string' ||
          typeof row[2] !== 'string' ||
          activations.has(row[0])
        ) {
          throw new Error('Reference home island catalogue has an invalid or duplicate activation');
        }
        activations.set(row[0], row[2]);
      }
      continue;
    }
    if (type && !['module', 'text/javascript', 'application/javascript'].includes(type)) continue;
    const src = htmlAttribute(attributes, 'src');
    if (src) urls.add(src);
    else if (content.trim()) throw new Error('Reference home has executable inline JavaScript');
  }
  for (const [, attributes] of html.matchAll(/<link\b([^>]*)>/gi)) {
    if (htmlAttribute(attributes, 'rel')?.toLowerCase() !== 'modulepreload') continue;
    const href = htmlAttribute(attributes, 'href');
    if (!href) throw new Error('Reference home has a modulepreload without href');
    urls.add(href);
  }
  return { urls, activations };
}

function htmlAttribute(
  attributes: string,
  name: 'rel' | 'href' | 'type' | 'src',
): string | undefined {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(
    attributes,
  );
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

export function referencePayloadUrls(
  viteManifest: Manifest,
  browserArtifact: Pick<BrowserEntryGraphArtifact, 'entry'> & {
    islands: Array<
      Pick<
        BrowserEntryGraphArtifact['islands'][number],
        'tag' | 'chunkFile' | 'activationChunkFile'
      >
    >;
  },
  html: string,
  homeManifest: Pick<PageIslandManifest, 'islands'>,
) {
  const activeIslands = homeManifest.islands.filter((island) => island.strategy !== 'none');
  const counters = activeIslands.filter((island) => island.tagName === 'my-counter');
  if (counters.length !== 1) throw new Error('Expected one active my-counter on the starter home');

  const graph = clientImportGraph(viteManifest);
  const bootstrap = clientChunkUrl(browserArtifact.entry.chunkFile);
  const { urls: htmlRoots, activations } = documentScripts(html);
  if (!htmlRoots.has(bootstrap)) throw new Error('Reference home is missing its client bootstrap');
  const urlByTag = new Map(
    browserArtifact.islands.map(({ tag, chunkFile }) => [tag, clientChunkUrl(chunkFile)]),
  );
  const expectedActivations = new Map(
    browserArtifact.islands.flatMap(({ tag, activationChunkFile }) =>
      activationChunkFile ? [[tag, clientChunkUrl(activationChunkFile)] as const] : [],
    ),
  );
  for (const [tag, url] of activations) {
    if (expectedActivations.get(tag) !== url) {
      throw new Error(`Reference home island activation is missing from the client graph: ${tag}`);
    }
  }
  const islandUrls = new Set(urlByTag.values());
  for (const island of activeIslands) {
    if (
      urlByTag.get(island.tagName) !== island.chunkUrl ||
      expectedActivations.get(island.tagName) !== activations.get(island.tagName)
    ) {
      throw new Error(`Reference home island is missing from the client graph: ${island.tagName}`);
    }
  }
  // The bootstrap dispatches every app island. The page manifest selects which
  // dispatch edges can run here. Follow all other dynamic imports, including
  // those triggered only after a user interacts with an active island.
  const shared = payloadClosure(
    graph,
    [...htmlRoots].filter((url) => !islandUrls.has(url)),
    (from, to) => from !== bootstrap || !islandUrls.has(to),
  );
  const hostedTags = new Set(activeIslands.map(({ tagName }) => tagName));
  const activationRoots = [
    ...activeIslands.map(({ tagName, chunkUrl }) => activations.get(tagName) ?? chunkUrl),
    ...[...activations].filter(([tag]) => !hostedTags.has(tag)).map(([, url]) => url),
  ];
  const islandClosures = activationRoots.map((url) => payloadClosure(graph, [url], () => true));
  for (const [index, closure] of islandClosures.entries()) {
    for (const url of closure) {
      if (islandClosures.slice(index + 1).some((other) => other.has(url))) shared.add(url);
    }
  }
  const referenceWithShared = islandClosures[activeIslands.indexOf(counters[0])];
  const referenceIsland = new Set([...referenceWithShared].filter((url) => !shared.has(url)));
  // Include explicit document preloads even when no active island owns them.
  const htmlPreloads = payloadClosure(
    graph,
    [...htmlRoots].filter((url) => islandUrls.has(url)),
  );
  const home = new Set([...shared, ...htmlPreloads, ...islandClosures.flatMap((set) => [...set])]);
  return { home, shared, referenceIsland, referenceWithShared };
}

export async function measureReferencePayload(dist: string) {
  const manifestDir = join(dist, 'island-manifests');
  const [viteManifest, browserArtifact, html, manifestFiles] = await Promise.all([
    readJson<Manifest>(join(dist, 'client/.vite/manifest.json')),
    readJson<BrowserEntryGraphArtifact>(join(dist, 'client', BROWSER_ENTRY_GRAPH_ARTIFACT_FILE)),
    readFile(join(dist, 'index.html'), 'utf8'),
    readdir(manifestDir),
  ]);
  const browser = evaluateBrowserEntryGraphArtifact(browserArtifact);
  if (browser.verdict === 'UNPROVEN') {
    throw new Error(`Cannot validate reference browser graph: ${browser.detail ?? browser.reason}`);
  }
  const manifests = await Promise.all(
    manifestFiles
      .filter((file) => file.endsWith('.json'))
      .map((file) => readJson<PageIslandManifest>(join(manifestDir, file))),
  );
  const homes = manifests.filter((manifest) => manifest.route === '/');
  if (homes.length !== 1) throw new Error('Expected one island manifest for the starter home');
  const { home, shared, referenceIsland, referenceWithShared } = referencePayloadUrls(
    viteManifest,
    browserArtifact,
    html,
    homes[0],
  );

  const chunks = await Promise.all(
    [...home].sort().map(async (url) => {
      const file = url.slice('/client/'.length);
      const chunk = browserArtifact.chunks.find((entry) => entry.file === file);
      if (!chunk) throw new Error(`Reference browser graph has no chunk for ${url}`);
      const bytes = await readFile(join(dist, 'client', chunk.file));
      const [gzipped, brotliCompressed] = await Promise.all([
        gzip9(bytes, { level: 9 }),
        brotli(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }),
      ]);
      return {
        url,
        raw: bytes.length,
        gzip: gzipped.length,
        brotli: brotliCompressed.length,
        // Bundler-attributed module lengths precede final minification and
        // compression. They identify contributors but are not additive bytes.
        sha256: createHash('sha256').update(bytes).digest('hex'),
        modules: chunk.modules
          .filter((module) => module.renderedLength > 0)
          .sort((a, b) => b.renderedLength - a.renderedLength),
      };
    }),
  );
  function total(urls: ReadonlySet<string>): ByteSizes {
    return chunks.reduce(
      (sum, chunk) =>
        urls.has(chunk.url)
          ? {
              raw: sum.raw + chunk.raw,
              gzip: sum.gzip + chunk.gzip,
              brotli: sum.brotli + chunk.brotli,
            }
          : sum,
      { raw: 0, gzip: 0, brotli: 0 },
    );
  }
  return {
    totals: {
      sharedRuntime: total(shared),
      referenceIsland: total(referenceIsland),
      referenceIslandWithDependencies: total(referenceWithShared),
      home: total(home),
    },
    chunks: chunks.map((chunk) => ({
      ...chunk,
      sharedRuntime: shared.has(chunk.url),
      referenceIsland: referenceIsland.has(chunk.url),
      referenceIslandWithDependencies: referenceWithShared.has(chunk.url),
    })),
  };
}

export function referencePayloadFailures(totals: {
  [K in keyof typeof REFERENCE_GZIP_LIMITS]: ByteSizes;
}): string[] {
  return Object.entries(REFERENCE_GZIP_LIMITS).flatMap(([metric, limit]) => {
    const actual = totals[metric as keyof typeof REFERENCE_GZIP_LIMITS].gzip;
    return actual > limit
      ? [`${metric}: ${actual} B gzip exceeds ${limit} B by ${actual - limit} B`]
      : [];
  });
}
