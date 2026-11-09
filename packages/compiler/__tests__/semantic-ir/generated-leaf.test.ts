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
  const front = compileFunctionModule(source, FILE, {
    importClassifier: CLASSIFIER,
  });
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
  test('emits one module-level mount + delegating createRecipe factory per component', () => {
    const result = generate(COUNTER);
    expect(result.module).not.toBeNull();
    const module = result.module!;
    expect(module).toContain(`from ${JSON.stringify(GENERATED_LEAF_RUNTIME_SPECIFIER)}`);
    // The body lives in the module-level mount (M06b1a-1) ...
    expect(module).toContain('function Counter__mount(__oe_scope, __oe_props, __oe_host) {');
    expect(module).toContain('const props = __oe_props;');
    // ... and the pinned factory keeps its name/signature and delegates.
    expect(module).toContain('export function createCounterRecipe(');
    expect(module).toContain('createRecipe({');
    expect(module).toContain('mount(__oe_scope) {');
    expect(module).toContain('return Counter__mount(__oe_scope, __oe_host.props, __oe_mountHost);');
    expect(module).toContain('bindSignalWrites(__oe_scope, count, "count"');
    expect(module).toContain('bindSignalWrites(__oe_scope, doubled, "doubled"');
    expect(module).toContain('displayValue(');
    expect(module).toContain('attributeValueOf(');
    expect(module).toContain('document.createElement("section")');
    // Host contract: props plus the signal/computed bindings.
    expect(result.requiredProps).toEqual(['props']);
    expect(result.requiredBindings).toEqual(['count', 'doubled']);
    expect(result.requiresPropsChanged).toBe(true);
    // Root props refresh: propDeps = [host.propsChanged]; the missing-host throw
    // stays at factory creation (OEIR_LEAF_MISSING_VALUE contract preserved).
    expect(module).toContain(
      'const __oe_propsChanged = __oe_host.propsChanged; if (__oe_propsChanged === undefined) throw new Error("OEIR_LEAF_MISSING_VALUE: propsChanged");',
    );
    expect(module).toContain(
      'const __oe_mountHost = { bindings: __oe_host.bindings, propDeps: [__oe_propsChanged] };',
    );
    expect(module).toContain(
      'for (const __oe_propDep of __oe_host.propDeps) bindSignalWrites(__oe_scope, __oe_propDep, "props"',
    );
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

describe('M06b1a-1 — module-level mounts and module-local component references', () => {
  const NESTED = `function Row(props) { return <li>{props.text}</li>; }
function C(props) { return <ul><Row text="x" /><Row text={props.label} /></ul>; }
`;

  test('one body per component: <Child>__mount defined once, called from the parent', () => {
    const result = generate(NESTED);
    expect(result.module).not.toBeNull();
    const module = result.module!;
    // One module-level mount per component, however often it is referenced.
    expect(module.match(/^function Row__mount\(/gm)?.length).toBe(1);
    expect(module.match(/^function C__mount\(/gm)?.length).toBe(1);
    // One exported root factory per component; the pinned `create<Name>Recipe`
    // name pattern is exactly what the browser harness extracts.
    expect(module.match(/^export function create\w+Recipe\(/gm)?.length).toBe(2);
    expect(module).toContain('export function createRowRecipe(__oe_owner, __oe_host) {');
    expect(module).toContain('export function createCRecipe(__oe_owner, __oe_host) {');
    // The parent calls the child mount directly ...
    expect(module.match(/Row__mount\(__oe_childScope/g)?.length).toBe(2);
    // ... on a fresh child scope of the defining (parent) mount scope.
    expect(module).toContain('const __oe_childScope1 = __oe_scope.child();');
    expect(module).toContain('const __oe_childScope2 = __oe_scope.child();');
  });

  test('child props are a per-read getter record over the parent scope', () => {
    const module = generate(NESTED).module!;
    expect(module).toContain('const __oe_childProps1 = {');
    // Static prop: literal data property (no scope read, no dependency).
    expect(module).toContain('text: "x",');
    // Dynamic prop: a getter over the DEFINING scope, never a cached value.
    expect(module).toContain('get text() { return (props . label); },');
    expect(module).not.toMatch(/const\s+text\s*=/);
    // A passed parent prop resolves to the parent's own props channel.
    expect(module).toContain(
      'const __oe_childHost2 = { bindings: __oe_host.bindings, propDeps: [...__oe_host.propDeps] };',
    );
  });

  test('the child refresh channel is the defining-scope read of each passed prop', () => {
    const module = generate(`import { signal } from '@openelement/element';
function Row(props) { return <li>{props.text}</li>; }
function C(props) { const label = signal('a'); return <Row text={label.value} />; }
`).module!;
    // The passed prop reads the parent signal: the child subscribes to it.
    expect(module).toContain(
      'const __oe_childHost0 = { bindings: __oe_host.bindings, propDeps: [label] };',
    );
    // Parent prologue declares the binding exactly like any other read.
    expect(module).toContain('const __oe_requireBinding = (name) =>');
    expect(module).toContain('const label = __oe_requireBinding("label");');
  });

  test('mixed intrinsic/component siblings keep authored order', () => {
    const module = generate(
      'function Row(props) { return <li>{props.text}</li>; }\nfunction C(props) { return <section><h1>a</h1><Row text="x" /><p>b</p></section>; }\n',
    ).module!;
    const heading = module.indexOf('document.createElement("h1")');
    const child = module.indexOf('Row__mount(__oe_childScope');
    const paragraph = module.indexOf('document.createElement("p")');
    expect(heading).toBeGreaterThanOrEqual(0);
    expect(child).toBeGreaterThan(heading);
    expect(paragraph).toBeGreaterThan(child);
    // The parent appends the child's returned nodes to the enclosing element.
    expect(module).toContain(
      'for (const __oe_child of __oe_childNodes3) __oe_el0.appendChild(__oe_child);',
    );
  });

  test('a component-reference instance owns a child scope and cleans up its range', () => {
    const module = generate(
      'function Row(props) { return <li>{props.text}</li>; }\nfunction C(props) { return <Row text="x" />; }\n',
    ).module!;
    expect(module).toContain('const __oe_childScope0 = __oe_scope.child();');
    expect(module).toContain('try {');
    expect(module).toContain('} catch (error) { __oe_childScope0.dispose(true); throw error; }');
    expect(module).toContain(
      '__oe_childScope0.addRangeCleanup(() => removeNodes(__oe_childNodes0));',
    );
  });

  test('key on a component reference is list identity, never a DOM write or a child prop', () => {
    const module = generate(`import { signal } from '@openelement/element';
function Row(props) { return <li>{props.text}</li>; }
function C(props) {
  const items = signal([]);
  return <ul>{items.value.map((item) => <Row key={item.id} text={item.label} />)}</ul>;
}
`).module!;
    // The enclosing list consumes the key thunk; the child never receives it.
    expect(module).toContain('function __oe_eachKey1(');
    expect(module).not.toContain('get key()');
    expect(module).not.toMatch(/setAttribute\("key"/);
    expect(module).toContain('Row__mount(__oe_childScope');
  });

  test('module host contract unions the child props channel', () => {
    const result = generate(NESTED);
    // Row's props reads are the module's props channel; the parent passes them.
    expect(result.requiredProps).toEqual(['props']);
    expect(result.requiredBindings).toEqual([]);
    expect(result.requiresPropsChanged).toBe(true);
  });

  test('nested-component output is deterministic', () => {
    expect(generate(NESTED).module).toBe(generate(NESTED).module);
  });
});

describe('M05 leaf v2 — fail-closed boundary (M05b/M06 shapes refused)', () => {
  const REFUSED: ReadonlyArray<{
    label: string;
    source: string;
    code: string;
  }> = [
    {
      label: 'component reference to a name outside the module',
      source: 'function C(props) { return <External text="x" />; }\n',
      code: 'OEIR_LEAF_UNKNOWN_COMPONENT',
    },
    {
      label: 'component reference to a destructured-props child',
      source:
        'function Row({ text }) { return <li>{text}</li>; }\nfunction C(props) { return <Row text="x" />; }\n',
      code: 'OEIR_LEAF_UNSUPPORTED_COMPONENT',
    },
    {
      label: 'component reference to a child that owns signal/computed resources',
      source:
        'import { signal } from "@openelement/element";\nfunction Row(props) { const n = signal(0); return <li>{n.value}</li>; }\nfunction C(props) { return <Row />; }\n',
      code: 'OEIR_LEAF_UNSUPPORTED_COMPONENT',
    },
    {
      label: 'event channel as a component prop',
      source:
        'function Row(props) { return <li>{props.text}</li>; }\nfunction C(props) { return <Row onHit={() => props.text} />; }\n',
      code: 'OEIR_LEAF_UNSUPPORTED_ATTRIBUTE',
    },
    {
      label: 'class channel as a component prop',
      source:
        'function Row(props) { return <li>{props.text}</li>; }\nfunction C(props) { return <Row class={props.text} />; }\n',
      code: 'OEIR_LEAF_UNSUPPORTED_ATTRIBUTE',
    },
    {
      label: 'children prop on a component reference',
      source:
        'function Row(props) { return <li>{props.text}</li>; }\nfunction C(props) { return <Row children="x" />; }\n',
      code: 'OEIR_LEAF_UNSUPPORTED_COMPONENT',
    },
    {
      label: 'style channel as a component prop',
      source:
        'function Row(props) { return <li>{props.text}</li>; }\nfunction C(props) { return <Row style={props.text} />; }\n',
      code: 'OEIR_LEAF_UNSUPPORTED_ATTRIBUTE',
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
