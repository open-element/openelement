/**
 * Emit the Cloudflare Pages redirect table from site-redirects.json.
 *
 * Deliberately NOT named generate-*: the output lands in www/dist (rebuilt
 * every site:build, never committed), like site:sitemap and site:rss — so it
 * stays outside the generator-gates drift rule, which covers only committed
 * mirrors. Reads the same table check-retired-urls.ts validates; locale
 * prefixes expand from SITE_LOCALES (never written in the table).
 */
import { fromFileUrl, join } from '@std/path';
import { SITE_LOCALES } from '../../www/app/site-ui/link.ts';
import { loadRedirectTable } from './check-retired-urls.ts';

const repoRoot = fromFileUrl(new URL('../../', import.meta.url));
const outFile = join(repoRoot, 'www/dist/_redirects');

const mappings = await loadRedirectTable();
const lines: string[] = [];
for (const mapping of mappings) {
  const perLocale = { en: mapping.to, zh: mapping.toZh ?? mapping.to };
  for (const locale of SITE_LOCALES) {
    const prefix = locale === 'en' ? '' : `/${locale}`;
    const raw = perLocale[locale as 'en' | 'zh'];
    const [toPath, fragment] = raw.split('#');
    const target = `${prefix}${toPath}${fragment ? `#${fragment}` : ''}`;
    lines.push(`${prefix}${mapping.from}  ${target}  ${mapping.status}`);
  }
}

try {
  await Deno.stat(outFile);
  console.error(`site:redirects: ${outFile} already exists — refusing to overwrite.`);
  Deno.exit(1);
} catch {
  // Missing file is the expected case; fall through to writing.
}
await Deno.writeTextFile(outFile, lines.join('\n') + '\n');
console.log(`site redirects written: ${lines.length} rules (${outFile}).`);
