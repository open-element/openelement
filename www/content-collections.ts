import type { CollectionOptions, CollectionSchema } from './lib/content.ts';
import { renderSiteMarkdown } from './lib/markdown.ts';

/**
 * Article frontmatter owns article titles and short `navLabel` copy. The
 * global documentation sidebar's four groups and their membership/order are
 * curated in www/tools/generate-site-nav.ts so the same information
 * architecture appears on every route; frontmatter `section` remains useful
 * to other collection consumers but does not filter or regroup that tree.
 *
 * Every article collection renders through the shared build-time markdown
 * pipeline (www/lib/markdown.ts): fences compile to Shiki token spans at
 * generation time, so the emitted data modules carry fully highlighted HTML.
 */
function articleSchema(defaultSection: string): CollectionSchema {
  return {
    fields: {
      title: { type: 'string', required: true },
      lede: 'string',
      order: { type: 'number', required: true },
      locale: { type: 'string', default: 'en' },
      section: { type: 'string', default: defaultSection },
      navLabel: 'string',
    },
    transform(frontmatter, context) {
      const localized = context.slug.match(/^(.*)\.([a-z]{2})$/);
      return {
        slug: localized?.[1] ?? context.slug,
        frontmatter: { ...frontmatter, locale: localized?.[2] ?? 'en' },
      };
    },
  };
}

export const articleCollections = {
  guide: {
    contentDir: 'content/docs/guide',
    basePath: '/guide',
    schema: articleSchema('Guide'),
    markdown: renderSiteMarkdown,
  },
  architecture: {
    contentDir: 'content/docs/architecture',
    basePath: '/architecture',
    schema: articleSchema('Principles'),
    markdown: renderSiteMarkdown,
  },
} satisfies Record<'guide' | 'architecture', CollectionOptions>;
