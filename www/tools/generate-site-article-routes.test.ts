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
import { assert, assertEquals, assertStringIncludes, assertThrows } from '@std/assert';
import { fromFileUrl, join } from '@std/path';
import {
  type ArticleRoute,
  managedDirectories,
  pascalCase,
  planFiles,
  renderComponent,
  renderRouteModule,
  routeSetFor,
} from './generate-site-article-routes.ts';

const siteRoot = fromFileUrl(new URL('../../www/', import.meta.url));
const entry = (slug: string, order: number, locale?: string) => ({
  slug,
  ...(locale ? { locale } : {}),
  frontmatter: { order },
});

Deno.test('article routes: a slug maps to its route, binding and class names', () => {
  assertEquals(pascalCase('web-component-admission'), 'WebComponentAdmission');
  assertEquals(pascalCase('i18n'), 'I18n');
  assertEquals(pascalCase('mdx'), 'Mdx');

  const [route] = routeSetFor('guide', [entry('getting-started', 1)]);
  assertEquals(route, {
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
  assertEquals(overview.routeFile, 'index.tsx');
  assertEquals(overview.componentFile, 'architecture-architecture.tsx');
  assertEquals(overview.className, 'ArchitecturePage');
});

Deno.test('article routes: a zh locale suffix folds into the English route', () => {
  const routes = routeSetFor('guide', [entry('styling', 5), entry('styling', 5, 'zh')]);
  assertEquals(routes.length, 1, 'the zh pair is not a second route');
  assertEquals(routes[0].routeFile, 'styling.tsx');
});

Deno.test('article routes: content that cannot become a route module fails closed', () => {
  // No English original: the route would serve a page whose canonical head and
  // body fall back to a slug title.
  assertThrows(
    () => routeSetFor('guide', [entry('only-chinese', 1, 'zh')]),
    Error,
    'no English source',
  );
  // Two files for one locale would silently overwrite each other's route.
  assertThrows(
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
    assertThrows(
      () => routeSetFor('guide', [entry(slug, 1)]),
      Error,
      'slug must match',
      `slug '${slug}' must not become a route`,
    );
  }
  // A digit-only or hyphen-joined slug is still a legal module name.
  assertEquals(routeSetFor('guide', [entry('a-2', 1)])[0].className, 'GuideA2Page');
  // A route with no navigation order cannot be placed in the sidebar.
  assertThrows(
    () =>
      routeSetFor('guide', [{
        slug: 'unordered',
        frontmatter: { order: 'first' },
      }]),
    Error,
    'frontmatter.order must be a number',
  );
});

Deno.test('article routes: two content files claiming one generated file fail closed', () => {
  // The collection overview article owns `index.tsx`; a separate article whose
  // slug is literally `index` computes the same output path. Without the
  // collision check one route would silently disappear from the tree while its
  // binding stayed behind as an orphan.
  const routes = routeSetFor('architecture', [entry('architecture', 10), entry('index', 11)]);
  assertEquals(routes.length, 2, 'the route set itself sees two distinct articles');
  assertEquals(
    routes.map((route) => route.routeFile).sort(),
    ['index.tsx', 'index.tsx'],
    'both routes compute the same route module path',
  );
  const error = assertThrows(() => planFiles(routes), Error) as Error;
  assertStringIncludes(error.message, 'two content files resolve to the same generated file');
  assertStringIncludes(error.message, 'app/routes/architecture/index.tsx');
  // Both claiming sources are named, so the fix is unambiguous.
  assertStringIncludes(error.message, 'content/docs/architecture/architecture.md');
  assertStringIncludes(error.message, 'content/docs/architecture/index.md');

  // The same rule covers the binding directory: a colliding binding file is
  // caught by the same mechanism, not by a second code path.
  assertThrows(
    () =>
      planFiles([{
        collection: 'guide',
        slug: 'a-2',
        routeFile: 'a-2.tsx',
        componentFile: 'guide-a-2.tsx',
        elementTag: 'guide-a-2',
        className: 'GuideA2Page',
        order: 1,
      }, {
        collection: 'guide',
        slug: 'a-2-alias',
        routeFile: 'a-2-alias.tsx',
        // A duplicated binding name: two elements, one file.
        componentFile: 'guide-a-2.tsx',
        elementTag: 'guide-a-2-alias',
        className: 'GuideA2AliasPage',
        order: 2,
      }]),
    Error,
    'app/components/article-routes/guide-a-2.tsx',
  );
});

Deno.test('article routes: the plan covers only managed article paths', () => {
  const routes: ArticleRoute[] = routeSetFor('guide', [entry('styling', 5)]);
  const files = planFiles(routes);
  assertEquals(files.length, routes.length * 2 + 1, 'one route module + one binding per route');
  for (const file of files) {
    assert(
      file.rel.startsWith('app/routes/guide/') ||
        file.rel.startsWith('app/components/article-routes/') ||
        file.rel === 'app/data/_generated-article-routes.ts',
      `unmanaged output path: ${file.rel}`,
    );
    assertStringIncludes(
      file.content.split('\n')[0],
      'Auto-generated by www/tools/generate-site-article-routes.ts',
      `${file.rel} must carry the ownership header the generator keys on`,
    );
  }
  // The managed directories are exactly the article collection route dirs plus
  // the binding dir — the non-article surface (/blog, /docs, /reference, …) is
  // never walked, written or deleted.
  assertEquals(
    [...managedDirectories().keys()].sort(),
    ['app/components/article-routes', 'app/routes/architecture', 'app/routes/guide'],
  );
});

Deno.test('article routes: the emitted modules name their content source', () => {
  const [route] = routeSetFor('architecture', [entry('dsd', 30)]);
  const routeModule = renderRouteModule(route);
  assertStringIncludes(routeModule, 'www/content/docs/architecture/dsd.md');
  assertStringIncludes(routeModule, `projectArticlePage('architecture', 'dsd', locale)`);
  assertStringIncludes(routeModule, `articlePageHead('architecture', 'dsd', locale)`);
  assertStringIncludes(routeModule, 'export default definePage(DsdPage, {');
  // The binding's locale redeclaration is load-bearing (its @ts-expect-error is
  // fingerprinted by site-ui conventions); the generator must keep emitting it.
  const binding = renderComponent(route);
  assertStringIncludes(binding, `@element('architecture-dsd')`);
  assertStringIncludes(binding, 'export default class DsdPage extends OpenElement');
  assertStringIncludes(binding, '// @ts-expect-error compiled @property shadows');
  assertStringIncludes(binding, '<open-article-view model={this.model} locale={this.locale}>');
});

Deno.test('article routes: every route on disk is generated from the collection', async () => {
  // The real tree, read through the same pure rules: this is the invariant the
  // generated table and the managed-directory walk both rely on.
  const { articleRoutes } = await import('../app/data/_generated-article-routes.ts');
  assert(articleRoutes.length > 0, 'the generated table is empty');
  for (const route of articleRoutes) {
    const path = join(siteRoot, 'app/routes', route.collection, route.routeFile);
    const source = await Deno.readTextFile(path);
    assertStringIncludes(source, route.className);
    assertStringIncludes(source, route.componentFile);
    const binding = await Deno.readTextFile(
      join(siteRoot, 'app/components/article-routes', route.componentFile),
    );
    assertStringIncludes(binding, `@element('${route.elementTag}')`);
    // The content file the header names must exist — the route is not orphaned.
    const contentPath = join(siteRoot, 'content/docs', route.collection, `${route.slug}.md`);
    const stat = await Deno.stat(contentPath);
    assert(stat.isFile, `${contentPath} must exist for ${route.slug}`);
  }
});
