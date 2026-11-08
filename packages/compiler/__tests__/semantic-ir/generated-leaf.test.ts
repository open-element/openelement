/**
 * M05 v2 — generated leaf module unit contract (compiler-private).
 *
 * These tests pin the emitted module shape and the fail-closed boundary without
 * a browser; the real-engine S1 evidence lives in `generated-leaf.browser.test.ts`.
 * The generator consumes the M03 `FunctionModelModule` + registry — no M03
 * semantics are re-derived here, and no Part Program/wire form is emitted.
 */

import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { compileFunctionModule } from '../../src/internal/compiler/semantic-core/function-frontend.ts';
import {
  GENERATED_LEAF_RUNTIME_SPECIFIER,
  generateLeafModule,
  type GeneratedLeafModule,
} from '../../src/internal/compiler/semantic-ir/generated-leaf/generate.ts';

const FILE = '/proj/src/leaf.tsx';

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

function generate(source: string): GeneratedLeafModule {
  const front = compileFunctionModule(source, FILE, { importClassifier: CLASSIFIER });
  expect(front.diagnostics, 'frontend admission').toEqual([]);
  return generateLeafModule(front.module!);
}

function codes(result: GeneratedLeafModule): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

const COUNTER = `import { signal, computed } from '@openelement/element';
function Counter(props) {
  const count = signal(0);
  const doubled = computed(() => count.value * 2);
  return (
    <section data-count={count.value}>
      <p title={props.label}>{props.label}: {count.value} / {doubled.value}</p>
    </section>
  );
}
`;

describe('M05 leaf v2 — emitted module contract', () => {
  test('emits one createRecipe factory per component using the M04 call surface', () => {
    const result = generate(COUNTER);
    expect(result.module).not.toBeNull();
    const module = result.module!;
    expect(module).toContain(`from ${JSON.stringify(GENERATED_LEAF_RUNTIME_SPECIFIER)}`);
    expect(module).toContain('export function createCounterRecipe(');
    expect(module).toContain('createRecipe({');
    expect(module).toContain('mount(__oe_scope) {');
    expect(module).toContain('bindSignalWrites(__oe_scope, count, "count"');
    expect(module).toContain('bindSignalWrites(__oe_scope, doubled, "doubled"');
    expect(module).toContain('displayValue(');
    expect(module).toContain('attributeValueOf(');
    expect(module).toContain('document.createElement("section")');
    // Host contract: props plus the signal/computed bindings.
    expect(result.requiredProps).toEqual(['props']);
    expect(result.requiredBindings).toEqual(['count', 'doubled']);
    expect(result.requiresPropsChanged).toBe(true);
    expect(module).toContain('bindSignalWrites(__oe_scope, __oe_propsChanged, "props"');
  });

  test('emits detached nodes only: the mount never appends to a host element', () => {
    const module = generate(COUNTER).module!;
    expect(module).not.toMatch(/document\.body/);
    expect(module).not.toMatch(/\.appendChild\([^)]*host/i);
    expect(module).toContain('return __oe_nodes;');
  });

  test('is deterministic for the same model and registry', () => {
    expect(generate(COUNTER).module).toBe(generate(COUNTER).module);
  });

  test('fragments/multi-root flatten into the returned node list; empty output is admissible', () => {
    const multi = generate(
      `function Multi(props) { return <><p>{props.label}</p><span>extra</span></>; }\n`,
    );
    expect(multi.module).not.toBeNull();
    expect(multi.module!.match(/__oe_nodes\.push\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    const empty = generate('function Empty(props) { return <></>; }\n');
    expect(empty.module).not.toBeNull();
    expect(empty.module).toContain('const __oe_nodes = [];');
    expect(empty.module).toContain('return __oe_nodes;');
    expect(empty.module).not.toContain('createElement');
  });

  test('the artifact holds no Part Program/wire form and no generic node walker', () => {
    const module = generate(COUNTER).module!;
    expect(module).not.toContain('__partProgram');
    expect(module).not.toContain('PartProgram');
    expect(module).not.toMatch(/JSON\.(parse|stringify)/);
    expect(module).not.toMatch(/switch\s*\(\s*__oe_/);
    // Authored expressions are emitted through the M03 lowered text, never
    // re-parsed: the module contains no TypeScript syntax or JSX.
    expect(module).not.toContain('<section');
    expect(module).not.toMatch(/\bas\s+[A-Z]/);
  });

  test('nested intrinsic children are modelled and emitted (M03 follow-up)', () => {
    const nested = generate(
      'function C(props) { return <section><p class="x"><b>bold</b></p><i>it</i></section>; }\n',
    );
    expect(nested.module).not.toBeNull();
    expect(nested.module!.match(/document\.createElement\(/g)?.length ?? 0).toBeGreaterThanOrEqual(
      4,
    );
    expect(nested.module).toContain('appendChild');
  });

  test('M06 conditions emit an anchor + branch builders with disposal mapping', () => {
    const result = generate(
      'function C(props) { return <section>{props.ok ? <p>on</p> : <em>off</em>}</section>; }\n',
    );
    expect(result.module).not.toBeNull();
    const module = result.module!;
    expect(module).toContain('document.createComment("oe:when")');
    expect(module).toContain('function __oe_whenThen');
    expect(module).toContain('function __oe_whenElse');
    expect(module).toContain('dispose(true)');
    expect(module).toContain('removeNodes(');
    expect(module).toContain('insertBefore');
    // Props reads refresh through the host propsChanged channel.
    expect(result.requiresPropsChanged).toBe(true);
  });

  test('M06 lists emit per-entry owners, a key thunk, reuse and in-place update', () => {
    const result = generate(`import { signal } from '@openelement/element';
function C(props) {
  const items = signal([]);
  return <ul>{items.value.map((item) => <li key={item.id}>{item.label}</li>)}</ul>;
}
`);
    expect(result.module).not.toBeNull();
    const module = result.module!;
    expect(module).toContain('document.createComment("oe:each")');
    expect(module).toContain('function __oe_eachEntry');
    expect(module).toContain('function __oe_eachKey');
    expect(module).toContain('update(next)');
    expect(module).toContain('.child()');
    expect(module).toContain('dispose(true)');
    expect(module).toContain('insertBefore');
    // The mapper parameter is entry-local, never a host binding.
    expect(result.requiredBindings).toEqual(['items']);
    expect(module).not.toContain('requireBinding("item")');
  });

  test('generated code is valid JavaScript (parse check)', () => {
    const module = generate(COUNTER).module!;
    const source = ts.createSourceFile(
      'leaf.js',
      module,
      ts.ScriptTarget.ES2022,
      true,
      ts.ScriptKind.JS,
    );
    const parseDiagnostics =
      (source as unknown as { parseDiagnostics?: readonly unknown[] }).parseDiagnostics ?? [];
    expect(parseDiagnostics).toHaveLength(0);
  });
});

describe('M05 leaf v2 — fail-closed boundary (M05b/M06 shapes refused)', () => {
  const REFUSED: ReadonlyArray<{ label: string; source: string; code: string }> = [
    {
      label: 'component reference',
      source:
        'function Row(props) { return <li>{props.text}</li>; }\nfunction C(props) { return <Row text="x" />; }\n',
      code: 'OEIR_LEAF_UNSUPPORTED_NODE',
    },
    {
      label: 'children projection',
      source: 'function C(props) { return <section>{props.children}</section>; }\n',
      code: 'OEIR_LEAF_UNSUPPORTED_NODE',
    },
    {
      label: 'event attribute',
      source: 'function C(props) { return <button onClick={() => props.onHit()}>go</button>; }\n',
      code: 'OEIR_LEAF_UNSUPPORTED_ATTRIBUTE',
    },
    {
      label: 'class channel attribute',
      source: 'function C(props) { return <div class={props.className}></div>; }\n',
      code: 'OEIR_LEAF_UNSUPPORTED_ATTRIBUTE',
    },
    {
      label: 'style channel attribute',
      source: 'function C(props) { return <div style={props.style}></div>; }\n',
      code: 'OEIR_LEAF_UNSUPPORTED_ATTRIBUTE',
    },
    {
      label: 'nested recipe (JSX in expression)',
      source:
        'function C(props) { return <main title={props.ok ? <b>a</b> : <i>b</i>}></main>; }\n',
      code: 'OEIR_LEAF_UNSUPPORTED_RECIPE',
    },
    {
      label: 'static javascript: URL',
      source: 'function C(props) { return <a href="javascript:alert(1)">x</a>; }\n',
      code: 'OEIR_LEAF_UNSAFE_ATTRIBUTE',
    },
  ];
  for (const entry of REFUSED) {
    test(`refuses ${entry.label}`, () => {
      const result = generate(entry.source);
      expect(result.module).toBeNull();
      expect(codes(result)).toContain(entry.code);
    });
  }

  test('a reserved generated-namespace binding fails closed', () => {
    const front = compileFunctionModule(
      `import { signal } from '@openelement/element';
function C(props) { const __oe_count = signal(0); return <p>{__oe_count.value}</p>; }
`,
      FILE,
      { importClassifier: CLASSIFIER },
    );
    expect(front.diagnostics).toEqual([]);
    const result = generateLeafModule(front.module!);
    expect(result.module).toBeNull();
    expect(codes(result)).toContain('OEIR_LEAF_INVALID_BINDING');
  });

  test('a module without a component fails closed', () => {
    const front = compileFunctionModule('export const value = 1;\n', FILE);
    expect(front.module).toBeNull();
    // The frontend already fails closed; the generator's direct guard is tested
    // through a synthetic empty module shape.
    const result = generateLeafModule({
      file: FILE,
      components: [],
      expressions: { expressions: [] } as never,
    });
    expect(result.module).toBeNull();
    expect(codes(result)).toContain('OEIR_LEAF_MISSING_COMPONENT');
  });

  test('the generator is not exported from the package entry', () => {
    const entry = readFileSync(new URL('../../src/compiler.ts', import.meta.url), 'utf8');
    expect(entry).not.toContain('generated-leaf');
    expect(entry).not.toContain('generateLeafModule');
  });

  test('the generator source contains no production wiring or class-frontend call', () => {
    const source = readFileSync(
      new URL(
        '../../src/internal/compiler/semantic-ir/generated-leaf/generate.ts',
        import.meta.url,
      ),
      'utf8',
    );
    expect(source).not.toMatch(/compileElementProgram\s*\(/);
    expect(source).not.toMatch(
      /from '\.\.\/\.\.\/semantic-core\/(compile|lower-program|emit-program)/,
    );
    expect(source).not.toMatch(/PartProgram/);
    expect(source).not.toMatch(/__partProgram/);
  });
});
