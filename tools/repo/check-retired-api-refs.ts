/**
 * Current-doc retired-API scan (1.0.0-alpha.1): fail when current guides,
 * architecture pages, READMEs, or site chrome teach a retired package or
 * subpath. History stays allowed only where it is explicitly labeled as
 * history: the migration archive and version-titled blog posts.
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
  'www/content/guide',
  'www/content/architecture',
  'www/app',
  'www/lib',
  'packages/ui',
];

const HISTORY_ALLOWLIST = ['migration.md', 'migration.zh.md'];

let failures = 0;
for (const dir of SCAN_DIRS) {
  for await (const entry of walk(dir, { exts: ['.md', '.mdx', '.ts', '.tsx'] })) {
    const file = entry.path;
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
}
if (failures > 0) {
  console.error(`current-doc retired-API scan failed: ${failures} file(s)`);
  Deno.exit(1);
}
console.log('current-doc retired-API scan passed.');
