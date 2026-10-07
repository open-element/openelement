import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';
import { assertRejectsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import { join } from 'node:path';
import { expandDynamicRoutes, expandI18nLocales } from '../src/vite/internal/ssg/ssg-dynamic.ts';
import type { SsgPageOutput } from '@openelement/protocol/ssg';

function okOutput(html = '<html><body>ok</body></html>'): SsgPageOutput {
  return { html, errors: [], componentCount: 0, renderTimeMs: 0 };
}

function failingOutput(): SsgPageOutput {
  // The generated renderRoute emits plain error literals (see
  // entry-render-ssg.ts); the cast mirrors existing SsgPageOutput mocks.
  return {
    html: '<html><body>500 Internal Server Error</body></html>',
    status: 500,
    errors: [
      {
        code: 'OPEN_ELEMENT_RENDER_RENDER_FAILED',
        severity: 'error',
        phase: 'render',
        tagName: 'blog-page',
        message: 'render exploded',
        recoverable: false,
      },
    ],
    componentCount: 0,
    renderTimeMs: 0,
  } as SsgPageOutput;
}

const blogRoute = {
  path: '/blog/:slug',
  tagName: 'blog-page',
  isDynamic: true,
  paramNames: ['slug'],
};

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

test('expandI18nLocales skips the default locale output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-'));
  const calls: string[] = [];
  try {
    await expandI18nLocales(
      { i18nOptions: { locales: ['en', 'zh'], defaultLocale: 'en' } },
      (_path, options) => {
        calls.push(String(options?.locale));
        return Promise.resolve({
          html: '<html></html>',
          errors: [],
          componentCount: 0,
          renderTimeMs: 0,
        });
      },
      [{ path: '/guide', tagName: 'guide-page', isDynamic: false, paramNames: [] }],
      undefined,
      { root, outDir: 'dist' },
      root,
      'dist',
    );
    expect(calls).toEqual(['zh']);
    let defaultOutputExists = true;
    try {
      await stat(join(root, 'dist', 'en', 'guide', 'index.html'));
    } catch {
      defaultOutputExists = false;
    }
    expect(defaultOutputExists).toEqual(false);
  } finally {
    await rm(root, { recursive: true });
  }
});

// ─── alpha.18 R2-H3: 500 contract wiring (dynamic routes) ──────

test('expandDynamicRoutes - renderRoute receives no forced global title (#968)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-'));
  try {
    let seenOptions: Record<string, unknown> | undefined;
    await expandDynamicRoutes(
      [blogRoute],
      (_path, options) => {
        seenOptions = options as Record<string, unknown>;
        return Promise.resolve(okOutput());
      },
      () => Promise.resolve([{ slug: 'a' }]),
      // A global html.title must NOT be forwarded as `title`: the generated
      // renderRoute falls back `title || __doc.title || document.title`,
      // so a forced global would shadow the route's own resolved head title.
      { root, outDir: 'dist', html: { title: 'Global Title' } },
      root,
      'dist',
    );
    expect(seenOptions !== undefined).toEqual(true);
    expect(seenOptions!.title).toEqual(undefined);
  } finally {
    await rm(root, { recursive: true });
  }
});

test('expandDynamicRoutes - defined 500 output fails the build by default and writes nothing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-'));
  try {
    await assertRejectsIncludes(
      () =>
        expandDynamicRoutes(
          [blogRoute],
          () => Promise.resolve(failingOutput()),
          () => Promise.resolve([{ slug: 'a' }]),
          { root, outDir: 'dist' },
          root,
          'dist',
        ),
      Error,
      '/blog/a',
    );
    expect(await exists(join(root, 'dist', 'blog', 'a', 'index.html'))).toEqual(false);
  } finally {
    await rm(root, { recursive: true });
  }
});

test('expandDynamicRoutes - defined 500 output in warn mode skips the page and keeps it out of the ISR map', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-'));
  try {
    const map = await expandDynamicRoutes(
      [blogRoute],
      () => Promise.resolve(failingOutput()),
      () => Promise.resolve([{ slug: 'a' }]),
      { root, outDir: 'dist', dynamicRouteFailure: 'warn' },
      root,
      'dist',
    );
    expect(await exists(join(root, 'dist', 'blog', 'a', 'index.html'))).toEqual(false);
    expect(map.get('/blog/:slug') ?? []).toEqual([]);
  } finally {
    await rm(root, { recursive: true });
  }
});

test('expandDynamicRoutes - mixed params register only successful renders in the ISR map (warn mode)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-'));
  try {
    const map = await expandDynamicRoutes(
      [blogRoute],
      (_path, opts) => {
        const slug = (opts?.params as Record<string, string>).slug;
        return Promise.resolve(slug === 'a' ? okOutput() : failingOutput());
      },
      () => Promise.resolve([{ slug: 'a' }, { slug: 'b' }]),
      { root, outDir: 'dist', dynamicRouteFailure: 'warn' },
      root,
      'dist',
    );
    expect(map.get('/blog/:slug')).toEqual([{ slug: 'a' }]);
    expect(await exists(join(root, 'dist', 'blog', 'a', 'index.html'))).toEqual(true);
    expect(await exists(join(root, 'dist', 'blog', 'b', 'index.html'))).toEqual(false);
  } finally {
    await rm(root, { recursive: true });
  }
});

test('expandDynamicRoutes - redirect result is not written as a 200 page', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-'));
  try {
    const redirectOutput: SsgPageOutput = {
      ...okOutput('<html><body>Redirecting</body></html>'),
      status: 302,
      redirect: { location: '/login', status: 302 },
    };
    const map = await expandDynamicRoutes(
      [blogRoute],
      () => Promise.resolve(redirectOutput),
      () => Promise.resolve([{ slug: 'a' }]),
      { root, outDir: 'dist' },
      root,
      'dist',
    );
    expect(await exists(join(root, 'dist', 'blog', 'a', 'index.html'))).toEqual(false);
    expect(map.get('/blog/:slug') ?? []).toEqual([]);
  } finally {
    await rm(root, { recursive: true });
  }
});

test('expandDynamicRoutes - notFound result is not written as a 200 page', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-'));
  try {
    const notFoundOutput: SsgPageOutput = {
      ...okOutput('<html><body>404 Not Found</body></html>'),
      status: 404,
      notFound: true,
    };
    const map = await expandDynamicRoutes(
      [blogRoute],
      () => Promise.resolve(notFoundOutput),
      () => Promise.resolve([{ slug: 'a' }]),
      { root, outDir: 'dist' },
      root,
      'dist',
    );
    expect(await exists(join(root, 'dist', 'blog', 'a', 'index.html'))).toEqual(false);
    expect(map.get('/blog/:slug') ?? []).toEqual([]);
  } finally {
    await rm(root, { recursive: true });
  }
});

test('expandDynamicRoutes - renderRoute throw fails the build by default', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-'));
  try {
    await assertRejectsIncludes(
      () =>
        expandDynamicRoutes(
          [blogRoute],
          () => Promise.reject(new Error('render exploded')),
          () => Promise.resolve([{ slug: 'a' }]),
          { root, outDir: 'dist' },
          root,
          'dist',
        ),
      Error,
      'render exploded',
    );
    expect(await exists(join(root, 'dist', 'blog', 'a', 'index.html'))).toEqual(false);
  } finally {
    await rm(root, { recursive: true });
  }
});

test('expandDynamicRoutes - renderRoute throw in warn mode skips the page', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-'));
  try {
    const map = await expandDynamicRoutes(
      [blogRoute],
      () => Promise.reject(new Error('render exploded')),
      () => Promise.resolve([{ slug: 'a' }]),
      { root, outDir: 'dist', dynamicRouteFailure: 'warn' },
      root,
      'dist',
    );
    expect(await exists(join(root, 'dist', 'blog', 'a', 'index.html'))).toEqual(false);
    expect(map.get('/blog/:slug') ?? []).toEqual([]);
  } finally {
    await rm(root, { recursive: true });
  }
});

// ─── #672: getStaticPaths failures follow the dynamicRouteFailure policy ───

test('expandDynamicRoutes - getStaticPaths throw fails the build by default', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-'));
  try {
    await assertRejectsIncludes(
      () =>
        expandDynamicRoutes(
          [blogRoute],
          () => Promise.resolve(okOutput()),
          () => Promise.reject(new Error('paths exploded')),
          { root, outDir: 'dist' },
          root,
          'dist',
        ),
      Error,
      'getStaticPaths',
    );
  } finally {
    await rm(root, { recursive: true });
  }
});

test('expandDynamicRoutes - getStaticPaths throw in warn mode skips the route', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-'));
  try {
    const map = await expandDynamicRoutes(
      [blogRoute],
      () => Promise.resolve(okOutput()),
      () => Promise.reject(new Error('paths exploded')),
      { root, outDir: 'dist', dynamicRouteFailure: 'warn' },
      root,
      'dist',
    );
    expect(map.get('/blog/:slug') ?? []).toEqual([]);
  } finally {
    await rm(root, { recursive: true });
  }
});

test('expandI18nLocales - getStaticPaths throw fails the build by default', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-'));
  try {
    await assertRejectsIncludes(
      () =>
        expandI18nLocales(
          { i18nOptions: { locales: ['en', 'zh'], defaultLocale: 'en' } },
          () => Promise.resolve(okOutput()),
          [blogRoute],
          () => Promise.reject(new Error('paths exploded')),
          { root, outDir: 'dist' },
          root,
          'dist',
        ),
      Error,
      'getStaticPaths',
    );
    expect(await exists(join(root, 'dist', 'zh', 'blog', 'a', 'index.html'))).toEqual(false);
  } finally {
    await rm(root, { recursive: true });
  }
});

test('expandI18nLocales - getStaticPaths throw in warn mode skips the route', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-'));
  try {
    await expandI18nLocales(
      { i18nOptions: { locales: ['en', 'zh'], defaultLocale: 'en' } },
      () => Promise.resolve(okOutput()),
      [blogRoute],
      () => Promise.reject(new Error('paths exploded')),
      { root, outDir: 'dist', dynamicRouteFailure: 'warn' },
      root,
      'dist',
    );
    expect(await exists(join(root, 'dist', 'zh', 'blog', 'a', 'index.html'))).toEqual(false);
  } finally {
    await rm(root, { recursive: true });
  }
});
