/**
 * M08 S2 acceptance — independent source-map consumer for the authored Board.
 *
 * The S2 browser vertical (`generated-leaf.s2-ssr-claim.browser.test.ts`) proves
 * SSR → parse → claim → update → dispose. This Node consumer proves the module
 * map for the same authored Board without trusting the generator's placement
 * ledger: it finds the lowered text in the emitted SSR, claim and update
 * functions and decodes those generated positions through the pinned
 * `@jridgewell/trace-mapping@0.3.31`. Each decoded authored position must land
 * on the authored expression itself (`open.value`, `items.value.map`,
 * `item.id`, `item.label`, `count.value`).
 *
 * LOCAL Node evidence. It is not a filled TSX-18/TSX-30 cell and not an M08
 * exit.
 */

import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import { compileFunctionModule } from '../../src/internal/compiler/semantic-core/function-frontend.ts';
import { generateLeafModule } from '../../src/internal/compiler/semantic-ir/generated-leaf/generate.ts';

const FILE = '/proj/src/m08-s2-acceptance.tsx';

const CLASSIFIER = {
  classifySymbol: (specifier: string, importedName: string | null) => {
    if (specifier !== '@openelement/element') return undefined;
    if (importedName === 'signal' || importedName === 'computed') return 'factory' as const;
    return 'value' as const;
  },
  classifyValue: () => undefined,
  classifyCall: (specifier: string, importedName: string | null) => {
    if (specifier !== '@openelement/element') return undefined;
    if (importedName === 'signal') return { call: 'signal' as const };
    if (importedName === 'computed') return { call: 'computed' as const };
    return undefined;
  },
};

/** The same authored S2 Board as the acceptance vertical. */
const S2_BOARD = `import { signal } from '@openelement/element';
function Board(props) {
  const items = signal([{ id: 'a', label: 'A' }, { id: 'c', label: 'C' }]);
  const open = signal(true);
  const count = signal(0);
  return <section>
    {open.value ? <p class="on">open</p> : <em class="off">closed</em>}
    <ul>{items.value.map((item) => <li key={item.id}>{item.label}: {count.value}</li>)}</ul>
    <p id="draft" contenteditable="true">note</p>
  </section>;
}
`;

function compile() {
  const front = compileFunctionModule(S2_BOARD, FILE, { importClassifier: CLASSIFIER });
  expect(front.diagnostics, 'frontend admission').toEqual([]);
  const generated = generateLeafModule(front.module!, { authoredSource: S2_BOARD });
  expect(generated.diagnostics.map((item) => item.message)).toEqual([]);
  expect(generated.module).not.toBeNull();
  expect(generated.sourceMap).not.toBeNull();
  return { module: generated.module!, sourceMap: generated.sourceMap! };
}

function consumer(sourceMap: NonNullable<ReturnType<typeof compile>['sourceMap']>): TraceMap {
  return new TraceMap(sourceMap as unknown as ConstructorParameters<typeof TraceMap>[0]);
}

interface FunctionRange {
  readonly name: string;
  /** 0-based inclusive line indexes into the generated module. */
  readonly startLine: number;
  readonly endLine: number;
}

const FUNCTION_HEADER = /^\s*(?:export\s+)?function\s+([\w$]+)\s*\(/;

/** Remove quoted literals so braces inside strings cannot move a range end. */
function stripQuoted(line: string): string {
  return line
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

function functionRanges(module: string): FunctionRange[] {
  const lines = module.split('\n');
  const ranges: FunctionRange[] = [];
  for (let index = 0; index < lines.length; index++) {
    const match = FUNCTION_HEADER.exec(lines[index]!);
    if (match === null) continue;
    let depth = 0;
    let opened = false;
    for (let cursor = index; cursor < lines.length; cursor++) {
      for (const char of stripQuoted(lines[cursor]!)) {
        if (char === '{') {
          depth += 1;
          opened = true;
        } else if (char === '}') {
          depth -= 1;
        }
      }
      if (opened && depth === 0) {
        ranges.push({ name: match[1]!, startLine: index, endLine: cursor });
        break;
      }
    }
  }
  return ranges;
}

function positionAt(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  return {
    line: before.split('\n').length,
    column: offset - (before.lastIndexOf('\n') + 1),
  };
}

interface Target {
  readonly role: string;
  readonly pattern: RegExp;
  readonly authored: string;
}

const TARGETS: readonly Target[] = [
  { role: 'condition test', pattern: /open\s*\.\s*value/g, authored: 'open.value' },
  { role: 'list items', pattern: /items\s*\.\s*value/g, authored: 'items.value.map' },
  { role: 'list key', pattern: /item\s*\.\s*id/g, authored: 'item.id' },
  { role: 'entry slot 0', pattern: /item\s*\.\s*label/g, authored: 'item.label' },
  { role: 'entry slot 1', pattern: /count\s*\.\s*value/g, authored: 'count.value' },
];

interface DecodedTarget {
  readonly role: string;
  readonly line: number;
  readonly column: number;
}

function decodeTargets(
  map: TraceMap,
  lines: readonly string[],
  ranges: readonly FunctionRange[],
  rangeLabel: string,
): readonly DecodedTarget[] {
  const decoded: DecodedTarget[] = [];
  for (const target of TARGETS) {
    let found = 0;
    for (const range of ranges) {
      for (let index = range.startLine; index <= range.endLine; index++) {
        const line = lines[index]!;
        const pattern = new RegExp(target.pattern.source, 'g');
        let match = pattern.exec(line);
        while (match !== null) {
          const original = originalPositionFor(map, {
            line: index + 1,
            column: match.index,
          });
          expect(original.source, `${rangeLabel} ${target.role}`).toBe(FILE);
          expect(original.line, `${rangeLabel} ${target.role}`).not.toBeNull();
          expect(original.column, `${rangeLabel} ${target.role}`).not.toBeNull();
          const authoredAt = positionAt(S2_BOARD, S2_BOARD.indexOf(target.authored));
          expect(
            { line: original.line, column: original.column },
            `${rangeLabel} ${target.role} generated ${index + 1}:${match.index}`,
          ).toEqual(authoredAt);
          decoded.push({ role: target.role, line: original.line!, column: original.column! });
          found += 1;
          match = pattern.exec(line);
        }
      }
    }
    expect(found, `${rangeLabel} must carry ${target.role}`).toBeGreaterThanOrEqual(1);
  }
  return decoded;
}

describe('M08 S2 acceptance — independent source-map decode', () => {
  test('SSR, claim and update positions decode to the authored list/key/condition/slot expressions', () => {
    const generated = compile();
    const map = consumer(generated.sourceMap);
    const lines = generated.module.split('\n');
    const ranges = functionRanges(generated.module);
    const byName = new Map(ranges.map((range) => [range.name, range]));
    const ssr = byName.get('Board__ssr');
    const claim = byName.get('Board__claim');
    expect(ssr, 'Board__ssr range').toBeDefined();
    expect(claim, 'Board__claim range').toBeDefined();

    // Update code: the refresh and key functions nested in mount and claim.
    // Claim-insert (server-empty/client-more) refresh functions live inside an
    // *EntryCreate* builder and are creation work, not the update phase, so
    // they are excluded from this range set.
    const createBuilders = ranges.filter((range) => /EntryCreate|Create/.test(range.name));
    const update = ranges.filter(
      (range) =>
        /Refresh|refresh|eachKey/.test(range.name) &&
        !createBuilders.some(
          (builder) => range.startLine > builder.startLine && range.endLine <= builder.endLine,
        ),
    );
    expect(update.length, 'update refresh/key functions').toBeGreaterThanOrEqual(5);
    expect(update.some((range) => range.startLine > claim!.startLine)).toBe(true);
    expect(update.some((range) => range.startLine < claim!.startLine)).toBe(true);

    const ssrDecoded = decodeTargets(map, lines, [ssr!], 'SSR');
    const claimDecoded = decodeTargets(map, lines, [claim!], 'claim');
    const updateDecoded = decodeTargets(map, lines, update, 'update');
    console.log(
      `[M08-S2-map] decoded ssr=${ssrDecoded.length} claim=${claimDecoded.length} update=${updateDecoded.length} LOCAL`,
    );
  });

  test('the consumer is the pinned trace-mapping and the map carries the authored Board', () => {
    const require = createRequire(import.meta.url);
    const manifest = JSON.parse(
      readFileSync(require.resolve('@jridgewell/trace-mapping/package.json'), 'utf8'),
    ) as { version: string };
    expect(manifest.version).toBe('0.3.31');

    const generated = compile();
    const map = consumer(generated.sourceMap);
    expect(map.sources).toEqual([FILE]);
    expect(map.sourcesContent).toEqual([S2_BOARD]);
    // The map is deterministic across two compilations of the same input.
    expect(JSON.stringify(compile().sourceMap)).toBe(JSON.stringify(generated.sourceMap));
  });
});
