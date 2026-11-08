/**
 * M05b — end-to-end generated-module source map consumer contract.
 *
 * The M05a generator records every lowered-expression placement and assembles a
 * Source Map v3 document for the emitted module (`SourceMapSegmentBuilder` over
 * the A2 `EmissionSegment` convention + authored anchors from the M03 model).
 * This suite decodes that map through `@jridgewell/trace-mapping` — the
 * repository's established consumer — and pins the properties the end-to-end
 * map must have: single-line placement, multi-line lowering, erasure shrink,
 * static scaffolding having no bogus mappings, structural anchors, and
 * determinism.
 *
 * Boundary: JSX→recipe-ref replacement positions are NOT produced by the leaf
 * generator (nested recipes/insertion sites are M06/M07 shapes and remain
 * refused by M05a's fail-closed boundary). The anchors-not-ranges behaviour for
 * recipe replacement is already asserted at expression level by the A4b suite
 * (`m03-sourcemap-parity.test.ts`); this file records that the module map cannot
 * contain those positions until the generator admits the shape.
 */

import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { eachMapping, originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import ts from 'typescript';
import { compileFunctionModule } from '../../src/internal/compiler/semantic-core/function-frontend.ts';
import {
  generateLeafModule,
  type ExpressionPlacement,
} from '../../src/internal/compiler/semantic-ir/generated-leaf/generate.ts';
import type { LoweredExpressionRecord } from '../../src/internal/compiler/semantic-core/expression-registry.ts';
import type { CompiledElementSourceMap } from '../../src/internal/compiler/semantic-core/source-map.ts';

const FILE = '/proj/src/generated-leaf-map.tsx';

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

interface Compiled {
  readonly source: string;
  readonly module: string;
  readonly map: CompiledElementSourceMap;
  readonly placements: readonly ExpressionPlacement[];
  readonly records: ReadonlyMap<string, LoweredExpressionRecord>;
}

function compile(source: string): Compiled {
  const front = compileFunctionModule(source, FILE, { importClassifier: CLASSIFIER });
  expect(front.diagnostics, 'frontend admission').toEqual([]);
  const generated = generateLeafModule(front.module!, { authoredSource: source });
  expect(generated.diagnostics).toEqual([]);
  expect(generated.module).not.toBeNull();
  expect(generated.sourceMap).not.toBeNull();
  return {
    source,
    module: generated.module!,
    map: generated.sourceMap!,
    placements: generated.placements,
    records: new Map(front.module!.expressions.expressions.map((record) => [record.id, record])),
  };
}

function consumer(map: CompiledElementSourceMap): TraceMap {
  return new TraceMap(map as unknown as ConstructorParameters<typeof TraceMap>[0]);
}

function positionAt(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  return { line: before.split('\n').length, column: offset - (before.lastIndexOf('\n') + 1) };
}

/** Rebase one A2 expression segment into module coordinates for a placement. */
function composedPosition(
  placement: ExpressionPlacement,
  segment: LoweredExpressionRecord['segments'][number],
): { line: number; column: number } {
  return {
    line: placement.generatedLine + segment.generatedLine - 1,
    column:
      segment.generatedLine === 1
        ? placement.generatedColumn + segment.generatedColumn
        : segment.generatedColumn,
  };
}

function authoredOffset(sourceFile: ts.SourceFile, line: number, column: number): number {
  return sourceFile.getPositionOfLineAndCharacter(line - 1, column);
}

const COUNTER = `import { signal, computed } from '@openelement/element';
function Counter(props) {
  const count = signal(0);
  const doubled = computed(() => count.value * 2);
  return <section data-count={count.value}><p title={props.label}>{props.label}: {count.value} / {doubled.value}</p></section>;
}
`;

describe('M05b — end-to-end generated-module source map', () => {
  test('map structure: Source Map v3, one authored source with content, pinned consumer', () => {
    const compiled = compile(COUNTER);
    expect(compiled.map.version).toBe(3);
    expect(compiled.map.file).toBe(FILE);
    expect(compiled.map.sources).toEqual([FILE]);
    expect(compiled.map.sourcesContent).toEqual([COUNTER]);
    expect(compiled.map.mappings.length).toBeGreaterThan(0);
    const map = consumer(compiled.map);
    expect(map.sources).toEqual([FILE]);
    expect(map.sourcesContent).toEqual([COUNTER]);
  });

  test('every lowered expression placement decodes to its authored expression start', () => {
    const compiled = compile(COUNTER);
    const map = consumer(compiled.map);
    const sourceFile = ts.createSourceFile(
      FILE,
      compiled.source,
      ts.ScriptTarget.ES2022,
      true,
      ts.ScriptKind.TSX,
    );
    expect(compiled.placements.length).toBeGreaterThanOrEqual(4);
    for (const placement of compiled.placements) {
      const decoded = originalPositionFor(map, {
        line: placement.generatedLine,
        column: placement.generatedColumn,
      });
      expect(decoded.source, placement.exprId).toBe(FILE);
      expect(decoded.line, placement.exprId).toBe(placement.authoredLine);
      expect(decoded.column, placement.exprId).toBe(placement.authoredColumn);
      // The authored column points at real authored code, never into removed text.
      const offset = authoredOffset(sourceFile, placement.authoredLine, placement.authoredColumn);
      expect(compiled.source[offset]).not.toBe(undefined);
    }
  });

  test('A2 expression segments are composed into the module map at their exact positions', () => {
    const compiled = compile(COUNTER);
    const map = consumer(compiled.map);
    for (const placement of compiled.placements) {
      const record = compiled.records.get(placement.exprId)!;
      for (const segment of record.segments) {
        const expected = composedPosition(placement, segment);
        const decoded = originalPositionFor(map, expected);
        expect(decoded.line, `${placement.exprId}@${expected.line}:${expected.column}`).toBe(
          segment.sourceLine,
        );
        expect(decoded.column, `${placement.exprId}@${expected.line}:${expected.column}`).toBe(
          segment.sourceColumn,
        );
      }
    }
  });

  test('multi-line lowered expressions keep later generated lines on their own coordinates', () => {
    const source = `function Multi(props) {
  return <p>{props.label /* first
  second */ + props.suffix}</p>;
}
`;
    const front = compileFunctionModule(source, FILE, { importClassifier: CLASSIFIER });
    expect(front.diagnostics, 'frontend admission').toEqual([]);
    const generated = generateLeafModule(front.module!, { authoredSource: source });
    expect(generated.diagnostics).toEqual([]);
    expect(generated.module).not.toBeNull();
    const records = new Map(
      front.module!.expressions.expressions.map((record) => [record.id, record]),
    );
    const map = consumer(generated.sourceMap!);
    let checkedMultiLine = false;
    for (const placement of generated.placements) {
      const record = records.get(placement.exprId);
      if (record === undefined) continue;
      for (const segment of record.segments) {
        if (segment.generatedLine === 1) continue;
        checkedMultiLine = true;
        const decoded = originalPositionFor(map, composedPosition(placement, segment));
        expect(decoded.line).toBe(segment.sourceLine);
        expect(decoded.column).toBe(segment.sourceColumn);
      }
    }
    expect(checkedMultiLine, 'fixture must produce a multi-line lowered expression').toBe(true);
    // The lowered text itself really carried a newline into the module.
    const multiLineRecord = [...records.values()].find((record) => record.lowered.includes('\n'));
    expect(multiLineRecord).toBeDefined();
  });

  test('erasure-shrunk lowered text maps to the surviving authored expression only', () => {
    const source = 'function Shrunk(props) { return <p>{props.value as number}</p>; }\n';
    const compiled = compile(source);
    const map = consumer(compiled.map);
    expect(compiled.module).not.toContain('as number');
    expect(compiled.module).toContain('props . value');
    const placement = compiled.placements[0]!;
    const record = compiled.records.get(placement.exprId)!;
    // The A2 record's authored span is the surviving inner expression, not the
    // erased wrapper: the module map must not point at the removed `as number`.
    const decoded = originalPositionFor(map, {
      line: placement.generatedLine,
      column: placement.generatedColumn,
    });
    expect(decoded.line).toBe(record.authoredSpan.line);
    expect(decoded.column).toBe(record.authoredSpan.column - 1);
    const removedStart = source.indexOf('as number');
    const removedEnd = removedStart + 'as number'.length;
    const sourceFile = ts.createSourceFile(
      FILE,
      source,
      ts.ScriptTarget.ES2022,
      true,
      ts.ScriptKind.TSX,
    );
    eachMapping(map, (mapping) => {
      if (mapping.originalLine === null || mapping.originalColumn === null) return;
      const offset = authoredOffset(sourceFile, mapping.originalLine, mapping.originalColumn);
      expect(offset >= removedStart && offset < removedEnd, 'erased range must not be mapped').toBe(
        false,
      );
    });
  });

  test('structural anchors map generated DOM construction to authored nodes', () => {
    const compiled = compile(COUNTER);
    const source = compiled.source;
    const elementLine = positionAt(
      compiled.module,
      compiled.module.indexOf('document.createElement("section")'),
    );
    const map = consumer(compiled.map);
    const elementAuthored = source.indexOf('<section');
    const elementAuthoredPosition = positionAt(source, elementAuthored);
    const decoded = originalPositionFor(map, { line: elementLine.line, column: 0 });
    expect(decoded.line).toBe(elementAuthoredPosition.line);
    expect(decoded.column).toBe(elementAuthoredPosition.column);

    const text = compile('function T(props) { return <p>hello</p>; }\n');
    const textLine = positionAt(
      text.module,
      text.module.indexOf('document.createTextNode("hello")'),
    );
    const textAuthored = positionAt(text.source, text.source.indexOf('hello'));
    const decodedText = originalPositionFor(consumer(text.map), {
      line: textLine.line,
      column: 0,
    });
    expect(decodedText.line).toBe(textAuthored.line);
    expect(decodedText.column).toBe(textAuthored.column);
  });

  test('static scaffolding lines carry no bogus mappings', () => {
    const compiled = compile(COUNTER);
    const map = consumer(compiled.map);
    const lines = compiled.module.split('\n');
    const scaffolding = [
      'return createRecipe({',
      '});',
      'mount(__oe_scope) {',
      'const __oe_nodes = [];',
      'export function createCounterRecipe',
    ];
    const mappedLines = new Set<number>();
    eachMapping(map, (mapping) => {
      if (mapping.originalLine !== null) mappedLines.add(mapping.generatedLine);
    });
    for (const marker of scaffolding) {
      const lineIndex = lines.findIndex((line) => line.includes(marker));
      expect(lineIndex, marker).toBeGreaterThanOrEqual(0);
      expect(mappedLines.has(lineIndex + 1), `${marker} must not be mapped`).toBe(false);
    }
    // Every mapping resolves into the authored source and inside a real line.
    eachMapping(map, (mapping) => {
      if (mapping.originalLine === null || mapping.originalColumn === null) return;
      expect(mapping.source).toBe(FILE);
      const authoredLine = compiled.source.split('\n')[mapping.originalLine - 1];
      expect(authoredLine).not.toBe(undefined);
      expect(mapping.originalColumn).toBeLessThanOrEqual(authoredLine!.length);
    });
  });

  test('the map and placement ledger are deterministic across two runs', () => {
    const first = compile(COUNTER);
    const second = compile(COUNTER);
    expect(first.module).toBe(second.module);
    expect(JSON.stringify(first.map)).toBe(JSON.stringify(second.map));
    expect(first.placements).toEqual(second.placements);
  });

  test('recipe-ref replacement positions are not emitted by the leaf generator (named boundary)', () => {
    // Nested recipes/insertion sites remain a fail-closed M05a shape (M06/M07
    // own them), so the module map cannot contain their positions yet. The
    // anchors-not-ranges property for replacement is asserted at expression
    // level by m03-sourcemap-parity.test.ts (A4b). No silent drop: the
    // generator refuses and produces no map.
    const front = compileFunctionModule(
      'function C(props) { return <main title={props.ok ? <b>a</b> : <i>b</i>}></main>; }\n',
      FILE,
      { importClassifier: CLASSIFIER },
    );
    expect(front.diagnostics).toEqual([]);
    const generated = generateLeafModule(front.module!, { authoredSource: '' });
    expect(generated.module).toBeNull();
    expect(generated.sourceMap).toBeNull();
    expect(generated.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'OEIR_LEAF_UNSUPPORTED_RECIPE',
    );
  });

  test('M06 condition shapes are covered: placements decode and the map is deterministic', () => {
    const source =
      'function C(props) { return <section>{props.ok ? <p>on</p> : <em>off</em>}</section>; }\n';
    const compiled = compile(source);
    expect(compiled.placements.length).toBeGreaterThanOrEqual(1);
    const map = consumer(compiled.map);
    for (const placement of compiled.placements) {
      const decoded = originalPositionFor(map, {
        line: placement.generatedLine,
        column: placement.generatedColumn,
      });
      expect(decoded.line).toBe(placement.authoredLine);
      expect(decoded.column).toBe(placement.authoredColumn);
    }
    expect(compiled.module).toContain('document.createComment("oe:when")');
    // Structural anchors exist for the emitted branch builders.
    let mappedLines = 0;
    eachMapping(map, (mapping) => {
      if (mapping.originalLine !== null) mappedLines += 1;
    });
    expect(mappedLines).toBeGreaterThan(compiled.placements.length);
    expect(JSON.stringify(compile(source).map)).toBe(JSON.stringify(compiled.map));
  });

  test('M06 list shapes are covered: items/key/template placements decode to authored spans', () => {
    const source = `import { signal } from '@openelement/element';
function L(props) {
  const items = signal([]);
  return <ul>{items.value.map((item) => <li key={item.id}>{item.label}</li>)}</ul>;
}
`;
    const compiled = compile(source);
    expect(compiled.module).toContain('document.createComment("oe:each")');
    expect(compiled.placements.length).toBeGreaterThanOrEqual(3);
    const map = consumer(compiled.map);
    for (const placement of compiled.placements) {
      const record = compiled.records.get(placement.exprId);
      if (record === undefined) continue;
      for (const segment of record.segments) {
        const decoded = originalPositionFor(map, composedPosition(placement, segment));
        expect(decoded.line).toBe(segment.sourceLine);
        expect(decoded.column).toBe(segment.sourceColumn);
      }
    }
    expect(JSON.stringify(compile(source).map)).toBe(JSON.stringify(compiled.map));
  });

  test('the consumer package is the pinned repository version', () => {
    const require = createRequire(import.meta.url);
    const manifest = JSON.parse(
      readFileSync(require.resolve('@jridgewell/trace-mapping/package.json'), 'utf8'),
    ) as { version: string };
    expect(manifest.version).toBe('0.3.31');
  });
});
