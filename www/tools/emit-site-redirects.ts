/**
 * Emit the Cloudflare Pages redirect table from site-redirects.json.
 *
 * Deliberately NOT named generate-*: the output lands in www/dist (rebuilt
 * every site:build, never committed), like site:sitemap and site:rss — so it
 * stays outside the generator-gates drift rule, which covers only committed
 * mirrors. Reads the same table check-retired-urls.ts validates; locale
 * prefixes expand from SITE_LOCALES (never written in the table).
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_LOCALES } from '../site-config.ts';
import { loadRedirectTable } from './lib/site-retired.ts';
import { writeFile } from 'node:fs/promises';
import process from 'node:process';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const outFile = join(repoRoot, 'www/dist/_redirects');

const mappings = await loadRedirectTable();
const lines: string[] = [];
for (const mapping of mappings) {
  const perLocale = { en: mapping.to, zh: mapping.toZh ?? mapping.to };
  for (const locale of SITE_LOCALES) {
    const prefix = locale === 'en' ? '' : `/${locale}`;
    const raw = perLocale[locale];
    const [toPath, fragment] = raw.split('#');
    const target = `${prefix}${toPath}${fragment ? `#${fragment}` : ''}`;
    lines.push(`${prefix}${mapping.from}  ${target}  ${mapping.status}`);
  }
}

// EAFP (CodeQL js/toctou-race-condition): open the output with O_EXCL ('wx')
// instead of stat-then-write, so there is no check/act window for the file to
// change through — the kernel rejects an existing target atomically with EEXIST.
try {
  await writeFile(outFile, lines.join('\n') + '\n', { flag: 'wx' });
} catch (error) {
  if ((error as { code?: string }).code === 'EEXIST') {
    console.error(`site:redirects: ${outFile} already exists — refusing to overwrite.`);
    process.exit(1);
  }
  throw error;
}
console.log(`site redirects written: ${lines.length} rules (${outFile}).`);
