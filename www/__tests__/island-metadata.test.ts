import { assert, assertEquals, assertExists, assertFalse, assertStringIncludes } from '@std/assert';
import { fromFileUrl, join } from 'jsr:@std/path@^1.0.0';
import {
  fileToTagName,
  generateClientEntry,
  scanIslandMeta,
  scanIslands,
} from '../../packages/adapter-vite/src/internal/ssg/index.ts';

const REPO_ROOT = fromFileUrl(new URL('../..', import.meta.url));
const WWW_ISLANDS_DIR = join(REPO_ROOT, 'www', 'app', 'islands');

const REQUIRED_LOCAL_ISLANDS = {
  'open-cinematic-atmosphere': { hydrate: 'idle', ssr: true, dsd: true },
  'open-cinematic-scroll': { hydrate: 'load', ssr: true, dsd: true },
  'open-dragon-gaze': { hydrate: 'idle', ssr: true, dsd: true },
  'open-dragon-live-gaze': { hydrate: 'idle', ssr: true, dsd: true },
  'open-search': { hydrate: 'load', ssr: true, dsd: true },
} as const;

async function scanWwwIslandMetadata() {
  const islandFiles = await scanIslands(WWW_ISLANDS_DIR);
  const meta = await scanIslandMeta(WWW_ISLANDS_DIR, islandFiles);
  return { islandFiles, meta };
}

Deno.test('www local islands expose explicit v0.33 metadata', async () => {
  const { islandFiles, meta } = await scanWwwIslandMetadata();
  const scannedTags = new Set(islandFiles.map(fileToTagName));

  for (const [tagName, expected] of Object.entries(REQUIRED_LOCAL_ISLANDS)) {
    assert(scannedTags.has(tagName), `${tagName} must exist under www/app/islands`);
    const actual = meta[tagName];
    assertExists(actual, `${tagName} must export defineIslandConfig(...) metadata`);
    assertEquals(actual.hydrate, expected.hydrate, `${tagName} hydrate strategy drifted`);
    assertEquals(actual.ssr, expected.ssr, `${tagName} SSR flag drifted`);
    assertEquals(actual.dsd, expected.dsd, `${tagName} DSD flag drifted`);
  }

  const missingMetadata = [...scannedTags].filter((tagName) => meta[tagName] === undefined);
  assertEquals(
    missingMetadata,
    [],
    `All www/app/islands files must declare defineIslandConfig(...): ${missingMetadata.join(', ')}`,
  );
});

Deno.test('www search island metadata schedules immediate client hydration', async () => {
  const { islandFiles, meta } = await scanWwwIslandMetadata();
  const entries = islandFiles.map((filePath) => {
    const tagName = fileToTagName(filePath);
    return {
      tagName,
      modulePath: `/app/islands/${filePath}`,
      strategy: meta[tagName]?.hydrate ?? 'idle',
    };
  });

  const code = generateClientEntry(entries);
  // #606/#610 (alpha.13): strategy buckets live in the generated scheduler
  // config — `strategies: { load: [...], idle: [...] }`.
  const loadTags = code.match(/strategies:\s*\{\s*load:\s*\[(.*?)\]/s)?.[1] ?? '';
  const idleTags = code.match(/idle:\s*\[(.*?)\]/s)?.[1] ?? '';

  assertStringIncludes(
    loadTags,
    '"open-search"',
    'open-search must be in the immediate client:load bucket',
  );
  assertFalse(
    idleTags.includes('"open-search"'),
    'open-search must not silently fall back to idle hydration',
  );
});
