/**
 * Framework-root declaration-surface boundary (#1607 follow-up): the packed
 * declaration walker (tools/release/consumer-packaged-shared.ts
 * `walkPackedDeclarations`, run by the packed-consumer gate's boundary cell)
 * refuses any declaration edge naming Vite from the four Framework Mode
 * entries, and a `skipLibCheck: false` consumer cannot typecheck the root
 * without Vite installed.
 *
 * The runtime module-graph walk (lit-graph-boundary.test.ts) deliberately
 * drops type-only edges: an `import type`, or an inline `import('./…')` in a
 * type position, is erased at runtime but survives into the emitted `.d.ts`,
 * so a source module that only TYPES against the Vite build layer still leaks
 * Vite into every consumer's typecheck. This walk keeps those edges, and its
 * leak rule is the packed walker's own pattern — one authority, no copy.
 */

import { readFileSync, statSync } from 'node:fs';
import { expect, test } from 'vitest';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import { DECLARATION_LEAK_PATTERN } from '../../../tools/release/consumer-packaged-shared.ts';

const REPO_ROOT = new URL('../../../', import.meta.url).pathname;
const ROUTER_SRC = resolve(REPO_ROOT, 'packages/router/src');

/** The packed walker's entry set: the Framework Mode surface consumers get. */
const ENTRY_FILES = ['index.ts', 'lit.ts', 'lit-ssr.ts', 'document.ts'];

/**
 * Resolve one relative source specifier to an on-disk module. Sources spell
 * their own extension (`./config.ts`, allowImportingTsExtensions); a `.js`
 * spelling (what the emitted declarations carry) maps back to the source.
 */
function resolveRelative(spec: string, fromFile: string): string | null {
  const base = resolve(dirname(fromFile), spec);
  for (const candidate of [base, base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx')]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // not a file; try the next spelling
    }
  }
  return null;
}

interface SourceGraph {
  seen: Set<string>;
  edges: string[];
}

/**
 * Walk the type-bearing source graph from the entries. Every specifier is
 * scanned for the leak (the same `preProcessFile` read the packed walker's
 * leak pass uses, so inline `import('./…')` types are seen); only relative
 * specifiers join the walk — package specifiers are external to this claim.
 */
function walkSourceGraph(entries: readonly string[]): SourceGraph {
  const seen = new Set<string>();
  const edges: string[] = [];
  const stack = [...entries];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    for (const { fileName } of ts.preProcessFile(text).importedFiles) {
      edges.push(`${file.slice(REPO_ROOT.length)} -> ${fileName}`);
      if (!fileName.startsWith('.')) continue;
      const target = resolveRelative(fileName, file);
      if (target && !seen.has(target)) stack.push(target);
    }
  }
  return { seen, edges };
}

test('Framework-root type graph names neither Vite nor the vite build layer', () => {
  const graph = walkSourceGraph(ENTRY_FILES.map((entry) => resolve(ROUTER_SRC, entry)));
  const leaks = graph.edges.filter((edge) => DECLARATION_LEAK_PATTERN.test(edge.split(' -> ')[1]));
  expect(
    leaks,
    `Framework-root declaration edges naming Vite (a packed consumer typechecking the root ` +
      `without Vite installed fails on these):\n  ${leaks.join('\n  ')}`,
  ).toEqual([]);
  // The walk must be able to find the config surface at all, or the
  // assertion above is vacuous.
  expect(graph.seen.has(resolve(ROUTER_SRC, 'config.ts')), 'config.ts missing').toBeTruthy();
  expect(graph.seen.has(resolve(ROUTER_SRC, 'authoring.ts')), 'authoring.ts missing').toBeTruthy();
});
