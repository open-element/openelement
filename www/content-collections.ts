import type { CollectionOptions, CollectionSchema } from '@openelement/adapter-vite';

export const articleCollectionSchema: CollectionSchema = {
  fields: {
    title: { type: 'string', required: true },
    lede: 'string',
    order: { type: 'number', required: true },
    locale: { type: 'string', default: 'en' },
  },
  transform(frontmatter, context) {
    const localized = context.slug.match(/^(.*)\.([a-z]{2})$/);
    return {
      slug: localized?.[1] ?? context.slug,
      frontmatter: { ...frontmatter, locale: localized?.[2] ?? 'en' },
    };
  },
};

export const articleCollections = {
  guide: { contentDir: 'content/guide', basePath: '/guide', schema: articleCollectionSchema },
  architecture: {
    contentDir: 'content/architecture',
    basePath: '/architecture',
    schema: articleCollectionSchema,
  },
} satisfies Record<'guide' | 'architecture', CollectionOptions>;
