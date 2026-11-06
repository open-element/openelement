import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import ts from 'typescript';
import {
  CompiledElementError,
  compileElementProgram,
} from '../../../packages/compiler/src/internal/compiler/semantic-core/compile.ts';

const CORE_ROOT = new URL(
  '../../../packages/compiler/src/internal/compiler/semantic-core/',
  import.meta.url,
);
/**
 * The canonical Part Program protocol module (ADR-0148 exchange artifact).
 * It is the one deliberate outside-module import: import-free, bundler-neutral,
 * and shared with the runtime so compiler and runtime cannot drift.
 */
const PROTOCOL_PROGRAM = new URL('../../../packages/protocol/src/part-program.ts', import.meta.url);
/** The import-free, host-free canonical VOID_TAGS owner (protocol base). */
const PROTOCOL_VOID_TAGS = new URL('../../../packages/protocol/src/void-tags.ts', import.meta.url);
/** The import-free, host-free canonical forbidden-sink owner (protocol base). */
const PROTOCOL_FORBIDDEN_SINKS = new URL(
  '../../../packages/protocol/src/forbidden-sinks.ts',
  import.meta.url,
);
/**
 * The import-free, host-free error contract (#1386 item 3). The semantic core
 * raises `OpenElementError`, so the class has to live where a compiler module
 * may import it without gaining host state — the same admission rule as the
 * other protocol base owners.
 */
const PROTOCOL_ERRORS = new URL('../../../packages/protocol/src/errors.ts', import.meta.url);

/** Protocol base owners a semantic-core or protocol module may import. */
const PROTOCOL_BASE = [
  { url: PROTOCOL_VOID_TAGS, label: 'VOID_TAGS owner' },
  { url: PROTOCOL_FORBIDDEN_SINKS, label: 'forbidden-sink owner' },
  { url: PROTOCOL_ERRORS, label: 'error contract' },
] as const;

async function sourceFiles(root: URL): Promise<URL[]> {
  const files: URL[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const url = new URL(entry.name, root);
    if (entry.isDirectory()) files.push(...(await sourceFiles(new URL(`${url.href}/`))));
    if (entry.isFile() && entry.name.endsWith('.ts')) files.push(url);
  }
  return files.sort((a, b) => a.href.localeCompare(b.href));
}

/**
 * Sentinel specifier for a dynamic `import()`/`require()` whose argument is
 * not a string literal. The ADR-0148 boundary admits only statically known
 * module edges, so an unknown specifier is reported as a violation (fail
 * closed) rather than skipped.
 */
const OPAQUE_DYNAMIC_SPECIFIER = '<dynamic:non-literal>';

/**
 * The module edges of one source file: static `import`/`export ... from`
 * specifiers, TypeScript `import x = require(...)` edges, plus the literal
 * specifiers of dynamic `import(...)` / `require(...)` calls. A non-literal
 * dynamic argument is carried as {@link OPAQUE_DYNAMIC_SPECIFIER} so every
 * consumer fails closed on it.
 */
function moduleSpecifiers(source: string, file: URL): string[] {
  const specifiers: string[] = [];
  const sourceFile = ts.createSourceFile(
    file.pathname,
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      specifiers.push(node.moduleReference.expression.text);
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if (isDynamicImport || isRequire) {
        const [argument] = node.arguments;
        specifiers.push(
          argument !== undefined && ts.isStringLiteral(argument)
            ? argument.text
            : OPAQUE_DYNAMIC_SPECIFIER,
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

/**
 * ADR-0148 admission for one source module's edges: every edge must stay
 * inside the semantic core, name the canonical Part Program protocol (or the
 * import-free protocol base owners), or be a bundler-neutral external module.
 * `coreRoot` is a parameter so the rule can be exercised against a throwaway
 * core layout as well as the real one.
 */
function boundaryViolations(source: string, file: URL, coreRoot: URL): string[] {
  const violations: string[] = [];
  for (const specifier of moduleSpecifiers(source, file)) {
    if (specifier === OPAQUE_DYNAMIC_SPECIFIER) {
      violations.push(
        `${file.pathname}: dynamic import()/require() with a non-literal specifier ` +
          'is not statically admissible',
      );
      continue;
    }
    if (!specifier.startsWith('.')) {
      if (!/^(?:typescript|@openelement\/protocol\/[a-z-]+)$/.test(specifier)) {
        violations.push(`${file.pathname}: external import "${specifier}"`);
      }
      continue;
    }
    const resolved = new URL(specifier, file);
    const insideCore = resolved.href.startsWith(coreRoot.href);
    const isCanonicalProtocol =
      resolved.href === PROTOCOL_PROGRAM.href ||
      PROTOCOL_BASE.some((base) => base.url.href === resolved.href);
    if (!insideCore && !isCanonicalProtocol) {
      violations.push(`${file.pathname}: escapes semantic core through "${specifier}"`);
    }
  }
  return violations;
}

test('ADR-0148 semantic core imports stay bundler-neutral and inside the core', async () => {
  const files = await sourceFiles(CORE_ROOT);
  expect(files.length > 0, 'semantic core must contain source files').toBeTruthy();

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    expect(
      boundaryViolations(source, file, CORE_ROOT),
      `${file.pathname} must satisfy the ADR-0148 module-edge rule`,
    ).toEqual([]);

    expect(
      !/PluginContext|moduleGraph|hotUpdate|devServer/.test(source),
      `${file.pathname} accepts integration lifecycle state`,
    ).toBeTruthy();
  }

  // The allowed outside modules must stay neutral: no runtime, Vite, or Node
  // capability may ride into the semantic core. The Part Program artifact's
  // only edges are the import-free canonical protocol base owners.
  const protocolSource = await readFile(PROTOCOL_PROGRAM, 'utf8');
  expect(
    moduleSpecifiers(protocolSource, PROTOCOL_PROGRAM),
    'canonical Part Program protocol may only import the protocol base owners (ADR-0148)',
  ).toEqual(['./errors.ts', './forbidden-sinks.ts', './void-tags.ts']);
  for (const { url, label } of PROTOCOL_BASE) {
    const source = await readFile(url, 'utf8');
    expect(moduleSpecifiers(source, url), `canonical ${label} must stay import-free`).toEqual([]);
  }
  for (const [source, label] of [
    [protocolSource, 'Part Program protocol'],
    ...(await Promise.all(
      PROTOCOL_BASE.map(async ({ url, label }) => [await readFile(url, 'utf8'), label] as const),
    )),
  ] as const) {
    expect(
      !/PluginContext|moduleGraph|hotUpdate|devServer|Deno\./.test(source),
      `${label} must not accept integration or host state`,
    ).toBeTruthy();
  }
});

test('ADR-0148 boundary rule rejects host edges and dynamic specifiers it cannot see statically', async () => {
  // A throwaway semantic-core layout: the same rule is exercised against files
  // that are NOT the real core, so the negative cases can be written freely and
  // nothing lands in the repository. The temporary tree is removed in `finally`.
  const rootPath = await mkdtemp(`${tmpdir()}/oe-semantic-core-boundary-`);
  const coreRoot = pathToFileURL(`${rootPath}/`);
  const rejectedCases = [
    {
      file: 'static-node-edge.ts',
      source: `import { readFileSync } from 'node:fs';\n`,
      expected: 'node:fs',
    },
    {
      file: 'static-vite-edge.ts',
      source: `import { createServer } from 'vite';\n`,
      expected: 'vite',
    },
    {
      file: 'dynamic-node-edge.ts',
      source: `export async function load() {\n  return import('node:fs');\n}\n`,
      expected: 'node:fs',
    },
    {
      file: 'dynamic-require-edge.ts',
      source: `export function load() {\n  return require('vite');\n}\n`,
      expected: 'vite',
    },
    {
      file: 'import-equals-node-edge.ts',
      source: `import fs = require('node:fs');\n`,
      expected: 'node:fs',
    },
    {
      file: 'opaque-dynamic-edge.ts',
      source: `export function load(specifier: string) {\n  return import(specifier);\n}\n`,
      expected: 'non-literal specifier',
    },
    {
      file: 'relative-escape.ts',
      source: `import { outside } from '../outside.ts';\n`,
      expected: 'escapes semantic core',
    },
  ] as const;
  try {
    for (const { file, source } of rejectedCases) {
      await writeFile(new URL(file, coreRoot), source);
    }
    // In-core relative imports (static and dynamic) and the protocol base are
    // admissible: the extended scan must not blanket-deny dynamic imports.
    const legalFile = new URL('legal-module.ts', coreRoot);
    await writeFile(new URL('legal-helper.ts', coreRoot), 'export const helper = 1;\n');
    await writeFile(
      legalFile,
      [
        `import { helper } from './legal-helper.ts';`,
        `import { VOID_TAGS } from '@openelement/protocol/void-tags';`,
        `export async function load() {`,
        `  return import('./legal-helper.ts');`,
        `}`,
        `export const size = helper + VOID_TAGS.size;`,
        ``,
      ].join('\n'),
    );

    for (const { file, expected } of rejectedCases) {
      const url = new URL(file, coreRoot);
      const violations = boundaryViolations(await readFile(url, 'utf8'), url, coreRoot);
      expect(violations.length, `${file} must be rejected`).toBeGreaterThan(0);
      expect(violations.join('\n'), file).toContain(expected);
    }
    expect(
      boundaryViolations(await readFile(legalFile, 'utf8'), legalFile, coreRoot),
      'in-core relative and protocol-base module edges stay admissible',
    ).toEqual([]);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test('ADR-0148 semantic output and diagnostics are stable for canonical inputs', () => {
  const source = `
import { element, OpenElement, property } from '@openelement/element';
@element('oe-deterministic')
export default class DeterministicElement extends OpenElement {
  @property({ reflect: false }) count = 0;
  increment(): void { this.count++; }
  render() { return <button onClick={this.increment}>{this.count}</button>; }
}`;
  const file = '/canonical/app/islands/deterministic.tsx';
  const outputs = Array.from({ length: 3 }, () => compileElementProgram(source, file));
  expect(outputs[1].code).toEqual(outputs[0].code);
  expect(outputs[2].code).toEqual(outputs[0].code);
  expect(JSON.stringify(outputs[1].program)).toEqual(JSON.stringify(outputs[0].program));
  expect(JSON.stringify(outputs[2].program)).toEqual(JSON.stringify(outputs[0].program));

  const invalid = `${source}\nconst runtimeTopLevel = Date.now();`;
  const diagnostics = Array.from({ length: 3 }, () => {
    try {
      compileElementProgram(invalid, file);
      throw new Error('invalid source unexpectedly compiled');
    } catch (error) {
      expect(error instanceof CompiledElementError).toBeTruthy();
      return JSON.stringify(error.diagnostics);
    }
  });
  expect(diagnostics[1]).toEqual(diagnostics[0]);
  expect(diagnostics[2]).toEqual(diagnostics[0]);
});
