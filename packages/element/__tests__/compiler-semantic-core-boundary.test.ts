import { assert, assertEquals } from '@std/assert';
import ts from 'typescript';
import {
  CompiledElementError,
  compileElementProgram,
} from '../src/internal/compiler/semantic-core/compile.ts';

const CORE_ROOT = new URL('../src/internal/compiler/semantic-core/', import.meta.url);

async function sourceFiles(root: URL): Promise<URL[]> {
  const files: URL[] = [];
  for await (const entry of Deno.readDir(root)) {
    const url = new URL(entry.name, root);
    if (entry.isDirectory) files.push(...await sourceFiles(new URL(`${url.href}/`)));
    if (entry.isFile && entry.name.endsWith('.ts')) files.push(url);
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
      statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      specifiers.push(statement.moduleSpecifier.text);
    }
  }
  return specifiers;
}

Deno.test('ADR-0148 semantic core imports stay bundler-neutral and inside the core', async () => {
  const files = await sourceFiles(CORE_ROOT);
  assert(files.length > 0, 'semantic core must contain source files');

  for (const file of files) {
    const source = await Deno.readTextFile(file);
    for (const specifier of moduleSpecifiers(source, file)) {
      if (!specifier.startsWith('.')) {
        assertEquals(specifier, 'typescript', `${file.pathname} external import`);
        continue;
      }
      const resolved = new URL(specifier, file);
      assert(
        resolved.href.startsWith(CORE_ROOT.href),
        `${file.pathname} escapes semantic core through ${specifier}`,
      );
    }

    assert(
      !/PluginContext|moduleGraph|hotUpdate|devServer/.test(source),
      `${file.pathname} accepts integration lifecycle state`,
    );
  }
});

Deno.test('ADR-0148 semantic output and diagnostics are stable for canonical inputs', () => {
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
  assertEquals(outputs[1].code, outputs[0].code);
  assertEquals(outputs[2].code, outputs[0].code);
  assertEquals(JSON.stringify(outputs[1].program), JSON.stringify(outputs[0].program));
  assertEquals(JSON.stringify(outputs[2].program), JSON.stringify(outputs[0].program));

  const invalid = `${source}\nconst runtimeTopLevel = Date.now();`;
  const diagnostics = Array.from({ length: 3 }, () => {
    try {
      compileElementProgram(invalid, file);
      throw new Error('invalid source unexpectedly compiled');
    } catch (error) {
      assert(error instanceof CompiledElementError);
      return JSON.stringify(error.diagnostics);
    }
  });
  assertEquals(diagnostics[1], diagnostics[0]);
  assertEquals(diagnostics[2], diagnostics[0]);
});
