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
  const front = compileFunctionModule(source, FILE, {
    importClassifier: CLASSIFIER,
  });
  expect(front.diagnostics, 'frontend admission').toEqual([]);
  const generated = generateLeafModule(front.module!, {
    authoredSource: source,
  });
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
  return {
    line: before.split('\n').length,
    column: offset - (before.lastIndexOf('\n') + 1),
  };
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
    const front = compileFunctionModule(source, FILE, {
      importClassifier: CLASSIFIER,
    });
    expect(front.diagnostics, 'frontend admission').toEqual([]);
    const generated = generateLeafModule(front.module!, {
      authoredSource: source,
    });
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

  test('every placement points at the generated line that carries its lowered text', () => {
    // The decoding tests above are self-consistent by construction: they decode
    // at the coordinates the placement itself declares. This test anchors on the
    // emitted module instead — the line a placement names must be the line that
    // physically contains that expression. It is what catches a chunk offset
    // that counted array elements rather than generated lines: a multi-line
    // lowered expression occupies more generated lines than one element, and
    // before the physical-line accounting every later chunk (claim, then SSR)
    // drifted by the embedded-newline count.
    const source = `function Multi(props) {
  return <p>{props.label /* first
  second */ + props.suffix}</p>;
}
`;
    const front = compileFunctionModule(source, FILE, {
      importClassifier: CLASSIFIER,
    });
    expect(front.diagnostics, 'frontend admission').toEqual([]);
    const generated = generateLeafModule(front.module!, { authoredSource: source });
    expect(generated.diagnostics).toEqual([]);
    const records = new Map(
      front.module!.expressions.expressions.map((record) => [record.id, record]),
    );
    const moduleLines = generated.module!.split('\n');
    const map = consumer(generated.sourceMap!);
    expect(generated.placements.length).toBeGreaterThanOrEqual(3);
    let multiLinePlacements = 0;
    for (const placement of generated.placements) {
      const record = records.get(placement.exprId);
      if (record === undefined) continue;
      if (record.lowered.includes('\n')) multiLinePlacements += 1;
      const firstLoweredLine = record.lowered.split('\n')[0]!.trim();
      const generatedLine = moduleLines[placement.generatedLine - 1];
      expect(generatedLine, placement.exprId).toBeDefined();
      expect(generatedLine, placement.exprId).toContain(firstLoweredLine);
      const decoded = originalPositionFor(map, {
        line: placement.generatedLine,
        column: placement.generatedColumn,
      });
      expect(decoded.source, placement.exprId).toBe(FILE);
      expect(decoded.line, placement.exprId).toBe(placement.authoredLine);
      expect(decoded.column, placement.exprId).toBe(placement.authoredColumn);
    }
    // mount, claim and SSR all reference the same multi-line record.
    expect(multiLinePlacements).toBeGreaterThanOrEqual(3);
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
    const decoded = originalPositionFor(map, {
      line: elementLine.line,
      column: 0,
    });
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
    // M06b1a-2 supersession: the M05b "nested recipe" named boundary is
    // superseded for DIRECT component-local JSX initializers — a `const x =
    // <div/>` is now a reusable recipe and every `{x}` slot is an admitted
    // insertion site whose positions ARE in the module map (see the M06b1a-2
    // test below). This named boundary now covers only a JSX value lowered
    // inside an ARBITRARY expression: it keeps the M02 `__oe_recipe_ref`
    // placeholder, has no generated recipe definition and still fails closed
    // with no map. The anchors-not-ranges property for replacement remains
    // asserted at expression level by m03-sourcemap-parity.test.ts (A4b).
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

  test('M06b1a-2 insertion-site anchors and recipe-body expressions decode in the module map', () => {
    const source = `import { signal } from '@openelement/element';
function Chip(props) {
  const tone = signal('blue');
  const chip = <i title={tone.value}>{tone.value}</i>;
  return <div>{chip}<span>{chip}</span></div>;
}
`;
    const compiled = compile(source);
    expect(compiled.module).toContain('createRecipe({');
    expect(compiled.module).toContain('insertRecipe(');
    const lines = compiled.module.split('\n');
    // The recipe body is emitted inline in the component chunk (the per-chunk
    // line rebase is unchanged), so its expressions keep A2 segments.
    const recipeBodyLine = lines.findIndex((line) => line.includes('mount(__oe_recipeScope'));
    expect(recipeBodyLine).toBeGreaterThanOrEqual(0);
    const map = consumer(compiled.map);
    // Every insertion site carries a placement anchor at the authored `{chip}`
    // identifier: decode each generated line start to its authored slot.
    const authoredSlots = [...source.matchAll(/\{chip\}/g)].map((match) =>
      positionAt(source, (match.index ?? 0) + 1),
    );
    expect(authoredSlots).toHaveLength(2);
    const insertionLines = lines
      .map((line, index) => ({ line, index }))
      .filter((entry) => entry.line.includes('insertRecipe('));
    expect(insertionLines).toHaveLength(2);
    insertionLines.forEach((entry, site) => {
      const decoded = originalPositionFor(map, { line: entry.index + 1, column: 0 });
      expect(decoded.source).toBe(FILE);
      expect(decoded.line).toBe(authoredSlots[site]!.line);
      expect(decoded.column).toBe(authoredSlots[site]!.column);
    });
    // Both `tone.value` reads live inside the reusable value: every placement
    // is below the recipe mount header and decodes to its authored start.
    expect(compiled.placements.length).toBeGreaterThanOrEqual(2);
    for (const placement of compiled.placements) {
      expect(placement.generatedLine, placement.exprId).toBeGreaterThan(recipeBodyLine + 1);
      const record = compiled.records.get(placement.exprId)!;
      const decoded = originalPositionFor(map, {
        line: placement.generatedLine,
        column: placement.generatedColumn,
      });
      expect(decoded.line, placement.exprId).toBe(placement.authoredLine);
      expect(decoded.column, placement.exprId).toBe(placement.authoredColumn);
      for (const segment of record.segments) {
        const segDecoded = originalPositionFor(map, composedPosition(placement, segment));
        expect(segDecoded.line).toBe(segment.sourceLine);
        expect(segDecoded.column).toBe(segment.sourceColumn);
      }
    }
    expect(JSON.stringify(compile(source).map)).toBe(JSON.stringify(compiled.map));
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
    expect(compiled.module).toContain('emitComment(MARKERS.when)');
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
    expect(compiled.module).toContain('emitComment(MARKERS.each)');
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

  test('M06b1a-1 nested components: every emitted chunk decodes at its module line', () => {
    // Two component chunks: the child mount body and the parent prop getter both
    // carry placements. A stale per-component line offset would misdecode the
    // second chunk only, so both authored lines must be reachable.
    const source = `function Row(props) { return <li>{props.text}</li>; }
function C(props) { return <ul><Row text={props.label} /></ul>; }
`;
    const compiled = compile(source);
    expect(compiled.module).toContain('function Row__mount(__oe_scope, __oe_props, __oe_host) {');
    expect(compiled.module).toContain('get text() { return (props . label); }');
    const map = consumer(compiled.map);
    const authoredLines = new Set<number>();
    for (const placement of compiled.placements) {
      const decoded = originalPositionFor(map, {
        line: placement.generatedLine,
        column: placement.generatedColumn,
      });
      expect(decoded.line, placement.exprId).toBe(placement.authoredLine);
      expect(decoded.column, placement.exprId).toBe(placement.authoredColumn);
      authoredLines.add(placement.authoredLine);
    }
    // Placements exist for the child component body (line 1) and the parent prop
    // expression (line 2): both chunks are mapped at their real module lines.
    expect(authoredLines.has(1)).toBe(true);
    expect(authoredLines.has(2)).toBe(true);
    expect(JSON.stringify(compile(source).map)).toBe(JSON.stringify(compiled.map));
  });

  test('M06b2a children: recipe-body placements decode and the projection anchors at the slot', () => {
    const source = `import { signal } from '@openelement/element';
function Frame(props) { return <div>{props.children}</div>; }
function C(props) {
  const n = signal(1);
  return <Frame label={props.title}><b>{n.value}</b></Frame>;
}
`;
    const compiled = compile(source);
    // The projection goes through the M06b1a-2 insertion mechanism, against the
    // mount-level children recipe read.
    expect(compiled.module).toContain('insertRecipe(__oe_scope, __oe_childrenRecipe, ');
    const map = consumer(compiled.map);
    // Children-recipe-body placements stay inside C's component chunk: the
    // existing per-chunk rebase is the only shift, so every placement decodes.
    for (const placement of compiled.placements) {
      const decoded = originalPositionFor(map, {
        line: placement.generatedLine,
        column: placement.generatedColumn,
      });
      expect(decoded.line, placement.exprId).toBe(placement.authoredLine);
      expect(decoded.column, placement.exprId).toBe(placement.authoredColumn);
    }
    // The defining-scope read inside the children fragment has a placement at
    // its authored span (nothing is re-lowered or relocated).
    const valuePosition = positionAt(source, source.indexOf('n.value'));
    expect(
      compiled.placements.some(
        (placement) =>
          placement.authoredLine === valuePosition.line &&
          placement.authoredColumn === valuePosition.column,
      ),
    ).toBe(true);
    // The `{props.children}` projection site carries a structural anchor at the
    // authored slot: the generated insertRecipe line decodes to `props.children`,
    // not to the enclosing component or the Frame return.
    const projectionLine = compiled.module
      .split('\n')
      .findIndex((line) => line.includes('insertRecipe(__oe_scope, __oe_childrenRecipe, '));
    expect(projectionLine).toBeGreaterThanOrEqual(0);
    const projectionPosition = positionAt(source, source.indexOf('props.children'));
    const decodedProjection = originalPositionFor(map, {
      line: projectionLine + 1,
      column: 0,
    });
    expect(decodedProjection.line).toBe(projectionPosition.line);
    expect(decodedProjection.column).toBe(projectionPosition.column);
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
