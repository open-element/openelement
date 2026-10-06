/**
 * build-pagefind.ts - Pagefind search index generation for the site.
 *
 * Runs after the vite/SSG build (`pnpm --dir www run build`). Replaces the old
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
 * UI-suite filtering (#1555): the pagefind service unconditionally copies
 * three UI bundles (pagefind-ui, pagefind-modular-ui, pagefind-component-ui,
 * each with its CSS) into the output. Verified against the 1.5.2 output: the
 * core runtime (pagefind.js + pagefind-worker.js) fetches only
 * pagefind-entry.json, pagefind.*.pf_meta, wasm.*.pagefind,
 * index/*.pf_index, fragment/*.pf_fragment — and this site loads only
 * /pagefind/pagefind.js (app/site-ui/open-search-combobox.ts). The UI
 * suites are dead weight (~390 KB) and are removed after the write.
 * Retirement condition: if a pagefind release stops emitting the suites or
 * gains a CLI/JS-API option to skip them, this filter no-ops/vanishes —
 * the removal list and the dist guard test (build-output.test.ts) are the
 * only things to delete.
 *
 * Usage: `pnpm --dir www run pagefind` (the root `site:build` gate runs it
 * after the site build).
 */

import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { close, createIndex } from 'pagefind';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import process from 'node:process';

const WWW_ROOT = import.meta.dirname ?? '.';
const DIST_DIR = join(WWW_ROOT, 'dist');
const STAGE_DIR = join(WWW_ROOT, '.openElement', 'pagefind-stage');
const OUTPUT_DIR = join(DIST_DIR, 'pagefind');

/**
 * The UI bundles the pagefind service copies but the core runtime never
 * fetches. pagefind-component-ui.js doubles as the copy-phase anchor below
 * because it is the last file the child process writes (observed as the
 * 0-byte race this script already guards).
 */
export const PAGEFIND_UI_SUITE_FILES = [
  'pagefind-ui.js',
  'pagefind-ui.css',
  'pagefind-modular-ui.js',
  'pagefind-modular-ui.css',
  'pagefind-component-ui.js',
  'pagefind-component-ui.css',
] as const;

/** Unwrap every `<template>` so DSD prose becomes indexable text. */
function unwrapTemplates(html: string): string {
  return html.replace(/<\/?template[^>]*>/g, '');
}

/**
 * Remove the unreferenced UI suites from the written output, failing closed
 * if any of them survives the removal (a pagefind rename would otherwise
 * silently resurrect dead weight).
 */
export async function removeUiSuites(outputDir: string): Promise<void> {
  for (const name of PAGEFIND_UI_SUITE_FILES) {
    await rm(join(outputDir, name), { force: true });
  }
  const survivors: string[] = [];
  for (const name of PAGEFIND_UI_SUITE_FILES) {
    if (await exists(join(outputDir, name))) survivors.push(name);
  }
  if (survivors.length > 0) {
    throw new Error(
      `Pagefind: UI suite files survived removal (pagefind layout changed?): ${survivors.join(', ')}`,
    );
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function stageDist(): Promise<number> {
  await rm(STAGE_DIR, { recursive: true }).catch(() => {});
  let count = 0;
  for (const entry of await readdir(DIST_DIR, { recursive: true, withFileTypes: true })) {
    if (entry.isDirectory() || !entry.name.endsWith('.html')) continue;
    const entryPath = `${entry.parentPath}/${entry.name}`;
    const html = await readFile(entryPath, 'utf8');
    const staged = unwrapTemplates(html);
    const outPath = join(STAGE_DIR, relative(DIST_DIR, entryPath));
    await mkdir(join(outPath, '..'), { recursive: true });
    await writeFile(outPath, staged);
    count++;
  }
  return count;
}

/**
 * Wait until the pagefind child process has finished copying the UI suites.
 * `writeFiles` resolves while the copies are still in flight, and removing a
 * file the child is still writing fails on Windows — the copy must land
 * first. A pagefind that no longer emits the suites skips the wait (the
 * filter's retirement condition); a 0-byte file that never grows is still
 * the broken copy the old freeze-gate race saw.
 */
export async function waitForUiCopy(
  outputDir: string,
  { attempts = 100, intervalMs = 100 }: { attempts?: number; intervalMs?: number } = {},
): Promise<void> {
  const anchor = join(outputDir, 'pagefind-component-ui.js');
  let everSeen = false;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const info = await stat(anchor);
      everSeen = true;
      if (info.size > 0) return;
    } catch {
      // not there (yet)
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  if (!everSeen) return; // pagefind no longer emits the suites
  throw new Error('Pagefind: UI bundle copy did not complete');
}

export async function main(): Promise<void> {
  const staged = await stageDist();
  console.log(`Pagefind: staged ${staged} HTML file(s) from www/dist`);

  const { errors, index } = await createIndex();
  if (!index) {
    console.error('Pagefind: failed to create index:', errors);
    process.exit(1);
  }

  const { errors: addErrors, page_count } = await index.addDirectory({ path: STAGE_DIR });
  if (addErrors.length > 0 || page_count === 0) {
    console.error(`Pagefind: indexing failed (page_count=${page_count}):`, addErrors);
    process.exit(1);
  }

  const { errors: writeErrors, outputPath } = await index.writeFiles({ outputPath: OUTPUT_DIR });
  if (writeErrors.length > 0) {
    console.error('Pagefind: failed to write index files:', writeErrors);
    process.exit(1);
  }

  await waitForUiCopy(outputPath);
  await removeUiSuites(outputPath);

  console.log(`Pagefind: indexed ${page_count} page(s) -> ${outputPath}`);
  await index.deleteIndex();
  await close();
  await rm(STAGE_DIR, { recursive: true }).catch(() => {});
}

if (import.meta.main) {
  await main();
}
