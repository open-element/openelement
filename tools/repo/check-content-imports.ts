/**
 * Content import gate: every named `@openelement/*` import inside a fenced
 * code block under www/content must name a real export.
 *
 * The inventory is www/app/data/_generated-api-reference.ts, generated from
 * the repository truth by generate:api-reference — so a doc sample importing
 * a renamed or never-exported symbol fails here instead of teaching a
 * broken import (TS2305 class). Relative imports ('../app/routes/x.tsx')
 * are narrative paths and deliberately NOT checked — that boundary is
 * documented here so the next reader does not mistake this for full
 * coverage (full snippet type-checking lives in content-examples:check).
 */
import { walk } from '@std/fs/walk';
import { fromFileUrl, join } from '@std/path';
import { apiReference } from '../../www/app/data/_generated-api-reference.ts';

const repoRoot = fromFileUrl(new URL('../../', import.meta.url));
const contentRoot = join(repoRoot, 'www/content');

const inventory = new Map<string, Set<string>>();
for (const pkg of apiReference.packages) {
  for (const subpath of pkg.subpaths) {
    const specifier = subpath.subpath === '.'
      ? pkg.name
      : `${pkg.name}/${subpath.subpath.replace(/^\.\//, '')}`;
    inventory.set(specifier, new Set(subpath.exports.map((item) => item.name)));
  }
}

const FENCE = /```(?:ts|tsx|js|javascript|typescript)?[^\S\n]*\n([\s\S]*?)```/g;
const NAMED_IMPORT =
  /import\s+(?:type\s+)?(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}\s*from\s*['"](@openelement\/[^'"]+)['"]/g;

let failures = 0;
for await (const entry of walk(contentRoot, { exts: ['.md', '.mdx'], includeDirs: false })) {
  const text = await Deno.readTextFile(entry.path);
  const rel = entry.path.slice(repoRoot.length + 1);
  for (const fence of text.matchAll(FENCE)) {
    for (const stmt of fence[1].matchAll(NAMED_IMPORT)) {
      const specifier = stmt[2];
      const known = inventory.get(specifier);
      if (!known) {
        console.error(`- ${rel}: unknown @openelement subpath '${specifier}'`);
        failures++;
        continue;
      }
      for (const raw of stmt[1].split(',')) {
        // `type X` inline modifiers and `X as Y` aliases resolve to X.
        const name = raw.replace(/^\s*type\s+/, '').split(/\s+as\s+/)[0].trim();
        if (!name) continue;
        if (!known.has(name)) {
          console.error(`- ${rel}: '${name}' is not exported from '${specifier}'`);
          failures++;
        }
      }
    }
  }
}

if (failures > 0) {
  console.error(`content imports check failed: ${failures} bad named import(s).`);
  Deno.exit(1);
}
console.log('content imports check passed.');
