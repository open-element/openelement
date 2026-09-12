/**
 * Generate the www data modules required by tests, the site check tools and the
 * site build on a clean clone.
 *
 * Emits, from the checked-in content collections:
 *   www/app/data/_generated-guide-data.ts
 *   www/app/data/_generated-architecture-data.ts
 *   www/app/data/_generated-blog-data.ts
 *
 * The remaining modules under www/app/data/ (_generated-nav.ts,
 * _generated-i18n-data.ts, _generated-api-reference.ts,
 * _generated-content-graph.json, version.ts) have no generator on this line yet
 * and are consumed as ordinary checked-in modules.
 */
import {
  loadCollectionData,
  writeBlogDataModule,
  writeCollectionDataModule,
} from '../www/lib/content.ts';
import { blogCollection, prepareBlogPosts } from '../www/lib/blog.ts';
import { fromFileUrl, join } from '@std/path';
import { articleCollections } from '../www/content-collections.ts';

const wwwRoot = fromFileUrl(new URL('../www/', import.meta.url));

for (const name of ['guide', 'architecture'] as const) {
  const options = {
    ...articleCollections[name],
    contentDir: join(wwwRoot, articleCollections[name].contentDir),
  };
  const entries = await loadCollectionData(name, options);
  const output = writeCollectionDataModule(name, entries, options);
  await Deno.writeTextFile(join(wwwRoot, `app/data/_generated-${name}-data.ts`), output);
}

const blogOptions = { ...blogCollection, contentDir: join(wwwRoot, blogCollection.contentDir) };
const blogEntries = await loadCollectionData('blog', blogOptions);
await Deno.writeTextFile(
  join(wwwRoot, 'app/data/_generated-blog-data.ts'),
  writeBlogDataModule(prepareBlogPosts(blogEntries)),
);
