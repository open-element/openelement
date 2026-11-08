/**
 * M03-I-1 — differential oracle: resolver bindings vs the TypeScript checker.
 *
 * The resolver is syntax-authoritative and must NOT use `ts.Program` or the
 * type checker as its mechanism (M03-A §7 A3). TypeScript is used here **only
 * as a test oracle**: for every value-position identifier in a corpus module,
 * compare the declaration the resolver binds against the declaration the
 * checker binds. The oracle checks *binding targets*, not value kinds — TS has
 * no notion of OpenElement's `signal`/`computed`/`prop` classification.
 *
 * The oracle program is virtual (no filesystem, `noResolve`/`noLib`) so no
 * module graph is built for the resolver under test.
 */

import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import {
  bindingKey,
  resolveModule,
  type ComponentFunction,
  type ImportClassifier,
  type ResolvedModule,
} from '../../src/internal/compiler/semantic-core/scope-resolution.ts';

const FILE = '/proj/src/oracle.tsx';

// ─── Resolver side ──────────────────────────────────────────────────────────

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile(FILE, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
}

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

function runtimeClassifier(): ImportClassifier {
  return {
    classifySymbol: (specifier, importedName) => {
      if (specifier !== 'runtime') return undefined;
      if (importedName === null) return 'namespace';
      if (importedName === 'signal' || importedName === 'computed') return 'factory';
      return 'value';
    },
    classifyValue: () => undefined,
    classifyCall: (specifier, importedName) =>
      specifier === 'runtime' && (importedName === 'signal' || importedName === 'computed')
        ? { call: importedName }
        : undefined,
    classifyMember: () => undefined,
  };
}

// ─── Oracle side ────────────────────────────────────────────────────────────

interface Oracle {
  readonly program: ts.Program;
  readonly checker: ts.TypeChecker;
  readonly sourceFile: ts.SourceFile;
}

/** A virtual, single-file TS program: source in, checker out. No real FS. */
function createOracle(source: string): Oracle {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noResolve: true,
    noLib: true,
    types: [],
    jsx: ts.JsxEmit.Preserve,
  };
  const sourceFile = parse(source);
  const host = ts.createCompilerHost(options, true);
  const defaultGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) =>
    fileName === FILE
      ? sourceFile
      : defaultGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  host.fileExists = (fileName) => fileName === FILE;
  host.readFile = (fileName) => (fileName === FILE ? source : undefined);
  const program = ts.createProgram([FILE], options, host);
  return { program, checker: program.getTypeChecker(), sourceFile };
}

/** The checker's binding target: the authored name offset of one declaration. */
function declarationNameOffset(
  declaration: ts.Declaration,
  sourceFile: ts.SourceFile,
): number | undefined {
  if (ts.isImportSpecifier(declaration)) return declaration.name.getStart(sourceFile);
  if (ts.isImportClause(declaration)) return declaration.name?.getStart(sourceFile);
  if (ts.isNamespaceImport(declaration)) return declaration.name.getStart(sourceFile);
  if (ts.isBindingElement(declaration)) {
    return ts.isIdentifier(declaration.name) ? declaration.name.getStart(sourceFile) : undefined;
  }
  if (
    ts.isFunctionDeclaration(declaration) ||
    ts.isFunctionExpression(declaration) ||
    ts.isClassDeclaration(declaration) ||
    ts.isClassExpression(declaration) ||
    ts.isVariableDeclaration(declaration) ||
    ts.isParameter(declaration)
  ) {
    return ts.isIdentifier(declaration.name) ? declaration.name.getStart(sourceFile) : undefined;
  }
  return declaration.getStart(sourceFile);
}

function oracleBindingOffset(
  checker: ts.TypeChecker,
  identifier: ts.Identifier,
  sourceFile: ts.SourceFile,
): number | undefined {
  const symbol = checker.getSymbolAtLocation(identifier);
  if (symbol === undefined) return undefined;
  const offsets: number[] = [];
  for (const declaration of symbol.declarations ?? []) {
    if (declaration.getSourceFile() !== sourceFile) continue;
    const offset = declarationNameOffset(declaration, sourceFile);
    if (offset !== undefined) offsets.push(offset);
  }
  if (offsets.length === 0) return undefined;
  return Math.min(...offsets);
}

/**
 * Mirrors the resolver's value-position rule independently: property names,
 * declaration names, labels, JSX attribute names and intrinsic tags are not
 * reads; component tags are.
 */
function isValuePosition(identifier: ts.Identifier): boolean {
  const parent = identifier.parent as ts.Node | undefined;
  if (parent === undefined) return false;
  if (ts.isPropertyAccessExpression(parent)) return parent.expression === identifier;
  if (ts.isQualifiedName(parent)) return false;
  if (ts.isPropertyAssignment(parent)) return parent.name !== identifier;
  if (ts.isShorthandPropertyAssignment(parent)) return parent.name === identifier;
  if (ts.isBindingElement(parent)) return false;
  if (ts.isVariableDeclaration(parent)) return parent.name !== identifier;
  if (ts.isParameter(parent)) return parent.name !== identifier;
  if (
    ts.isFunctionDeclaration(parent) ||
    ts.isFunctionExpression(parent) ||
    ts.isClassDeclaration(parent) ||
    ts.isClassExpression(parent) ||
    ts.isMethodDeclaration(parent) ||
    ts.isPropertyDeclaration(parent) ||
    ts.isGetAccessorDeclaration(parent) ||
    ts.isSetAccessorDeclaration(parent) ||
    ts.isImportClause(parent) ||
    ts.isImportSpecifier(parent) ||
    ts.isNamespaceImport(parent) ||
    ts.isImportEqualsDeclaration(parent) ||
    ts.isExportSpecifier(parent) ||
    ts.isNamespaceExport(parent) ||
    ts.isLabeledStatement(parent) ||
    ts.isBreakStatement(parent) ||
    ts.isContinueStatement(parent) ||
    ts.isJsxAttribute(parent) ||
    ts.isJsxNamespacedName(parent) ||
    ts.isMetaProperty(parent)
  ) {
    return false;
  }
  if (
    ts.isJsxOpeningElement(parent) ||
    ts.isJsxSelfClosingElement(parent) ||
    ts.isJsxClosingElement(parent)
  ) {
    return parent.tagName === identifier && /^[A-Z]/.test(identifier.text);
  }
  return true;
}

function allIdentifiers(sourceFile: ts.SourceFile): ts.Identifier[] {
  const identifiers: ts.Identifier[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) identifiers.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return identifiers;
}

/** Compare every value-position identifier's binding target against TS. */
function differential(source: string): {
  readonly module: ResolvedModule;
  readonly mismatches: string[];
  readonly compared: number;
} {
  const module = resolveModule(parse(source), {
    components: collectComponents(parse(source)),
    importClassifier: runtimeClassifier(),
  });
  const oracle = createOracle(source);
  const mismatches: string[] = [];
  let compared = 0;
  for (const identifier of allIdentifiers(oracle.sourceFile)) {
    if (!isValuePosition(identifier)) continue;
    const offset = identifier.getStart(oracle.sourceFile);
    const ours = module.resolveIdentifier(identifier);
    const tsOffset = oracleBindingOffset(oracle.checker, identifier, oracle.sourceFile);
    const label = `${identifier.text}@${offset}`;
    if (ours === undefined || ours.origin.form === 'builtin') {
      // A builtin global has no declaration in the noLib program; an unresolved
      // read must stay unresolved for the author's symbol.
      if (ours === undefined && tsOffset !== undefined) {
        mismatches.push(`${label}: TypeScript binds an in-file declaration at ${tsOffset}`);
      }
      continue;
    }
    compared += 1;
    if (tsOffset === undefined) {
      mismatches.push(
        `${label}: resolver binds '${ours.id.name}' (${bindingKey(ours.id)}) but TypeScript has no in-file declaration`,
      );
      continue;
    }
    if (tsOffset !== ours.declarationSpan.start) {
      mismatches.push(
        `${label}: resolver declaration at ${ours.declarationSpan.start}, TypeScript declaration at ${tsOffset}`,
      );
    }
  }
  return { module, mismatches, compared };
}

// ─── Corpus ─────────────────────────────────────────────────────────────────

const CORPUS: ReadonlyArray<{ name: string; source: string; minimumComparisons: number }> = [
  {
    name: 'shadowing, hoisting and closures',
    minimumComparisons: 6,
    source: `
      function C(props) {
        let value = 1;
        {
          let value = 2;
          value;
        }
        var hoisted = value;
        const read = () => value;
        return <p>{value}{hoisted}{read()}</p>;
      }
    `,
  },
  {
    name: 'destructuring and parameter defaults',
    minimumComparisons: 6,
    source: `
      function C(props, second = props) {
        const { a, b: renamed, c = second, ...rest } = props;
        const [first, , third] = props.items;
        return <p>{a}{renamed}{c}{rest}{first}{third}</p>;
      }
    `,
  },
  {
    name: 'catch, for-let, switch and parameter scope',
    minimumComparisons: 5,
    source: `
      function C(props) {
        try { throw props; } catch (caught) { caught; }
        for (let i = 0; i < 2; i++) { i; }
        switch (props.kind) {
          case 1: { let scoped = 1; scoped; break; }
          case 2: props.kind;
        }
        return <p>{String(props.kind)}</p>;
      }
    `,
  },
  {
    name: 'class declaration, class expression and self-name',
    minimumComparisons: 3,
    source: `
      class Counter { static create() { return new Counter(); } }
      const Factory = class Internal { static make() { return Internal; } };
      function C(props) { return <div>{new Counter()}</div>; }
    `,
  },
  {
    name: 'imports, aliases, namespace, default and type-only',
    minimumComparisons: 6,
    source: `
      import def from 'runtime';
      import * as NS from 'runtime';
      import { signal as s, type Widget } from 'runtime';
      function Row(props) { return <li>{props.name}</li>; }
      function C(props) {
        const count = s(0);
        return <p>{def}{NS.member}{count.value}{Widget}</p>;
      }
    `,
  },
  {
    name: 'named function expression and block function declaration',
    minimumComparisons: 4,
    source: `
      function C(props) {
        const fn = function self() { return self; };
        if (props.ok) {
          function blockScoped() { return 1; }
          blockScoped();
        }
        return <p>{fn()}</p>;
      }
    `,
  },
];

describe('differential oracle: resolver binding targets vs TypeScript', () => {
  test('the pinned TypeScript version is recorded', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    expect(manifest.dependencies?.typescript).toBe('6.0.3');
    expect(ts.version).toBe(manifest.dependencies?.typescript);
  });

  for (const entry of CORPUS) {
    test(`agrees with the checker: ${entry.name}`, () => {
      const { mismatches, compared } = differential(entry.source);
      expect(mismatches).toEqual([]);
      expect(compared).toBeGreaterThanOrEqual(entry.minimumComparisons);
    });
  }

  test('a shadowed inner declaration matches the checker, not the outer one', () => {
    const source = `
      function C(props) {
        let value = 1;
        { let value = 2; value; }
        return <p>{value}</p>;
      }
    `;
    const { module, mismatches } = differential(source);
    expect(mismatches).toEqual([]);
    const identifiers = allIdentifiers(module.sourceFile).filter(
      (identifier) => identifier.text === 'value' && isValuePosition(identifier),
    );
    // Declaration name occurrences are not value positions: one read inside the
    // block, one read in JSX.
    expect(identifiers).toHaveLength(2);
    const scopes = identifiers.map(
      (identifier) => module.resolveIdentifier(identifier)?.id.scope.path,
    );
    expect(scopes[0]).not.toBe(scopes[1]);
  });

  test('a factory import binds the import specifier, matching the checker', () => {
    const source = `
      import { signal as makeSignal } from 'runtime';
      function C(props) { const count = makeSignal(0); return <p>{count.value}</p>; }
    `;
    const { module, mismatches } = differential(source);
    expect(mismatches).toEqual([]);
    const binding = module.bindings.find((candidate) => candidate.id.name === 'makeSignal')!;
    const sourceFile = module.sourceFile;
    expect(
      sourceFile.getFullText().slice(binding.declarationSpan.start, binding.declarationSpan.end),
    ).toBe('makeSignal');
  });
});
