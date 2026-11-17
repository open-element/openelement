/**
 * The island/component policy sidecar locator — ONE definition for every reader.
 *
 * A generated element declares its platform facts in the sidecar statement
 *
 *   `export const openElement = defineIslandConfig({ ... })`   (router islands)
 *   `export const openElement = defineComponentConfig({ ... })` (ui components)
 *
 * Two independent readers need this shape: the generated-element lane (which
 * validates and reads the config) and the module-semantics fact
 * `hasGeneratedElementSidecar` (which lets the router's auto-admission
 * derivation recognize a generated component module). Duplicating the locator
 * would let them disagree about WHICH statement is the policy — the drift class
 * P6/P8 forbid — so it lives here and both import it.
 *
 * Binding provenance (which local name a host's descriptor binds) is NOT
 * decided here: the host's admission has already answered that question before
 * either reader runs. This is the statement SHAPE only.
 */
import ts from 'typescript';

/** The exported name the sidecar statement must bind. */
const SIDECAR_NAME = 'openElement';

/**
 * Locate the sidecar's config object literal, or `null` when the module has
 * none. Exactly one `export const openElement = <call>({...})` statement is
 * recognized: extra modifiers, a multi-declaration list, a non-identifier name,
 * a non-call initializer or a non-object argument all mean "not the sidecar".
 */
export function islandPolicyObjectLiteral(
  sourceFile: ts.SourceFile,
): ts.ObjectLiteralExpression | null {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const modifiers = ts.getModifiers(statement) ?? [];
    if (modifiers.length !== 1 || modifiers[0]!.kind !== ts.SyntaxKind.ExportKeyword) continue;
    const declarations = statement.declarationList.declarations;
    if (declarations.length !== 1) continue;
    const declaration = declarations[0]!;
    if (!ts.isIdentifier(declaration.name) || declaration.name.text !== SIDECAR_NAME) continue;
    const initializer = declaration.initializer;
    if (initializer === undefined || !ts.isCallExpression(initializer)) continue;
    if (initializer.arguments.length !== 1) continue;
    const descriptor = initializer.arguments[0]!;
    if (ts.isObjectLiteralExpression(descriptor)) return descriptor;
  }
  return null;
}

/** Whether the module carries the sidecar statement at all. */
export function hasIslandPolicyStatement(sourceFile: ts.SourceFile): boolean {
  return islandPolicyObjectLiteral(sourceFile) !== null;
}
