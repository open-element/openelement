/**
 * route-scanner: .mdx route discovery (#954).
 *
 * The scanner extension filter used to admit only ts/tsx/js/jsx, so an MDX
 * page was invisible to the route table even though the dev entry and the
 * Phase 3 SSR build both carry mdxPlugin. These tests pin discovery; the
 * end-to-end render path is covered by static-only-build.test.ts.
 */
import { assertEquals } from '@std/assert';
import { join } from 'jsr:@std/path@^1.0.0';
import { scanRoutes } from '../src/vite/internal/ssg/index.ts';

Deno.test('scanRoutes discovers .mdx page routes (#954)', async () => {
  const dir = await Deno.makeTempDir({ prefix: 'oe-scan-mdx-' });
  try {
    const routesDir = join(dir, 'routes');
    await Deno.mkdir(join(routesDir, 'docs'), { recursive: true });
    await Deno.writeTextFile(join(routesDir, 'index.tsx'), `export default null;\n`);
    await Deno.writeTextFile(join(routesDir, 'guide.mdx'), `# Guide\n`);
    await Deno.writeTextFile(join(routesDir, 'docs', 'deep.mdx'), `# Deep\n`);

    const entries = await scanRoutes(routesDir);
    const paths = entries.map((entry) => entry.path);
    assertEquals(paths, ['/', '/docs/deep', '/guide']);
    const mdx = entries.find((entry) => entry.path === '/guide');
    assertEquals(mdx?.type, 'page');
    assertEquals(mdx?.filePath, 'guide.mdx');
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});
