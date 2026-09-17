/**
 * Current-doc retired-API scan (1.0.0-alpha.1): fail when current guides,
 * architecture pages, maintainer docs, package READMEs, starter templates,
 * or site chrome teach a retired package or subpath. History stays allowed
 * only where it is explicitly labeled as history: the migration archive and
 * version-titled blog posts. docs/adr stays out of scope on purpose: ADRs
 * are the historical record and may name retired decisions.
 */
import { walk } from '@std/fs';

const RETIRED = [
  '@openelement/app',
  '@openelement/adapter-vite',
  'adapter-vite',
  '@openelement/core',
  '@openelement/signal',
  '@openelement/protocol',
  '@openelement/content',
  '@openelement/ssg',
  '/preact',
  'preact-render-to-string',
];

const SCAN_DIRS = [
  'www/content/docs/guide',
  'www/content/docs/architecture',
  'www/app',
  'www/lib',
  'packages/ui',
  'docs/architecture',
  'docs/integrations',
  'docs/maintainers',
  // Starter template sources ship as .tmpl; the extension list covers them.
  'packages/create/templates',
];

const HISTORY_ALLOWLIST = ['migration.md', 'migration.zh.md'];

const seen = new Set<string>();
const files: string[] = [];
const collect = (file: string) => {
  if (seen.has(file)) return;
  seen.add(file);
  files.push(file);
};
for (const dir of SCAN_DIRS) {
  for await (
    const entry of walk(dir, { exts: ['.md', '.mdx', '.ts', '.tsx', '.tmpl'] })
  ) {
    collect(entry.path);
  }
}
// Every package README teaches the current public surface; packages/ui is
// already walked above and deduped.
for await (const entry of walk('packages', { maxDepth: 2, exts: ['.md'] })) {
  if (entry.path.endsWith('/README.md')) collect(entry.path);
}

let failures = 0;
for (const file of files) {
  if (HISTORY_ALLOWLIST.some((allowed) => file.endsWith(allowed))) continue;
  // Generated data modules are derived from scanned sources (content
  // collections, package exports); version-titled blog history may name
  // retired APIs, so scan sources rather than serialized output.
  if (file.includes('www/app/data/_generated-')) continue;
  const text = await Deno.readTextFile(file);
  // Markdown formatters may wrap a retired-package list across physical
  // lines; match against logical lines (consecutive blockquote lines
  // merged) so `Retired: ... \n > adapter-vite` stays documentation.
  const logical: string[] = [];
  for (const line of text.split('\n')) {
    const previous = logical[logical.length - 1];
    if (
      line.trimStart().startsWith('>') && previous !== undefined &&
      previous.trimStart().startsWith('>')
    ) {
      logical[logical.length - 1] = `${previous} ${line}`;
    } else {
      logical.push(line);
    }
  }
  for (const token of RETIRED) {
    if (text.includes(token)) {
      // A retired list that names the token as retired is documentation,
      // not teaching: allow "Retired:" / "已退役" lines only.
      const offending = logical.filter((line) =>
        line.includes(token) && !/Retired:|已退役|retired/i.test(line)
      );
      if (offending.length > 0) {
        console.error(`${file}: retired reference '${token}' (${offending.length} line(s))`);
        failures += 1;
      }
    }
  }
}
if (failures > 0) {
  console.error(`current-doc retired-API scan failed: ${failures} file(s)`);
  Deno.exit(1);
}
console.log('current-doc retired-API scan passed.');
