/**
 * v0.44 ISR removal gate (issue #1217, ADR-0151).
 *
 * ISR was decided-removed for v0.44: no `revalidate` authoring semantics, no
 * ISR manifest generation, no ISR cache types, no ISR public exports. These
 * assertions are the mechanical absence proof; any future re-introduction
 * must land through the evidence-gated redesign (#1221), not by reviving the
 * deleted surface.
 */

import { assert, assertEquals } from '@std/assert';

const repoRoot = new URL('../../../', import.meta.url);

async function readRepoFile(path: string): Promise<string> {
  return await Deno.readTextFile(new URL(path, repoRoot));
}

async function repoFileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(new URL(path, repoRoot));
    return true;
  } catch {
    return false;
  }
}

Deno.test('ISR modules are deleted from @openelement/element internals', async () => {
  assertEquals(
    await repoFileExists('packages/element/src/internal/core/isr.ts'),
    false,
    'packages/element/src/internal/core/isr.ts must be deleted (#1217)',
  );
  assertEquals(
    await repoFileExists('packages/element/src/internal/protocol/isr.ts'),
    false,
    'packages/element/src/internal/protocol/isr.ts must be deleted (#1217)',
  );
});

Deno.test('no ISR surface remains in element public entry points', async () => {
  for (
    const path of [
      'packages/element/src/index.ts',
      'packages/element/src/public-contracts.ts',
      'packages/element/src/public-build-runtime.ts',
      'packages/element/src/build-utils.ts',
      'packages/element/src/internal/core/index.ts',
      'packages/element/src/internal/protocol/framework.ts',
      'packages/element/src/internal/protocol/runtime.ts',
    ]
  ) {
    const source = await readRepoFile(path);
    for (
      const token of [
        'IsrManifestEntry',
        'IsrCacheEntry',
        'IsrCacheResult',
        'CacheAdapter',
        'CacheEntry',
        'createIsrCacheKey',
        'isr-manifest',
        'revalidate',
      ]
    ) {
      assert(
        !source.includes(token),
        `${path} must not reference ${token} (#1217)`,
      );
    }
  }
});

Deno.test('no ISR/revalidate semantics remain in app authoring or adapter SSG', async () => {
  for (
    const path of [
      'packages/router/src/authoring.ts',
      'packages/adapter-vite/src/internal/ssg/ssg-helpers.ts',
      'packages/adapter-vite/src/internal/ssg/ssg-render.ts',
      'packages/adapter-vite/src/internal/ssg/entry-route-helpers.ts',
      'packages/adapter-vite/src/internal/ssg/entry-render-ssg.ts',
      'packages/adapter-vite/src/internal/protocol/framework.ts',
      'packages/adapter-vite/src/internal/protocol/ssg.ts',
      'packages/adapter-vite/src/framework.ts',
    ]
  ) {
    const source = await readRepoFile(path);
    for (
      const token of [
        'IsrManifestEntry',
        'IsrCache',
        'createIsrCacheKey',
        'isr-manifest',
        'revalidate',
      ]
    ) {
      assert(
        !source.includes(token),
        `${path} must not reference ${token} (#1217)`,
      );
    }
  }
});
