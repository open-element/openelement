/**
 * build-pagefind.ts - Pagefind search index generation for the site.
 *
 * Runs after the vite/SSG build (`deno task build`). Replaces the old
 * bespoke public/search-index.json pipeline (ADR-0123 item 17, #867).
 *
 * Pagefind cannot index Declarative Shadow DOM: `<template shadowrootmode>`
 * content is inert per the HTML spec, and this site's SSG output places
 * page prose inside DSD templates. So the built HTML is staged through a
 * lossy transform before indexing: unwrap every `<template>` tag so page
 * prose becomes indexable light-DOM text.
 *
 * Chrome exclusion is NOT done by string surgery here: the app shell renders
 * light-DOM (there is no shell DSD template to drop), so repeated chrome —
 * header/sidebar/footer, skip link, search overlay, the hidden 404 blocks —
 * carries `data-pagefind-ignore` in the source components, and article/blog
 * prose is scoped with `data-pagefind-body` (which also makes pagefind take
 * the page title from the real h1 instead of the hidden not-found h1).
 * The transform only touches the throwaway staging copy; www/dist itself
 * is untouched apart from the emitted /pagefind directory.
 *
 * Usage: run after the site build (`deno task site:build`); no dedicated task.
 */

import { walk } from '@std/fs/walk';
import { join, relative } from '@std/path';
import { close, createIndex } from 'pagefind';

const WWW_ROOT = import.meta.dirname ?? '.';
const DIST_DIR = join(WWW_ROOT, 'dist');
const STAGE_DIR = join(WWW_ROOT, '.openElement', 'pagefind-stage');
const OUTPUT_DIR = join(DIST_DIR, 'pagefind');

/** Unwrap every `<template>` so DSD prose becomes indexable text. */
function unwrapTemplates(html: string): string {
  return html.replace(/<\/?template[^>]*>/g, '');
}

async function stageDist(): Promise<number> {
  await Deno.remove(STAGE_DIR, { recursive: true }).catch(() => {});
  let count = 0;
  for await (const entry of walk(DIST_DIR, { exts: ['.html'], includeDirs: false })) {
    const html = await Deno.readTextFile(entry.path);
    const staged = unwrapTemplates(html);
    const outPath = join(STAGE_DIR, relative(DIST_DIR, entry.path));
    await Deno.mkdir(join(outPath, '..'), { recursive: true });
    await Deno.writeTextFile(outPath, staged);
    count++;
  }
  return count;
}

const staged = await stageDist();
console.log(`Pagefind: staged ${staged} HTML file(s) from www/dist`);

const { errors, index } = await createIndex();
if (!index) {
  console.error('Pagefind: failed to create index:', errors);
  Deno.exit(1);
}

const { errors: addErrors, page_count } = await index.addDirectory({ path: STAGE_DIR });
if (addErrors.length > 0 || page_count === 0) {
  console.error(`Pagefind: indexing failed (page_count=${page_count}):`, addErrors);
  Deno.exit(1);
}

const { errors: writeErrors, outputPath } = await index.writeFiles({ outputPath: OUTPUT_DIR });
if (writeErrors.length > 0) {
  console.error('Pagefind: failed to write index files:', writeErrors);
  Deno.exit(1);
}

// pagefind copies its UI bundle through a child process; writeFiles can
// resolve while pagefind-component-ui.js is still being written (observed as
// a 0-byte file racing the static-output-freeze gate). Wait for it to land.
const uiBundle = join(outputPath, 'pagefind-component-ui.js');
for (let attempt = 0; attempt < 100; attempt++) {
  try {
    if ((await Deno.stat(uiBundle)).size > 0) break;
  } catch {
    // not there yet
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
}
try {
  const size = (await Deno.stat(uiBundle)).size;
  if (size === 0) {
    console.error('Pagefind: UI bundle copy did not complete');
    Deno.exit(1);
  }
} catch {
  console.error('Pagefind: UI bundle was never emitted');
  Deno.exit(1);
}

console.log(`Pagefind: indexed ${page_count} page(s) -> ${outputPath}`);
await index.deleteIndex();
await close();
await Deno.remove(STAGE_DIR, { recursive: true }).catch(() => {});
