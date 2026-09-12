/**
 * build-pagefind.ts - Pagefind search index generation for the www site.
 *
 * Runs after the vite/SSG build (`deno task build`). Replaces the old
 * bespoke public/search-index.json pipeline (ADR-0123 item 17, #867).
 *
 * Pagefind cannot index Declarative Shadow DOM: `<template shadowrootmode>`
 * content is inert per the HTML spec, and this site's SSG output places
 * page prose inside DSD templates. So the built HTML is staged through a
 * lossy transform before indexing:
 *   1. drop the app shell's own DSD template — header/sidebar/footer chrome
 *      is identical on every page and would otherwise flood the index;
 *   2. unwrap every remaining `<template>` tag so page prose becomes
 *      indexable light-DOM text.
 * The transform only touches the throwaway staging copy; www/dist itself is
 * untouched apart from the emitted /pagefind directory.
 *
 * Usage: deno task www:pagefind
 */

import { walk } from '@std/fs/walk';
import { join, relative } from '@std/path';
import { close, createIndex } from 'pagefind';

const WWW_ROOT = import.meta.dirname ?? '.';
const DIST_DIR = join(WWW_ROOT, 'dist');
const STAGE_DIR = join(WWW_ROOT, '.openElement', 'pagefind-stage');
const OUTPUT_DIR = join(DIST_DIR, 'pagefind');

/** Remove the first `<template>` block following `<hostTag` (depth-aware). */
function removeShellTemplate(html: string, hostTag: string): string {
  const hostIdx = html.indexOf(`<${hostTag}`);
  if (hostIdx === -1) return html;
  const openIdx = html.indexOf('<template', hostIdx);
  if (openIdx === -1) return html;
  const tagRe = /<template|<\/template>/g;
  tagRe.lastIndex = html.indexOf('>', openIdx) + 1;
  let depth = 1;
  let match;
  while ((match = tagRe.exec(html)) !== null) {
    depth += match[0] === '<template' ? 1 : -1;
    if (depth === 0) return html.slice(0, openIdx) + html.slice(tagRe.lastIndex);
  }
  return html;
}

/** Unwrap every remaining `<template>` so DSD prose becomes indexable text. */
function unwrapTemplates(html: string): string {
  return html.replace(/<\/?template[^>]*>/g, '');
}

async function stageDist(): Promise<number> {
  await Deno.remove(STAGE_DIR, { recursive: true }).catch(() => {});
  let count = 0;
  for await (const entry of walk(DIST_DIR, { exts: ['.html'], includeDirs: false })) {
    const html = await Deno.readTextFile(entry.path);
    const staged = unwrapTemplates(removeShellTemplate(html, 'open-layout'));
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
