import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { readdirSync } from 'node:fs';
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

function moduleSpecifiers(source: string, file: URL): string[] {
  const specifiers: string[] = [];
  const sourceFile = ts.createSourceFile(
    file.pathname,
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  for (const statement of sourceFile.statements) {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      specifiers.push(statement.moduleSpecifier.text);
    }
  }
  return specifiers;
}

test('ADR-0148 semantic core imports stay bundler-neutral and inside the core', async () => {
  const files = await sourceFiles(CORE_ROOT);
  expect(files.length > 0, 'semantic core must contain source files').toBeTruthy();

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const specifier of moduleSpecifiers(source, file)) {
      if (!specifier.startsWith('.')) {
        expect(specifier, `${file.pathname} external import`).toMatch(
          /^(?:typescript|@openelement\/protocol\/[a-z-]+)$/,
        );
        continue;
      }
      const resolved = new URL(specifier, file);
      const insideCore = resolved.href.startsWith(CORE_ROOT.href);
      const isCanonicalProtocol =
        resolved.href === PROTOCOL_PROGRAM.href ||
        PROTOCOL_BASE.some((base) => base.url.href === resolved.href);
      expect(
        insideCore || isCanonicalProtocol,
        `${file.pathname} escapes semantic core through ${specifier}`,
      ).toBeTruthy();
    }

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
