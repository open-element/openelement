import ts from 'typescript';
import { GENERATED_ELEMENT_SHELL_SPECIFIER } from '../../packages/compiler/src/internal/compiler/semantic-ir/generated-element/contract.ts';
import { GENERATED_LEAF_RUNTIME_SPECIFIER } from '../../packages/compiler/src/internal/compiler/semantic-ir/generated-leaf/generate.ts';
import { generatedElementProperties } from '../../packages/element/src/internal/compiled/generated-element/shell.ts';
import * as leafRuntime from '../../packages/element/src/internal/compiled/leaf-runtime.ts';
import { parseTypeScript } from '../../tools/lib/typescript-ast.ts';

// The benchmarks drive the emitted recipes directly. There is no custom element
// registration in the measured subject, so both class tails just return the descriptor.
const keepDescriptor = (descriptor: unknown): unknown => descriptor;
const runtimeModules = new Map<string, Readonly<Record<string, unknown>>>([
  [GENERATED_LEAF_RUNTIME_SPECIFIER, leafRuntime],
  [
    GENERATED_ELEMENT_SHELL_SPECIFIER,
    {
      createGeneratedElementClass: keepDescriptor,
      createGeneratedElementClassWithFeatures: keepDescriptor,
      generatedElementProperties,
    },
  ],
]);

/** Evaluate the real emitted body with its named imports supplied as local bindings. */
export function loadGeneratedBenchmarkModule<T>(
  code: string,
  result: string,
  leafOverrides: Readonly<Record<string, unknown>> = {},
): T {
  const file = parseTypeScript(code);
  const names: string[] = [];
  const values: unknown[] = [];
  let body = '';
  let offset = 0;

  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const { importClause, moduleSpecifier } = statement;
    const source = ts.isStringLiteral(moduleSpecifier) ? moduleSpecifier.text : '';
    const runtime = runtimeModules.get(source);
    if (!runtime) throw new Error(`[micro] unsupported emitted import source "${source}"`);
    const bindings = importClause?.namedBindings;
    if (
      !bindings ||
      !ts.isNamedImports(bindings) ||
      importClause?.name ||
      importClause?.isTypeOnly
    ) {
      throw new Error(`[micro] expected named runtime imports from "${source}"`);
    }
    for (const binding of bindings.elements) {
      const exported = binding.propertyName ?? binding.name;
      if (
        binding.isTypeOnly ||
        !ts.isIdentifier(exported) ||
        !Object.hasOwn(runtime, exported.text)
      ) {
        throw new Error(`[micro] unsupported emitted import "${exported.text}" from "${source}"`);
      }
      names.push(binding.name.text);
      values.push(
        source === GENERATED_LEAF_RUNTIME_SPECIFIER && Object.hasOwn(leafOverrides, exported.text)
          ? leafOverrides[exported.text]
          : runtime[exported.text],
      );
    }
    body += code.slice(offset, statement.getStart(file));
    offset = statement.getEnd();
  }

  if (names.length === 0) throw new Error('[micro] the emitted module has no runtime imports');
  body = (body + code.slice(offset))
    .replace(/^export default .*$/gm, '')
    .replace(/^export \{[^}]*\};$/gm, '')
    .replace(/^export /gm, '');

  // Keep the emitted Recipe and SSR code, lifting only the module syntax.
  const factory = new Function(...names, `${body}\n; return ${result};`);
  return factory(...values) as T;
}
