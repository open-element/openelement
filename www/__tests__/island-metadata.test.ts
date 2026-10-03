import { expect, test } from 'vitest';
import { fromFileUrl, join } from '@std/path';
import {
  fileToTagName,
  scanIslandMeta,
  scanIslands,
} from '../../packages/router/src/vite/internal/ssg/route-scanner.ts';
import { generateClientEntry } from '../../packages/router/src/vite/internal/ssg/entry-client-codegen.ts';

const REPO_ROOT = fromFileUrl(new URL('../..', import.meta.url));
const SITE_ISLANDS_DIR = join(REPO_ROOT, 'www', 'app', 'islands');

const REQUIRED_LOCAL_ISLANDS = {
  'open-cinematic-scroll': { hydrate: 'load', ssr: true },
  'open-dragon-live-gaze': { hydrate: 'idle', ssr: true },
  'open-search': { hydrate: 'load', ssr: true },
} as const;

async function scanWwwIslandMetadata() {
  const islandFiles = await scanIslands(SITE_ISLANDS_DIR);
  const meta = await scanIslandMeta(SITE_ISLANDS_DIR, islandFiles);
  return { islandFiles, meta };
}

test('site local islands expose explicit island metadata', async () => {
  const { islandFiles, meta } = await scanWwwIslandMetadata();
  const scannedTags = new Set(islandFiles.map(fileToTagName));

  for (const [tagName, expected] of Object.entries(REQUIRED_LOCAL_ISLANDS)) {
    expect(scannedTags.has(tagName), `${tagName} must exist under www/app/islands`).toBeTruthy();
    const actual = meta[tagName];
    expect(actual, `${tagName} must export defineIslandConfig(...) metadata`).toEqual(
      expect.anything(),
    );
    expect(actual.hydrate, `${tagName} hydrate strategy drifted`).toEqual(expected.hydrate);
    expect(actual.ssr, `${tagName} SSR flag drifted`).toEqual(expected.ssr);
  }

  const missingMetadata = [...scannedTags].filter((tagName) => meta[tagName] === undefined);
  expect(
    missingMetadata,
    `All www/app/islands files must declare defineIslandConfig(...): ${missingMetadata.join(', ')}`,
  ).toEqual([]);
});

test('site search island metadata schedules immediate client hydration', async () => {
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

  expect(loadTags, 'open-search must be in the immediate client:load bucket').toContain(
    '"open-search"',
  );
  expect(
    idleTags.includes('"open-search"'),
    'open-search must not silently fall back to idle hydration',
  ).toBeFalsy();
});
