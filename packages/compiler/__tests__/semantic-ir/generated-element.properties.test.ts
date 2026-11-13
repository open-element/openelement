/**
 * M09-2b — primitive property metadata for the generated Native Custom Element
 * (D-props, 2026-11-14), LOCAL Node.
 *
 * The declaration source is the island sidecar `properties` table (the
 * platform facts a TS type cannot express) cross-checked against the root
 * component's typed props parameter (names and types). The emitted rows are
 * exactly the shell's landed `GeneratedElementProperty`; `observedAttributes`,
 * attribute conversion, reflection and defaults stay the shell's mechanism and
 * are not re-implemented here.
 *
 * These tests pin:
 *
 * - the table spelling and its rationale: an object map keyed by the typed
 *   member name carrying only `reflect`/`attribute`/`default`;
 * - the cross-check in BOTH directions (typed member without an entry, entry
 *   without a typed member) and the no-parameter/no-annotation/destructured/
 *   imported/generic/optional/non-primitive refusals;
 * - the one-way attribute resolution (omitted ⇒ camelToKebab, false ⇒ null,
 *   string ⇒ lowercased/safe) shared with the scanner;
 * - the emitted descriptor rows (all five facts explicit) and the M09-1a
 *   `properties: []` bytes when there is no declaration;
 * - the fail-closed table refusals (unknown option, dynamic default, unsafe or
 *   duplicate attribute, reflect without a channel, default/type mismatch,
 *   reserved lifecycle name);
 * - the reserved-name copy is a SUBSET of the shell's own refusals (the
 *   consumer-form guard for the one duplicated list; the shell remains the
 *   runtime authority and still fails closed for a name this early check
 *   misses).
 *
 * Not claimed here: array/object/trustedHtml conversion, custom converters,
 * `observedAttributes` for class components, CEM output, SSR host attribute
 * serialization (M11 owns the host-attribute serializer), forms.
 */

import { expect, test } from 'vitest';
import ts from 'typescript';
import { CompiledElementError } from '../../src/internal/compiler/semantic-core/compiler-diagnostics.ts';
import { typescriptParser } from '../../src/internal/compiler/semantic-core/parse-module.ts';
import { compileGeneratedElementIfAdmitted } from '../../src/internal/compiler/semantic-ir/generated-element/compile.ts';
import {
  GENERATED_ELEMENT_DIAGNOSTIC,
  type GeneratedElementSite,
} from '../../src/internal/compiler/semantic-ir/generated-element/contract.ts';
import { compiledElementPlugin } from '../../src/internal/compiler/plugin.ts';
import {
  admitGeneratedElementSite,
  readIslandMetadata,
  RESERVED_GENERATED_ELEMENT_PROPERTY_NAMES,
} from '../../src/internal/compiler/semantic-ir/generated-element/site.ts';
import {
  createGeneratedElementClass,
  type GeneratedElementDescriptor,
} from '../../../element/src/internal/compiled/generated-element/shell.ts';

const FILE = '/proj/src/islands/counter.tsx';
const SITE: GeneratedElementSite = { tag: 'x-counter' };

function parse(source: string): ts.SourceFile {
  const parsed = typescriptParser.parseModule(source, FILE);
  expect(parsed.syntaxDiagnostics).toEqual([]);
  return parsed.sourceFile;
}

/** One island module: sidecar entries plus the component body, verbatim. */
function island(entries: string, component: string, extra = ''): string {
  return (
    "import { defineIslandConfig } from '@openelement/router';\n" +
    `export const openElement = defineIslandConfig({ ${entries === '' ? '' : `${entries}, `}hydrate: 'idle' });\n` +
    extra +
    component
  );
}

/** The canonical shape: a typed inline props parameter. */
function counter(parameters = 'props: { count: number; label: string; padding: number }'): string {
  return (
    `function Counter(${parameters}) {\n` +
    '  return <section><p id="count">{props.count}</p><p id="label">{props.label}</p></section>;\n' +
    '}\n' +
    'export default Counter;\n'
  );
}

const TABLE = `properties: { count: { reflect: true, default: 0 }, label: { default: 'untitled' }, padding: { attribute: false } }`;

function laneError(source: string): CompiledElementError {
  try {
    compileGeneratedElementIfAdmitted(source, FILE, { site: SITE });
  } catch (error) {
    if (error instanceof CompiledElementError) return error;
    throw error;
  }
  throw new Error('expected the generated element lane to refuse the module');
}

function codes(error: CompiledElementError): string[] {
  return error.diagnostics.map((diagnostic) => diagnostic.code);
}

test('the sidecar table + typed props emit the shell descriptor rows', () => {
  const compiled = compileGeneratedElementIfAdmitted(island(TABLE, counter()), FILE, {
    site: SITE,
  });
  expect(compiled).not.toBeNull();
  const code = compiled!.code;
  expect(code).toContain('tag: "x-counter"');
  expect(code).toContain('properties: [');
  expect(code).toContain(
    '    { name: "count", attribute: "count", type: "number", reflect: true, default: 0 },',
  );
  expect(code).toContain(
    '    { name: "label", attribute: "label", type: "string", reflect: false, default: "untitled" },',
  );
  expect(code).toContain(
    '    { name: "padding", attribute: null, type: "number", reflect: false, default: 0 },',
  );
  expect(code).not.toContain('properties: []');
  // The rows are exactly the landed shell shape: the shell accepts this module.
  expect(typeof createGeneratedElementClass).toBe('function');
});

test('omitted defaults resolve to the type zero value', () => {
  const compiled = compileGeneratedElementIfAdmitted(
    island(
      'properties: { count: {}, label: {} }',
      counter('props: { count: number; label: string }'),
    ),
    FILE,
    { site: SITE },
  );
  expect(compiled!.code).toContain(
    '{ name: "count", attribute: "count", type: "number", reflect: false, default: 0 },',
  );
  expect(compiled!.code).toContain(
    '{ name: "label", attribute: "label", type: "string", reflect: false, default: "" },',
  );
});

test('a local type alias and a local interface are both admitted', () => {
  for (const extra of [
    'type CounterProps = { count: number };\n',
    'interface CounterProps { count: number }\n',
  ]) {
    const compiled = compileGeneratedElementIfAdmitted(
      island('properties: { count: { reflect: true } }', counter('props: CounterProps'), extra),
      FILE,
      { site: SITE },
    );
    expect(compiled, extra).not.toBeNull();
    expect(compiled!.code, extra).toContain(
      '{ name: "count", attribute: "count", type: "number", reflect: true, default: 0 },',
    );
  }
});

test('the explicit attribute spelling is lowercased and validated', () => {
  const compiled = compileGeneratedElementIfAdmitted(
    island(
      "properties: { count: { attribute: 'data-Count' } }",
      counter('props: { count: number }'),
    ),
    FILE,
    { site: SITE },
  );
  expect(compiled!.code).toContain('attribute: "data-count"');

  const unsafe = laneError(
    island("properties: { count: { attribute: 'onclick' } }", counter('props: { count: number }')),
  );
  expect(codes(unsafe)).toEqual([GENERATED_ELEMENT_DIAGNOSTIC.PROPERTY_INVALID]);
  expect(unsafe.diagnostics[0]!.message).toContain('not a safe HTML attribute name');
});

test('no declaration keeps the M09-1a props gate and the empty descriptor bytes', () => {
  // A props parameter WITHOUT a declaration is still the M09-1a refusal.
  const refused = laneError(island('', counter()));
  expect(codes(refused)).toEqual([GENERATED_ELEMENT_DIAGNOSTIC.UNDECLARED_PROPS]);

  // A component with no props parameter and no declaration emits `properties: []`.
  const compiled = compileGeneratedElementIfAdmitted(
    island('', 'function Counter() {\n  return <p id="count">0</p>;\n}\nexport default Counter;\n'),
    FILE,
    { site: SITE },
  );
  expect(compiled!.code).toContain('properties: []');
});

test('an empty declaration with an empty props type admits and emits []', () => {
  const compiled = compileGeneratedElementIfAdmitted(
    island('properties: {}', counter('props: {}')),
    FILE,
    { site: SITE },
  );
  expect(compiled!.code).toContain('properties: []');
});

test('the table and the typed members must match in both directions', () => {
  const missingEntry = laneError(island('properties: { count: {} }', counter()));
  expect(codes(missingEntry)).toEqual([GENERATED_ELEMENT_DIAGNOSTIC.PROPERTY_MISMATCH]);
  expect(missingEntry.diagnostics[0]!.message).toContain('without a sidecar entry');
  expect(missingEntry.diagnostics[0]!.message).toContain('"label"');

  const extraEntry = laneError(
    island('properties: { count: {}, ghost: {} }', counter('props: { count: number }')),
  );
  expect(codes(extraEntry)).toEqual([GENERATED_ELEMENT_DIAGNOSTIC.PROPERTY_MISMATCH]);
  expect(extraEntry.diagnostics[0]!.message).toContain('without a typed member');
  expect(extraEntry.diagnostics[0]!.message).toContain('"ghost"');

  const noParameter = laneError(
    island(
      'properties: { count: {} }',
      'function Counter() {\n  return <p id="count">0</p>;\n}\nexport default Counter;\n',
    ),
  );
  expect(codes(noParameter)).toEqual([GENERATED_ELEMENT_DIAGNOSTIC.PROPERTY_MISMATCH]);
  expect(noParameter.diagnostics[0]!.message).toContain('no props parameter');
});

test('the typed props extraction refuses shapes it cannot prove', () => {
  const cases: Array<[string, string, string]> = [
    ['no annotation', 'props', 'has no type annotation'],
    ['destructured', '{ count }: { count: number }', 'destructured'],
    ['non-primitive member', 'props: { count: ReadonlyArray<number> }', 'ReadonlyArray'],
    ['optional member', 'props: { count?: number }', 'is optional'],
    ['union member', 'props: { count: number | string }', 'not an admitted value type'],
    ['imported type', 'props: CounterProps', 'is not declared in this module'],
  ];
  for (const [name, parameters, message] of cases) {
    const error = laneError(
      island(
        'properties: { count: {} }',
        counter(parameters),
        'import type { CounterProps } from "./x.ts";\n',
      ),
    );
    expect(codes(error), name).toEqual([GENERATED_ELEMENT_DIAGNOSTIC.PROPS_TYPE_UNSUPPORTED]);
    expect(error.diagnostics[0]!.message, name).toContain(message);
    expect(error.diagnostics[0]!.file, name).toBe(FILE);
  }
});

test('a generic props type alias refuses instead of being unrolled', () => {
  const error = laneError(
    island(
      'properties: { count: {} }',
      counter('props: CounterProps'),
      'type CounterProps<T> = { count: number };\n',
    ),
  );
  expect(codes(error)).toEqual([GENERATED_ELEMENT_DIAGNOSTIC.PROPS_TYPE_UNSUPPORTED]);
  expect(error.diagnostics[0]!.message).toContain('generic');
});

test('malformed property entries fail closed with PROPERTY_INVALID', () => {
  const cases: Array<[string, string, string]> = [
    ['unknown option', 'properties: { count: { type: "number" } }', 'does not accept "type"'],
    ['dynamic default', 'properties: { count: { default: value } }', 'must be a static'],
    ['array default', 'properties: { count: { default: [1] } }', 'must be a static'],
    [
      'reflect without channel',
      'properties: { count: { attribute: false, reflect: true } }',
      'cannot reflect',
    ],
    [
      'duplicate attribute',
      'properties: { count: { attribute: "n" }, label: { attribute: "n" } }',
      'more than once',
    ],
    ['non-object entry', 'properties: { count: 1 }', 'must be an object'],
    ['invalid key', 'properties: { "not-an-identifier": {} }', 'must be an identifier'],
    [
      'default/type mismatch',
      'properties: { count: { default: "zero" } }',
      'default must be a number',
    ],
  ];
  for (const [name, entries, message] of cases) {
    const source = island(entries, counter('props: { count: number }'));
    if (name === 'dynamic default') {
      // `value` must be declared for the source to parse as an expression.
      const error = laneError(
        'const value = 1;\n' + island(entries, counter('props: { count: number }')),
      );
      expect(codes(error), name).toEqual([GENERATED_ELEMENT_DIAGNOSTIC.PROPERTY_INVALID]);
      expect(error.diagnostics[0]!.message, name).toContain(message);
      continue;
    }
    const error = laneError(source);
    expect(codes(error), name).toEqual([GENERATED_ELEMENT_DIAGNOSTIC.PROPERTY_INVALID]);
    expect(error.diagnostics[0]!.message, name).toContain(message);
    expect(error.diagnostics[0]!.file, name).toBe(FILE);
  }
});

test('a reserved lifecycle name refuses at the lane, and the shell refuses the same set', () => {
  for (const name of RESERVED_GENERATED_ELEMENT_PROPERTY_NAMES) {
    const error = laneError(
      island(`properties: { ${name}: {} }`, counter(`props: { ${name}: string }`)),
    );
    expect(codes(error), name).toEqual([GENERATED_ELEMENT_DIAGNOSTIC.PROPERTY_INVALID]);
    expect(error.diagnostics[0]!.message, name).toContain('collides with the element lifecycle');

    // Consumer-form guard for the one duplicated list: the shell (the runtime
    // owner) must refuse every name this early check refuses. An over-refusal
    // is the drift direction that matters; a shell-only addition still fails
    // closed at class creation.
    expect(
      () =>
        createGeneratedElementClass({
          tag: 'x-reserved-probe',
          properties: [{ name, type: 'string' }],
          createRecipe: (() => ({ mount: () => [], createProps: () => ({}) })) as never,
        }),
      name,
    ).toThrow(/collides with the element lifecycle surface/);
  }
});

test('the admission carries the resolved rows beside the other facts', () => {
  const source = parse(island(TABLE, counter()));
  const admitted = admitGeneratedElementSite(source, SITE);
  expect(admitted.kind).toBe('admitted');
  if (admitted.kind !== 'admitted') throw new Error('unreachable');
  expect(admitted.admission.propertiesDeclared).toBe(true);
  expect(admitted.admission.properties).toEqual([
    { name: 'count', attribute: 'count', type: 'number', reflect: true, default: 0 },
    { name: 'label', attribute: 'label', type: 'string', reflect: false, default: 'untitled' },
    { name: 'padding', attribute: null, type: 'number', reflect: false, default: 0 },
  ]);

  const read = readIslandMetadata(parse(island(TABLE, counter())));
  expect(read.kind).toBe('read');
  if (read.kind !== 'read') throw new Error('unreachable');
  expect(read.facts.properties?.map((entry) => entry.name)).toEqual(['count', 'label', 'padding']);
});

test('the emitted module with property rows parses as JavaScript', () => {
  const compiled = compileGeneratedElementIfAdmitted(island(TABLE, counter()), FILE, {
    site: SITE,
  });
  const parsed = ts.createSourceFile(
    'generated-element.js',
    compiled!.code,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.JS,
  );
  const diagnostics = (parsed as unknown as { parseDiagnostics?: readonly unknown[] })
    .parseDiagnostics;
  expect(diagnostics ?? []).toEqual([]);
});

test('a property row is a plain descriptor input the shell normalizes', () => {
  // The shell's own validation is the final authority for the emitted shape:
  // an invalid row (probe only) fails closed there instead of mounting.
  expect(() =>
    createGeneratedElementClass({
      tag: 'x-props-probe',
      properties: [{ name: 'count', type: 'number', reflect: true, attribute: null }],
      createRecipe: (() => ({ mount: () => [], createProps: () => ({}) })) as never,
    }),
  ).toThrow(/requests reflection but declares no attribute/);

  const descriptor: GeneratedElementDescriptor = {
    tag: 'x-props-ok',
    properties: [{ name: 'count', type: 'number', reflect: true, default: 0 }],
    createRecipe: (() => ({ mount: () => [], createProps: () => ({}) })) as never,
  };
  const ctor = createGeneratedElementClass(descriptor);
  expect((ctor as unknown as { observedAttributes: readonly string[] }).observedAttributes).toEqual(
    ['count'],
  );
});

test('a cyclic props type alias refuses instead of overflowing the stack (B1)', () => {
  const cases: Array<[string, string, string]> = [
    ['self alias', 'type CounterProps = CounterProps;\n', 'props: CounterProps'],
    ['two-hop cycle', 'type A = B;\ntype B = A;\n', 'props: A'],
    ['three-hop cycle', 'type A = B;\ntype B = C;\ntype C = A;\n', 'props: A'],
  ];
  for (const [name, extra, parameters] of cases) {
    const error = laneError(island('properties: { count: {} }', counter(parameters), extra));
    expect(codes(error), name).toEqual([GENERATED_ELEMENT_DIAGNOSTIC.PROPS_TYPE_UNSUPPORTED]);
    expect(error.diagnostics[0]!.message, name).toContain('cyclic');
    expect(error.diagnostics[0]!.file, name).toBe(FILE);
    // Located at the cyclic reference inside the alias, not at the module start.
    expect(error.diagnostics[0]!.line, name).toBeGreaterThan(1);
  }
});

test('the plugin boundary reports the coded cycle refusal, never a RangeError (B1)', () => {
  type TransformHook = (
    this: unknown,
    code: string,
    id: string,
  ) => { code: string; map: unknown } | null;
  const source = island(
    'properties: { count: {} }',
    counter('props: A'),
    'type A = B;\ntype B = C;\ntype C = A;\n',
  );
  const plugin = compiledElementPlugin({
    generatedElementSite: () => ({ tag: 'x-cycle' }),
  });
  let thrown: unknown;
  const context = {
    error(payload: unknown): never {
      thrown = payload;
      throw payload;
    },
  };
  const transform = (plugin.transform as unknown as TransformHook).bind(context);
  try {
    transform(source, FILE);
  } catch (error) {
    // The plugin's this.error path is the expected refusal channel.
    expect(error).toBe(thrown);
  }
  expect(thrown, 'the plugin transform must throw the coded diagnostic').toBeDefined();
  expect(thrown).not.toBeInstanceOf(RangeError);
  const payload = thrown as {
    readonly message?: string;
    readonly loc?: { readonly file?: string; readonly line?: number };
    readonly diagnostics?: readonly { readonly code: string }[];
  };
  expect(payload.message).toContain('OEIR_GENERATED_ELEMENT_PROPS_TYPE_UNSUPPORTED');
  expect(payload.diagnostics?.[0]?.code).toBe(GENERATED_ELEMENT_DIAGNOSTIC.PROPS_TYPE_UNSUPPORTED);
  expect(payload.loc?.file).toBe(FILE);
  expect(payload.loc?.line ?? 0).toBeGreaterThan(1);
});

test('merged same-name interface declarations are refused, never partially read (D1)', () => {
  const merged =
    'interface CounterProps { label: string }\n' + 'interface CounterProps { count: number }\n';
  // Both members declared: the old first-match read produced a WRONG mismatch.
  const both = laneError(
    island('properties: { label: {}, count: {} }', counter('props: CounterProps'), merged),
  );
  expect(codes(both)).toEqual([GENERATED_ELEMENT_DIAGNOSTIC.PROPS_TYPE_UNSUPPORTED]);
  expect(both.diagnostics[0]!.message).toContain('declared more than once');
  expect(both.diagnostics[0]!.file).toBe(FILE);

  // Only the first declaration's member declared: the old read silently
  // compiled and left `props.count` undefined at runtime.
  const partial = laneError(
    island('properties: { label: {} }', counter('props: CounterProps'), merged),
  );
  expect(codes(partial)).toEqual([GENERATED_ELEMENT_DIAGNOSTIC.PROPS_TYPE_UNSUPPORTED]);
  expect(partial.diagnostics[0]!.message).toContain('declared more than once');

  // An interface and a type alias with one name are equally unprovable.
  const mixed = laneError(
    island(
      'properties: { label: {}, count: {} }',
      counter('props: CounterProps'),
      'interface CounterProps { label: string }\ntype CounterProps = { count: number };\n',
    ),
  );
  expect(codes(mixed)).toEqual([GENERATED_ELEMENT_DIAGNOSTIC.PROPS_TYPE_UNSUPPORTED]);
  expect(mixed.diagnostics[0]!.message).toContain('declared more than once');
});

test('duplicate sidecar property names refuse independent of the attribute channel (D2)', () => {
  const cases: Array<[string, string]> = [
    [
      'property-only duplicates',
      'properties: { label: { attribute: false }, label: { attribute: false } }',
    ],
    [
      'distinct-attribute duplicates',
      "properties: { label: { attribute: 'a' }, label: { attribute: 'b' } }",
    ],
  ];
  for (const [name, entries] of cases) {
    const error = laneError(island(entries, counter('props: { label: string }')));
    expect(codes(error), name).toEqual([GENERATED_ELEMENT_DIAGNOSTIC.PROPERTY_INVALID]);
    expect(error.diagnostics[0]!.message, name).toContain('more than once');
    expect(error.diagnostics[0]!.file, name).toBe(FILE);
  }
});

test('duplicate sidecar property names are refused before any attribute resolution', () => {
  // The same name twice must be located as a duplicate NAME even when the
  // entries would derive distinct attributes (the old attribute-set check
  // could not see it) and even when there is no attribute channel at all.
  const read = readIslandMetadata(
    parse(
      island(
        'properties: { label: { attribute: false }, label: { attribute: false } }',
        counter('props: { label: string }'),
      ),
    ),
  );
  expect(read.kind).toBe('refused');
  if (read.kind !== 'refused') throw new Error('unreachable');
  expect(read.diagnostic.code).toBe(GENERATED_ELEMENT_DIAGNOSTIC.PROPERTY_INVALID);
  expect(read.diagnostic.message).toContain('more than once');
});
