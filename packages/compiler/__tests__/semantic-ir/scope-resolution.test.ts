/**
 * M03-I-1 — acceptance matrix and invariants for the lexical scope resolver.
 *
 * The authority is `docs/architecture/m03-scope-resolution.md` §3–§6 and the
 * §10 matrix. Row labels below name the matrix row they evidence. Every
 * diagnostic test asserts the code, `origin: 'source'`, and the authored span
 * slice — a code without a location is not evidence.
 *
 * The resolver is compiler-private: these tests import the internal module
 * directly, exactly like the M02 semantic-ir suites.
 */

import { describe, expect, test } from 'vitest';
import ts from 'typescript';
import {
  bindingKey,
  resolveModule,
  type BindingId,
  type ComponentFunction,
  type ExpressionResolution,
  type ImportClassifier,
  type ResolveModuleOptions,
  type ResolvedBinding,
  type ResolvedModule,
  type ScopeDiagnostic,
} from '../../src/internal/compiler/semantic-core/scope-resolution.ts';

const FILE = '/proj/src/component.tsx';
const RUNTIME = 'runtime';

// ─── Harness ────────────────────────────────────────────────────────────────

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile(FILE, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
}

/** Capitalized declarations are treated as the module's function components. */
function collectComponents(sourceFile: ts.SourceFile): ComponentFunction[] {
  const components: ComponentFunction[] = [];
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement)) {
      if (
        statement.body !== undefined &&
        statement.name !== undefined &&
        /^[A-Z]/.test(statement.name.text)
      ) {
        components.push(statement);
      }
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !/^[A-Z]/.test(declaration.name.text)) continue;
      const initializer = declaration.initializer;
      if (
        initializer !== undefined &&
        (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
      ) {
        components.push(initializer);
      }
    }
  }
  return components;
}

interface Fixture {
  readonly source: string;
  readonly sourceFile: ts.SourceFile;
  readonly module: ResolvedModule;
}

function fixture(
  source: string,
  options: Omit<ResolveModuleOptions, 'components'> & { components?: 'auto' | 'none' } = {},
): Fixture {
  const sourceFile = parse(source);
  const components = options.components === 'none' ? [] : collectComponents(sourceFile);
  const module = resolveModule(sourceFile, { ...options, components });
  return { source, sourceFile, module };
}

function findNode<T extends ts.Node>(root: ts.Node, predicate: (node: ts.Node) => node is T): T {
  const found = findAllNodes(root, predicate);
  if (found.length === 0) throw new Error('node not found');
  return found[0]!;
}

function findAllNodes<T extends ts.Node>(
  root: ts.Node,
  predicate: (node: ts.Node) => node is T,
): T[] {
  const found: T[] = [];
  const visit = (node: ts.Node): void => {
    if (predicate(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

/** Every JSX expression slot (children and attribute initializers), in AST order. */
function jsxSlots(sourceFile: ts.SourceFile): ts.Expression[] {
  return findAllNodes(sourceFile, (node): node is ts.JsxExpression => ts.isJsxExpression(node))
    .map((slot) => slot.expression)
    .filter((expression): expression is ts.Expression => expression !== undefined);
}

function declarationInitializer(sourceFile: ts.SourceFile, name: string): ts.Expression {
  const declaration = findNode(
    sourceFile,
    (node): node is ts.VariableDeclaration =>
      ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name,
  );
  if (declaration.initializer === undefined) throw new Error(`'${name}' has no initializer`);
  return declaration.initializer;
}

function codesOf(diagnostics: readonly ScopeDiagnostic[]): string[] {
  return diagnostics.map((diagnostic) => diagnostic.code);
}

function expectSourceDiagnostic(
  diagnostics: readonly ScopeDiagnostic[],
  code: string,
  source: string,
  slice?: string,
): ScopeDiagnostic {
  const diagnostic = diagnostics.find((candidate) => candidate.code === code);
  expect(diagnostic, `expected ${code}; got [${codesOf(diagnostics).join(', ')}]`).toBeDefined();
  expect(diagnostic!.origin).toBe('source');
  if (slice !== undefined) {
    expect(source.slice(diagnostic!.span.start, diagnostic!.span.end)).toBe(slice);
  }
  return diagnostic!;
}

function bindingsNamed(module: ResolvedModule, name: string): ResolvedBinding[] {
  return module.bindings.filter((binding) => binding.id.name === name);
}

function onlyBinding(module: ResolvedModule, name: string): ResolvedBinding {
  const matches = bindingsNamed(module, name);
  expect(matches, `expected exactly one binding named '${name}'`).toHaveLength(1);
  return matches[0]!;
}

function bindingNames(module: ResolvedModule, ids: readonly BindingId[]): string[] {
  const names = new Map(
    module.bindings.map((binding) => [bindingKey(binding.id), binding.id.name]),
  );
  // Builtin globals are synthesized on read and not part of the authored inventory.
  return ids.map((id) => names.get(bindingKey(id)) ?? id.name);
}

function sameBinding(left: BindingId | undefined, right: BindingId | undefined): boolean {
  return left !== undefined && right !== undefined && bindingKey(left) === bindingKey(right);
}

function scopeKindOf(module: ResolvedModule, id: BindingId): string {
  return module.scopes.find((scope) => scope.id.path === id.scope.path)?.kind ?? 'missing';
}

// ─── Host classifier fixtures (§6) ──────────────────────────────────────────

interface RecordingClassifier extends ImportClassifier {
  readonly calls: Array<[string, string | null]>;
}

/**
 * The design's canonical runtime fixture: `signal`/`computed` are factories,
 * `count` is a value the host classifies as a signal, namespace members are
 * classified on demand.
 */
function runtimeClassifier(overrides: Partial<ImportClassifier> = {}): RecordingClassifier {
  const calls: Array<[string, string | null]> = [];
  const classifier: ImportClassifier = {
    classifySymbol(specifier, importedName) {
      calls.push([specifier, importedName]);
      if (specifier !== RUNTIME) return undefined;
      if (importedName === null) return 'namespace';
      if (importedName === 'signal' || importedName === 'computed') return 'factory';
      if (importedName === 'count') return 'value';
      return undefined;
    },
    classifyValue(specifier, importedName) {
      return specifier === RUNTIME && importedName === 'count' ? 'signal' : undefined;
    },
    classifyCall(specifier, importedName) {
      if (specifier !== RUNTIME) return undefined;
      if (importedName === 'signal') return { call: 'signal' };
      if (importedName === 'computed') return { call: 'computed' };
      return undefined;
    },
    classifyMember(specifier, member) {
      if (specifier !== RUNTIME) return undefined;
      return member === 'signal' || member === 'computed' ? 'factory' : undefined;
    },
    ...overrides,
  };
  return Object.assign(classifier, { calls });
}

function classifierWith(partial: Partial<ImportClassifier>): ImportClassifier {
  return {
    classifySymbol: () => undefined,
    classifyValue: () => undefined,
    classifyCall: () => undefined,
    ...partial,
  };
}

// ─── §3 binding identity + merge table ──────────────────────────────────────

describe('§3 binding identity and declaration merging', () => {
  test('var declared twice is one binding with two declaration records', () => {
    const { module } = fixture(`
      function C(props) {
        var x = 1;
        var x = 2;
        return <p>{x}</p>;
      }
    `);
    const binding = onlyBinding(module, 'x');
    expect(binding.declarations.map((record) => record.kind)).toEqual(['var', 'var']);
    expect(binding.id.declarationOrder).toBe(0);
    expect(module.diagnostics).toHaveLength(0);
  });

  test('function overloads merge into one binding; the first authored record is canonical', () => {
    const { module, source } = fixture(`
      function C(props) {
        function f(a: number): number;
        function f(a: number) { return a; }
        return <p>{f(1)}</p>;
      }
    `);
    const binding = onlyBinding(module, 'f');
    expect(binding.declarations).toHaveLength(2);
    expect(binding.declarations[0]!.kind).toBe('function');
    expect(source.slice(binding.declarationSpan.start, binding.declarationSpan.end)).toBe('f');
    expect(module.diagnostics).toHaveLength(0);
  });

  test('two function implementations conflict', () => {
    const { module, source } = fixture(`
      function C(props) {
        function f() { return 1; }
        function f() { return 2; }
        return <p>{f()}</p>;
      }
    `);
    expectSourceDiagnostic(module.diagnostics, 'OEIR_DECLARATION_CONFLICT', source);
  });

  test('var and function merge into one binding with both records', () => {
    const { module } = fixture(`
      function C(props) {
        function f() { return 1; }
        var f;
        return <p>{f()}</p>;
      }
    `);
    const binding = onlyBinding(module, 'f');
    expect(binding.declarations.map((record) => record.kind).sort()).toEqual(['function', 'var']);
    expect(module.diagnostics).toHaveLength(0);
  });

  test('let + var in one scope is OEIR_DECLARATION_CONFLICT', () => {
    const { module, source } = fixture(`
      function C(props) {
        let x = 1;
        var x = 2;
        return <p>{x}</p>;
      }
    `);
    expectSourceDiagnostic(module.diagnostics, 'OEIR_DECLARATION_CONFLICT', source, 'x');
  });

  test('function + const in one scope is OEIR_DECLARATION_CONFLICT', () => {
    const { module, source } = fixture(`
      function C(props) {
        function f() { return 1; }
        const f = 1;
        return <p>{f}</p>;
      }
    `);
    expectSourceDiagnostic(module.diagnostics, 'OEIR_DECLARATION_CONFLICT', source);
  });

  test('class + var in one scope is OEIR_DECLARATION_CONFLICT', () => {
    const { module, source } = fixture(`
      class Counter {}
      var Counter = 1;
      function C(props) { return <p>{props.ok ? 'x' : 'y'}</p>; }
    `);
    expectSourceDiagnostic(module.diagnostics, 'OEIR_DECLARATION_CONFLICT', source);
  });

  test('duplicate let declarations are OEIR_DUPLICATE_DECLARATION', () => {
    const { module, source } = fixture(`
      function C(props) {
        let x = 1;
        let x = 2;
        return <p>{x}</p>;
      }
    `);
    expectSourceDiagnostic(module.diagnostics, 'OEIR_DUPLICATE_DECLARATION', source, 'x');
  });

  test('import + module-scope local conflict is OEIR_IMPORT_CONFLICT', () => {
    const { module, source } = fixture(`
      import { count } from 'runtime';
      const count = 1;
      function C(props) { return <p>{props.ok ? 'x' : 'y'}</p>; }
    `);
    const conflict = expectSourceDiagnostic(
      module.diagnostics,
      'OEIR_IMPORT_CONFLICT',
      source,
      'count',
    );
    expect(conflict.message).toContain('count');
  });

  test('a local declaration shadows an import inside its scope only', () => {
    const { sourceFile, module } = fixture(
      `
      import { count } from 'runtime';
      function C(props) {
        const count = 1;
        return <p>{count}</p>;
      }
    `,
      { importClassifier: runtimeClassifier() },
    );
    const imports = module.bindings.filter(
      (binding) => binding.id.name === 'count' && binding.origin.form === 'import',
    );
    const locals = module.bindings.filter(
      (binding) => binding.id.name === 'count' && binding.origin.form === 'local',
    );
    expect(imports).toHaveLength(1);
    expect(locals).toHaveLength(1);
    const resolution = module.resolveExpression(jsxSlots(sourceFile)[0]!, 'inline');
    expect(sameBinding(resolution.reads[0]!.binding, locals[0]!.id)).toBe(true);
  });
});

// ─── §3/§4 shadowing, destructuring, class, scope constructs ────────────────

describe('§4 lexical scope semantics', () => {
  test('shadowed local resolves to the inner binding; the outer binding is untouched', () => {
    const { module, sourceFile, source } = fixture(`
      function C(props) {
        const value = 1;
        {
          const value = 2;
          value;
        }
        return <p>{value}</p>;
      }
    `);
    const innerRead = findNode(
      sourceFile,
      (node): node is ts.ExpressionStatement =>
        ts.isExpressionStatement(node) && ts.isIdentifier(node.expression),
    );
    const outerRead = jsxSlots(sourceFile)[0]!;
    const inner = module.resolveExpression(innerRead.expression, 'setup');
    const outer = module.resolveExpression(outerRead, 'setup');
    expect(sameBinding(inner.reads[0]!.binding, outer.reads[0]!.binding)).toBe(false);
    expect(source.slice(inner.reads[0]!.span.start, inner.reads[0]!.span.end)).toBe('value');
  });

  test('var hoisting: a read before the declaration resolves to the same binding', () => {
    const { module, sourceFile } = fixture(`
      function C(props) {
        x = 1;
        var x;
        return <p>{x}</p>;
      }
    `);
    const assignment = findNode(
      sourceFile,
      (node): node is ts.BinaryExpression =>
        ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken,
    );
    const before = module.resolveExpression(assignment, 'setup');
    const after = module.resolveExpression(jsxSlots(sourceFile)[0]!, 'setup');
    expect(sameBinding(before.reads[0]!.binding, after.reads[0]!.binding)).toBe(true);
  });

  test('block function declarations are block-scoped and do not leak (no Annex B)', () => {
    const { module, sourceFile, source } = fixture(`
      function C(props) {
        if (props.ok) {
          function helper() { return 1; }
          helper();
        }
        return <p>{helper}</p>;
      }
    `);
    const call = findNode(sourceFile, (node): node is ts.CallExpression =>
      ts.isCallExpression(node),
    );
    const inside = module.resolveExpression(call, 'setup');
    expect(scopeKindOf(module, inside.reads[0]!.binding)).toBe('block');
    const outside = module.resolveExpression(jsxSlots(sourceFile)[0]!, 'inline');
    expectSourceDiagnostic(outside.diagnostics, 'OEIR_UNRESOLVED_BINDING', source, 'helper');
  });

  test('catch parameter has its own scope', () => {
    const { module, sourceFile, source } = fixture(`
      function C(props) {
        try { throw props; } catch (e) { e; }
        return <p>{e}</p>;
      }
    `);
    const catchRead = findNode(
      sourceFile,
      (node): node is ts.ExpressionStatement =>
        ts.isExpressionStatement(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'e',
    );
    const resolution = module.resolveExpression(catchRead.expression, 'setup');
    const binding = module.bindings.find(
      (candidate) => bindingKey(candidate.id) === bindingKey(resolution.reads[0]!.binding),
    );
    expect(binding?.declarations[0]?.kind).toBe('catch');
    const outside = module.resolveExpression(jsxSlots(sourceFile)[0]!, 'setup');
    expectSourceDiagnostic(outside.diagnostics, 'OEIR_UNRESOLVED_BINDING', source, 'e');
  });

  test('switch shares one block scope across all cases', () => {
    const { module, sourceFile, source } = fixture(`
      function C(props) {
        switch (props.kind) {
          case 1: let shared = 1; break;
          case 2: shared; break;
        }
        return <p>{props.ok ? 'x' : 'y'}</p>;
      }
    `);
    const read = findNode(
      sourceFile,
      (node): node is ts.ExpressionStatement =>
        ts.isExpressionStatement(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'shared',
    );
    const resolution = module.resolveExpression(read.expression, 'setup');
    const declaration = module.bindings.find((binding) => binding.id.name === 'shared');
    expect(declaration).toBeDefined();
    expect(sameBinding(resolution.reads[0]!.binding, declaration!.id)).toBe(true);
    expect(source.slice(resolution.reads[0]!.span.start, resolution.reads[0]!.span.end)).toBe(
      'shared',
    );
  });

  test('for (let i) closure captures the per-iteration binding', () => {
    const { module, sourceFile } = fixture(`
      function C(props) {
        for (let i = 0; i < 2; i++) {
          const read = () => i;
        }
        return <p>{props.ok ? 'x' : 'y'}</p>;
      }
    `);
    const arrow = declarationInitializer(sourceFile, 'read');
    const resolution = module.resolveExpression(arrow, 'derived');
    expect(bindingNames(module, resolution.captures)).toEqual(['i']);
    expect(scopeKindOf(module, resolution.reads[0]!.binding)).toBe('for');
  });

  test('a named function expression binds its own name inside only', () => {
    const { module, sourceFile, source } = fixture(`
      function C(props) {
        const f = function self() { return self; };
        return <p>{self}</p>;
      }
    `);
    const inside = findNode(
      sourceFile,
      (node): node is ts.ReturnStatement =>
        ts.isReturnStatement(node) && node.expression !== undefined,
    );
    const resolution = module.resolveExpression(inside.expression!, 'setup');
    expect(
      bindingNames(
        module,
        resolution.reads.map((read) => read.binding),
      ),
    ).toEqual(['self']);
    expect(scopeKindOf(module, resolution.reads[0]!.binding)).toBe('function');
    const outside = module.resolveExpression(jsxSlots(sourceFile)[0]!, 'inline');
    expectSourceDiagnostic(outside.diagnostics, 'OEIR_UNRESOLVED_BINDING', source, 'self');
  });

  test('a parameter default may read an earlier parameter', () => {
    const { module, sourceFile } = fixture(`
      function helper(a: number, b: number = a) { return b; }
    `);
    const parameter = findNode(
      sourceFile,
      (node): node is ts.ParameterDeclaration =>
        ts.isParameter(node) && node.initializer !== undefined,
    );
    const resolution = module.resolveExpression(parameter.initializer!, 'setup');
    expect(
      bindingNames(
        module,
        resolution.reads.map((read) => read.binding),
      ),
    ).toEqual(['a']);
    expect(scopeKindOf(module, resolution.reads[0]!.binding)).toBe('function');
  });

  test('a class declaration has an outer binding and an inner class-name binding', () => {
    const { module, sourceFile } = fixture(`
      class Counter {
        static create() { return new Counter(); }
      }
      function C(props) {
        return <div>{new Counter()}</div>;
      }
    `);
    const creations = findAllNodes(sourceFile, (node): node is ts.NewExpression =>
      ts.isNewExpression(node),
    );
    expect(creations).toHaveLength(2);
    const inner = module.resolveExpression(creations[0]!, 'setup');
    const outer = module.resolveExpression(creations[1]!, 'setup');
    expect(scopeKindOf(module, inner.reads[0]!.binding)).toBe('class');
    expect(scopeKindOf(module, outer.reads[0]!.binding)).toBe('module');
    expect(sameBinding(inner.reads[0]!.binding, outer.reads[0]!.binding)).toBe(false);
  });

  test('an anonymous class expression declares only the outer binding', () => {
    const { module } = fixture(`
      function C(props) {
        const Factory = class {};
        return <p>{props.ok ? 'x' : 'y'}</p>;
      }
    `);
    expect(
      module.bindings.filter((binding) => binding.declarations[0]?.kind === 'class-name'),
    ).toHaveLength(0);
    expect(onlyBinding(module, 'Factory').origin.form).toBe('local');
  });

  test('for (const x of …) is per-iteration scoped like for (let i)', () => {
    const { module, sourceFile } = fixture(`
      function C(props) {
        for (const entry of props.items) { entry; }
        return <p>{props.ok ? 'x' : 'y'}</p>;
      }
    `);
    const read = findNode(
      sourceFile,
      (node): node is ts.ExpressionStatement =>
        ts.isExpressionStatement(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'entry',
    );
    const resolution = module.resolveExpression(read.expression, 'setup');
    expect(scopeKindOf(module, resolution.reads[0]!.binding)).toBe('for');
  });

  test('a named class expression class-name is visible only inside the body', () => {
    const { module, sourceFile, source } = fixture(`
      function C(props) {
        const Factory = class Internal { static make() { return Internal; } };
        return <p>{Internal}</p>;
      }
    `);
    const inside = findNode(
      sourceFile,
      (node): node is ts.ReturnStatement =>
        ts.isReturnStatement(node) && node.expression !== undefined,
    );
    const resolution = module.resolveExpression(inside.expression!, 'setup');
    expect(scopeKindOf(module, resolution.reads[0]!.binding)).toBe('class');
    const outside = module.resolveExpression(jsxSlots(sourceFile)[0]!, 'inline');
    expectSourceDiagnostic(outside.diagnostics, 'OEIR_UNRESOLVED_BINDING', source, 'Internal');
  });

  test('a class heritage expression is evaluated in the enclosing scope and is TDZ-provable', () => {
    const { module, sourceFile, source } = fixture(`
      class Loop extends Loop {}
      function C(props) { return <p>{props.ok ? 'x' : 'y'}</p>; }
    `);
    const heritage = findNode(sourceFile, (node): node is ts.HeritageClause =>
      ts.isHeritageClause(node),
    );
    const reference = heritage.types[0]!.expression;
    const resolution = module.resolveExpression(reference, 'setup');
    expect(scopeKindOf(module, resolution.reads[0]!.binding)).toBe('module');
    expectSourceDiagnostic(resolution.diagnostics, 'OEIR_TDZ_READ', source, 'Loop');
  });

  test('class members keep their own this/arguments; a component does not', () => {
    const { module } = fixture(`
      function C(props) {
        class Helper { run() { return this; } }
        return <p>{props.ok ? 'x' : 'y'}</p>;
      }
    `);
    expect(codesOf(module.diagnostics)).not.toContain('OEIR_UNSUPPORTED_THIS');
  });
});

// ─── §3/§4 destructuring and props (owner decision: JavaScript semantics) ───

describe('§4 destructuring is JavaScript snapshot semantics (option A)', () => {
  test('object destructuring declares distinct local snapshot bindings', () => {
    const { module } = fixture(`
      function C(props) {
        const { a, b: renamed, c = 1, ...rest } = props;
        return <p>{a}{renamed}{c}{rest}</p>;
      }
    `);
    for (const name of ['a', 'renamed', 'c', 'rest']) {
      const binding = onlyBinding(module, name);
      expect(binding.origin.form).toBe('local');
      expect(binding.value).toBe('plain');
    }
  });

  test('array destructuring declares distinct bindings (holes skipped)', () => {
    const { module } = fixture(`
      function C(props) {
        const [first, , third] = props.items;
        return <p>{first}{third}</p>;
      }
    `);
    expect(onlyBinding(module, 'first').id.declarationOrder).toBe(0);
    expect(onlyBinding(module, 'third').id.declarationOrder).toBe(0);
    expect(onlyBinding(module, 'first').origin.form).toBe('local');
  });

  test('a destructured props parameter produces local snapshots, not prop reads', () => {
    const { sourceFile, module } = fixture(`
      function C({ a }) {
        return <p>{a}</p>;
      }
    `);
    const binding = onlyBinding(module, 'a');
    expect(binding.origin.form).toBe('local');
    expect(binding.value).toBe('plain');
    expect(bindingsNamed(module, 'props')).toHaveLength(0);
    const resolution = module.resolveExpression(jsxSlots(sourceFile)[0]!, 'inline');
    expect(bindingNames(module, resolution.dependencies)).toEqual([]);
  });

  test('the props parameter is prop-param; props.a is a tracked prop read, a snapshot is not', () => {
    const { sourceFile, module } = fixture(`
      function C(props) {
        const { a } = props;
        return <p>{a}{props.b}</p>;
      }
    `);
    const props = onlyBinding(module, 'props');
    expect(props.origin.form).toBe('prop-param');
    expect(props.value).toBe('prop');
    const snapshots = module.resolveExpression(jsxSlots(sourceFile)[0]!, 'inline');
    const propRead = module.resolveExpression(jsxSlots(sourceFile)[1]!, 'inline');
    expect(bindingNames(module, snapshots.dependencies)).toEqual([]);
    expect(bindingNames(module, propRead.dependencies)).toEqual(['props']);
  });

  test('parameter + var of the same name merge into one binding', () => {
    const { module } = fixture(`
      function C(props) {
        var props;
        return <p>{props.a}</p>;
      }
    `);
    const binding = onlyBinding(module, 'props');
    expect(binding.declarations.map((record) => record.kind).sort()).toEqual(['param', 'var']);
  });
});

// ─── §5 reads / captures / dependencies / mode ──────────────────────────────

describe('§5 four independent axes', () => {
  const SOURCE = `
    import { signal } from 'runtime';
    function C(props) {
      const s = signal(0);
      const x = s.value;
      return (
        <div onClick={() => { s.value++; }}>
          {s.value}
        </div>
      );
    }
  `;

  test('setup read is a snapshot: reads the signal, captures nothing, subscribes to nothing', () => {
    const { sourceFile, module } = fixture(SOURCE, { importClassifier: runtimeClassifier() });
    const resolution = module.resolveExpression(declarationInitializer(sourceFile, 'x'), 'setup');
    expect(
      bindingNames(
        module,
        resolution.reads.map((read) => read.binding),
      ),
    ).toEqual(['s']);
    expect(resolution.captures).toHaveLength(0);
    expect(resolution.dependencies).toHaveLength(0);
  });

  test('inline tracked read: reads and subscribes, but does not capture', () => {
    const { sourceFile, module } = fixture(SOURCE, { importClassifier: runtimeClassifier() });
    const resolution = module.resolveExpression(jsxSlots(sourceFile)[1]!, 'inline');
    expect(
      bindingNames(
        module,
        resolution.reads.map((read) => read.binding),
      ),
    ).toEqual(['s']);
    expect(bindingNames(module, resolution.dependencies)).toEqual(['s']);
    expect(resolution.captures).toHaveLength(0);
  });

  test('handler: captures a signal without subscribing to it', () => {
    const { sourceFile, module } = fixture(SOURCE, { importClassifier: runtimeClassifier() });
    const resolution = module.resolveExpression(jsxSlots(sourceFile)[0]!, 'handler');
    expect(bindingNames(module, resolution.captures)).toEqual(['s']);
    expect(resolution.dependencies).toHaveLength(0);
  });

  test('derived (computed body): capture and dependency both', () => {
    const { sourceFile, module } = fixture(
      `
      import { signal, computed } from 'runtime';
      function C(props) {
        const s = signal(0);
        const d = computed(() => s.value * 2);
        return <p>{d.value}</p>;
      }
    `,
      { importClassifier: runtimeClassifier() },
    );
    const arrow = declarationInitializer(sourceFile, 'd');
    const body = (arrow as ts.CallExpression).arguments[0]!;
    const resolution = module.resolveExpression(body, 'derived');
    expect(bindingNames(module, resolution.dependencies)).toEqual(['s']);
    expect(bindingNames(module, resolution.captures)).toEqual(['s']);
  });

  test('per-entry list: items read outside the arrow, item bound by the arrow', () => {
    const { sourceFile, module } = fixture(
      `
      import { signal } from 'runtime';
      function Row(props) { return <li>{props.name}</li>; }
      function C(props) {
        const items = signal([{ id: 1 }]);
        return <ul>{items.map((item) => <Row name={item.id} />)}</ul>;
      }
    `,
      { importClassifier: runtimeClassifier() },
    );
    const call = findNode(
      sourceFile,
      (node): node is ts.CallExpression =>
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'map',
    );
    const resolution = module.resolveExpression(call, 'per-entry');
    expect(bindingNames(module, resolution.dependencies)).toEqual(['items']);
    const captures = bindingNames(module, resolution.captures);
    expect(captures).not.toContain('items');
    expect(captures).not.toContain('item');
    // `<Row/>` is a value read inside the mapper closure, so it is a capture.
    expect(captures).toContain('Row');
  });

  test('key mode: reads but neither captures nor subscribes', () => {
    const { sourceFile, module } = fixture(`
      function Row(props) { return <li key={props.id}>{props.id}</li>; }
      function C(props) {
        const item = props;
        return <ul>{item.id}</ul>;
      }
    `);
    const slot = jsxSlots(sourceFile)[0]!;
    const resolution = module.resolveExpression(slot, 'key');
    expect(resolution.dependencies).toHaveLength(0);
    expect(resolution.reads.length).toBeGreaterThan(0);
  });

  test('unresolved identifier in a tracked slot is OEIR_UNRESOLVED_BINDING with its span', () => {
    const { sourceFile, module, source } = fixture(`
      function C(props) {
        return <p>{missing}</p>;
      }
    `);
    const resolution = module.resolveExpression(jsxSlots(sourceFile)[0]!, 'inline');
    expectSourceDiagnostic(resolution.diagnostics, 'OEIR_UNRESOLVED_BINDING', source, 'missing');
    expect(resolution.unresolvedReads).toHaveLength(1);
    expect(resolution.reads).toHaveLength(0);
  });

  test('an unclassified binding is fatal only in a tracked slot', () => {
    const { sourceFile, module, source } = fixture(
      `
      import { data } from 'runtime';
      function C(props) {
        return <p>{data}</p>;
      }
    `,
      {
        importClassifier: classifierWith({
          classifySymbol: () => 'value',
        }),
      },
    );
    const inline = module.resolveExpression(jsxSlots(sourceFile)[0]!, 'inline');
    const diagnostic = expectSourceDiagnostic(
      inline.diagnostics,
      'OEIR_UNCLASSIFIED_BINDING',
      source,
      'data',
    );
    expect(diagnostic.message).toContain('runtime');
    const setup = module.resolveExpression(jsxSlots(sourceFile)[0]!, 'setup');
    expect(codesOf(setup.diagnostics)).not.toContain('OEIR_UNCLASSIFIED_BINDING');
  });

  test('builtin globals resolve without capture and without subscriptions', () => {
    const { sourceFile, module } = fixture(`
      function C(props) {
        return <p>{Math.PI}</p>;
      }
    `);
    const resolution = module.resolveExpression(jsxSlots(sourceFile)[0]!, 'inline');
    expect(
      bindingNames(
        module,
        resolution.reads.map((read) => read.binding),
      ),
    ).toEqual(['Math']);
    expect(resolution.captures).toHaveLength(0);
    expect(resolution.dependencies).toHaveLength(0);
  });
});

// ─── §4.1 TDZ: static diagnostic only inside the provable bound ─────────────

describe('§4.1 TDZ is a runtime state, not a source-order rule', () => {
  test('direct same-block read before initialization is OEIR_TDZ_READ', () => {
    const { sourceFile, module, source } = fixture(`
      function C(props) {
        value;
        let value = 1;
        return <p>{props.ok ? 'x' : 'y'}</p>;
      }
    `);
    const statement = findNode(
      sourceFile,
      (node): node is ts.ExpressionStatement =>
        ts.isExpressionStatement(node) && ts.isIdentifier(node.expression),
    );
    const resolution = module.resolveExpression(statement.expression, 'setup');
    expectSourceDiagnostic(resolution.diagnostics, 'OEIR_TDZ_READ', source, 'value');
  });

  test('a self-referencing initializer is provably TDZ', () => {
    const { sourceFile, module, source } = fixture(`
      function C(props) {
        let value = value + 1;
        return <p>{props.ok ? 'x' : 'y'}</p>;
      }
    `);
    const resolution = module.resolveExpression(
      declarationInitializer(sourceFile, 'value'),
      'setup',
    );
    expectSourceDiagnostic(resolution.diagnostics, 'OEIR_TDZ_READ', source, 'value');
  });

  test('a closure created before initialization is legal and binds lexically', () => {
    const { sourceFile, module, source } = fixture(`
      function C(props) {
        const read = () => value;
        let value = 42;
        return <p>{read()}</p>;
      }
    `);
    const resolution = module.resolveExpression(
      declarationInitializer(sourceFile, 'read'),
      'derived',
    );
    expect(
      bindingNames(
        module,
        resolution.reads.map((read) => read.binding),
      ),
    ).toEqual(['value']);
    expect(codesOf(resolution.diagnostics)).not.toContain('OEIR_TDZ_READ');
    expect(source.slice(resolution.reads[0]!.span.start, resolution.reads[0]!.span.end)).toBe(
      'value',
    );
  });

  test('a closure invoked before initialization compiles; the error stays runtime', () => {
    const { sourceFile, module } = fixture(`
      function C(props) {
        const read = () => value;
        read();
        let value = 42;
        return <p>{props.ok ? 'x' : 'y'}</p>;
      }
    `);
    const resolution = module.resolveExpression(
      declarationInitializer(sourceFile, 'read'),
      'derived',
    );
    expect(codesOf(resolution.diagnostics)).not.toContain('OEIR_TDZ_READ');
  });

  test('a read in a nested block is not in the provable straight-line bound', () => {
    const { sourceFile, module } = fixture(`
      function C(props) {
        if (props.ok) { value; }
        let value = 1;
        return <p>{props.ok ? 'x' : 'y'}</p>;
      }
    `);
    const read = findNode(
      sourceFile,
      (node): node is ts.Identifier =>
        ts.isIdentifier(node) && node.text === 'value' && ts.isExpressionStatement(node.parent),
    );
    const resolution = module.resolveExpression(read, 'setup');
    expect(codesOf(resolution.diagnostics)).not.toContain('OEIR_TDZ_READ');
  });

  test('var reads before their declaration have no TDZ', () => {
    const { sourceFile, module } = fixture(`
      function C(props) {
        value;
        var value = 1;
        return <p>{props.ok ? 'x' : 'y'}</p>;
      }
    `);
    const statement = findNode(
      sourceFile,
      (node): node is ts.ExpressionStatement =>
        ts.isExpressionStatement(node) && ts.isIdentifier(node.expression),
    );
    const resolution = module.resolveExpression(statement.expression, 'setup');
    expect(codesOf(resolution.diagnostics)).not.toContain('OEIR_TDZ_READ');
  });
});

// ─── §6 host ImportClassifier: factory vs value vs namespace ────────────────

describe('§6 import classification through the host classifier', () => {
  test('a factory import is SymbolRole factory and is NOT ValueKind signal', () => {
    const { module } = fixture(
      `
      import { signal } from 'runtime';
      function C(props) { return <p>{props.ok ? signal : null}</p>; }
    `,
      { importClassifier: runtimeClassifier() },
    );
    const binding = onlyBinding(module, 'signal');
    expect(binding.role).toBe('factory');
    expect(binding.value).not.toBe('signal');
    expect(binding.value).toBe('plain');
  });

  test('a call result whose factory is known becomes the binding ValueKind', () => {
    const { module } = fixture(
      `
      import { signal } from 'runtime';
      const count = signal(0);
      function C(props) { return <p>{count.value}</p>; }
    `,
      { importClassifier: runtimeClassifier() },
    );
    const binding = onlyBinding(module, 'count');
    expect(binding.value).toBe('signal');
    expect(binding.classifiedBy).toBe('host-classifier');
  });

  test('a host-classified value import carries its ValueKind', () => {
    const { module } = fixture(
      `
      import { count } from 'runtime';
      function C(props) { return <p>{count.value}</p>; }
    `,
      { importClassifier: runtimeClassifier() },
    );
    const binding = onlyBinding(module, 'count');
    expect(binding.value).toBe('signal');
    expect(binding.classifiedBy).toBe('host-classifier');
  });

  test('namespace member chain: classifySymbol → classifyMember → classifyCall', () => {
    const { module } = fixture(
      `
      import * as Runtime from 'runtime';
      const count = Runtime.signal(0);
      function C(props) { return <p>{count.value}</p>; }
    `,
      { importClassifier: runtimeClassifier() },
    );
    expect(onlyBinding(module, 'Runtime').role).toBe('namespace');
    expect(onlyBinding(module, 'count').value).toBe('signal');
  });

  test('namespace member without a member classifier stays unknown and fails closed in a tracked slot', () => {
    const { sourceFile, module, source } = fixture(
      `
      import * as Runtime from 'runtime';
      const count = Runtime.signal(0);
      function C(props) { return <p>{count.value}</p>; }
    `,
      {
        importClassifier: classifierWith({
          classifySymbol: () => 'namespace',
          classifyCall: () => ({ call: 'signal' }),
        }),
      },
    );
    expect(onlyBinding(module, 'count').value).toBe('unknown');
    const resolution = module.resolveExpression(jsxSlots(sourceFile)[0]!, 'inline');
    expectSourceDiagnostic(resolution.diagnostics, 'OEIR_UNCLASSIFIED_BINDING', source, 'count');
  });

  test('import alias: the local name is bound, the classifier sees the original name', () => {
    const { module } = fixture(
      `
      import { signal as makeSignal } from 'runtime';
      const count = makeSignal(0);
      function C(props) { return <p>{count.value}</p>; }
    `,
      { importClassifier: runtimeClassifier() },
    );
    const binding = onlyBinding(module, 'makeSignal');
    expect(binding.origin).toEqual({
      form: 'import',
      specifier: 'runtime',
      importedName: 'signal',
    });
    expect(onlyBinding(module, 'count').value).toBe('signal');
  });

  test('default import is importedName null', () => {
    const classifier = runtimeClassifier();
    const { module } = fixture(
      `
      import runtimeDefault from 'runtime';
      function C(props) { return <p>{props.ok ? runtimeDefault : null}</p>; }
    `,
      { importClassifier: classifier },
    );
    const binding = onlyBinding(module, 'runtimeDefault');
    expect(binding.origin).toEqual({
      form: 'import',
      specifier: 'runtime',
      importedName: null,
    });
    expect(
      classifier.calls.some(([specifier, name]) => specifier === 'runtime' && name === null),
    ).toBe(true);
  });

  test('a type-only import read as a value is OEIR_TYPE_ONLY_VALUE_READ', () => {
    const { sourceFile, module, source } = fixture(`
      import type { Widget } from 'runtime';
      function C(props) { return <p>{Widget}</p>; }
    `);
    const resolution = module.resolveExpression(jsxSlots(sourceFile)[0]!, 'inline');
    expectSourceDiagnostic(resolution.diagnostics, 'OEIR_TYPE_ONLY_VALUE_READ', source, 'Widget');
  });

  test('a host type role on a runtime import is also a value-read diagnostic', () => {
    const { sourceFile, module } = fixture(
      `
      import { Widget } from 'runtime';
      function C(props) { return <p>{Widget}</p>; }
    `,
      { importClassifier: classifierWith({ classifySymbol: () => 'type' }) },
    );
    const resolution = module.resolveExpression(jsxSlots(sourceFile)[0]!, 'inline');
    expect(codesOf(resolution.diagnostics)).toContain('OEIR_TYPE_ONLY_VALUE_READ');
  });

  test('an unresolved external import is unknown + unresolved', () => {
    const { module } = fixture(`
      import { mystery } from 'unknown-pkg';
      function C(props) { return <p>{props.ok ? mystery : null}</p>; }
    `);
    const binding = onlyBinding(module, 'mystery');
    expect(binding.value).toBe('unknown');
    expect(binding.classifiedBy).toBe('unresolved');
  });

  test('the resolver never guesses a factory from an unclassified local callee', () => {
    const { module } = fixture(`
      function C(props) {
        const signal = (value: number) => value;
        const count = signal(0);
        return <p>{count}</p>;
      }
    `);
    const binding = onlyBinding(module, 'count');
    expect(binding.value).toBe('plain');
    expect(binding.classifiedBy).toBe('syntax');
  });

  test('a local alias of a factory import keeps the import provenance for the call chain', () => {
    const { module } = fixture(
      `
      import { signal } from 'runtime';
      const makeSignal = signal;
      const count = makeSignal(0);
      function C(props) { return <p>{count.value}</p>; }
    `,
      { importClassifier: runtimeClassifier() },
    );
    expect(onlyBinding(module, 'count').value).toBe('signal');
  });

  test('a factory call whose result the host reports unknown is unknown (host-classified)', () => {
    const { module } = fixture(
      `
      import { make } from 'runtime';
      const thing = make();
      function C(props) { return <p>{thing}</p>; }
    `,
      {
        importClassifier: classifierWith({
          classifySymbol: () => 'factory',
          classifyCall: () => ({ call: 'unknown' }),
        }),
      },
    );
    const binding = onlyBinding(module, 'thing');
    expect(binding.value).toBe('unknown');
    expect(binding.classifiedBy).toBe('host-classifier');
  });
});

// ─── §4 context-sensitive fail-closed diagnostics ──────────────────────────

describe('§4 context-sensitive constructs fail closed with coded diagnostics', () => {
  test('this in a function component', () => {
    const { module } = fixture(`
      function C(props) { return <p>{this}</p>; }
    `);
    expect(codesOf(module.diagnostics)).toContain('OEIR_UNSUPPORTED_THIS');
  });

  test('arguments in a function component', () => {
    const { module, source } = fixture(`
      function C(props) { return <p>{arguments.length}</p>; }
    `);
    expectSourceDiagnostic(module.diagnostics, 'OEIR_UNSUPPORTED_ARGUMENTS', source, 'arguments');
  });

  test('super in a function component', () => {
    const { module } = fixture(`
      function C(props) { return <p>{super}</p>; }
    `);
    expect(codesOf(module.diagnostics)).toContain('OEIR_UNSUPPORTED_SUPER');
  });

  test('new.target in a function component', () => {
    const { module } = fixture(`
      function C(props) {
        const probe = () => new.target;
        return <p>{props.ok ? 'x' : 'y'}</p>;
      }
    `);
    expect(codesOf(module.diagnostics)).toContain('OEIR_UNSUPPORTED_NEW_TARGET');
  });

  test('eval is OEIR_DYNAMIC_SCOPE', () => {
    const { module, source } = fixture(`
      function C(props) { const value = eval('1'); return <p>{value}</p>; }
    `);
    expectSourceDiagnostic(module.diagnostics, 'OEIR_DYNAMIC_SCOPE', source, 'eval');
  });

  test('with is OEIR_DYNAMIC_SCOPE', () => {
    const { module } = fixture(`
      function C(props) { with (props) { } return <p>{props.ok ? 'x' : 'y'}</p>; }
    `);
    expect(codesOf(module.diagnostics)).toContain('OEIR_DYNAMIC_SCOPE');
  });

  test('labels are OEIR_UNSUPPORTED_LABEL', () => {
    const { module } = fixture(`
      function C(props) {
        loop: for (;;) { break loop; }
        return <p>{props.ok ? 'x' : 'y'}</p>;
      }
    `);
    expect(codesOf(module.diagnostics)).toContain('OEIR_UNSUPPORTED_LABEL');
  });

  test('enum and namespace declarations fail closed', () => {
    const { module } = fixture(`
      enum E { A }
      namespace N { export const x = 1; }
      function C(props) { return <p>{props.ok ? 'x' : 'y'}</p>; }
    `);
    expect(
      codesOf(module.diagnostics).filter((code) => code === 'OEIR_UNSUPPORTED_DECLARATION'),
    ).toHaveLength(2);
  });
});

// ─── Contract invariants ────────────────────────────────────────────────────

describe('capture/dependency contract invariants', () => {
  const SOURCE = `
    import { signal, computed } from 'runtime';
    const moduleCount = signal(0);
    function Row(props) { return <li>{props.name}</li>; }
    function C(props) {
      const s = signal(0);
      const d = computed(() => s.value + moduleCount.value);
      const { a } = props;
      return (
        <div onClick={() => { s.value++; }} key={a}>
          {s.value}
          {d.value}
        </div>
      );
    }
  `;

  test('captures and dependencies are subsets of reads; modes stay legal', () => {
    const { sourceFile, module } = fixture(SOURCE, { importClassifier: runtimeClassifier() });
    const slots = jsxSlots(sourceFile);
    const modes = ['inline', 'inline', 'inline', 'handler', 'key'] as const;
    const resolutions = [
      module.resolveExpression(declarationInitializer(sourceFile, 'd'), 'setup'),
      ...slots.map((slot, index) => module.resolveExpression(slot, modes[index] ?? 'inline')),
    ];
    const readKeys = (resolution: ExpressionResolution): Set<string> =>
      new Set(resolution.reads.map((read) => bindingKey(read.binding)));
    for (const resolution of resolutions) {
      const keys = readKeys(resolution);
      for (const id of [...resolution.captures, ...resolution.dependencies]) {
        expect(keys.has(bindingKey(id))).toBe(true);
      }
      if (!['inline', 'derived', 'per-entry'].includes(resolution.mode)) {
        expect(resolution.dependencies).toHaveLength(0);
      }
    }
  });

  test('every authored binding is declared, owned by one scope, and keeps a canonical span', () => {
    const { module } = fixture(SOURCE, { importClassifier: runtimeClassifier() });
    const scopePaths = new Set(module.scopes.map((scope) => scope.id.path));
    const bindingKeys = new Set<string>();
    const declarationSpans = new Set<string>();
    for (const binding of module.bindings) {
      expect(binding.declarations.length).toBeGreaterThan(0);
      expect(binding.declarationSpan).toEqual(binding.declarations[0]!.span);
      expect(scopePaths.has(binding.id.scope.path)).toBe(true);
      const key = bindingKey(binding.id);
      expect(bindingKeys.has(key), `duplicate binding identity ${key}`).toBe(false);
      bindingKeys.add(key);
      for (const declaration of binding.declarations) {
        const spanKey = `${declaration.span.start}:${declaration.span.end}`;
        expect(
          declarationSpans.has(spanKey),
          `declaration span ${spanKey} is owned by two bindings`,
        ).toBe(false);
        declarationSpans.add(spanKey);
      }
    }
  });

  test('resolution is deterministic across two runs', () => {
    const first = fixture(SOURCE, { importClassifier: runtimeClassifier() });
    const second = fixture(SOURCE, { importClassifier: runtimeClassifier() });
    const summarize = (value: Fixture): unknown =>
      value.module.bindings.map((binding) => ({
        id: bindingKey(binding.id),
        value: binding.value,
        origin: binding.origin,
        declarations: binding.declarations.map((declaration) => declaration.kind),
      }));
    expect(summarize(first)).toEqual(summarize(second));
  });

  test('every module diagnostic is source-located', () => {
    const { module, source } = fixture(`
      enum E { A }
      function C(props) { return <p>{this}{missing}</p>; }
    `);
    const resolution = module.resolveExpression(
      jsxSlots(module.sourceFile).find((slot) => ts.isIdentifier(slot))!,
      'inline',
    );
    for (const diagnostic of [...module.diagnostics, ...resolution.diagnostics]) {
      expect(diagnostic.origin).toBe('source');
      expect(diagnostic.span.start).toBeGreaterThanOrEqual(0);
      expect(diagnostic.span.end).toBeLessThanOrEqual(source.length);
      expect(source.slice(diagnostic.span.start, diagnostic.span.end).length).toBeGreaterThan(0);
    }
    expect(codesOf(module.diagnostics)).toContain('OEIR_UNSUPPORTED_DECLARATION');
    expect(codesOf(module.diagnostics)).toContain('OEIR_UNSUPPORTED_THIS');
    expect(codesOf(resolution.diagnostics)).toContain('OEIR_UNRESOLVED_BINDING');
  });
});

// Keep the TypeScript version visible: the resolver is syntax-only, but the TS
// AST/API version is part of the contract the tests run against.
test('the pinned TypeScript version is recorded', async () => {
  const { readFileSync } = await import('node:fs');
  const manifest = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { dependencies?: Record<string, string> };
  expect(ts.version).toBe(manifest.dependencies?.typescript);
});
