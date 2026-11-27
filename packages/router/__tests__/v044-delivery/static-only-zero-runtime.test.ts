/** Source-gate build and mutation proof for the release fixture check (#1171, #1633). */
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { assertZeroIslandOutput } from '../../../../tests/fixtures/router-static-only/check-zero-island.ts';
import type { PageIslandManifest } from '../../src/vite/internal/ssg/island-manifest.ts';

const fixtureDir = join(import.meta.dirname!, '../../../../tests/fixtures/router-static-only');
const distDir = join(fixtureDir, 'dist');

async function removeDist(): Promise<void> {
  await rm(distDir, { recursive: true, force: true });
}

beforeAll(async () => {
  await removeDist();
  const build = spawn(
    process.execPath,
    [join(fixtureDir, '../../../packages/router/src/cli/build.ts')],
    { cwd: fixtureDir },
  );
  const [outChunks, errChunks, code] = await Promise.all([
    Array.fromAsync(build.stdout),
    Array.fromAsync(build.stderr),
    new Promise<number | null>((resolve, reject) => {
      build.once('error', reject);
      build.once('exit', resolve);
    }),
  ]);
  const logs = Buffer.concat([...outChunks, ...errChunks]).toString();
  expect(code, `static-only fixture build failed:\n${logs}`).toEqual(0);
});

afterAll(removeDist);

test('v0.44 static-only build ships zero client runtime (#1171)', () => {
  assertZeroIslandOutput(distDir);
});

const islandManifest: PageIslandManifest = {
  route: '/',
  islands: [
    {
      tagName: 'mutant-island',
      chunkUrl: '/client/islands/mutant-island.js',
      strategy: 'idle',
      layer: 'dsd-static',
    },
  ],
  builtAt: '1970-01-01T00:00:00.000Z',
};

test.each([
  {
    file: 'island-manifests/mutant.json',
    addition: JSON.stringify(islandManifest),
    error: 'emitted dist/island-manifests',
  },
  {
    file: 'index.html',
    addition: '<link rel="modulepreload" href="/client/element-runtime-mutant.js">',
    error: 'document dist/index.html references a client asset',
  },
  {
    file: 'about/index.html',
    addition: '<link rel="prefetch" as="fetch" href="/assets/mutant-island.js">',
    error: 'document dist/about/index.html references a client asset',
  },
  {
    file: 'mdx-page/index.html',
    addition: '<script type="module" src="/client/client.js"></script>',
    error: 'document dist/mdx-page/index.html contains a script tag',
  },
  {
    file: 'assets/element-runtime-mutant.js',
    addition: 'export {};',
    error: 'emitted JavaScript at dist/assets/element-runtime-mutant.js',
  },
])('zero-island checker rejects a mutation to $file (#1633)', async ({ file, addition, error }) => {
  const mutatedDist = await mkdtemp(join(tmpdir(), 'oe-zero-island-'));
  try {
    await cp(distDir, mutatedDist, { recursive: true });
    const output = join(mutatedDist, file);
    await mkdir(dirname(output), { recursive: true });
    const content = file.endsWith('.html')
      ? (await readFile(output, 'utf8')).replace('</head>', `${addition}</head>`)
      : addition;
    await writeFile(output, content);
    expect(() => assertZeroIslandOutput(mutatedDist)).toThrow(error);
  } finally {
    await rm(mutatedDist, { recursive: true, force: true });
  }
});
