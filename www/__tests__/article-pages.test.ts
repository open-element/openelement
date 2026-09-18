import { assert, assertEquals, assertExists, assertStringIncludes } from '@std/assert';
import { loadCollectionData } from '../lib/content.ts';
import { fromFileUrl } from '@std/path';
import { articleCollections } from '../content-collections.ts';
import { projectArticlePage } from '../app/site-ui/article-page-model.ts';

type ArticleCollection = keyof typeof articleCollections;
type ArticleContentPage = {
  slug: string;
  locale?: string;
  frontmatter: {
    title: string;
    lede?: string;
    order: number;
    locale: string;
    section: string;
    navLabel?: string;
  };
  content: string;
  html: string;
};
const siteRoot = fromFileUrl(new URL('../', import.meta.url));
const loadContentPages = (collection: ArticleCollection) =>
  loadCollectionData(collection, {
    ...articleCollections[collection],
    contentDir: `${siteRoot}/${articleCollections[collection].contentDir}`,
  }) as Promise<ArticleContentPage[]>;

// The content routes share the site-ui article shell: each route module is a
// thin binding — a content slug — and the nav contract (section / order /
// navLabel) lives in the article frontmatter
// (www/content/docs/<collection>/<slug>[.<locale>].md), the single source of
// truth that tools/repo/generate-site-nav.ts projects (#1087, ADR-0136).
const articleRoutes = [
  ['guide', 'api', 'GuideApiPage', 60],
  ['guide', 'configuration', 'GuideConfigurationPage', 70],
  ['guide', 'core-concepts', 'GuideCoreConceptsPage', 10],
  ['guide', 'deployment', 'GuideDeploymentPage', 100],
  ['guide', 'error-handling', 'GuideErrorHandlingPage', 80],
  ['guide', 'getting-started', 'GuideGettingStartedPage', 1],
  ['guide', 'glossary', 'GuideGlossaryPage', 65],
  ['guide', 'islands-and-ssr', 'GuideIslandsAndSsrPage', 90],
  ['guide', 'mdx', 'GuideMdxPage', 50],
  ['guide', 'routing-and-data', 'GuideRoutingAndDataPage', 40],
  ['guide', 'security', 'GuideSecurityPage', 95],
  ['guide', 'styling', 'GuideStylingPage', 5],
  ['guide', 'testing', 'GuideTestingPage', 110],
  ['guide', 'tutorial', 'GuideTutorialPage', 2],
  ['architecture', 'architecture', 'ArchitecturePage', 10, 'index'],
  ['architecture', 'comparison', 'ComparisonPage', 20],
  ['architecture', 'design-system', 'DesignSystemPage', 15],
  ['architecture', 'dsd', 'DsdGuidePage', 30],
  ['architecture', 'islands', 'IslandsPage', 40],
] as const;

for (const [collection, route, className, , routeFile] of articleRoutes) {
  Deno.test(`${collection}/${route} is a thin article shell`, async () => {
    const routeSource = await Deno.readTextFile(
      new URL(`../app/routes/${collection}/${routeFile ?? route}.tsx`, import.meta.url),
    );
    const adapterSource = await Deno.readTextFile(
      new URL(`../app/components/article-routes/${collection}-${route}.tsx`, import.meta.url),
    );
    assertStringIncludes(routeSource, 'export default definePage(');
    assertStringIncludes(
      routeSource,
      `projectArticlePage('${collection}', '${route}', locale)`,
    );
    assert(
      !routeSource.includes('export const meta'),
      `${collection}/${route} must not duplicate nav metadata; declare it in the frontmatter`,
    );
    assertStringIncludes(adapterSource, `@element('${collection}-${route}')`);
    assertStringIncludes(adapterSource, `class ${className} extends OpenElement`);
    assertStringIncludes(
      adapterSource,
      '<open-article-view model={this.model} locale={this.locale}>',
    );

    const model = projectArticlePage(collection, route, 'en');
    assertEquals(model.slug, route);
    assert(model.metadata.title.length > 0, `${collection}/${route} must project article data`);
    assertStringIncludes(
      model.articleHtml,
      '<h2',
      `${collection}/${route} must project compiled article HTML`,
    );
  });
}

// Content-level assertions run against the real Markdown via the pipeline's
// pure loader — no generated-artifact dependency.
Deno.test('content covers every route in both locales', async () => {
  for (const collection of ['guide', 'architecture'] as const) {
    const pages = await loadContentPages(collection);
    for (const [, route, , order] of articleRoutes.filter((r) => r[0] === collection)) {
      for (const locale of ['en', 'zh'] as const) {
        const page = pages.find((p) => p.slug === route && p.locale === locale);
        assertExists(page, `content/${collection} missing ${route} (${locale})`);
        assertEquals(
          page.frontmatter.order,
          order,
          `${collection}/${route} (${locale}) order mismatch`,
        );
        assert(
          page.frontmatter.title.length > 0,
          `${collection}/${route} (${locale}) title must not be empty`,
        );
        assert(
          typeof page.frontmatter.section === 'string' && page.frontmatter.section.length > 0,
          `${collection}/${route} (${locale}) must declare a nav section`,
        );
        assertStringIncludes(
          page.html,
          '<h2',
          `${collection}/${route} (${locale}) must have article sections`,
        );
        assert(
          !page.html.includes('open-card'),
          `${collection}/${route} (${locale}) must not contain cards`,
        );
      }
    }
  }
});

Deno.test('frontmatter orders are unique within each collection locale', async () => {
  for (const collection of ['guide', 'architecture'] as const) {
    const pages = await loadContentPages(collection);
    for (const locale of ['en', 'zh'] as const) {
      const orders = pages.filter((p) => p.locale === locale).map((p) => p.frontmatter.order);
      assertEquals(
        new Set(orders).size,
        orders.length,
        `duplicate orders in ${collection}/${locale}`,
      );
    }
  }
});

Deno.test('getting-started leads with copyable commands', async () => {
  const pages = await loadContentPages('guide');
  const en = pages.find((p) => p.slug === 'getting-started' && p.locale === 'en');
  assertExists(en);
  // The page's primary job: a fenced, copyable install command — not prose.
  assertStringIncludes(en.html, '<pre><code class="language-bash">');
  assertStringIncludes(en.html, 'npm:@openelement/create');
});

// The security page deep-links the configuration anchor; the configuration
// article must produce a heading whose generated id is middleware-use.
Deno.test('configuration keeps the middleware-use anchor target', async () => {
  const pages = await loadContentPages('guide');
  const en = pages.find((p) => p.slug === 'configuration' && p.locale === 'en');
  const security = pages.find((p) => p.slug === 'security' && p.locale === 'en');
  assertExists(en);
  assertExists(security);
  assertStringIncludes(en.html, '<h2>middleware.use</h2>');
  assertStringIncludes(security.html, '/guide/configuration#middleware-use');
});

Deno.test('content collection loading succeeds for all collections', async () => {
  const count = (await Promise.all(
    (Object.keys(articleCollections) as ArticleCollection[]).map(loadContentPages),
  )).reduce((total, pages) => total + pages.length, 0);
  assertEquals(count, articleRoutes.length * 2, 'every route needs en + zh content');
});
