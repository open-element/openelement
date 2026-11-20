/**
 * P8 consumer-form drift guard for the element-browser alias table — the
 * hand-maintained second source of truth (P6) that #1804 B-1 drifted on.
 *
 * The `element-browser` project resolves the browser conformance suite's
 * `@openelement/element` specifiers ONLY through the literal `resolve.alias`
 * table in `vitest.config.ts` (that project's own comment says so: the bare
 * element specifier must not be rewritten to a published artifact, so the
 * table is the resolution contract). The table is therefore a hand-maintained
 * copy of a subset of `packages/element/package.json#exports`, and hand copies
 * drift. It drifted twice inside one PR: `f24f60716` added the
 * `internal/compiled/leaf-runtime` row by hand ("One row added"), then
 * `61027e501` changed `packages/ui/src/component-recipes.ts` to import
 * `@openelement/element/logger` without a row, and CI's
 * `Element browser gate (chromium)` job failed with
 * `Failed to resolve import "@openelement/element/logger"`.
 *
 * This suite is the consumer-form guard the review asked for. It is
 * fail-closed in both directions:
 *
 * 1. COVERAGE. Every `@openelement/element/<sub>` specifier imported anywhere
 *    under the two consumer directories the browser project compiles
 *    (`packages/ui/src/**` and `packages/element/__wtr__/**`, whose tracked
 *    tests/fixtures plus the generated modules are what the suite loads) must
 *    have an EXACT entry in the alias table. A new subpath import with no row
 *    fails here — in the `element` project, which every CI `test` run and
 *    `gate:source` already executes before the browser gate — instead of
 *    being rediscovered as a red browser job.
 * 2. MIRROR. Every element row in the table (bare specifier included) must
 *    still mirror `packages/element/package.json#exports`: the subpath must be
 *    exported, and the `${rootDir}…` replacement must resolve to exactly the
 *    exported source file. A renamed or retired export fails here instead of
 *    silently resolving a stale file (or not resolving at all).
 *
 * Vacuous passes are failures too. An empty alias-table parse, an empty file
 * scan, or an empty specifier census means the scan/parse shape drifted — not
 * that the table is correct — so each is asserted non-empty before the
 * coverage/mirror comparisons run.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

/** `<repo>/packages/element/__tests__/browser-alias-table-drift.test.ts` → `<repo>`. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const VITEST_CONFIG_PATH = join(REPO_ROOT, 'vitest.config.ts');
const ELEMENT_PACKAGE_JSON_PATH = join(REPO_ROOT, 'packages/element/package.json');

/**
 * The consumer directories whose imports the element-browser project resolves
 * through the table. Both are tracked, so the scan is never empty in a fresh
 * checkout; `__wtr__/generated/` is a gitignored build product
 * (`browser:compile`), scanned only when present.
 */
const CONSUMER_ROOTS = [
  join(REPO_ROOT, 'packages/ui/src'),
  join(REPO_ROOT, 'packages/element/__wtr__'),
];

/** Installed dependencies / build outputs inside a consumer root, never source. */
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', '.git']);

const SOURCE_FILE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

const BARE_ELEMENT_SPECIFIER = '@openelement/element';
const ELEMENT_SUBPATH_PREFIX = `${BARE_ELEMENT_SPECIFIER}/`;

/**
 * Import/export specifier positions that can carry an element subpath:
 * `… from '…'`, side-effect `import '…'`, and dynamic `import('…')`.
 */
const ELEMENT_IMPORT_PATTERN =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(@openelement\/element(?:\/[^'"]*)?)\1/g;

/** A literal `find: '…'` row of `vitest.config.ts` with its `${rootDir}…` replacement. */
interface AliasEntry {
  readonly find: string;
  readonly replacement: string;
}

function listSourceFiles(directory: string, out: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) listSourceFiles(path, out);
    } else if (SOURCE_FILE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      out.push(path);
    }
  }
  return out;
}

/** Absolute source files under the consumer roots, sorted for stable failure output. */
function listConsumerFiles(): string[] {
  const files: string[] = [];
  for (const root of CONSUMER_ROOTS) {
    expect(existsSync(root), `consumer scan root is missing: ${root}`).toBe(true);
    listSourceFiles(root, files);
  }
  return files.sort();
}

/** Every distinct `@openelement/element[/<sub>]` specifier imported under the roots. */
function extractElementSpecifiers(files: readonly string[]): string[] {
  const specifiers = new Set<string>();
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(ELEMENT_IMPORT_PATTERN)) {
      const specifier = match[2]?.replace(/[?#].*$/, '');
      if (specifier) specifiers.add(specifier);
    }
  }
  return [...specifiers].sort();
}

/**
 * The element rows of the `element-browser` project's alias table, parsed from
 * the config source (importing the config would construct the browser provider
 * and is not needed: the table is a literal it owns). Rows are `{ find, …
 * replacement }` object literals; the UI regex rows (`find: /^\.\/…/`) are not
 * element specifiers and do not match the pattern.
 */
function parseElementAliasEntries(configSource: string): AliasEntry[] {
  const findPattern = /find:\s*(['"])(@openelement\/element(?:\/[^'"]*)?)\1/g;
  const matches = [...configSource.matchAll(findPattern)];
  const entries: AliasEntry[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    if (!match) continue;
    const start = match.index ?? 0;
    const end =
      index + 1 < matches.length ? (matches[index + 1]?.index ?? start) : configSource.length;
    const replacement = configSource
      .slice(start, end)
      .match(/replacement:\s*`\$\{rootDir\}([^`]+)`/)?.[1]
      ?.trim();
    entries.push({ find: match[2] ?? '', replacement: replacement ?? '' });
  }
  return entries;
}

const CONFIG_SOURCE = readFileSync(VITEST_CONFIG_PATH, 'utf8');
const ALIAS_ENTRIES = parseElementAliasEntries(CONFIG_SOURCE);
const EXPORTS_MAP = (
  JSON.parse(readFileSync(ELEMENT_PACKAGE_JSON_PATH, 'utf8')) as {
    exports?: Record<string, string>;
  }
).exports;

test('the alias table covers every element subpath import in the browser consumer graph (P8)', () => {
  expect(
    ALIAS_ENTRIES.length,
    'fail-closed: no @openelement/element row parsed out of vitest.config.ts — the table shape drifted',
  ).toBeGreaterThan(0);

  const files = listConsumerFiles();
  expect(
    files.length,
    'fail-closed: the consumer scan found no source files — the roots drifted',
  ).toBeGreaterThan(0);

  const specifiers = extractElementSpecifiers(files);
  expect(
    specifiers.length,
    'fail-closed: no @openelement/element import found at all — the scan is proving nothing',
  ).toBeGreaterThan(0);

  const importedSubpaths = specifiers.filter((specifier) =>
    specifier.startsWith(ELEMENT_SUBPATH_PREFIX),
  );
  expect(
    importedSubpaths.length,
    'fail-closed: no @openelement/element/<sub> import found — the coverage half is vacuous',
  ).toBeGreaterThan(0);

  const aliased = new Set(ALIAS_ENTRIES.map((entry) => entry.find));
  expect(
    aliased.has(BARE_ELEMENT_SPECIFIER),
    'the bare @openelement/element alias row is missing from the element-browser table',
  ).toBe(true);

  // B-1 shape: `@openelement/element/logger` imported with no exact row.
  const missing = importedSubpaths.filter((specifier) => !aliased.has(specifier));
  expect(
    missing,
    `element-browser would fail to resolve these imports (no exact alias row): ${missing.join(', ')}`,
  ).toEqual([]);
});

test('every element alias row still mirrors packages/element/package.json#exports (P6)', () => {
  expect(
    ALIAS_ENTRIES.length,
    'fail-closed: no @openelement/element row parsed out of vitest.config.ts — the table shape drifted',
  ).toBeGreaterThan(0);

  const exportedKeys = EXPORTS_MAP ? Object.keys(EXPORTS_MAP) : [];
  expect(
    exportedKeys.length,
    'fail-closed: packages/element/package.json has no exports map — the mirror half is vacuous',
  ).toBeGreaterThan(0);

  const problems: string[] = [];
  for (const entry of ALIAS_ENTRIES) {
    const exportKey =
      entry.find === BARE_ELEMENT_SPECIFIER
        ? '.'
        : `.${entry.find.slice(BARE_ELEMENT_SPECIFIER.length)}`;
    const target = EXPORTS_MAP?.[exportKey];
    if (typeof target !== 'string') {
      problems.push(`${entry.find}: no "${exportKey}" export in packages/element/package.json`);
      continue;
    }
    const expectedReplacement = `packages/element/${target.replace(/^\.\//, '')}`;
    if (entry.replacement !== expectedReplacement) {
      problems.push(
        `${entry.find}: alias replacement is ${entry.replacement === '' ? '<not parsed>' : `\`\${rootDir}${entry.replacement}\``}, but the "${exportKey}" export resolves to \`\${rootDir}${expectedReplacement}\``,
      );
    }
    if (!existsSync(join(REPO_ROOT, expectedReplacement))) {
      problems.push(`${entry.find}: exported source file is missing: ${expectedReplacement}`);
    }
  }

  expect(problems).toEqual([]);
});
