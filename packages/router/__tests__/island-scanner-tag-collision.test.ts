/**
 * scanIslandMeta — an island tag collision is diagnosed at SCAN time.
 *
 * The scanner's record is keyed by the tag a file derives from its path
 * (`pathToTagName`), which is not injective: `about.tsx` / `about-page.tsx`
 * both derive `about-page`, `a_b.tsx` / `a-b.tsx` both derive `a-b`. Two such
 * files used to race for one slot (`meta[tagName] = ...`), so the later write
 * replaced the earlier entry and every downstream lookup (`build-postprocess`,
 * `entry-descriptor`, `build-client`) read the survivor's sidecar —
 * tags/tagNames/exportNames — for BOTH files.
 *
 * This suite pins the FAIL-EARLY half of that one ownership invariant: the
 * second claimant fails `ISLAND_TAG_DUPLICATE` (the existing
 * `ClientAssetErrorCode` identity — no new code) while both source paths are
 * still known. The manifest builder (`client-asset-manifest.ts`) keeps its own
 * FAIL-LATE check as defense in depth; that guard only walks islands a page
 * actually reaches, which is exactly the gap the "no page references" case
 * below covers. Both halves stay reachable and are not an either/or.
 *
 * The islands dir here is a real temp directory: `scanIslandMeta` reads each
 * module from disk and never executes it.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from 'vitest';
import { OpenElementError } from '@openelement/element/authoring';
import { ClientAssetErrorCode } from '../src/internal/error-codes.ts';
import { scanIslandMeta } from '../src/vite/internal/ssg/island-scanner.ts';

/** The canonical sidecar form the static scanner reads. */
function islandSource(options: string): string {
  return (
    `import { defineIslandConfig } from '@openelement/router';\n` +
    `export const openElement = defineIslandConfig({ ${options} });\n`
  );
}

/**
 * Write `files` (islandsDir-relative name -> module source) into a fresh temp
 * islands dir, run `run` against it, then remove the dir.
 */
async function withIslandFiles(
  files: Record<string, string>,
  run: (islandsDir: string, islandFiles: string[]) => Promise<void>,
): Promise<void> {
  const islandsDir = await mkdtemp(join(tmpdir(), 'oe-island-tag-collision-'));
  try {
    for (const [name, source] of Object.entries(files)) {
      const fullPath = join(islandsDir, name);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, source);
    }
    // scanIslands() sorts its result; keep the same order here.
    await run(
      islandsDir,
      Object.keys(files).sort((a, b) => a.localeCompare(b)),
    );
  } finally {
    await rm(islandsDir, { recursive: true }).catch(() => {});
  }
}

test('scanIslandMeta: two files deriving one tag fail ISLAND_TAG_DUPLICATE naming both files and the tag', async () => {
  await withIslandFiles(
    {
      // about.tsx -> 'about-page' via the -page fallback; about-page.tsx -> the
      // same tag directly. Both are ordinary island files.
      'about.tsx': islandSource(`hydrate: 'idle'`),
      'about-page.tsx': islandSource(`hydrate: 'idle'`),
    },
    async (islandsDir, islandFiles) => {
      let thrown: unknown;
      try {
        await scanIslandMeta(islandsDir, islandFiles);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, 'a tag collision must fail the scan, not overwrite').toBeInstanceOf(
        OpenElementError,
      );
      const error = thrown as OpenElementError;
      // The existing identity, reused as-is: one ownership invariant, one code.
      expect(error.code).toEqual(ClientAssetErrorCode.ISLAND_TAG_DUPLICATE);
      expect(error.code).toEqual('OE_CLIENT_ASSET_ISLAND_TAG_DUPLICATE');
      expect(error.phase).toEqual('build');
      expect(error.message).toContain('"about-page"');
      expect(error.message).toContain('"about.tsx"');
      expect(error.message).toContain('"about-page.tsx"');
      // The one-line hint: the tag came from the path, so the author can
      // rename one file or pin the tag in the sidecar.
      expect(error.message).toContain('derives its tag from its path');
      expect(error.message).toContain('tags/tagNames');
    },
  );
});

/**
 * The unused-island case: neither file is referenced by any page, so no island
 * list, no reachability narrowing and no client asset manifest participates in
 * this call — the manifest guard would never see these two entries. The scan
 * still fails, which is the gap this guard exists to close.
 */
test('scanIslandMeta: a collision among islands no page references is still diagnosed', async () => {
  await withIslandFiles(
    {
      // The underscore/separator path: both derive 'a-b'.
      'a_b.tsx': islandSource(`hydrate: 'idle'`),
      'a-b.tsx': islandSource(`hydrate: 'idle'`),
    },
    async (islandsDir, islandFiles) => {
      let thrown: unknown;
      try {
        await scanIslandMeta(islandsDir, islandFiles);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, 'unused islands must not collide silently').toBeInstanceOf(OpenElementError);
      const error = thrown as OpenElementError;
      expect(error.code).toEqual(ClientAssetErrorCode.ISLAND_TAG_DUPLICATE);
      expect(error.message).toContain('"a-b"');
      expect(error.message).toContain('"a_b.tsx"');
      expect(error.message).toContain('"a-b.tsx"');
    },
  );
});

test('scanIslandMeta: distinct tags keep the scanned metadata unchanged', async () => {
  const files = {
    'about.tsx': islandSource(`hydrate: 'idle'`),
    'profile-card.tsx': islandSource(`ssr: false`),
    'dashboard/stats.tsx': islandSource(`hydrate: 'only'`),
  };
  await withIslandFiles(files, async (islandsDir, islandFiles) => {
    const meta = await scanIslandMeta(islandsDir, islandFiles);
    expect(Object.keys(meta).sort()).toEqual(['about-page', 'dashboard-stats', 'profile-card']);
    expect(meta['about-page']).toMatchObject({
      tagName: 'about-page',
      filePath: 'about.tsx',
      hydrate: 'idle',
    });
    expect(meta['profile-card']).toMatchObject({
      tagName: 'profile-card',
      filePath: 'profile-card.tsx',
      ssr: false,
    });
    // hydrate:'only' still coerces ssr/dsd off, as before.
    expect(meta['dashboard-stats']).toMatchObject({
      tagName: 'dashboard-stats',
      filePath: 'dashboard/stats.tsx',
      hydrate: 'only',
      ssr: false,
      dsd: false,
      reason: 'local island exports openElement.hydrate=only',
    });

    // Order-independence: the same set scanned in the other order collides in
    // neither direction and yields the same record.
    const reversed = await scanIslandMeta(islandsDir, [...islandFiles].reverse());
    expect(reversed).toEqual(meta);
  });
});

test('scanIslandMeta: the collision message names paths and the tag, never the module source', async () => {
  const sentinelA = 'SENTINEL_SOURCE_TEXT_ALPHA';
  const sentinelB = 'SENTINEL_SOURCE_TEXT_BETA';
  await withIslandFiles(
    {
      'about.tsx': `// ${sentinelA}\n${islandSource(`hydrate: 'idle'`)}`,
      'about-page.tsx': `// ${sentinelB}\n${islandSource(`hydrate: 'idle'`)}`,
    },
    async (islandsDir, islandFiles) => {
      let thrown: unknown;
      try {
        await scanIslandMeta(islandsDir, islandFiles);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(OpenElementError);
      const { message } = thrown as OpenElementError;
      expect(message).not.toContain(sentinelA);
      expect(message).not.toContain(sentinelB);
      // No sidecar syntax either — the message carries paths and the tag only.
      expect(message).not.toContain('defineIslandConfig');
      expect(message).not.toContain('export const');
      // Both paths are islandsDir-relative, so no absolute temp path leaks in.
      expect(message).not.toContain(islandsDir);
    },
  );
});
