/**
 * @openelement/element — real Source Map v3 emission for compiled
 * elements (#1210, A10.2).
 *
 * These tests consume the compiler's source map through a STANDARD source-map
 * consumer (@jridgewell/trace-mapping, already in the dependency tree) instead
 * of asserting snapshot equality of the mappings string. Every assertion
 * resolves a position in the generated module back to an independently
 * computed file/line/column in the authored TSX source.
 */

import { assert, assertEquals, assertNotEquals } from '@std/assert';
import { eachMapping, originalPositionFor, TraceMap } from 'npm:@jridgewell/trace-mapping@0.3.31';
import {
  CompiledElementError,
  compileElementProgram,
} from '../src/internal/compiler/semantic-core/compile.ts';
import { compileElementModule } from '../src/internal/compiler/plugin.ts';

const FILE = '/project/app/components/map-fixture.tsx';

/**
 * Fixture grammar (one construct per line where possible so positions are
 * independently computable):
 *   - decorator, verbatim import, island-config passthrough
 *   - plain/computed/multiline-initializer/boolean/array properties
 *   - two methods sharing an identical `this.count++;` line (one method carries
 *     the same line twice)
 *   - attr sink, JSX text part, prop sink, bool sink, method handler
 *   - two arrow handlers with identical `this.count++;` bodies (the MANDATORY
 *     duplicate-location vector)
 *   - a conditional (when) region and a keyed each region at nested tree paths
 */
const SOURCE = `import { computed, element, OpenElement, property } from '@openelement/element';
import { defineIslandConfig as island } from '@openelement/router';
export const openElement = island({ hydrate: 'load', ssr: true, dsd: false });

@element('oe-map-fixture')
export class MapFixture extends OpenElement {
  @property({ reflect: true }) count = 0;
  @property({ reflect: false }) label = 'ready';
  @property({ reflect: false, attribute: false }) doubled = computed(() => this.count * 2);
  @property({ reflect: false }) config = {
    step: 1,
    parity: 'even',
  };
  @property({ reflect: false }) busy = false;
  @property({ reflect: false }) items: Array<{ id: string; text: string }> = [];

  bump(): void {
    this.count++;
  }
  bumpTwice(): void {
    this.count++;
    this.count++;
  }

  render() {
    return (
      <div class='fixture' title={this.label}>
        <h1>Count: {this.count}</h1>
        <input value={this.label} hidden={this.busy} />
        <button type='button' onClick={() => this.count++}>inc</button>
        <button type='button' onClick={() => this.count++}>inc again</button>
        <button type='button' onClick={this.bump}>method</button>
        {this.count > 0 ? <p class='parity'>positive</p> : <p class='parity'>zero</p>}
        <ul>{this.items.map((item) => <li key={item.id}>{item.text}</li>)}</ul>
      </div>
    );
  }
}
`;

/** 1-based line / 0-based column of the nth (1-based) occurrence of needle. */
function positionOf(
  haystack: string,
  needle: string,
  occurrence = 1,
): { line: number; column: number } {
  let from = 0;
  let offset = -1;
  for (let index = 0; index < occurrence; index++) {
    offset = haystack.indexOf(needle, from);
    assert(offset >= 0, `needle occurrence ${occurrence} not found: ${needle}`);
    from = offset + needle.length;
  }
  const before = haystack.slice(0, offset);
  return {
    line: before.split('\n').length,
    column: offset - (before.lastIndexOf('\n') + 1),
  };
}

function decodeInlineMap(code: string): Record<string, unknown> {
  const marker = '//# sourceMappingURL=data:application/json;base64,';
  const line = code.split('\n').find((candidate) => candidate.startsWith(marker));
  assert(line, 'generated code must embed an inline base64 source map');
  return JSON.parse(
    new TextDecoder().decode(
      Uint8Array.from(atob(line.slice(marker.length)), (c) => c.charCodeAt(0)),
    ),
  );
}

function traceOf(map: unknown): TraceMap {
  return new TraceMap(map as ConstructorParameters<typeof TraceMap>[0]);
}

/** Resolve the nth occurrence of needle in the generated code to the source. */
function resolve(
  trace: TraceMap,
  code: string,
  needle: string,
  occurrence = 1,
  columnNeedle?: string,
) {
  const position = positionOf(code, needle, occurrence);
  const lineText = code.split('\n')[position.line - 1];
  // Segments sit at the first mapped token of a line: query at the column of
  // columnNeedle when given, otherwise at the needle's first non-space char.
  const column = columnNeedle !== undefined
    ? lineText.indexOf(columnNeedle)
    : position.column + (needle.length - needle.trimStart().length);
  return originalPositionFor(trace, { line: position.line, column });
}

/** Independently computed authored-source position of a needle. */
function expectSource(needle: string, occurrence = 1, columnNeedle?: string) {
  const position = positionOf(SOURCE, needle, occurrence);
  return {
    source: FILE,
    line: position.line,
    column: columnNeedle === undefined
      ? position.column
      : SOURCE.split('\n')[position.line - 1].indexOf(columnNeedle),
  };
}

function assertResolves(
  trace: TraceMap,
  code: string,
  needle: string,
  occurrence: number,
  expected: { source: string; line: number; column: number },
  columnNeedle?: string,
) {
  const resolved = resolve(trace, code, needle, occurrence, columnNeedle);
  assertEquals(
    { source: resolved.source, line: resolved.line, column: resolved.column },
    expected,
    `generated "${needle}" (occurrence ${occurrence}) must resolve to ${expected.source}:${expected.line}:${expected.column}`,
  );
}

Deno.test('A10.2 compiler emits a REAL Source Map v3 (VLQ line+column segments)', () => {
  const { code, map, program } = compileElementProgram(SOURCE, FILE);

  // The old substitute (mappings: '') is gone; a standard consumer decodes
  // real segments from both the returned map and the inline artifact map.
  assertEquals(typeof map.mappings, 'string');
  assertNotEquals(map.mappings, '', 'mappings must carry real VLQ segments');
  assertEquals(map.version, 3);
  assertEquals(map.sources, [FILE]);
  assertEquals(map.sourcesContent, [SOURCE]);
  assertEquals(decodeInlineMap(code), map as unknown as Record<string, unknown>);

  // x_openElement survives only as SUPPLEMENTARY metadata next to real
  // segments, deep-equal to the Part Program's provenance records (#1209).
  assertEquals(map.x_openElement, program.sourceMap);

  const trace = traceOf(map);
  const decoded: Array<unknown> = [];
  eachMapping(trace, (mapping) => decoded.push(mapping));
  assert(decoded.length >= 30, `expected a dense segment table, decoded ${decoded.length}`);
});

Deno.test('A10.2 standard consumer resolves every program source record to its authored span', () => {
  const { code, map, program } = compileElementProgram(SOURCE, FILE);
  const trace = traceOf(map);

  // Locate each record's serialized entry inside the embedded program JSON
  // (records serialize in order under the "records" key) and resolve that
  // generated position through the generic consumer. This sweeps decorators'
  // program payload, properties, JSX elements, text parts, attribute sinks,
  // boolean/property sinks, handlers, conditional and keyed regions at nested
  // tree paths — everything the compiler records provenance for.
  let cursor = code.indexOf('"records": [');
  assert(cursor >= 0, 'generated code must embed the program source records');
  for (const record of program.sourceMap.records) {
    const idNeedle = `"id": ${JSON.stringify(record.id)}`;
    const offset = code.indexOf(idNeedle, cursor);
    assert(offset >= 0, `generated program JSON must carry record ${record.id}`);
    cursor = offset + idNeedle.length;
    const before = code.slice(0, offset);
    const line = before.split('\n').length;
    const column = offset - (before.lastIndexOf('\n') + 1);
    const resolved = originalPositionFor(trace, { line, column });
    assertEquals(
      { source: resolved.source, line: resolved.line, column: resolved.column },
      {
        source: FILE,
        line: record.source.start.line,
        column: record.source.start.column - 1,
      },
      `record ${record.id} must resolve to its authored source span start`,
    );
  }
});

Deno.test('A10.2 module scaffolding resolves to authored constructs', () => {
  const { code, map } = compileElementProgram(SOURCE, FILE);
  const trace = traceOf(map);

  // Verbatim/rewritten imports resolve to the authored import statements.
  assertResolves(trace, code, `import { computed, OpenElement } from '@openelement/element';`, 1, {
    source: FILE,
    line: 1,
    column: 0,
  });
  assertResolves(
    trace,
    code,
    `import { defineIslandConfig as island } from '@openelement/router';`,
    1,
    {
      source: FILE,
      line: 2,
      column: 0,
    },
  );
  // Island-config passthrough is copied verbatim.
  assertResolves(
    trace,
    code,
    `export const openElement = island(`,
    1,
    expectSource(`export const openElement = island(`),
  );
  // The embedded program payload resolves to the render() that produced it;
  // the serialized tag resolves to the @element decorator.
  assertResolves(trace, code, 'const __partProgram = {', 1, expectSource('render() {'));
  assertResolves(
    trace,
    code,
    '"tag": "oe-map-fixture"',
    1,
    expectSource("@element('oe-map-fixture')"),
  );
  // Generated helper/scaffold consts resolve to the class they describe.
  assertResolves(
    trace,
    code,
    'const __compiledProperties = ',
    1,
    expectSource('MapFixture extends'),
  );
  assertResolves(trace, code, 'const __compiledProps = {', 1, expectSource('MapFixture extends'));
  // The generated class declaration resolves to the authored class name.
  assertResolves(
    trace,
    code,
    'export class MapFixture extends OpenElement {',
    1,
    expectSource('export class MapFixture extends OpenElement {', 1, 'MapFixture'),
    'MapFixture',
  );
});

Deno.test('A10.2 properties, computed fields, methods and multiline initializers resolve', () => {
  const { code, map } = compileElementProgram(SOURCE, FILE);
  const trace = traceOf(map);

  // Field declarations resolve to the authored field name (column-exact).
  assertResolves(trace, code, '  count = 0;', 1, expectSource('count = 0;'));
  assertResolves(trace, code, `  label = 'ready';`, 1, expectSource(`label = 'ready';`));
  // The same fields inside the generated __compiledProps helper resolve too.
  assertResolves(trace, code, '  count: { type: Number', 1, expectSource('count = 0;'));
  // Computed field factory resolves to the authored computed() initializer.
  assertResolves(
    trace,
    code,
    'doubled: (__s) => computed(() => __s.count.value * 2),',
    1,
    expectSource('computed(() => this.count * 2)'),
    '(__s)',
  );
  // Methods resolve to the authored method start.
  assertResolves(trace, code, '  bump(): void {', 1, expectSource('bump(): void {'));
  // Multiline initializer: continuation lines in BOTH generated copies (the
  // __compiledProps default and the class field) resolve to the authored
  // continuation line/column.
  assertResolves(trace, code, '    step: 1,', 1, expectSource('step: 1,'));
  assertResolves(trace, code, '    step: 1,', 2, expectSource('step: 1,'));
  assertResolves(trace, code, `    parity: 'even',`, 2, expectSource(`parity: 'even',`));
});

Deno.test('A10.2 identical repeated source lines map to their DISTINCT authored locations', () => {
  const { code, map } = compileElementProgram(SOURCE, FILE);
  const trace = traceOf(map);

  // Three identical method-body lines resolve to three distinct authored lines.
  const first = resolve(trace, code, 'this.count++;', 1);
  const second = resolve(trace, code, 'this.count++;', 2);
  const third = resolve(trace, code, 'this.count++;', 3);
  assertEquals(
    { source: first.source, line: first.line, column: first.column },
    expectSource('this.count++;', 1),
  );
  assertEquals(
    { source: second.source, line: second.line, column: second.column },
    expectSource('this.count++;', 2),
  );
  assertEquals(
    { source: third.source, line: third.line, column: third.column },
    expectSource('this.count++;', 3),
  );
  assertNotEquals(first.line, second.line);
  assertNotEquals(second.line, third.line);
});

Deno.test('A10.2 MANDATORY: two generated `this.count++;` event handlers map to two distinct arrows', () => {
  const { code, map } = compileElementProgram(SOURCE, FILE);
  const trace = traceOf(map);

  // The two generated handler lines are byte-identical; each must map back to
  // ITS OWN authored arrow function (line AND column), not first-match-wins.
  const first = resolve(trace, code, '__compiledEvent0(): void { this.count++; }', 1);
  const second = resolve(trace, code, '__compiledEvent1(): void { this.count++; }', 1);
  const firstArrow = positionOf(SOURCE, '() => this.count++', 1);
  const secondArrow = positionOf(SOURCE, '() => this.count++', 2);
  assertEquals({ source: first.source, line: first.line, column: first.column }, {
    source: FILE,
    line: firstArrow.line,
    column: firstArrow.column,
  });
  assertEquals({ source: second.source, line: second.line, column: second.column }, {
    source: FILE,
    line: secondArrow.line,
    column: secondArrow.column,
  });
  assertNotEquals(
    first.line,
    second.line,
    'duplicate handler bodies must not collapse to one line',
  );
});

Deno.test('A10.2 segments carry original identifier names where the compiler knows them', () => {
  const { code, map } = compileElementProgram(SOURCE, FILE);
  const trace = traceOf(map);
  assert(map.names.includes('count'), 'names table must carry authored identifiers');
  assert(map.names.includes('bump'), 'names table must carry authored method names');
  const resolved = resolve(trace, code, '  count = 0;', 1);
  assertEquals(resolved.name, 'count');
});

Deno.test('A10.2 diagnostics keep pointing at authored positions', () => {
  const nested = `import { element, OpenElement, property } from '@openelement/element';
@element('oe-nested-region')
export class NestedRegion extends OpenElement {
  @property({ reflect: true }) count = 0;
  render() {
    return (
      <div>
        {this.count > 0 ? <p>{this.count > 1 ? <b>many</b> : <b>one</b>}</p> : <p>zero</p>}
      </div>
    );
  }
}
`;
  const file = '/project/app/components/nested-region.tsx';
  let caught: unknown;
  try {
    compileElementProgram(nested, file);
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof CompiledElementError, 'nested regions must fail closed');
  const diagnostic = caught.diagnostics[0];
  assertEquals(diagnostic.code, 'OEC9012');
  const expected = positionOf(nested, '{this.count > 1 ?');
  assertEquals(diagnostic.file, file);
  assertEquals(diagnostic.line, expected.line);
  assertEquals(diagnostic.character, expected.column + 1);
});

Deno.test('A10.2 Vite boundary: compileElementModule hands the real map to the host', () => {
  // compileElementModule (the Vite-bound entrypoint) returns the real map.
  const result = compileElementModule(SOURCE, FILE);
  assert(result, 'fixture must be admitted by the compiler gate');
  assertNotEquals(result.map.mappings, '');
  assertEquals(result.map.x_openElement, result.program.sourceMap);
  const trace = traceOf(result.map);
  const resolved = resolve(trace, result.code, '__compiledEvent1(): void { this.count++; }', 1);
  const secondArrow = positionOf(SOURCE, '() => this.count++', 2);
  assertEquals({ source: resolved.source, line: resolved.line, column: resolved.column }, {
    source: FILE,
    line: secondArrow.line,
    column: secondArrow.column,
  });
  // The Router-side open:core hook's map composition (inline comment stripped,
  // map object returned to Vite) is pinned adapter-side in
  // packages/router/__tests__/compiler-open-core-boundary.test.ts.
});
