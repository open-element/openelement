import type { CollectionOptions, CollectionSchema } from './lib/content.ts';
import { renderSiteMarkdown } from './lib/markdown.ts';

/**
 * Article frontmatter is the single source of truth for the sidebar nav:
 * `order` sorts within the section, `section` groups the entry (defaulted
 * per collection), and `navLabel` is the short sidebar label when the full
 * `title` is too long. Route modules no longer duplicate this in a `meta`
 * export; www/tools/generate-site-nav.ts reads it from here.
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
