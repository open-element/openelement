/**
 * Emit the Cloudflare Pages redirect table from site-redirects.json.
 *
 * Deliberately NOT named generate-*: the output lands in www/dist (rebuilt
 * every site:build, never committed), like the sitemap — so it
 * stays outside the generator-gates drift rule, which covers only committed
 * mirrors. Reads the same table check-retired-urls.ts validates; locale
 * prefixes expand from SITE_LOCALES (never written in the table).
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_LOCALES } from '../site-config.ts';
import { loadRedirectTable } from './lib/site-retired.ts';
import { siteRedirectSources, siteRedirectTarget } from '../lib/site-redirects.ts';
import { rename, writeFile } from 'node:fs/promises';
import process from 'node:process';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const outFile = join(repoRoot, 'www/dist/_redirects');

const mappings = await loadRedirectTable();
const lines: string[] = [];
for (const mapping of mappings) {
  for (const locale of SITE_LOCALES) {
    const prefix = locale === 'en' ? '' : `/${locale}`;
    // Shared with Vite dev responses so route slash and locale forms agree.
    const target = siteRedirectTarget(mapping, locale);
    for (const source of siteRedirectSources(mapping, prefix)) {
      lines.push(`${source}  ${target}  ${mapping.status}`);
    }
  }
}

// Idempotent, and atomic. The generator runs on every site:build, and a build
// that runs twice over the same output directory must produce the same table
// rather than fail on its own previous output. Writing a process-unique
// temporary and renaming it into place gives that without a check-then-act
// window (the previous O_EXCL open traded idempotence away for the same
// guarantee — CodeQL js/toctou-race-condition never required that trade).
const tempFile = `${outFile}.${process.pid}.tmp`;
await writeFile(tempFile, lines.join('\n') + '\n', 'utf8');
await rename(tempFile, outFile);
console.log(`site redirects written: ${lines.length} rules (${outFile}).`);
