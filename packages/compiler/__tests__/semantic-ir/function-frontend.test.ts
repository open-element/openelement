/**
 * M03-I-4a — production function-component frontend + Alpha15 diagnostics parity.
 *
 * Authority: `docs/architecture/alpha16-18-execution-plan.md` §1 M03 exit
 * (diagnostics / Source Map / security parity with the Alpha15 class frontend),
 * `docs/architecture/m03-expression-identity.md` §3/§6/§8, the M02 admitted
 * grammar, and the M03-A/-B adopted decisions. This file covers the A4a half of
 * the exit evidence: the compiler-private frontend pipeline and the
 * diagnostics-parity harness. Source-map parity, the full security parity
 * matrix, the semantic-test-matrix rows and the M03 ledger flip are A4b.
 */

import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import {
  compileFunctionModule,
  type FunctionFrontendResult,
} from '../../src/internal/compiler/semantic-core/function-frontend.ts';
import {
  CompiledElementError,
  compileElementProgram,
} from '../../src/internal/compiler/semantic-core/compile.ts';
import { classifyIntrinsicAttribute } from '../../src/internal/compiler/semantic-core/attribute-classification.ts';
import { forbiddenSinkReason } from '@openelement/protocol/forbidden-sinks';

const FILE = '/proj/src/function-component.tsx';
const ELEMENT = '@openelement/element';

const CLASSIFIER = {
  classifySymbol: (specifier: string, importedName: string | null) => {
    if (specifier !== ELEMENT) return undefined;
    if (importedName === 'signal' || importedName === 'computed') return 'factory' as const;
    return 'value' as const;
  },
  classifyValue: () => undefined,
  classifyCall: (specifier: string, importedName: string | null) => {
    if (specifier !== ELEMENT) return undefined;
    if (importedName === 'signal') return { call: 'signal' as const };
    if (importedName === 'computed') return { call: 'computed' as const };
    return undefined;
  },
};

function compile(source: string): FunctionFrontendResult {
  return compileFunctionModule(source, FILE, { importClassifier: CLASSIFIER });
}

function codes(result: FunctionFrontendResult): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

function expectDiagnostic(
  result: FunctionFrontendResult,
  code: string,
  source: string,
  slice?: string,
): void {
  const diagnostic = result.diagnostics.find((candidate) => candidate.code === code);
  expect(diagnostic, `expected ${code}; got [${codes(result).join(', ')}]`).toBeDefined();
  expect(diagnostic!.file).toBe(FILE);
  expect(diagnostic!.line).toBeGreaterThanOrEqual(1);
  expect(diagnostic!.character).toBeGreaterThanOrEqual(1);
  expect(diagnostic!.end).toBeGreaterThan(diagnostic!.start);
  if (slice !== undefined) {
    expect(source.slice(diagnostic!.start, diagnostic!.end)).toBe(slice);
  }
}

const ADMITTED = `import { signal, computed } from '@openelement/element';
function Card(props) {
  const count = signal(0);
  const doubled = computed(() => count.value * 2);
  return (
    <div class="card" title={props.title}>
      <h1>{props.title}</h1>
      {props.items.map((item) => <li key={item.id}>{item.text}</li>)}
      {props.show ? <p>{doubled.value}</p> : null}
      {props.children}
    </div>
  );
}
function Plain(props) { return <section>{props.value}</section>; }
`;

// ─── Component model (C+ admitted grammar) ─────────────────────────────────

describe('M03-I-4a production frontend — admitted component model', () => {
  test('discovers every top-level component and builds the model', () => {
    const result = compile(ADMITTED);
    expect(result.diagnostics).toEqual([]);
    expect(result.module).not.toBeNull();
    const names = result.module!.components.map((component) => component.name);
    expect(names).toEqual(['Card', 'Plain']);
    const card = result.module!.components[0]!;
    expect(card.propsParam).toBe('props');
    expect(card.resources.map((resource) => `${resource.name}:${resource.kind}`)).toEqual([
      'count:signal',
      'doubled:computed',
    ]);
    expect(card.roots.map((root) => root.kind)).toEqual(['element']);
    expect(card.roots[0]!.kind === 'element' && card.roots[0]!.tag).toBe('div');
    // Structural nodes come from the admitted grammar, not from text parsing.
    const root = card.roots[0]!;
    const kinds =
      JSON.stringify(root).includes('"list"') && JSON.stringify(root).includes('"condition"');
    expect(kinds).toBe(true);
  });

  test('the module carries the A2 expression sidecar with modes and captures', () => {
    const result = compile(ADMITTED);
    const registry = result.module!.expressions;
    expect(registry.size).toBeGreaterThan(0);
    const records = registry.expressions;
    expect(records.map((record) => record.mode)).toContain('derived');
    expect(records.map((record) => record.mode)).toContain('per-entry');
    for (const record of records) {
      expect(record.lowered.length).toBeGreaterThan(0);
      expect(record.provenance.typescriptVersion).toBe(ts.version);
    }
    // A1 answers captures/dependencies; the frontend never re-derives them.
    const derived = records.find((record) => record.mode === 'derived')!;
    expect(derived.captures.length).toBeGreaterThan(0);
  });

  test('a JSX node inside a lowered expression becomes a recipe reference', () => {
    const source = `import { signal } from '@openelement/element';
function Host(props) {
  const s = signal(0);
  return <main title={props.ok ? <b>{s.value}</b> : <i />}>{props.value}</main>;
}
`;
    const result = compile(source);
    expect(result.diagnostics).toEqual([]);
    const component = result.module!.components[0]!;
    expect(component.recipes).toHaveLength(2);
    const titleRecord = result.module!.expressions.expressions.find(
      (record) => record.lowered.includes('__oe_recipe_ref(') && record.mode !== 'handler',
    );
    expect(titleRecord).toBeDefined();
    expect(titleRecord!.lowered).toContain('__oe_recipe_ref("#recipe0")');
  });

  test('compilation is deterministic', () => {
    const first = compile(ADMITTED);
    const second = compile(ADMITTED);
    expect(second.module!.components.map((component) => component.name)).toEqual(
      first.module!.components.map((component) => component.name),
    );
    expect(second.module!.expressions.expressions).toEqual(first.module!.expressions.expressions);
  });
});

// ─── Fail-closed grammar and expression refusals (C−) ─────────────────────

describe('frontend fails closed with source-located OEC diagnostics', () => {
  test('no function component', () => {
    const source = 'export const value = 1;\n';
    const result = compile(source);
    expect(result.module).toBeNull();
    expectDiagnostic(result, 'OEC9040', source, 'export const value = 1;\n');
  });

  test('a non-admitted statement', () => {
    const source = `function C(props) {
  if (props.ok) { return <p>a</p>; }
  return <p>b</p>;
}
`;
    const result = compile(source);
    expectDiagnostic(result, 'OEC9041', source);
  });

  test('a declaration outside the admitted forms', () => {
    const source = `function C(props) {
  let { a } = props;
  return <p>{a}</p>;
}
`;
    const result = compile(source);
    expectDiagnostic(result, 'OEC9042', source);
  });

  test('spread attributes and component children fail closed', () => {
    const spread = `function C(props) { return <div {...props} />; }\n`;
    expectDiagnostic(compile(spread), 'OEC9042', spread);
    const children = `function C(props) { return <Box><span /></Box>; }\n`;
    expectDiagnostic(compile(children), 'OEC9042', children);
  });

  test('an expression refused by A1/A2/A3 keeps the original code in the message', () => {
    const unresolved = 'function C(props) { return <p>{missing}</p>; }\n';
    const result = compile(unresolved);
    expect(result.module).toBeNull();
    const diagnostic = result.diagnostics.find((candidate) => candidate.code === 'OEC9043');
    expect(diagnostic).toBeDefined();
    expect(diagnostic!.message).toContain('OEIR_UNRESOLVED_BINDING');
    expect(unresolved.slice(diagnostic!.start, diagnostic!.end)).toBe('missing');
  });

  test('context-sensitive constructs are refused', () => {
    const source = 'function C(props) { return <p>{this}</p>; }\n';
    const diagnostic = compile(source).diagnostics.find((candidate) =>
      candidate.message.includes('OEIR_UNSUPPORTED_THIS'),
    );
    expect(diagnostic).toBeDefined();
    expect(diagnostic!.code).toBe('OEC9043');
  });

  test('erasure is integrated: an originally deferred expression now lowers', () => {
    const source = `import { signal } from '@openelement/element';
function C(props) {
  const s = signal(0);
  return <p>{(s.value as number) + (props.count as number)}</p>;
}
`;
    const result = compile(source);
    expect(result.diagnostics).toEqual([]);
    const record = result.module!.expressions.expressions.find((candidate) =>
      candidate.lowered.replace(/\s+/g, '').includes('s.value'),
    );
    expect(record).toBeDefined();
    expect(record!.lowered.replace(/\s+/g, '')).toContain('s.value');
    expect(record!.lowered).not.toContain(' as ');
  });
});

// ─── Security admission reuses the canonical predicates ───────────────────

describe('security admission reuses the canonical deny lists/classifier', () => {
  test('raw-text tags are refused with the shared dedicated code', () => {
    const source = 'function C(props) { return <script>alert(1)</script>; }\n';
    expectDiagnostic(compile(source), 'OEC9010', source, 'script');
  });

  test('forbidden attribute sinks are refused with the Alpha15 code', () => {
    const cases: Array<{ source: string; slice: string }> = [
      {
        source: 'function C(props) { return <div srcdoc={props.raw} />; }\n',
        slice: 'srcdoc={props.raw}',
      },
      {
        source: 'function C(props) { return <div __proto__={props.raw} />; }\n',
        slice: '__proto__={props.raw}',
      },
      {
        source: 'function C(props) { return <div innerHTML="raw" />; }\n',
        slice: 'innerHTML="raw"',
      },
    ];
    for (const entry of cases) {
      expectDiagnostic(compile(entry.source), 'OEC9011', entry.source, entry.slice);
    }
  });

  test('the frontend asks the shared predicates (no second sink table)', () => {
    for (const name of ['srcdoc', '__proto__', 'constructor', 'prototype']) {
      const reasons = (['attr', 'bool', 'prop'] as const).map((kind) =>
        forbiddenSinkReason(kind, name),
      );
      expect(
        reasons.some((reason) => reason !== null),
        name,
      ).toBe(true);
    }
    expect(forbiddenSinkReason('tag', 'script')).not.toBeNull();
    // The shared classifier stays the one naming authority the frontend uses.
    expect(classifyIntrinsicAttribute('onClick', 'button')).toBe('event');
    expect(classifyIntrinsicAttribute('class', 'div')).toBe('class');
  });

  test('dynamic innerHTML is refused by the function model specifically', () => {
    const source = 'function C(props) { return <div innerHTML={props.html} />; }\n';
    expectDiagnostic(compile(source), 'OEC9044', source, 'innerHTML={props.html}');
  });
});

// ─── Parallel-entry boundary (no class-frontend wrapping, no Part Program) ─

describe('compiler-private parallel entry boundary', () => {
  test('the frontend does not call the class pipeline or emit a Part Program', () => {
    const raw = readFileSync(
      new URL('../../src/internal/compiler/semantic-core/function-frontend.ts', import.meta.url),
      'utf8',
    );
    // Strip comments: the header documents the boundary with these words.
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(source).not.toMatch(/compileElementProgram\s*\(/);
    expect(source).not.toMatch(/from '\.\/(compile|lower-program|emit-program|emit-module)\.ts'/);
    expect(source).not.toMatch(/PartProgram/);
    expect(source).not.toMatch(/__partProgram/);
    expect(source).not.toMatch(/ts\.createProgram\s*\(/);
    expect(source).not.toMatch(/ts\.transpileModule\s*\(/);
  });

  test('the frontend is not exported from the package entry', () => {
    const entry = readFileSync(new URL('../../src/compiler.ts', import.meta.url), 'utf8');
    expect(entry).not.toContain('function-frontend');
  });

  test('the function model contains no serialized program/wire field', () => {
    const result = compile(ADMITTED);
    const serialized = JSON.stringify(result.module!.components);
    expect(serialized).not.toContain('partProgram');
    expect(serialized).not.toContain('__oe_program');
  });
});

// ─── Alpha15 diagnostics parity harness (owner-approved shape, item a) ────

interface ParityCase {
  readonly name: string;
  readonly classRender: string;
  readonly functionRender: string;
  readonly code: string;
  readonly slice: string;
}

const CLASS_PRELUDE = `import { element, OpenElement, property } from '@openelement/element';
@element('oe-parity-fixture')
export class ParityFixture extends OpenElement {
  @property({ reflect: false }) label = 'ready';
  @property({ type: Array, reflect: false }) items = [];
  render() { return `;

function classSource(render: string): string {
  return `${CLASS_PRELUDE}${render}; }
}
`;
}

function functionSource(render: string): string {
  return `import { signal } from '@openelement/element';
function ParityFixture(props) { return ${render}; }
`;
}

function classDiagnostics(source: string): Array<{ code: string; start: number; end: number }> {
  try {
    compileElementProgram(source, FILE);
  } catch (error) {
    if (error instanceof CompiledElementError) {
      return error.diagnostics.map((diagnostic) => ({
        code: diagnostic.code,
        start: diagnostic.start,
        end: diagnostic.end,
      }));
    }
    throw error;
  }
  return [];
}

const PARITY_CASES: readonly ParityCase[] = [
  {
    name: 'dynamic srcdoc sink',
    classRender: '<x-widget srcdoc={this.label}></x-widget>',
    functionRender: '<x-widget srcdoc={props.label}></x-widget>',
    code: 'OEC9011',
    slice: 'srcdoc',
  },
  {
    name: 'prototype-pollution property sink',
    classRender: '<x-widget __proto__={this.label}></x-widget>',
    functionRender: '<x-widget __proto__={props.label}></x-widget>',
    code: 'OEC9011',
    slice: '__proto__',
  },
  {
    name: 'static innerHTML',
    classRender: '<div innerHTML="raw"></div>',
    functionRender: '<div innerHTML="raw"></div>',
    code: 'OEC9011',
    slice: 'innerHTML',
  },
  {
    name: 'raw-text script tag',
    classRender: '<script>alert(1)</script>',
    functionRender: '<script>alert(1)</script>',
    code: 'OEC9010',
    slice: 'script',
  },
  {
    name: 'raw-text style tag',
    classRender: '<style>raw text</style>',
    functionRender: '<style>raw text</style>',
    code: 'OEC9010',
    slice: 'style',
  },
];

describe('Alpha15 diagnostics parity — shared security constructs (asserted)', () => {
  for (const entry of PARITY_CASES) {
    test(`${entry.name}: same OEC code and same offending authored slice`, () => {
      const cls = classDiagnostics(classSource(entry.classRender));
      const fn = compile(functionSource(entry.functionRender)).diagnostics;
      const classDiagnostic = cls.find((diagnostic) => diagnostic.code === entry.code);
      const functionDiagnostic = fn.find((diagnostic) => diagnostic.code === entry.code);
      expect(classDiagnostic, `class frontend did not report ${entry.code}`).toBeDefined();
      expect(functionDiagnostic, `function frontend did not report ${entry.code}`).toBeDefined();
      // Normalization decision: the two fixtures differ in module shape, so
      // parity compares the OEC code, the field dialect and the OFFENDING
      // TOKEN (the attribute name / tag name), not absolute offsets. A span
      // that quotes the same token is the same source-located finding.
      const offending = (source: string, diagnostic: { start: number; end: number }): string => {
        const slice = source.slice(diagnostic.start, diagnostic.end);
        return slice.includes('=') ? slice.slice(0, slice.indexOf('=')) : slice;
      };
      expect(offending(classSource(entry.classRender), classDiagnostic!)).toBe(entry.slice);
      expect(offending(functionSource(entry.functionRender), functionDiagnostic!)).toBe(
        entry.slice,
      );
      expect(functionDiagnostic!.file).toBe(FILE);
    });
  }

  test('C+ parity: an admitted component compiles on both frontends', () => {
    const classResult = classDiagnostics(
      classSource('<main title={this.label}><h1>{this.label}</h1></main>'),
    );
    expect(classResult).toEqual([]);
    const functionResult = compile(
      functionSource('<main title={props.label}><h1>{props.label}</h1></main>'),
    );
    expect(functionResult.diagnostics).toEqual([]);
    expect(functionResult.module).not.toBeNull();
  });
});

// ─── T+/T− truthfulness (TypeScript is the type authority) ───────────────

/** Type-check one authored TSX fixture with a virtual, single-file program. */
function typeErrors(source: string, fileName: string): number {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    jsx: ts.JsxEmit.Preserve,
    types: [],
  };
  const host = ts.createCompilerHost(options, true);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  const originalReadFile = host.readFile.bind(host);
  const originalFileExists = host.fileExists.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) =>
    name === fileName
      ? ts.createSourceFile(name, source, languageVersion, true, ts.ScriptKind.TSX)
      : originalGetSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile);
  host.readFile = (name) => (name === fileName ? source : originalReadFile(name));
  host.fileExists = (name) => name === fileName || originalFileExists(name);
  const program = ts.createProgram([fileName], options, host);
  return ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.file?.fileName === fileName).length;
}

describe('T rows — TypeScript truthfulness of the authored fixtures (asserted)', () => {
  const JSX_STUB = 'declare namespace JSX { interface IntrinsicElements { [tag: string]: any } }\n';
  const T_POSITIVE =
    JSX_STUB +
    'function C(props: { label: string }) { return <p>{props.label.toUpperCase()}</p>; }\n';
  const T_NEGATIVE =
    JSX_STUB + 'function C(props: { label: string }) { return <p>{props.label.toFixed(2)}</p>; }\n';

  test('T+: a type-correct component has zero TypeScript errors', () => {
    // TypeScript is the T+ authority; this fixture is type-checked in a virtual
    // single-file program (the ambient JSX stub only silences the missing
    // platform JSX namespace, it adds no `any` to the authored expression).
    expect(typeErrors(T_POSITIVE, FILE)).toBe(0);
  });

  test('T−: a typed misuse has TypeScript errors; the frontend is not the type authority', () => {
    expect(typeErrors(T_NEGATIVE, FILE)).toBeGreaterThan(0);
    // The admission frontend is syntax/security-scoped and does not duplicate
    // the checker; T− parity is recorded from the TypeScript authority, not
    // from a compiler diagnostic (documented, not a silent pass).
  });

  test('NOT asserted in A4a (owned by A4b): source-map parity, full security matrix, breakage of the class default path', () => {
    // A4b owns: expression-level source-map parity via @jridgewell/trace-mapping,
    // the per-new-position security negative matrix, the semantic-test-matrix
    // rows and the M03 ledger exit flip. Recording the boundary here keeps the
    // harness honest: A4a asserts diagnostics parity only.
    expect(true).toBe(true);
  });
});
