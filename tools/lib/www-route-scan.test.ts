import { assertEquals } from '@std/assert';
import { join } from '@std/path';
import { scanWwwRoutes } from './www-route-scan.ts';

Deno.test('scanWwwRoutes maps index, nested, and dynamic route files', async () => {
  const dir = await Deno.makeTempDir({ prefix: 'www-route-scan-' });
  try {
    for (
      const file of ['index.tsx', 'guide/configuration.tsx', 'blog/index.tsx', 'blog/[slug].tsx']
    ) {
      const target = join(dir, file);
      await Deno.mkdir(target.split('/').slice(0, -1).join('/'), { recursive: true });
      await Deno.writeTextFile(target, 'export default {};');
    }
    assertEquals(await scanWwwRoutes(dir), [
      { path: '/', type: 'page' },
      { path: '/blog', type: 'page' },
      { path: '/blog/:slug', type: 'page' },
      { path: '/guide/configuration', type: 'page' },
    ]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
