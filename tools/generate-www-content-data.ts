/**
 * Generate the www data modules required by tests, the site check tools and the
 * site build on a clean clone.
 *
 * Emits, from the checked-in content collections:
 *   apps/site/app/data/_generated-guide-data.ts
 *   apps/site/app/data/_generated-architecture-data.ts
 *   apps/site/app/data/_generated-blog-data.ts
 *
 * The remaining modules under apps/site/app/data/ (_generated-api-reference.ts,
 * _generated-content-graph.json, version.ts) have no generator on this line
 * yet and are consumed as ordinary checked-in modules; the API reference has
 * its own `deno task generate:api-reference` gate.
 */
import {
  loadCollectionData,
  writeBlogDataModule,
  writeCollectionDataModule,
} from '../apps/site/lib/content.ts';
import { blogCollection, prepareBlogPosts } from '../apps/site/lib/blog.ts';
import { fromFileUrl, join } from '@std/path';
import { articleCollections } from '../apps/site/content-collections.ts';

const wwwRoot = fromFileUrl(new URL('../apps/site/', import.meta.url));

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
