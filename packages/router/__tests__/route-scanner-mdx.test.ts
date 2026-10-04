/**
 * route-scanner: .mdx route discovery (#954).
 *
 * The scanner extension filter used to admit only ts/tsx/js/jsx, so an MDX
 * page was invisible to the route table even though the dev entry and the
 * Phase 3 SSR build both carry mdxPlugin. These tests pin discovery; the
 * end-to-end render path is covered by static-only-build.test.ts.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';
import { join } from 'node:path';
import { scanRoutes } from '../src/vite/internal/ssg/index.ts';

test('scanRoutes discovers .mdx page routes (#954)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-scan-mdx-'));
  try {
    const routesDir = join(dir, 'routes');
    await mkdir(join(routesDir, 'docs'), { recursive: true });
    await writeFile(join(routesDir, 'index.tsx'), `export default null;\n`);
    await writeFile(join(routesDir, 'guide.mdx'), `# Guide\n`);
    await writeFile(join(routesDir, 'docs', 'deep.mdx'), `# Deep\n`);

    const entries = await scanRoutes(routesDir);
    const paths = entries.map((entry) => entry.path);
    expect(paths).toEqual(['/', '/docs/deep', '/guide']);
    const mdx = entries.find((entry) => entry.path === '/guide');
    expect(mdx?.type).toEqual('page');
    expect(mdx?.filePath).toEqual('guide.mdx');
  } finally {
    await rm(dir, { recursive: true }).catch(() => {});
  }
});
