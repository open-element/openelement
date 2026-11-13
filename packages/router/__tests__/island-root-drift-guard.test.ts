/**
 * Island sidecar `root` — two-parser DRIFT GUARD (P8 consumer form).
 *
 * Two implementations read one authored sidecar:
 *
 * 1. the router's static scanner (`island-scanner.ts` `readIslandConfig`),
 *    which is the authority for the sidecar's accepted shape, key set and
 *    error text (`ISLAND_METADATA_ERROR`);
 * 2. the compiler lane's `readIslandRoot` (`generated-element/site.ts`), which
 *    re-reads the same statement under D-root-source (2026-11-13) because the
 *    root fact must not ride the host site fact.
 *
 * The duplication is deliberate and recorded; this guard is its cost control.
 * It runs BOTH readers over ONE fixture corpus and asserts they agree for every
 * admissible case: the scanner's `'light' | 'shadow'` maps exactly onto the
 * compiler's `'light' | 'shadow-open'`, an undeclared root stays undeclared on
 * both sides, and a sidecar either reader rejects is rejected by both. A
 * partial agreement (one reads, the other refuses) is the drift this test
 * exists to catch; it is never waved through.
 *
 * The corpus is limited to the canonical `defineIslandConfig({...})` form on
 * purpose: a non-canonical callee is rejected by the scanner before any root
 * exists, so the host never admits such a file and the compiler lane never
 * sees it (see `locateDefineIslandConfigCall`).
 */

import { expect, test } from 'vitest';
import { readIslandConfig } from '../src/vite/internal/ssg/route-scanner.ts';
import { typescriptParser } from '../../compiler/src/internal/compiler/semantic-core/parse-module.ts';
import { readIslandRoot } from '../../compiler/src/internal/compiler/semantic-ir/generated-element/site.ts';

const FILE = '/proj/app/islands/profile-card.tsx';

/**
 * What one reader says about the sidecar's root:
 * - `read` with `undefined` → no root declared;
 * - `read` with a value → the declared root family;
 * - `rejected` → the reader refused the sidecar (reason kept for the log).
 */
type Outcome =
  | { readonly kind: 'read'; readonly root: string | undefined }
  | { readonly kind: 'rejected'; readonly reason: string };

function scannerOutcome(source: string): Outcome {
  try {
    const config = readIslandConfig(source);
    return { kind: 'read', root: config?.root };
  } catch (error) {
    return { kind: 'rejected', reason: (error as Error).message };
  }
}

function compilerOutcome(source: string): Outcome {
  const parsed = typescriptParser.parseModule(source, FILE);
  expect(parsed.syntaxDiagnostics, source).toEqual([]);
  const read = readIslandRoot(parsed.sourceFile);
  if (read.kind === 'refused') return { kind: 'rejected', reason: read.diagnostic.message };
  return { kind: 'read', root: read.kind === 'root' ? read.root : undefined };
}

/** The scanner's author-facing family, in the descriptor's root vocabulary. */
function descriptorRoot(family: string | undefined): string | undefined {
  if (family === undefined) return undefined;
  return family === 'light' ? 'light' : 'shadow-open';
}

function module(entries: string): string {
  return (
    "import { defineIslandConfig } from '@openelement/router';\n" +
    (entries === ''
      ? 'export const openElement = defineIslandConfig({});\n'
      : `export const openElement = defineIslandConfig({ ${entries} });\n`) +
    'function ProfileCard() {\n' +
    '  return <p id="profile-card">hello</p>;\n' +
    '}\n' +
    'export default ProfileCard;\n'
  );
}

/** The shared corpus: light, shadow, absent, invalid. */
const CORPUS: ReadonlyArray<{ readonly name: string; readonly source: string }> = [
  { name: 'light', source: module("ssr: false, hydrate: 'only', root: 'light'") },
  { name: 'shadow', source: module("hydrate: 'idle', root: 'shadow'") },
  { name: 'shadow via string-literal key', source: module("'root': 'shadow'") },
  {
    name: 'shadow with media delivery',
    source: module("hydrate: 'media', media: '(min-width: 48rem)', root: 'shadow'"),
  },
  { name: 'absent (sidecar without root)', source: module("ssr: false, hydrate: 'idle'") },
  { name: 'absent (empty sidecar)', source: module('') },
  { name: 'absent (no sidecar at all)', source: 'export default function ProfileCard() {}\n' },
  {
    name: 'invalid (dynamic value)',
    source: `const configuredRoot = 'light';\n${module('root: configuredRoot')}`,
  },
  { name: 'invalid (unknown literal)', source: module("root: 'shadow-closed'") },
  { name: 'invalid (duplicate key)', source: module("root: 'light', root: 'shadow'") },
  { name: 'invalid (shorthand)', source: `const root = 'light';\n${module('root')}` },
  { name: 'invalid (spread)', source: `const base = { root: 'shadow' };\n${module('...base')}` },
];

test('both readers agree on every corpus entry (the drift guard)', () => {
  const rows = CORPUS.map(({ name, source }) => ({
    name,
    scanner: scannerOutcome(source),
    compiler: compilerOutcome(source),
  }));
  const disagreements = rows
    .filter(({ scanner, compiler }) => {
      if (scanner.kind !== compiler.kind) return true;
      if (scanner.kind === 'rejected' || compiler.kind === 'rejected') return false;
      return descriptorRoot(scanner.root) !== compiler.root;
    })
    .map((row) => JSON.stringify(row));
  expect(disagreements, disagreements.join('\n')).toEqual([]);

  // The corpus must keep exercising all four classes, so a shrinking fixture
  // list cannot turn the guard into a vacuous pass.
  const readRoots = rows
    .filter((row) => row.scanner.kind === 'read')
    .map((row) => row.scanner.root);
  expect(readRoots).toContain('light');
  expect(readRoots).toContain('shadow');
  expect(readRoots).toContain(undefined);
  expect(rows.filter((row) => row.scanner.kind === 'rejected').length).toBeGreaterThanOrEqual(3);
});

test('the scanner keeps the authority: a root it rejects is refused, never read', () => {
  for (const { name, source } of CORPUS) {
    const scanner = scannerOutcome(source);
    if (scanner.kind !== 'rejected') continue;
    const compiler = compilerOutcome(source);
    expect(compiler.kind, `${name}: ${scanner.reason}`).toBe('rejected');
  }
});

test('the root vocabulary maps one way: shadow is the DSD default, closed is unspellable', () => {
  const shadow = compilerOutcome(module("root: 'shadow'"));
  expect(shadow).toEqual({ kind: 'read', root: 'shadow-open' });
  const light = compilerOutcome(module("root: 'light'"));
  expect(light).toEqual({ kind: 'read', root: 'light' });
  // No authored spelling reaches the closed root mode (D-closed).
  expect(compilerOutcome(module("root: 'shadow-closed'")).kind).toBe('rejected');
});
