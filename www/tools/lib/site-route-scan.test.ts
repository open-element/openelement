import { expect, test } from 'vitest';
import { join } from 'node:path';
import { scanSiteRoutes } from './site-route-scan.ts';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

test('scanSiteRoutes maps index, nested, and dynamic route files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'site-route-scan-'));
  try {
    for (const file of [
      'index.tsx',
      'guide/configuration.tsx',
      'articles/index.tsx',
      'articles/[slug].tsx',
    ]) {
      const target = join(dir, file);
      await mkdir(target.split('/').slice(0, -1).join('/'), { recursive: true });
      await writeFile(target, 'export default {};');
    }
    expect(await scanSiteRoutes(dir)).toEqual([
      { path: '/', type: 'page' },
      { path: '/articles', type: 'page' },
      { path: '/articles/:slug', type: 'page' },
      { path: '/guide/configuration', type: 'page' },
    ]);
  } finally {
    await rm(dir, { recursive: true });
  }
});
