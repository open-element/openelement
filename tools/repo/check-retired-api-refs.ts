/**
 * Current-doc retired-API scan (1.0.0-alpha.1): fail when current guides,
 * architecture pages, maintainer docs, package READMEs, starter templates,
 * or site chrome teach a retired package, subpath, or public symbol.
 * History stays allowed only where it is explicitly labeled as history: the
 * migration archive and version-titled blog posts. docs/adr stays out of
 * scope on purpose: ADRs are the historical record and may name retired
 * decisions.
 *
 * Symbol entries are DERIVED, not hand-listed: the public interface snapshot
 * at the newest release tag that ships one is diffed against the current
 * snapshot, and names that disappeared (and never moved to another package)
 * are caught when a file imports them from @openelement/*. The hand list
 * stays only for packages/subpaths and for symbols that never reached a
 * release tag (e.g. toRootCss, added and removed inside this PR).
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

// ─── Derived retired symbols (release snapshot diff) ────────────────────

const ADDITIONAL_RETIRED_SYMBOLS = ['toRootCss'];

interface SnapshotLike {
  packages: Array<{ declarations?: Record<string, { publicSymbols?: string[] }> }>;
}

function symbolNames(snapshot: SnapshotLike): Set<string> {
  const names = new Set<string>();
  for (const pkg of snapshot.packages) {
    for (const declaration of Object.values(pkg.declarations ?? {})) {
      for (const symbol of declaration.publicSymbols ?? []) names.add(symbol.split('=')[0]);
    }
  }
  return names;
}

async function gitShow(ref: string): Promise<string | undefined> {
  try {
    const output = await new Deno.Command('git', {
      args: ['show', `${ref}:docs/release/public-interface-snapshot.json`],
      stdin: 'null',
      stdout: 'piped',
      stderr: 'null',
    }).output();
    if (output.code !== 0) return undefined;
    return new TextDecoder().decode(output.stdout);
  } catch {
    return undefined;
  }
}

/** Names present at the newest tagged release snapshot but gone today. */
async function deriveRetiredSymbols(): Promise<Set<string>> {
  const retired = new Set<string>(ADDITIONAL_RETIRED_SYMBOLS);
  const tags = await new Deno.Command('git', {
    args: ['tag', '--list', 'v*', '--sort=-creatordate'],
    stdin: 'null',
    stdout: 'piped',
    stderr: 'null',
  }).output().catch(() => undefined);
  if (!tags || tags.code !== 0) return retired;
  let base: SnapshotLike | undefined;
  for (const tag of new TextDecoder().decode(tags.stdout).split('\n').map((t) => t.trim())) {
    if (!tag) continue;
    const raw = await gitShow(tag);
    if (!raw) continue;
    try {
      base = JSON.parse(raw) as SnapshotLike;
    } catch {
      continue;
    }
    break;
  }
  if (!base) {
    console.log(
      'retired-symbol derivation: no tagged release snapshot reachable — hand list only.',
    );
    return retired;
  }
  const current = JSON.parse(
    await Deno.readTextFile('docs/release/public-interface-snapshot.json'),
  ) as SnapshotLike;
  const currentNames = symbolNames(current);
  for (const name of symbolNames(base)) {
    // Identifiers only; short or all-lowercase names collide with prose.
    if (name.length < 6 || !/^[A-Za-z][A-Za-z0-9]*$/.test(name)) continue;
    if (!(/[A-Z]/.test(name))) continue;
    if (!currentNames.has(name)) retired.add(name);
  }
  return retired;
}

const RETIRED_SYMBOLS = await deriveRetiredSymbols();
const NAMED_IMPORT =
  /import\s+(?:type\s+)?(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}\s*from\s*['"](@openelement\/[^'"]+)['"]/g;

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
  for (const statement of text.matchAll(NAMED_IMPORT)) {
    const specifier = statement[2];
    for (const raw of statement[1].split(',')) {
      const name = raw.replace(/^\s*type\s+/, '').split(/\s+as\s+/)[0].trim();
      if (name && RETIRED_SYMBOLS.has(name)) {
        console.error(`${file}: retired symbol '${name}' imported from '${specifier}'`);
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
