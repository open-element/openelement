/**
 * @openelement/router — v0.44 zero-runtime proof for the static-only
 * fixture (#1171).
 *
 * Builds fixtures/router-static-only/ through the repo's
 * own build path — the same CLI module the root `fixture:router-static-only:build`
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
 * ends clean. Run it directly with:
 *   deno test -A packages/router/__tests__/v044-delivery/static-only-zero-runtime.test.ts
 */

import { assert, assertEquals } from '@std/assert';
import { join } from '@std/path';

const fixtureDir = join(import.meta.dirname!, '../../../../fixtures/router-static-only');
const distDir = join(fixtureDir, 'dist');
const repoRoot = join(fixtureDir, '../..');

const HTML_PAGES = ['index.html', 'about/index.html', 'mdx-page/index.html'];

async function removeDist(): Promise<void> {
  await Deno.remove(distDir, { recursive: true }).catch(() => undefined);
}

async function buildFixture(): Promise<void> {
  await removeDist();
  // Same CLI invocation as the root deno.json `fixture:router-static-only:build` task.
  const build = await new Deno.Command(Deno.execPath(), {
    args: [
      'run',
      '--config',
      join(repoRoot, 'deno.json'),
      '-A',
      join(fixtureDir, '../../packages/router/src/cli/build.ts'),
    ],
    cwd: fixtureDir,
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  const logs = new TextDecoder().decode(build.stdout) + new TextDecoder().decode(build.stderr);
  assertEquals(build.code, 0, `static-only fixture build failed:\n${logs}`);
}

Deno.test('v0.44 static-only build ships zero client runtime (#1171)', async () => {
  try {
    await buildFixture();

    // Expected HTML pages are emitted.
    for (const page of HTML_PAGES) {
      const stat = await Deno.stat(join(distDir, page)).catch(() => null);
      assert(stat?.isFile === true, `expected prerendered page dist/${page}`);
    }

    // No client runtime artifact directories.
    for (const artifactDir of ['client', 'island-manifests']) {
      assertEquals(
        await Deno.stat(join(distDir, artifactDir)).then(() => true).catch(() => false),
        false,
        `zero-runtime build must not emit dist/${artifactDir}`,
      );
    }

    // No OpenElement client script tags in any built HTML page.
    for (const page of HTML_PAGES) {
      const html = await Deno.readTextFile(join(distDir, page));
      assertEquals(
        html.includes('<script'),
        false,
        `dist/${page} must not contain a client script tag in a zero-runtime build`,
      );
    }
  } finally {
    await removeDist();
  }
});
