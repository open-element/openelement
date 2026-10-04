/**
 * Fail-closed rules of the article-routes generator, pinned by direct calls on
 * the exported pure core (tools/generate-site-article-routes.ts).
 *
 * The generator is a build step whose normal path is exercised by check:article-routes
 * and the www suite; these tests cover the paths that only fire on a mistake:
 * content that cannot become a route module, a missing English original, two
 * files resolving to one route, and the ownership/planning boundary that keeps
 * the generator away from non-article routes.
 */
import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../tests/lib/vitest-asserts.ts';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type ArticleRoute,
  managedDirectories,
  pascalCase,
  planFiles,
  renderComponent,
  renderRouteModule,
  routeSetFor,
} from './generate-site-article-routes.ts';
import { readFile, stat } from 'node:fs/promises';

const siteRoot = fileURLToPath(new URL('../../www/', import.meta.url));
const entry = (slug: string, order: number, locale?: string) => ({
  slug,
  ...(locale ? { locale } : {}),
  frontmatter: { order },
});

test('article routes: a slug maps to its route, binding and class names', () => {
  expect(pascalCase('web-component-admission')).toEqual('WebComponentAdmission');
  expect(pascalCase('i18n')).toEqual('I18n');
  expect(pascalCase('mdx')).toEqual('Mdx');

  const [route] = routeSetFor('guide', [entry('getting-started', 1)]);
  expect(route).toEqual({
    collection: 'guide',
    slug: 'getting-started',
    routeFile: 'getting-started.tsx',
    componentFile: 'guide-getting-started.tsx',
    elementTag: 'guide-getting-started',
    className: 'GuideGettingStartedPage',
    order: 1,
  });

  // The collection overview article owns the collection root URL, so its
  // route file is index.tsx — the one place the file name is not the slug.
  const [overview] = routeSetFor('architecture', [entry('architecture', 10)]);
  expect(overview.routeFile).toEqual('index.tsx');
  expect(overview.componentFile).toEqual('architecture-architecture.tsx');
  expect(overview.className).toEqual('ArchitecturePage');
});

test('article routes: a zh locale suffix folds into the English route', () => {
  const routes = routeSetFor('guide', [entry('styling', 5), entry('styling', 5, 'zh')]);
  expect(routes.length, 'the zh pair is not a second route').toEqual(1);
  expect(routes[0].routeFile).toEqual('styling.tsx');
});

test('article routes: content that cannot become a route module fails closed', () => {
  // No English original: the route would serve a page whose canonical head and
  // body fall back to a slug title.
  assertThrowsIncludes(
    () => routeSetFor('guide', [entry('only-chinese', 1, 'zh')]),
    Error,
    'no English source',
  );
  // Two files for one locale would silently overwrite each other's route.
  assertThrowsIncludes(
    () => routeSetFor('guide', [entry('dup', 1), entry('dup', 2)]),
    Error,
    'two content files resolve to dup (en)',
  );
  // A slug that cannot be a module name / element tag / file name.
  const unusableSlugs = [
    'Upper',
    'has_underscore',
    'trailing-',
    '-leading',
    'double--hyphen',
    'dot.ted',
  ];
  for (const slug of unusableSlugs) {
    assertThrowsIncludes(
      () => routeSetFor('guide', [entry(slug, 1)]),
      Error,
      'slug must match',
      `slug '${slug}' must not become a route`,
    );
  }
  // A digit-only or hyphen-joined slug is still a legal module name.
  expect(routeSetFor('guide', [entry('a-2', 1)])[0].className).toEqual('GuideA2Page');
  // A route with no navigation order cannot be placed in the sidebar.
  assertThrowsIncludes(
    () =>
      routeSetFor('guide', [
        {
          slug: 'unordered',
          frontmatter: { order: 'first' },
        },
      ]),
    Error,
    'frontmatter.order must be a number',
  );
});

test('article routes: two content files claiming one generated file fail closed', () => {
  // The collection overview article owns `index.tsx`; a separate article whose
  // slug is literally `index` computes the same output path. Without the
  // collision check one route would silently disappear from the tree while its
  // binding stayed behind as an orphan.
  const routes = routeSetFor('architecture', [entry('architecture', 10), entry('index', 11)]);
  expect(routes.length, 'the route set itself sees two distinct articles').toEqual(2);
  expect(
    routes.map((route) => route.routeFile).sort(),
    'both routes compute the same route module path',
  ).toEqual(['index.tsx', 'index.tsx']);
  const error = assertThrowsIncludes(() => planFiles(routes), Error) as Error;
  expect(error.message).toContain('two content files resolve to the same generated file');
  expect(error.message).toContain('app/routes/architecture/index.tsx');
  // Both claiming sources are named, so the fix is unambiguous.
  expect(error.message).toContain('content/docs/architecture/architecture.md');
  expect(error.message).toContain('content/docs/architecture/index.md');

  // The same rule covers the binding directory: a colliding binding file is
  // caught by the same mechanism, not by a second code path.
  assertThrowsIncludes(
    () =>
      planFiles([
        {
          collection: 'guide',
          slug: 'a-2',
          routeFile: 'a-2.tsx',
          componentFile: 'guide-a-2.tsx',
          elementTag: 'guide-a-2',
          className: 'GuideA2Page',
          order: 1,
        },
        {
          collection: 'guide',
          slug: 'a-2-alias',
          routeFile: 'a-2-alias.tsx',
          // A duplicated binding name: two elements, one file.
          componentFile: 'guide-a-2.tsx',
          elementTag: 'guide-a-2-alias',
          className: 'GuideA2AliasPage',
          order: 2,
        },
      ]),
    Error,
    'app/components/article-routes/guide-a-2.tsx',
  );
});

test('article routes: the plan covers only managed article paths', () => {
  const routes: ArticleRoute[] = routeSetFor('guide', [entry('styling', 5)]);
  const files = planFiles(routes);
  expect(files.length, 'one route module + one binding per route').toEqual(routes.length * 2 + 1);
  for (const file of files) {
    expect(
      file.rel.startsWith('app/routes/guide/') ||
        file.rel.startsWith('app/components/article-routes/') ||
        file.rel === 'app/data/_generated-article-routes.ts',
      `unmanaged output path: ${file.rel}`,
    ).toBeTruthy();
    expect(
      file.content.split('\n')[0],
      `${file.rel} must carry the ownership header the generator keys on`,
    ).toContain('Auto-generated by www/tools/generate-site-article-routes.ts');
  }
  // The managed directories are exactly the article collection route dirs plus
  // the binding dir — the non-article surface (/blog, /docs, /reference, …) is
  // never walked, written or deleted.
  expect([...managedDirectories().keys()].sort()).toEqual([
    'app/components/article-routes',
    'app/routes/architecture',
    'app/routes/guide',
  ]);
});

test('article routes: the emitted modules name their content source', () => {
  const [route] = routeSetFor('architecture', [entry('dsd', 30)]);
  const routeModule = renderRouteModule(route);
  expect(routeModule).toContain('www/content/docs/architecture/dsd.md');
  expect(routeModule).toContain(`projectArticlePage('architecture', 'dsd', locale)`);
  expect(routeModule).toContain(`articlePageHead('architecture', 'dsd', locale)`);
  expect(routeModule).toContain('export default definePage(DsdPage, {');
  // The binding's locale redeclaration is load-bearing (its @ts-expect-error is
  // fingerprinted by site-ui conventions); the generator must keep emitting it.
  const binding = renderComponent(route);
  expect(binding).toContain(`@element('architecture-dsd')`);
  expect(binding).toContain('export default class DsdPage extends OpenElement');
  expect(binding).toContain('// @ts-expect-error compiled @property shadows');
  expect(binding).toContain('<open-article-view model={this.model} locale={this.locale}>');
});

test('article routes: every route on disk is generated from the collection', async () => {
  // The real tree, read through the same pure rules: this is the invariant the
  // generated table and the managed-directory walk both rely on.
  const { articleRoutes } = await import('../app/data/_generated-article-routes.ts');
  expect(articleRoutes.length > 0, 'the generated table is empty').toBeTruthy();
  for (const route of articleRoutes) {
    const path = join(siteRoot, 'app/routes', route.collection, route.routeFile);
    const source = await readFile(path, 'utf8');
    expect(source).toContain(route.className);
    expect(source).toContain(route.componentFile);
    const binding = await readFile(
      join(siteRoot, 'app/components/article-routes', route.componentFile),
      'utf8',
    );
    expect(binding).toContain(`@element('${route.elementTag}')`);
    // The content file the header names must exist — the route is not orphaned.
    const contentPath = join(siteRoot, 'content/docs', route.collection, `${route.slug}.md`);
    const stats = await stat(contentPath);
    expect(stats.isFile(), `${contentPath} must exist for ${route.slug}`).toBeTruthy();
  }
});
