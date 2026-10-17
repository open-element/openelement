import { readFileSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  dirname,
  isAbsolute,
  join,
  relative as relativePath,
  resolve as resolvePath,
  extname,
} from 'node:path';
import { expect, test } from 'vitest';
import { assertRejectsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import type { RouteEntry } from '@openelement/protocol/framework';
import { scanStaticComponents } from '../src/vite/internal/ssg/static-component-scanner.ts';
import type { ModuleWalkResolver } from '../src/vite/internal/module-graph-walk.ts';

async function write(root: string, path: string, source: string): Promise<void> {
  const url = new URL(path, `file://${root}/`);
  await mkdir(new URL('.', url), { recursive: true });
  await writeFile(url, source);
}

const ROUTES: RouteEntry[] = [
  { path: '/', filePath: 'index.tsx', type: 'page', varName: 'pageIndex' },
];

/**
 * A resolver DOUBLE for the scanner's unit contract: relative specifiers with
 * extension probing, plus the root `package.json` `imports` map. The scanner
 * itself is resolver-driven by design (the same `walkModuleGraph` the build
 * uses); production resolution is the bundler's, and the build-level proof that
 * an aliased component is admitted lives in
 * `tailwind-component-discovery.test.ts`.
 */
function resolverFor(root: string): ModuleWalkResolver {
  const extensions = ['.tsx', '.ts', '.jsx', '.js'];
  const probe = (base: string): string | undefined => {
    const candidates = extname(base)
      ? [base]
      : [...extensions.map((extension) => base + extension)];
    for (const candidate of candidates) {
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        // keep probing
      }
    }
    return undefined;
  };
  const importsMap = JSON.parse(
    // The fixture writes its package.json before any scan runs.
    readFileSync(join(root, 'package.json'), 'utf8'),
  ) as { imports?: Record<string, string> };
  return {
    resolve(specifier: string, importer?: string) {
      const map = importsMap.imports ?? {};
      if (specifier.startsWith('#')) {
        const key = Object.keys(map).find((pattern) =>
          pattern.endsWith('*')
            ? specifier.startsWith(pattern.slice(0, -1))
            : pattern === specifier,
        );
        if (key === undefined) return Promise.resolve(null);
        const target = map[key]!;
        const substituted = key.endsWith('*')
          ? target.slice(0, -1) + specifier.slice(key.length - 1)
          : target;
        const id = probe(resolvePath(root, substituted));
        return Promise.resolve(id === undefined ? null : { id });
      }
      if (!specifier.startsWith('.')) return Promise.resolve(null);
      if (importer === undefined) return Promise.resolve(null);
      const id = probe(resolvePath(dirname(importer), specifier));
      return Promise.resolve(id === undefined ? null : { id });
    },
  };
}

/** Whether the resolved id stays inside the project root. */
const insideRoot = (root: string, id: string): boolean => {
  const relative = relativePath(root, id);
  return relative === '' || (!relative.startsWith('..') && !isAbsolute(relative));
};

test('scanStaticComponents follows the local route graph deterministically', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-static-components-'));
  try {
    await write(root, 'package.json', JSON.stringify({ name: 'proof', type: 'module' }));
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

    expect(
      await scanStaticComponents({
        root,
        routesDir: 'app/routes',
        islandsDir: 'app/islands',
        routes: ROUTES,
        resolve: resolverFor(root),
      }),
    ).toEqual([
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
    ]);
  } finally {
    await rm(root, { recursive: true });
  }
});

test('scanStaticComponents reaches a component through the imports map (defect B)', async () => {
  // The defect: a component reached ONLY through a `package.json` `imports`
  // subpath was invisible to the scanner, so the server rendered its host tag
  // with no DSD template — while the build reported success. Reachability is
  // the RESOLVER's, so every specifier form the bundler understands is
  // followed.
  const root = await mkdtemp(join(tmpdir(), 'oe-static-components-alias-'));
  try {
    await write(
      root,
      'package.json',
      JSON.stringify({
        name: 'proof',
        type: 'module',
        imports: { '#components/*': './app/components/*' },
      }),
    );
    await write(
      root,
      'app/routes/index.tsx',
      `import { OpenElement } from '@openelement/element';\nimport '#components/alias-card.tsx';\nexport default class Route extends OpenElement {}`,
    );
    await write(
      root,
      'app/components/alias-card.tsx',
      `import { element, OpenElement } from '@openelement/element';\n@element('oe-alias-card')\nexport default class AliasCard extends OpenElement {}`,
    );

    const decls = await scanStaticComponents({
      root,
      routesDir: 'app/routes',
      islandsDir: 'app/islands',
      routes: ROUTES,
      resolve: resolverFor(root),
    });
    expect(decls.map((decl) => decl.tagName)).toEqual(['oe-alias-card']);
    expect(insideRoot(root, resolvePath(root, decls[0]!.modulePath.slice(1)))).toBe(true);
  } finally {
    await rm(root, { recursive: true });
  }
});

test('scanStaticComponents fails closed on duplicate reachable tags', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-static-components-duplicate-'));
  try {
    await write(root, 'package.json', JSON.stringify({ name: 'proof', type: 'module' }));
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

    await assertRejectsIncludes(
      () =>
        scanStaticComponents({
          root,
          routesDir: 'app/routes',
          islandsDir: 'app/islands',
          routes: ROUTES,
          resolve: resolverFor(root),
        }),
      Error,
      'declared by both',
    );
  } finally {
    await rm(root, { recursive: true });
  }
});
