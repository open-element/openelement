/**
 * @openelement/router — v0.44 zero-runtime proof for the static-only
 * fixture (#1171).
 *
 * Builds tests/fixtures/router-static-only/ through the repo's
 * own build path — the same CLI module the `tests/fixtures/router-static-only#build`
 * task invokes — and pins the empty-islands delivery contract end to end
 * (buildClient()'s zero-island path, which backs removeClientDeliveryArtifacts
 * and the Phase 2 skip):
 *   - the build exits 0 and the expected HTML pages are emitted
 *   - no client runtime artifacts survive: no dist/client directory, no
 *     dist/island-manifests directory
 *   - the built HTML contains no OpenElement client script tags
 *
 * The fixture dist is gitignored. The test rebuilds from a clean dist and
 * removes it afterwards, so repeated runs are deterministic and the worktree
 * ends clean. Run it through the package-qualified suite task:
 *   pnpm --dir packages/router test   (or: vp run --fail-if-no-match @openelement/router#test)
 */

import { spawn } from 'node:child_process';
import { readFile, rm, stat } from 'node:fs/promises';
import process from 'node:process';
import { expect, test } from 'vitest';
import { join } from 'node:path';

const fixtureDir = join(import.meta.dirname!, '../../../../tests/fixtures/router-static-only');
const distDir = join(fixtureDir, 'dist');

const HTML_PAGES = ['index.html', 'about/index.html', 'mdx-page/index.html'];

async function removeDist(): Promise<void> {
  await rm(distDir, { recursive: true }).catch(() => undefined);
}

async function buildFixture(): Promise<void> {
  await removeDist();
  // The router build CLI is node-hosted (B1a): spawn it directly.
  const build = spawn(
    process.execPath,
    [join(fixtureDir, '../../../packages/router/src/cli/build.ts')],
    {
      cwd: fixtureDir,
    },
  );
  const [outChunks, errChunks] = await Promise.all([
    Array.fromAsync(build.stdout!),
    Array.fromAsync(build.stderr!),
  ]);
  const logs = Buffer.concat([...outChunks, ...errChunks]).toString();
  const code = await new Promise<number>((resolve) => build.once('exit', (c) => resolve(c ?? -1)));
  expect(code, `static-only fixture build failed:\n${logs}`).toEqual(0);
}

test('v0.44 static-only build ships zero client runtime (#1171)', async () => {
  try {
    await buildFixture();

    // Expected HTML pages are emitted.
    for (const page of HTML_PAGES) {
      const stats = await stat(join(distDir, page)).catch(() => null);
      expect(stats?.isFile() === true, `expected prerendered page dist/${page}`).toBeTruthy();
    }

    // No client runtime artifact directories.
    for (const artifactDir of ['client', 'island-manifests']) {
      expect(
        await stat(join(distDir, artifactDir))
          .then(() => true)
          .catch(() => false),
        `zero-runtime build must not emit dist/${artifactDir}`,
      ).toEqual(false);
    }

    // No OpenElement client script tags in any built HTML page.
    for (const page of HTML_PAGES) {
      const html = await readFile(join(distDir, page), 'utf8');
      expect(
        html.includes('<script'),
        `dist/${page} must not contain a client script tag in a zero-runtime build`,
      ).toEqual(false);
    }
  } finally {
    await removeDist();
  }
});
