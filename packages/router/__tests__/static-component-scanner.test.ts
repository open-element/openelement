import { assertEquals, assertRejects } from '@std/assert';
import type { RouteEntry } from '../src/vite/internal/protocol/framework.ts';
import { scanStaticComponents } from '../src/vite/internal/ssg/static-component-scanner.ts';

async function write(root: string, path: string, source: string): Promise<void> {
  const url = new URL(path, `file://${root}/`);
  await Deno.mkdir(new URL('.', url), { recursive: true });
  await Deno.writeTextFile(url, source);
}

const ROUTES: RouteEntry[] = [
  { path: '/', filePath: 'index.tsx', type: 'page', varName: 'pageIndex' },
];

Deno.test('scanStaticComponents follows the local route graph deterministically', async () => {
  const root = await Deno.makeTempDir({ prefix: 'oe-static-components-' });
  try {
    await write(
      root,
      'app/routes/index.tsx',
      `import { OpenElement } from '@openelement/element';\nimport '../components/article.tsx';\nimport '../islands/counter.tsx';\nexport default class Route extends OpenElement {}`,
    );
    await write(
      root,
      'app/components/article.tsx',
      `import { element, OpenElement } from '@openelement/element';\nimport './reading-shell.tsx';\n@element('open-article-view')\nexport default class Article extends OpenElement {}`,
    );
    await write(
      root,
      'app/components/reading-shell.tsx',
      `import { element, OpenElement } from '@openelement/element';\n@element('open-reading-shell')\nexport default class ReadingShell extends OpenElement { render() { return <button onClick={() => this.open()}>Open</button>; } open() {} }`,
    );
    await write(
      root,
      'app/islands/counter.tsx',
      `import { element, OpenElement } from '@openelement/element';\n@element('open-counter')\nexport default class Counter extends OpenElement {}`,
    );

    assertEquals(
      await scanStaticComponents({
        root,
        routesDir: 'app/routes',
        islandsDir: 'app/islands',
        routes: ROUTES,
      }),
      [
        {
          tagName: 'open-article-view',
          modulePath: '/app/components/article.tsx',
          compilerInteractionEvents: [],
        },
        {
          tagName: 'open-reading-shell',
          modulePath: '/app/components/reading-shell.tsx',
          compilerInteractionEvents: ['click'],
        },
      ],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('scanStaticComponents fails closed on duplicate reachable tags', async () => {
  const root = await Deno.makeTempDir({ prefix: 'oe-static-components-duplicate-' });
  try {
    await write(
      root,
      'app/routes/index.tsx',
      `export * from '../components/first.tsx';\nexport * from '../components/second.tsx';`,
    );
    for (const file of ['first', 'second']) {
      await write(
        root,
        `app/components/${file}.tsx`,
        `import { element, OpenElement } from '@openelement/element';\n@element('open-duplicate')\nexport default class Duplicate extends OpenElement {}`,
      );
    }

    await assertRejects(
      () =>
        scanStaticComponents({
          root,
          routesDir: 'app/routes',
          islandsDir: 'app/islands',
          routes: ROUTES,
        }),
      Error,
      'declared by both',
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
