/**
 * Island sidecar platform facts — two-parser DRIFT GUARD (P8 consumer form).
 *
 * Two implementations read one authored sidecar:
 *
 * 1. the router's static scanner (`island-scanner.ts` `readIslandConfig`),
 *    which is the authority for the sidecar's accepted shape, key set and
 *    error text (`ISLAND_METADATA_ERROR`);
 * 2. the compiler lane's `readIslandMetadata` (`generated-element/site.ts`),
 *    which re-reads the same statement under D-root-source (2026-11-13,
 *    `root`) and D-delegatesFocus (2026-11-14, `delegatesFocus`) because those
 *    facts must not ride the host site fact.
 *
 * The duplication is deliberate and recorded; this guard is its cost control.
 * It runs BOTH readers over ONE fixture corpus and asserts they agree for every
 * admissible case: the scanner's `'light' | 'shadow'` maps exactly onto the
 * compiler's `'light' | 'shadow-open'`, `delegatesFocus` agrees as a plain
 * boolean (absent on both sides means false), an undeclared fact stays
 * undeclared on both sides, and a sidecar either reader rejects is rejected by
 * both. A partial agreement (one reads, the other refuses) is the drift this
 * test exists to catch; it is never waved through.
 *
 * The corpus is limited to the canonical `defineIslandConfig({...})` form on
 * purpose: a non-canonical callee is rejected by the scanner before any fact
 * exists, so the host never admits such a file and the compiler lane never
 * sees it (see `locateDefineIslandConfigCall`).
 */

import { expect, test } from 'vitest';
import { readIslandConfig } from '../src/vite/internal/ssg/route-scanner.ts';
import { typescriptParser } from '../../compiler/src/internal/compiler/semantic-core/parse-module.ts';
import { readIslandMetadata } from '../../compiler/src/internal/compiler/semantic-ir/generated-element/site.ts';

const FILE = '/proj/app/islands/profile-card.tsx';

/** The descriptor-behavior facts both readers must agree on. */
interface Facts {
  readonly root: string | undefined;
  readonly delegatesFocus: boolean;
}

/**
 * What one reader says about the sidecar's platform facts:
 * - `read` with the normalized facts (an absent sidecar and a fact-free
 *   sidecar collapse to the same descriptor behavior);
 * - `rejected` → the reader refused the sidecar (reason kept for the log).
 */
type Outcome =
  | { readonly kind: 'read'; readonly facts: Facts }
  | { readonly kind: 'rejected'; readonly reason: string };

function scannerOutcome(source: string): Outcome {
  try {
    const config = readIslandConfig(source);
    return {
      kind: 'read',
      facts: {
        root: descriptorRoot(config?.root),
        delegatesFocus: config?.delegatesFocus === true,
      },
    };
  } catch (error) {
    return { kind: 'rejected', reason: (error as Error).message };
  }
}

function compilerOutcome(source: string): Outcome {
  const parsed = typescriptParser.parseModule(source, FILE);
  expect(parsed.syntaxDiagnostics, source).toEqual([]);
  const read = readIslandMetadata(parsed.sourceFile);
  if (read.kind === 'refused') return { kind: 'rejected', reason: read.diagnostic.message };
  if (read.kind === 'absent') {
    return { kind: 'read', facts: { root: undefined, delegatesFocus: false } };
  }
  return {
    kind: 'read',
    facts: { root: read.facts.root, delegatesFocus: read.facts.delegatesFocus },
  };
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

/** The shared corpus: root families, focus facts, absent and invalid. */
const CORPUS: ReadonlyArray<{ readonly name: string; readonly source: string }> = [
  { name: 'light', source: module("ssr: false, hydrate: 'only', root: 'light'") },
  { name: 'shadow', source: module("hydrate: 'idle', root: 'shadow'") },
  { name: 'shadow via string-literal key', source: module("'root': 'shadow'") },
  {
    name: 'shadow with media delivery',
    source: module("hydrate: 'media', media: '(min-width: 48rem)', root: 'shadow'"),
  },
  {
    name: 'shadow with delegatesFocus',
    source: module("root: 'shadow', delegatesFocus: true"),
  },
  {
    name: 'shadow with explicit false delegatesFocus',
    source: module("root: 'shadow', delegatesFocus: false"),
  },
  {
    name: 'shadow with string-literal delegatesFocus key',
    source: module('root: \'shadow\', "delegatesFocus": true'),
  },
  {
    name: 'light with false delegatesFocus',
    source: module("root: 'light', delegatesFocus: false"),
  },
  {
    name: 'delegatesFocus false without a root',
    source: module('delegatesFocus: false'),
  },
  { name: 'absent (sidecar without root)', source: module("ssr: false, hydrate: 'idle'") },
  { name: 'absent (empty sidecar)', source: module('') },
  { name: 'absent (no sidecar at all)', source: 'export default function ProfileCard() {}\n' },
  {
    name: 'invalid (dynamic root)',
    source: `const configuredRoot = 'light';\n${module('root: configuredRoot')}`,
  },
  { name: 'invalid (unknown root literal)', source: module("root: 'shadow-closed'") },
  { name: 'invalid (duplicate root)', source: module("root: 'light', root: 'shadow'") },
  { name: 'invalid (root shorthand)', source: `const root = 'light';\n${module('root')}` },
  { name: 'invalid (spread)', source: `const base = { root: 'shadow' };\n${module('...base')}` },
  {
    name: 'invalid (delegatesFocus without shadow)',
    source: module('delegatesFocus: true'),
  },
  {
    name: 'invalid (delegatesFocus with light root)',
    source: module("root: 'light', delegatesFocus: true"),
  },
  {
    name: 'invalid (dynamic delegatesFocus)',
    source: `const focus = true;\n${module("root: 'shadow', delegatesFocus: focus")}`,
  },
  {
    name: 'invalid (non-boolean delegatesFocus literal)',
    source: module("root: 'shadow', delegatesFocus: 1"),
  },
  {
    name: 'invalid (duplicate delegatesFocus)',
    source: module("root: 'shadow', delegatesFocus: true, delegatesFocus: false"),
  },
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
      return (
        scanner.facts.root !== compiler.facts.root ||
        scanner.facts.delegatesFocus !== compiler.facts.delegatesFocus
      );
    })
    .map((row) => JSON.stringify(row));
  expect(disagreements, disagreements.join('\n')).toEqual([]);

  // The corpus must keep exercising every class, so a shrinking fixture list
  // cannot turn the guard into a vacuous pass.
  const readRows = rows.filter((row) => row.scanner.kind === 'read');
  const readFacts = readRows.map((row) => row.scanner);
  const roots = readFacts.flatMap((row) => (row.kind === 'read' ? [row.facts.root] : []));
  const focus = readFacts.flatMap((row) => (row.kind === 'read' ? [row.facts.delegatesFocus] : []));
  expect(roots).toContain('light');
  expect(roots).toContain('shadow-open');
  expect(roots).toContain(undefined);
  expect(focus).toContain(true);
  expect(focus).toContain(false);
  expect(rows.filter((row) => row.scanner.kind === 'rejected').length).toBeGreaterThanOrEqual(6);
});

test('the scanner keeps the authority: a sidecar it rejects is refused, never read', () => {
  for (const { name, source } of CORPUS) {
    const scanner = scannerOutcome(source);
    if (scanner.kind !== 'rejected') continue;
    const compiler = compilerOutcome(source);
    expect(compiler.kind, `${name}: ${scanner.reason}`).toBe('rejected');
  }
});

test('the root vocabulary maps one way: shadow is the DSD default, closed is unspellable', () => {
  expect(compilerOutcome(module("root: 'shadow'"))).toEqual({
    kind: 'read',
    facts: { root: 'shadow-open', delegatesFocus: false },
  });
  expect(compilerOutcome(module("root: 'light'"))).toEqual({
    kind: 'read',
    facts: { root: 'light', delegatesFocus: false },
  });
  // No authored spelling reaches the closed root mode (D-closed).
  expect(compilerOutcome(module("root: 'shadow-closed'")).kind).toBe('rejected');
});

test('the delegatesFocus vocabulary is a boolean and needs a shadow root', () => {
  expect(compilerOutcome(module("root: 'shadow', delegatesFocus: true"))).toEqual({
    kind: 'read',
    facts: { root: 'shadow-open', delegatesFocus: true },
  });
  const withoutShadow = compilerOutcome(module('delegatesFocus: true'));
  expect(withoutShadow.kind).toBe('rejected');
  const light = compilerOutcome(module("root: 'light', delegatesFocus: true"));
  expect(light.kind).toBe('rejected');
});
