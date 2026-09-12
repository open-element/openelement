/** Generate the two www article data modules required by tests on a clean clone. */
import {
  loadCollectionData,
  writeCollectionDataModule,
} from '../packages/adapter-vite/src/content.ts';
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
