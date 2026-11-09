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

  test('M07a emits a structural claim for a static leaf and omits it for later shapes', () => {
    const leaf = generate(COUNTER);
    expect(leaf.module).not.toBeNull();
    const module = leaf.module!;
    expect(module).toContain(
      'function Counter__claim(__oe_scope, __oe_props, __oe_host, __oe_parent)',
    );
    expect(module).toContain('OEIR_LEAF_CLAIM_MISMATCH');
    expect(module).toContain(
      'return Counter__claim(__oe_scope, __oe_host.props, __oe_mountHost, __oe_parent);',
    );
    expect(module).toContain('claim(__oe_scope, __oe_props, __oe_parent)');
    // Mount stays the fresh-DOM path.
    expect(module).toContain('document.createElement("section")');
    expect(module).toContain('return Counter__mount(__oe_scope, __oe_host.props, __oe_mountHost);');

    const conditional = generate(
      'function C(props) { return <section>{props.ok ? <p>on</p> : <em>off</em>}</section>; }\n',
    );
    expect(conditional.module).not.toBeNull();
    expect(conditional.module).not.toContain('function C__claim');
    expect(conditional.module).not.toContain('claim(__oe_scope');

    const listed = generate(
      `import { signal } from '@openelement/element';
function List(props) {
  const items = signal([{ id: 'a', label: 'A' }]);
  return <ul>{items.value.map((item) => <li key={item.id}>{item.label}</li>)}</ul>;
}
`,
    );
    expect(listed.module).not.toBeNull();
    expect(listed.module).not.toContain('function List__claim');

    // Property assignment can overwrite a pre-claim input value. M07a leaves it mount-only.
    const property = generate('function Field(props) { return <input value={props.text} />; }\n');
    expect(property.module).not.toBeNull();
    expect(property.module).toContain('document.createElement("input")');
    expect(property.module).not.toContain('function Field__claim');
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

  test('key on a component reference is identity only, never a DOM write or a child prop', () => {
    const module = generate(
      'function Row(props) { return <li>{props.text}</li>; }\nfunction C(props) { return <Row key="row-1" text="x" />; }\n',
    ).module!;
    // `key` is consumed as identity: no prop getter/data property, no DOM write.
    expect(module).not.toContain('get key()');
    expect(module).not.toContain('"row-1"');
    expect(module).not.toMatch(/setAttribute\("key"/);
    expect(module).toContain('text: "x",');
    expect(module).toContain('Row__mount(__oe_childScope');
  });

  test('a component-reference cycle is refused with its cycle path (OEIR_LEAF_COMPONENT_CYCLE)', () => {
    const mutual = generate(
      'function A(props) { return <B />; }\nfunction B(props) { return <A />; }\nfunction Root(props) { return <A />; }\n',
    );
    expect(mutual.module).toBeNull();
    expect(codes(mutual)).toEqual(['OEIR_LEAF_COMPONENT_CYCLE']);
    expect(mutual.diagnostics[0]!.message).toContain('component reference cycle: A -> B -> A');
    const self = generate('function S(props) { return <S />; }\n');
    expect(self.module).toBeNull();
    expect(codes(self)).toEqual(['OEIR_LEAF_COMPONENT_CYCLE']);
    expect(self.diagnostics[0]!.message).toContain('component reference cycle: S -> S');
  });

  test('a component reference inside a list entry template is refused (needs the M06b1b child update hook)', () => {
    const result = generate(`import { signal } from '@openelement/element';
function Item(props) { return <li>{props.text}</li>; }
function List(props) {
  const items = signal([]);
  return <ul>{items.value.map((item) => <li><Item text={item.text} /></li>)}</ul>;
}
`);
    expect(result.module).toBeNull();
    expect(codes(result)).toEqual(['OEIR_LEAF_UNSUPPORTED_COMPONENT']);
    expect(result.diagnostics[0]!.message).toContain('needs the child update hook (M06b1b)');
    // A condition nested under the list template is still inside it.
    const nested = generate(`import { signal } from '@openelement/element';
function Item(props) { return <li>{props.text}</li>; }
function List(props) {
  const items = signal([]);
  return <ul>{items.value.map((item) => <li>{props.ok ? <Item text="a" /> : null}</li>)}</ul>;
}
`);
    expect(nested.module).toBeNull();
    expect(codes(nested)).toEqual(['OEIR_LEAF_UNSUPPORTED_COMPONENT']);
  });

  test('component references in condition branches stay admitted', () => {
    const result = generate(
      'function Item(props) { return <li>{props.text}</li>; }\nfunction C(props) { return <ul>{props.ok ? <Item text="a" /> : <Item text="b" />}</ul>; }\n',
    );
    expect(result.module).not.toBeNull();
    expect(result.module!.match(/Item__mount\(__oe_childScope/g)?.length).toBe(2);
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

describe('M06b1a-2 — reusable JSX values: one recipe per value, one projection per site', () => {
  const RECIPE_TREE = `import { signal } from '@openelement/element';
function Chip(props) {
  const tone = signal('blue');
  const chip = <i class="chip" title={tone.value}>{tone.value}</i>;
  return <div><b>a</b>{chip}<span>{chip}</span></div>;
}
`;

  test('the model links a direct JSX initializer to its recipe and `{name}` slots to sites', () => {
    const front = compileFunctionModule(RECIPE_TREE, FILE, {
      importClassifier: CLASSIFIER,
    });
    expect(front.diagnostics).toEqual([]);
    const component = front.module!.components[0]!;
    const chip = component.resources.find((resource) => resource.name === 'chip')!;
    expect(chip.kind).toBe('local');
    expect(chip.expression).toBeNull();
    expect(chip.recipeId).toBe('#recipe0');
    // A non-JSX declaration carries no recipe link.
    expect(component.resources.find((resource) => resource.name === 'tone')!.recipeId).toBeNull();
    expect(component.recipes.map((recipe) => recipe.id)).toEqual(['#recipe0']);
    const sites: string[] = [];
    const walk = (nodes: readonly ReturnType<typeof component.roots>[number][]): void => {
      for (const node of nodes) {
        if (node.kind === 'insertion-site') sites.push(node.recipeId);
        else if (node.kind === 'element' || node.kind === 'fragment') walk(node.children);
      }
    };
    walk(component.roots);
    expect(sites).toEqual(['#recipe0', '#recipe0']);
  });

  test('one createRecipe per referenced value and one insertRecipe per insertion site', () => {
    const result = generate(RECIPE_TREE);
    expect(result.module).not.toBeNull();
    const module = result.module!;
    // One recipe + the pinned root factory both call createRecipe.
    expect(module.match(/createRecipe\(/g)?.length).toBe(2);
    expect(module).toContain('definitionOwner: __oe_scope,');
    expect(module).toContain(`source: ${JSON.stringify(`${FILE}#Chip:recipe0`)},`);
    // Two `{chip}` slots: two projections of the SAME recipe variable.
    expect(module.match(/insertRecipe\(/g)?.length).toBe(2);
    expect(module.match(/insertRecipe\(__oe_scope, __oe_recipe0, /g)?.length).toBe(2);
    expect(module.match(/document\.createDocumentFragment\(\)/g)?.length).toBe(2);
    // Each projection's nodes are spread into the enclosing element (two
    // distinct projection handles, never a shared/moved region).
    const projections = [...module.matchAll(/const (__oe_projection\d+) = insertRecipe\(/g)].map(
      (match) => match[1],
    );
    expect(projections).toHaveLength(2);
    expect(new Set(projections).size).toBe(2);
    expect(
      module.match(/for \(const __oe_child of __oe_projection\d+\.nodes\) __oe_el\d+\.appendChild/g)
        ?.length,
    ).toBe(2);
  });

  test('recipe bodies stay inline in the component chunk and bind refresh on the recipe scope', () => {
    const module = generate(RECIPE_TREE).module!;
    expect(module.match(/mount\(__oe_recipeScope\d+\) \{/g)?.length).toBe(1);
    expect(module).toContain('const __oe_recipeNodes');
    expect(module).toContain('return __oe_recipeNodes');
    // The dynamic text inside the recipe target subscribes on the recipe
    // instance scope, not on the component mount scope.
    // Both the recipe attribute and its text child read `tone`, each with its
    // own refresh closure bound on the recipe instance scope.
    expect(module.match(/bindSignalWrites\(__oe_recipeScope\d+, tone, "tone"/g)?.length).toBe(2);
  });

  test('mixed intrinsic/insertion siblings keep authored order in the sink', () => {
    const module = generate(`import { signal } from '@openelement/element';
function C(props) {
  const chip = <i>c</i>;
  return <div><b>b</b>{chip}<u>u</u></div>;
}
`).module!;
    const before = module.indexOf('document.createElement("b")');
    const insertion = module.indexOf('insertRecipe(');
    const after = module.indexOf('document.createElement("u")');
    expect(before).toBeGreaterThanOrEqual(0);
    expect(insertion).toBeGreaterThan(before);
    expect(after).toBeGreaterThan(insertion);
  });

  test('a recipe target may be a component reference (M06b1a-1 prop rules apply)', () => {
    const result = generate(`function Row(props) { return <li>{props.text}</li>; }
function C(props) { const row = <Row text={props.label} />; return <ul>{row}{row}</ul>; }
`);
    expect(result.module).not.toBeNull();
    const module = result.module!;
    // The recipe body calls the child mount on a fresh child scope of the
    // recipe scope (the recipe instance owns the child instance).
    expect(module.match(/mount\(__oe_recipeScope\d+\) \{/g)?.length).toBe(1);
    expect(
      module.match(/const __oe_childScope\d+ = __oe_recipeScope\d+\.child\(\);/g)?.length,
    ).toBe(1);
    expect(
      module.match(
        /__oe_childNodes\d+ = Row__mount\(__oe_childScope\d+, __oe_childProps\d+, __oe_childHost\d+\)/g,
      )?.length,
    ).toBe(1);
    // Props stay per-read getters over the DEFINING mount scope, never cached.
    expect(module).toContain('get text() { return (props . label); },');
    // The child refresh channel is the defining-scope dependency set supplied by
    // the defining component's mount host.
    expect(module).toContain('propDeps: [...__oe_host.propDeps]');
    expect(result.requiredProps).toEqual(['props']);
    expect(result.requiresPropsChanged).toBe(true);
    expect(module.match(/insertRecipe\(__oe_scope, __oe_recipe0, /g)?.length).toBe(2);
  });

  test('insertion sites in condition branches and list entries use their live descendant scope', () => {
    const result = generate(`import { signal } from '@openelement/element';
function C(props) {
  const chip = <b>a</b>;
  const items = signal([1]);
  return <div>{props.ok ? <p>{chip}</p> : <i>{chip}</i>}<ul>{items.value.map((it) => <li>{chip}</li>)}</ul></div>;
}
`);
    expect(result.module).not.toBeNull();
    const module = result.module!;
    // One recipe, three projections, each on the owner of its generated builder
    // (a live descendant of the definition owner, so M04 lineage admits it).
    expect(module.match(/createRecipe\(/g)?.length).toBe(2);
    expect(module.match(/insertRecipe\(/g)?.length).toBe(3);
    expect(module).toMatch(/insertRecipe\(__oe_whenThenScope\d+, __oe_recipe0, /);
    expect(module).toMatch(/insertRecipe\(__oe_whenElseScope\d+, __oe_recipe0, /);
    expect(module).toMatch(/insertRecipe\(__oe_eachScope\d+, __oe_recipe0, /);
  });

  test('a declaration no insertion site reaches emits no recipe', () => {
    const result = generate(
      'function C(props) { const unused = <i>u</i>; return <p>plain</p>; }\n',
    );
    expect(result.module).not.toBeNull();
    // Only the root factory's createRecipe: the reusable value is never inserted.
    expect(result.module!.match(/createRecipe\(/g)?.length).toBe(1);
    // `insertRecipe` is imported unconditionally; no site may CALL it.
    expect(result.module).not.toMatch(/insertRecipe\(/);
  });

  test('a list mapper parameter shadows a same-named component recipe', () => {
    const result = generate(`import { signal } from '@openelement/element';
function C(props) {
  const x = <b>recipe</b>;
  const items = signal([]);
  return <div><ul>{items.value.map((x) => <li>{x}</li>)}</ul></div>;
}
`);
    expect(result.module).not.toBeNull();
    const module = result.module!;
    // The `{x}` slot reads the ENTRY, never the component-scope reusable value.
    expect(module).toContain('displayValue((x))');
    expect(module).not.toMatch(/insertRecipe\(/);
    expect(module.match(/createRecipe\(/g)?.length).toBe(1);
  });

  test('generated recipe modules are deterministic and parse as JavaScript', () => {
    const first = generate(RECIPE_TREE).module!;
    expect(generate(RECIPE_TREE).module).toBe(first);
    const source = ts.createSourceFile(
      'leaf.js',
      first,
      ts.ScriptTarget.ES2022,
      true,
      ts.ScriptKind.JS,
    );
    const parseDiagnostics =
      (source as unknown as { parseDiagnostics?: readonly unknown[] }).parseDiagnostics ?? [];
    expect(parseDiagnostics).toHaveLength(0);
  });

  test('JSX inside a non-initializer expression still fails closed (superseded whole-component refusal)', () => {
    // The M06b1a-1 whole-component `OEIR_LEAF_UNSUPPORTED_RECIPE` refusal is
    // superseded by the admitted path above; the code now pins only the
    // non-direct-initializer boundary: the lowered text still carries the M02
    // `__oe_recipe_ref` placeholder and no recipe is defined for it.
    const result = generate(
      'function C(props) { return <main title={props.ok ? <b>a</b> : <i>b</i>}></main>; }\n',
    );
    expect(result.module).toBeNull();
    expect(codes(result)).toEqual(['OEIR_LEAF_UNSUPPORTED_RECIPE']);
    expect(result.diagnostics[0]!.message).toContain('recipe reference');
  });

  test('a reusable JSX value read as an expression value fails closed', () => {
    const result = generate(
      'function C(props) { const x = <b>a</b>; return <p>{x && <i>y</i>}</p>; }\n',
    );
    expect(result.module).toBeNull();
    expect(codes(result)).toEqual(['OEIR_LEAF_UNSUPPORTED_RECIPE']);
    expect(result.diagnostics[0]!.message).toContain('projected with {x}');
  });

  test('children projection inside a recipe target fails closed', () => {
    const result = generate(
      'function C(props) { const x = <div>{props.children}</div>; return <p>{x}</p>; }\n',
    );
    expect(result.module).toBeNull();
    expect(codes(result)).toEqual(['OEIR_LEAF_UNSUPPORTED_NODE']);
    expect(result.diagnostics[0]!.message).toContain('children projection');
  });

  test('a recipe cycle is refused with its path and a coded diagnostic', () => {
    const self = generate('function C(props) { const x = <div>{x}</div>; return <p>{x}</p>; }\n');
    expect(self.module).toBeNull();
    expect(codes(self)).toEqual(['OEIR_LEAF_RECIPE_CYCLE']);
    expect(self.diagnostics[0]!.message).toContain(
      'recipe insertion cycle: C#recipe0 -> C#recipe0',
    );
    // A component reached through a recipe target closes the same cycle.
    const throughComponent = generate(
      'function A(props) { const x = <A />; return <div>{x}</div>; }\n',
    );
    expect(throughComponent.module).toBeNull();
    expect(codes(throughComponent)).toEqual(['OEIR_LEAF_RECIPE_CYCLE']);
    expect(throughComponent.diagnostics[0]!.message).toContain(
      'recipe insertion cycle: A -> A#recipe0 -> A',
    );
    // Mutually inserted recipes are still one cycle path.
    const mutual = generate(
      'function C(props) { const a = <div>{b}</div>; const b = <span>{a}</span>; return <p>{a}</p>; }\n',
    );
    expect(mutual.module).toBeNull();
    expect(codes(mutual)).toEqual(['OEIR_LEAF_RECIPE_CYCLE']);
    expect(mutual.diagnostics[0]!.message).toContain(
      'recipe insertion cycle: C#recipe0 -> C#recipe1 -> C#recipe0',
    );
  });
});

describe('M06b2a — component children projection: one children recipe per ref site', () => {
  const FRAME = `function Frame(props) { return <div>{props.children}</div>; }
function C(props) { return <Frame><b>x</b></Frame>; }
`;
  const CHILDREN_TREE = `import { signal } from '@openelement/element';
function Frame(props) { return <section>{props.children}</section>; }
function C(props) {
  const n = signal(1);
  return <Frame><b>{props.label}</b>{n.value}</Frame>;
}
`;

  test('the model links `<Frame>…</Frame>` to one children fragment recipe', () => {
    const front = compileFunctionModule(FRAME, FILE, { importClassifier: CLASSIFIER });
    expect(front.diagnostics).toEqual([]);
    const [frame, c] = front.module!.components;
    // The child component has no reusable JSX values of its own.
    expect(frame!.recipes).toEqual([]);
    expect(c!.recipes.map((recipe) => [recipe.id, recipe.target.kind])).toEqual([
      ['#children0', 'fragment'],
    ]);
    const ref = c!.roots[0]!;
    expect(ref.kind).toBe('component-ref');
    if (ref.kind !== 'component-ref') throw new Error('unreachable');
    expect(ref.name).toBe('Frame');
    // A recipe id, never a data prop: the children channel is the recipe link.
    expect(ref.childrenRecipeId).toBe('#children0');
    expect(ref.props).toEqual([]);
    const frameRoot = frame!.roots[0]!;
    expect(frameRoot.kind).toBe('element');
    if (frameRoot.kind !== 'element') throw new Error('unreachable');
    // The child's `{props.children}` slot is a projection node, not an expression.
    expect(frameRoot.children.map((node) => node.kind)).toEqual(['children-projection']);
  });

  test('emits the children recipe once per ref site and passes it as props.children', () => {
    const result = generate(FRAME);
    expect(result.module).not.toBeNull();
    const module = result.module!;
    // Two root factories + the one children recipe.
    expect(module.match(/createRecipe\(/g)?.length).toBe(3);
    // Definition site = the mount scope the ref is emitted in, one per ref site.
    expect(module).toContain(`source: ${JSON.stringify(`${FILE}#C:children0`)},`);
    expect(module.match(/const __oe_recipe0 = createRecipe\(\{/g)?.length).toBe(1);
    expect(
      module.match(/definitionOwner: __oe_scope,\n {4}source: ".*#C:children0",/g)?.length,
    ).toBe(1);
    // The props record carries the recipe as a plain property (a recipe channel,
    // never a per-read getter and never a data attribute).
    expect(module).toMatch(/const __oe_childProps\d+ = \{\n {4}children: __oe_recipe0,/);
    expect(module).not.toMatch(/get children\(\)/);
    // The children recipe body builds the authored fragment nodes.
    expect(module).toMatch(
      /mount\(__oe_recipeScope\d+\) \{\n {6}const __oe_recipeNodes\d+ = \[\];/,
    );
    expect(module).toContain('document.createElement("b")');
    // The child mount receives the record.
    expect(module).toMatch(
      /Frame__mount\(__oe_childScope\d+, __oe_childProps\d+, __oe_childHost\d+\)/,
    );
  });

  test('one mount-level props.children read, projected once per site', () => {
    const result = generate(`function Frame(props) {
  return <><section>{props.children}</section><aside>{props.children}</aside></>;
}
function C(props) { return <Frame><i>a</i><b>b</b></Frame>; }
`);
    expect(result.module).not.toBeNull();
    const module = result.module!;
    // One read + one coded host/root check per mount, however many sites.
    expect(module.match(/const __oe_childrenRecipe = __oe_props\.children;/g)?.length).toBe(1);
    expect(module.match(/OEIR_LEAF_MISSING_CHILDREN/g)?.length).toBe(1);
    // Two sites: two projections of the SAME recipe variable ...
    expect(module.match(/insertRecipe\(__oe_scope, __oe_childrenRecipe, /g)?.length).toBe(2);
    const projections = [
      ...module.matchAll(/const (__oe_childrenProjection\d+) = insertRecipe\(/g),
    ].map((match) => match[1]);
    expect(projections).toHaveLength(2);
    expect(new Set(projections).size).toBe(2);
    // ... spread into two distinct element sinks (independent regions/owners).
    expect(
      module.match(
        /for \(const __oe_child of __oe_childrenProjection\d+\.nodes\)\n?\s*__oe_el\d+\.appendChild/g,
      )?.length,
    ).toBe(2);
  });

  test('dynamic children content refreshes on the recipe scope, not the child mount scope', () => {
    const result = generate(CHILDREN_TREE);
    expect(result.module).not.toBeNull();
    const module = result.module!;
    // A defining-scope signal read inside the children fragment.
    expect(module).toMatch(/bindSignalWrites\(__oe_recipeScope\d+, n, "n"/);
    // A defining-component props read inside the children fragment refreshes
    // through the parent host's propDeps, still bound on the recipe instance.
    expect(module).toMatch(
      /for \(const __oe_propDep of __oe_host\.propDeps\) bindSignalWrites\(__oe_recipeScope\d+, __oe_propDep, "props"/,
    );
    // The recipe scope is the one handed to the recipe mount, never the child
    // component's own mount scope.
    const recipeScope = module.match(/mount\((__oe_recipeScope\d+)\)/)?.[1];
    expect(recipeScope).toBeDefined();
    expect(module).not.toMatch(new RegExp(`bindSignalWrites\\(__oe_childScope\\d+, n, "n"`));
    expect(result.requiresPropsChanged).toBe(true);
    expect(result.requiredProps).toEqual(['props']);
    expect(result.requiredBindings).toEqual(['n']);
  });

  test('the recipe body mounts a component reference on a child of the recipe scope', () => {
    const result = generate(`function Row(props) { return <li>{props.text}</li>; }
function Frame(props) { return <ul>{props.children}</ul>; }
function C(props) { return <Frame><Row text={props.label} /></Frame>; }
`);
    expect(result.module).not.toBeNull();
    const module = result.module!;
    // The Row instance is owned by the children recipe instance: its scope is a
    // child of the recipe scope (a live descendant of C's mount scope).
    expect(module).toMatch(/const __oe_childScope\d+ = __oe_recipeScope\d+\.child\(\);/);
    expect(module).toMatch(
      /Row__mount\(__oe_childScope\d+, __oe_childProps\d+, __oe_childHost\d+\)/,
    );
    // The passed prop getter reads the DEFINING (C) scope.
    expect(module).toContain('get text() { return (props . label); },');
  });

  test('projections in condition/list builders use their live descendant scopes', () => {
    const result = generate(`function Frame(props) {
  return <div>{props.ok ? <p>{props.children}</p> : null}<ul>{props.items.map((it) => <li>{props.children}</li>)}</ul></div>;
}
function C(props) { return <Frame ok={props.ok} items={props.items}><b>x</b></Frame>; }
`);
    expect(result.module).not.toBeNull();
    const module = result.module!;
    // A branch builder's scope and a list-entry owner are fresh descendants of
    // the child instance scope handed to their builder, so M04 lineage admits
    // the projection; each site still inserts the SAME mount-level recipe.
    expect(module).toMatch(/insertRecipe\(__oe_whenThenScope\d+, __oe_childrenRecipe, /);
    expect(module).toMatch(/insertRecipe\(__oe_eachScope\d+, __oe_childrenRecipe, /);
    expect(module).not.toMatch(/insertRecipe\(__oe_scope, __oe_childrenRecipe, /);
  });

  test('multiple children in one fragment keep authored order', () => {
    const result = generate(
      'function Frame(props) { return <div>{props.children}</div>; }\nfunction C(props) { return <Frame><i>a</i><b>b</b></Frame>; }\n',
    );
    expect(result.module).not.toBeNull();
    const module = result.module!;
    const italic = module.indexOf('document.createElement("i")');
    const bold = module.indexOf('document.createElement("b")');
    expect(italic).toBeGreaterThanOrEqual(0);
    expect(bold).toBeGreaterThan(italic);
    // The recipe returns the fragment nodes in authored order.
    expect(module).toMatch(
      /__oe_recipeNodes\d+\.push\(__oe_el\d+\);\n {6}__oe_recipeNodes\d+\.push\(__oe_el\d+\);/,
    );
  });

  test('children passed to a component that does not project them are admitted (unused channel)', () => {
    const result = generate(`function Plain(props) { return <div>plain</div>; }
function C(props) { return <Plain><b>x</b></Plain>; }
`);
    expect(result.module).not.toBeNull();
    // The recipe is still emitted and passed; only projection needs a site.
    expect(result.module).toContain(`source: ${JSON.stringify(`${FILE}#C:children0`)},`);
    expect(result.module).toMatch(/const __oe_childProps\d+ = \{\n {4}children: __oe_recipe\d+,/);
    expect(result.module).not.toMatch(/insertRecipe\(/);
  });

  test('a host-supplied root instance must pass a real children recipe (coded runtime check)', () => {
    const result = generate('function Frame(props) { return <div>{props.children}</div>; }\n');
    expect(result.module).not.toBeNull();
    const module = result.module!;
    // The root factory mounts with host.props; a plain value must fail coded
    // instead of rendering nothing: the check pins the recipe shape.
    expect(module).toContain('const __oe_childrenRecipe = __oe_props.children;');
    expect(module).toContain(
      'if (__oe_childrenRecipe == null || typeof __oe_childrenRecipe !== "object" || typeof __oe_childrenRecipe.mount !== "function" || __oe_childrenRecipe.definitionOwner == null) throw new Error("OEIR_LEAF_MISSING_CHILDREN: component \'<Frame>\' projects props.children but the mounted instance was given no children recipe");',
    );
  });

  test('a reference to a children-projecting component without JSX children fails closed', () => {
    const result = generate(
      'function Frame(props) { return <div>{props.children}</div>; }\nfunction C(props) { return <Frame />; }\n',
    );
    expect(result.module).toBeNull();
    expect(codes(result)).toEqual(['OEIR_LEAF_MISSING_CHILDREN']);
    expect(result.diagnostics[0]!.message).toContain('passes no JSX children');
  });

  test('nested children (a children-projecting ref inside a children recipe body) fail closed', () => {
    const result = generate(`function Frame(props) { return <div>{props.children}</div>; }
function Parent(props) { return <section>{props.children}</section>; }
function C(props) { return <Frame><Parent><b>x</b></Parent></Frame>; }
`);
    expect(result.module).toBeNull();
    expect(codes(result)).toEqual(['OEIR_LEAF_UNSUPPORTED_CHILDREN']);
    expect(result.diagnostics[0]!.message).toContain('inside a reusable JSX value body');
  });

  test('a cycle through a children recipe is refused with its path and a coded diagnostic', () => {
    const result = generate(`function A(props) { return <div>{props.children}</div>; }
function B(props) { return <span><A><B /></A></span>; }
`);
    expect(result.module).toBeNull();
    expect(codes(result)).toEqual(['OEIR_LEAF_RECIPE_CYCLE']);
    expect(result.diagnostics[0]!.message).toContain(
      'recipe insertion cycle: A -> B#children0 -> B -> A',
    );
  });

  test('`props.children` in an expression value stays refused by the frontend', () => {
    for (const source of [
      'function C(props) { return <div title={String(props.children)}></div>; }\n',
      'function C(props) { return <div title={props.children}></div>; }\n',
      'function C(props) { return <div>{props.children && <b>x</b>}</div>; }\n',
    ]) {
      const front = compileFunctionModule(source, FILE, { importClassifier: CLASSIFIER });
      expect(front.module).toBeNull();
      expect(front.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['OEC9042']);
      expect(front.diagnostics[0]!.message).toContain('recipe projection channel');
    }
  });

  test('an explicit `children` prop stays refused (the channel is JSX children only)', () => {
    const result = generate(
      'function Row(props) { return <li>{props.text}</li>; }\nfunction C(props) { return <Row children="x" />; }\n',
    );
    expect(result.module).toBeNull();
    expect(codes(result)).toEqual(['OEIR_LEAF_UNSUPPORTED_COMPONENT']);
    expect(result.diagnostics[0]!.message).toContain('authored as JSX children');
  });

  test('children projection output is deterministic and parses as JavaScript', () => {
    const first = generate(CHILDREN_TREE).module!;
    expect(generate(CHILDREN_TREE).module).toBe(first);
    const source = ts.createSourceFile(
      'leaf.js',
      first,
      ts.ScriptTarget.ES2022,
      true,
      ts.ScriptKind.JS,
    );
    const parseDiagnostics =
      (source as unknown as { parseDiagnostics?: readonly unknown[] }).parseDiagnostics ?? [];
    expect(parseDiagnostics).toHaveLength(0);
  });
});

describe('M06b2c — list-entry item refresh (unkeyed / same-key reuse)', () => {
  /**
   * The mapper parameter is re-bound by `update(next)`; a slot that reads it has
   * ZERO reactive dependencies, so its write used to be emitted statically and
   * never re-ran (first-snapshot staleness). These tests pin the registered
   * refresh closure on the entry collector. A component reference inside an
   * entry stays refused (see the M06b1a-1 suite); insertion sites inside an
   * entry are projections whose recipes refresh through their own instances.
   */

  /** The bodies of the generated entry `update(next) { ... }` hooks, in order. */
  function updateBodies(module: string): string[] {
    return [...module.matchAll(/update\(next\) \{ ([^}]*) \}/g)].map((match) => match[1]!);
  }

  /** The plain refresh functions called by one entry update body. */
  function refreshCalls(body: string): string[] {
    return [...body.matchAll(/(__oe_refresh\d+)\(true\)/g)].map((match) => match[1]!);
  }

  const UNKEYED = `import { signal } from '@openelement/element';
function List(props) {
  const items = signal([]);
  return <ul>{items.value.map((item) => <li>{item}</li>)}</ul>;
}
`;

  test('an unkeyed entry re-runs its `{item}` write from a registered refresh', () => {
    const result = generate(UNKEYED);
    expect(result.module).not.toBeNull();
    const module = result.module!;
    const updates = updateBodies(module);
    expect(updates).toHaveLength(1);
    // The defect was exactly `update(next) { item = next; }`: the parameter was
    // re-bound but no slot write re-ran, keeping the first render's snapshot.
    expect(updates[0]).toMatch(/^item = next; __oe_refresh\d+\(true\);$/);
    const refresh = refreshCalls(updates[0]!)[0]!;
    expect(refresh).toBeDefined();
    // The refresh re-reads the re-bound parameter (not a captured value) ...
    expect(module).toMatch(
      new RegExp(
        `function ${refresh}\\(\\) \\{\\n\\s+__oe_text\\d+\\.nodeValue = displayValue\\(\\(item\\)\\);\\n\\s+\\}`,
      ),
    );
    // ... and the initial build calls it immediately (one write, unchanged).
    expect(module).toContain(`${refresh}();`);
    // No reactive dependency exists on the slot, so only the list subscription
    // is emitted — no bogus signal binding for the entry-local name.
    expect(module.match(/bindSignalWrites\(/g)).toHaveLength(1);
    expect(result.requiredBindings).toEqual(['items']);
    expect(module).not.toContain('requireBinding("item")');
  });

  test('a keyed same-key replacement uses the same update path', () => {
    const module = generate(`import { signal } from '@openelement/element';
function List(props) {
  const items = signal([]);
  return <ul>{items.value.map((item) => <li key={item.id}>{item.label}</li>)}</ul>;
}
`).module!;
    // Keyed reuse: same key, changed label — the entry hook must refresh in place.
    expect(module).toMatch(/function __oe_eachKey\d+\(/);
    const updates = updateBodies(module);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatch(/^item = next; __oe_refresh\d+\(true\);$/);
    const refresh = refreshCalls(updates[0]!)[0]!;
    expect(module).toMatch(
      new RegExp(
        `function ${refresh}\\(\\) \\{\\n\\s+__oe_text\\d+\\.nodeValue = displayValue\\(\\(item \\. label\\)\\);`,
      ),
    );
  });

  test('an entry-local dynamic attribute refreshes on update', () => {
    const module = generate(`import { signal } from '@openelement/element';
function List(props) {
  const items = signal([]);
  return <ul>{items.value.map((item) => <li data-id={item.id}>{item}</li>)}</ul>;
}
`).module!;
    const updates = updateBodies(module);
    expect(updates).toHaveLength(1);
    const calls = refreshCalls(updates[0]!);
    expect(calls).toHaveLength(2);
    const attributeRefresh = calls.find((name) =>
      new RegExp(
        `function ${name}\\(\\) \\{\\n\\s+const __oe_value\\d+ = attributeValueOf\\(\\(item \\. id\\)\\);`,
      ).test(module),
    );
    expect(attributeRefresh).toBeDefined();
    expect(module).toContain(`${attributeRefresh}();`);
    const textRefresh = calls.find((name) => name !== attributeRefresh)!;
    expect(module).toMatch(
      new RegExp(
        `function ${textRefresh}\\(\\) \\{\\n\\s+__oe_text\\d+\\.nodeValue = displayValue\\(\\(item\\)\\);`,
      ),
    );
  });

  test('a condition inside an entry whose test reads the item refreshes (covered)', () => {
    const module = generate(`import { signal } from '@openelement/element';
function List(props) {
  const items = signal([]);
  return <ul>{items.value.map((item) => <li>{item.on ? <b>{item.label}</b> : <em>off</em>}</li>)}</ul>;
}
`).module!;
    // emitCondition already registered with the enclosing entry collector; the
    // forced refresh rebuilds the branch from the re-bound parameter, and the
    // branch slot reading `item.label` is registered by the M06b2c fix.
    const updates = updateBodies(module);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatch(
      /^item = next; __oe_refresh\d+\(true\); __oe_whenRefresh\d+\(true\);$/,
    );
    expect(module).toMatch(/const __oe_next = \(item \. on\) \? 1 : 2;/);
    const branchRefresh = refreshCalls(updates[0]!)[0]!;
    expect(module).toMatch(
      new RegExp(
        `function ${branchRefresh}\\(\\) \\{\\n\\s+__oe_text\\d+\\.nodeValue = displayValue\\(\\(item \\. label\\)\\);`,
      ),
    );
  });

  test('a nested list builder inside an entry re-reads the entry-local name', () => {
    const module = generate(`import { signal } from '@openelement/element';
function List(props) {
  const items = signal([]);
  return <ul>{items.value.map((item) => <li>{item.children.map((child) => <b>{child}</b>)}</li>)}</ul>;
}
`).module!;
    const updates = updateBodies(module);
    // Inner entry (child slot) and outer entry (nested list) both refresh.
    expect(updates).toHaveLength(2);
    expect(updates.some((body) => /^child = next; __oe_refresh\d+\(true\);$/.test(body))).toBe(
      true,
    );
    // The nested list's own refresh is registered on the SHARED entry collector.
    expect(updates.some((body) => /^item = next; __oe_eachRefresh\d+\(true\);$/.test(body))).toBe(
      true,
    );
    expect(module).toMatch(/const __oe_items = \(item \. children\);/);
  });

  test('a reusable-JSX insertion site inside an entry refreshes via its recipe instance', () => {
    const module = generate(`import { signal } from '@openelement/element';
function List(props) {
  const items = signal([]);
  const suffix = signal('!');
  const row = <b>{suffix.value}</b>;
  return <ul>{items.value.map((item) => <li>{row}{item}</li>)}</ul>;
}
`).module!;
    // The projection is inserted on the entry owner scope (a live descendant of
    // the recipe's definition owner) ...
    expect(module).toMatch(/insertRecipe\(__oe_eachScope\d+, __oe_recipe\d+,/);
    // ... and its body subscribes on the RECIPE instance scope, so recipe
    // content never depends on the entry `update` hook.
    expect(module).toMatch(/bindSignalWrites\(__oe_recipeScope\d+, suffix, "suffix"/);
    // The entry-local `{item}` text slot (the M06b2c defect) still refreshes.
    const updates = updateBodies(module);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatch(/^item = next; __oe_refresh\d+\(true\);$/);
  });

  test('static slots outside a list entry keep the inline write (no refresh churn)', () => {
    const text = generate('function C(props) { return <p>{"plain"}</p>; }\n').module!;
    expect(text).not.toMatch(/function __oe_refresh\d+\(/);
    expect(text).toContain('.nodeValue = displayValue(("plain"));');
    const attribute = generate('function C(props) { return <p data-n={1}>x</p>; }\n').module!;
    expect(attribute).not.toMatch(/function __oe_refresh\d+\(/);
    expect(attribute).toContain('attributeValueOf((1))');
    // No `update` hook exists outside an entry builder, so nothing can go stale.
    expect(text).not.toContain('update(next)');
    expect(attribute).not.toContain('update(next)');
  });

  test('the fixed list output is deterministic and parses as JavaScript', () => {
    for (const source of [
      UNKEYED,
      `import { signal } from '@openelement/element';
function List(props) {
  const items = signal([]);
  return <ul>{items.value.map((item) => <li key={item.id}>{item.label}</li>)}</ul>;
}
`,
      `import { signal } from '@openelement/element';
function List(props) {
  const items = signal([]);
  return <ul>{items.value.map((item) => <li data-id={item.id}>{item}</li>)}</ul>;
}
`,
    ]) {
      const first = generate(source).module!;
      expect(generate(source).module).toBe(first);
      const parsed = ts.createSourceFile(
        'leaf.js',
        first,
        ts.ScriptTarget.ES2022,
        true,
        ts.ScriptKind.JS,
      );
      const parseDiagnostics =
        (parsed as unknown as { parseDiagnostics?: readonly unknown[] }).parseDiagnostics ?? [];
      expect(parseDiagnostics).toHaveLength(0);
    }
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
      // M06b2a supersedes the whole-node `children projection` refusal: a
      // `{props.children}` site in a component mount is now an admitted
      // projection (see the M06b2a suite above; the host/root boundary is the
      // coded `OEIR_LEAF_MISSING_CHILDREN` read). This row pins the remaining
      // boundary: a projection inside a reusable JSX value body is refused.
      label: 'children projection inside a reusable JSX value body',
      source: 'function C(props) { const x = <div>{props.children}</div>; return <p>{x}</p>; }\n',
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
      // M06b1a-2 supersedes the whole-component `OEIR_LEAF_UNSUPPORTED_RECIPE`
      // refusal: a DIRECT component-local `const x = <div/>` is now a reusable
      // recipe and every `{x}` slot an insertion site (see the M06b1a-2 suite
      // below). The code is retained for a JSX value lowered inside an
      // arbitrary expression, which keeps the M02 `__oe_recipe_ref` placeholder
      // and has no generated recipe definition.
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
