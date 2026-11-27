import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { expect, test, vi } from 'vitest';
import { scanRoutes } from '../../../packages/router/src/vite/internal/ssg/route-scanner.ts';
import { spawnCommand } from '../../../tools/repo/node-command.ts';
import {
  collectRetiredUrlFailures,
  retiredContentTitles,
  type RedirectMapping,
} from './site-retired.ts';

vi.mock(import('node:fs/promises'), async (importOriginal) => ({
  ...(await importOriginal()),
  readFile: vi.fn(),
}));
vi.mock(import('../../../packages/router/src/vite/internal/ssg/route-scanner.ts'), () => ({
  scanRoutes: vi.fn(),
}));
vi.mock(import('../../../tools/repo/node-command.ts'), () => ({
  spawnCommand: vi.fn(),
}));

function siteFixture(mappings: RedirectMapping[], retiredTitles = ['Old comparison']) {
  const baseline = {
    baseline: { ref: 'v1.0.0', sha: '0123456789abcdef' },
    routes: ['/', '/comparison-old', '/guide/deploy-old'],
    retiredTitles,
  };
  const files = new Map([
    ['site-baseline-routes.json', JSON.stringify(baseline)],
    ['site-redirects.json', JSON.stringify({ redirects: mappings })],
    ['architecture.md', '## Measured [output](/guide/deployment)\n'],
    ['architecture.zh.md', '## **实测输出**\n'],
    ['deployment.md', '### Verify build\n'],
    ['deployment.zh.md', '### Verify build\n'],
  ]);
  vi.mocked(readFile).mockImplementation((file) => {
    const name = basename(String(file));
    const source = files.get(name);
    if (source === undefined) return Promise.reject(new Error(`Unexpected fixture path: ${name}`));
    return Promise.resolve(source);
  });
  vi.mocked(scanRoutes).mockResolvedValue(
    ['index.tsx', 'architecture/index.tsx', 'guide/deployment.tsx', 'guide/[slug].tsx'].map(
      (filePath) => ({ type: 'page', filePath, path: '', varName: '' }),
    ),
  );
  vi.mocked(spawnCommand).mockImplementation((command, options) => {
    expect(command).toBe('git');
    const args = options?.args;
    let out: string;
    if (args?.[0] === 'tag') {
      out = 'v0.9.0\n';
    } else if (args?.[0] === 'ls-tree' && args.at(-1) === 'apps/site/app/routes') {
      out = 'apps/site/app/routes/older.tsx\napps/site/app/routes/guide/[slug].tsx\n';
    } else {
      expect(args).toEqual(['ls-tree', '-r', '--name-only', 'v0.9.0', '--', 'www/app/routes']);
      out = '';
    }
    return Promise.resolve({
      code: 0,
      success: true,
      signal: null,
      stdout: new TextEncoder().encode(out),
      stderr: new Uint8Array(),
    });
  });
}

test('retired redirects resolve translated headings and retain sources from older releases', async () => {
  siteFixture([
    {
      from: '/comparison-old',
      to: '/architecture#measured-output',
      toZh: '/architecture#实测输出',
      status: 301,
    },
    { from: '/guide/deploy-old', to: '/guide/deployment#verify-build', status: 301 },
    { from: '/older', to: '/architecture', status: 301 },
  ]);

  await expect(collectRetiredUrlFailures()).resolves.toEqual({
    failures: [],
    baselineSha: '0123456789abcdef',
    retiredCount: 2,
  });
  await expect(retiredContentTitles()).resolves.toEqual(new Set(['Old comparison']));
});

test('retired redirects report a missing locale heading, a missing route, and a non-article fragment', async () => {
  siteFixture(
    [
      {
        from: '/comparison-old',
        to: '/architecture#measured-output',
        toZh: '/architecture#旧标题',
        status: 301,
      },
      { from: '/guide/deploy-old', to: '/guide/missing', status: 301 },
      { from: '/older', to: '/#start', status: 301 },
    ],
    [],
  );

  const { failures } = await collectRetiredUrlFailures();
  expect(failures).toEqual(
    expect.arrayContaining([
      'fragment #旧标题 missing in zh /architecture#旧标题',
      'mapping target is not a route: /guide/missing',
      'cannot verify fragment against non-collection route: /#start',
      'baseline snapshot (0123456789ab) has no retired titles recorded',
    ]),
  );
  expect(failures.join('\n')).not.toContain('missing in en');
});
