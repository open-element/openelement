/**
 * M09-1a — site admission for the generated native element lane.
 *
 * The lane runs inside the compiler transform, before the router's island
 * transform. It therefore cannot see `__tagName` and cannot derive the tag; the
 * host passes one {@link GeneratedElementSite} fact for a module it has already
 * resolved under `islandsDir`. This module supplies the rest of the admission
 * from the authored AST — the one explicit "Native Export" marker, a local
 * default-exported function component, and the M09-1a fail-closed gates.
 *
 * It re-derives no semantic model: the default-export fact is a small syntax
 * walk over the same `typescriptParser` AST, matched by name against
 * `FunctionModelModule.components` (decision D4a's smaller-diff alternative —
 * adding `isDefaultExport` to the M03 model — would touch the parity surface).
 *
 * Structural opt-outs stay silent (the lane returns null and the module falls
 * through to the class lane or the existing passthrough):
 *
 * - no default export;
 * - `export default class` (the retiring class lane owns it);
 * - `export default <expression>`, including a `definePage(...)` call;
 * - a re-export (`export { default } from './x.tsx'`), including the
 *   `export { default } from '../site-ui/...'` island shape. Resolving
 *   re-exported function islands is M09-2/M11 work (residual R11);
 * - an anonymous default function.
 *
 * A local default-exported function is admitted structurally, then the lane
 * compiles it through the real function frontend. If the frontend does not
 * model it as a component, this module refuses with
 * `OEIR_GENERATED_ELEMENT_NOT_A_COMPONENT` instead of silently shipping a
 * non-constructor default export.
 */

import ts from 'typescript';
import { type SourceSpan } from '../../semantic-core/scope-resolution.ts';
import { type FunctionModelComponent } from '../../semantic-core/function-frontend.ts';
import type { IrDiagnostic } from '../types.ts';
import type { GeneratedLeafModule } from '../generated-leaf/generate.ts';
import { GENERATED_ELEMENT_DIAGNOSTIC, type GeneratedElementSite } from './contract.ts';

/** The default export is a local function declaration or local arrow/function const. */
export interface LocalFunctionDefaultExport {
  readonly kind: 'local-function';
  readonly name: string;
  readonly node: ts.FunctionLikeDeclaration;
  readonly span: SourceSpan;
}

/**
 * The narrowed default-export fact. `class`, `expression` and `anonymous` are
 * structural opt-outs; `null` means the module has no default export at all.
 */
export type DefaultExportFact =
  | LocalFunctionDefaultExport
  | { readonly kind: 'class' }
  | { readonly kind: 'expression' }
  | { readonly kind: 'anonymous' };

/** The root-component facts the gates need, derived from the authored AST. */
export interface GeneratedElementSiteAdmission {
  readonly componentName: string;
  /** The default-export node, used for source-located refusals. */
  readonly defaultExportSpan: SourceSpan;
  /**
   * The root component's props parameter spelling, or null when it takes none.
   *
   * This is deliberately derived from the AST parameter list rather than from
   * `FunctionModelComponent.propsParam`: that field is also null for a
   * destructured parameter, so a `propsParam !== null` test would admit
   * `function Profile({ label })` with no attribute channel. The M09-1a gate's
   * intent ("the presence of a props parameter is the whole test") is the AST
   * fact, and this closes the hole the model field cannot express.
   */
  readonly propsParameter: string | null;
}

export type GeneratedElementSiteAdmissionResult =
  | { readonly kind: 'declined' }
  | { readonly kind: 'refused'; readonly diagnostics: readonly IrDiagnostic[] }
  | { readonly kind: 'admitted'; readonly admission: GeneratedElementSiteAdmission };

function spanOf(sourceFile: ts.SourceFile, node: ts.Node): SourceSpan {
  const start = node.getStart(sourceFile);
  const end = node.getEnd();
  const position = sourceFile.getLineAndCharacterOfPosition(start);
  return {
    file: sourceFile.fileName,
    start,
    end,
    line: position.line + 1,
    column: position.character + 1,
  };
}

function diagnosticAt(
  sourceFile: ts.SourceFile,
  node: ts.Node | null,
  code: string,
  message: string,
): IrDiagnostic {
  const span =
    node === null
      ? {
          file: sourceFile.fileName,
          start: 0,
          end: 0,
          line: 1,
          column: 1,
        }
      : spanOf(sourceFile, node);
  return { severity: 'error', code, message, span, origin: 'module' };
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  return (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind);
}

/**
 * The island policy statement, `export const openElement = defineIslandConfig({ ... })`.
 *
 * This is the STATEMENT shape validated by the class lane's
 * `isIslandConfigStatement`, with one deliberate difference: binding
 * provenance (which local name the injected static-sidecar descriptor binds)
 * is the host's admission decision and is not re-derived here. The compiler
 * package cannot import the router's `defineIslandConfig`; the host's site
 * predicate has already answered that question, and this check is the defense
 * in depth the `OEIR_GENERATED_ELEMENT_MISSING_SITE_MARKER` code names.
 */
export function hasIslandPolicyStatement(sourceFile: ts.SourceFile): boolean {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const modifiers = ts.getModifiers(statement) ?? [];
    if (modifiers.length !== 1 || modifiers[0]!.kind !== ts.SyntaxKind.ExportKeyword) continue;
    const declarations = statement.declarationList.declarations;
    if (declarations.length !== 1) continue;
    const declaration = declarations[0]!;
    if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'openElement') continue;
    const initializer = declaration.initializer;
    if (initializer === undefined || !ts.isCallExpression(initializer)) continue;
    if (initializer.arguments.length !== 1) continue;
    if (ts.isObjectLiteralExpression(initializer.arguments[0]!)) return true;
  }
  return false;
}

function localFunctionDeclaration(
  sourceFile: ts.SourceFile,
  name: string,
): ts.FunctionLikeDeclaration | null {
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
      return statement;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue;
      const initializer = declaration.initializer;
      if (
        initializer !== undefined &&
        (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
      ) {
        return initializer;
      }
      return null;
    }
  }
  return null;
}

function localFunctionFact(
  sourceFile: ts.SourceFile,
  name: string,
  node: ts.FunctionLikeDeclaration,
): LocalFunctionDefaultExport {
  return {
    kind: 'local-function',
    name,
    node,
    span: spanOf(sourceFile, node),
  };
}

/**
 * Classify the module's default export without compiling anything.
 *
 * `export default Name` is resolved against local top-level declarations only:
 * an imported or re-exported name is not a local function the lane can model,
 * and the design records that residual instead of guessing.
 */
export function findDefaultExport(sourceFile: ts.SourceFile): DefaultExportFact | null {
  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement)) {
      const expression = statement.expression;
      if (!ts.isIdentifier(expression)) return { kind: 'expression' };
      const local = localFunctionDeclaration(sourceFile, expression.text);
      return local === null
        ? { kind: 'expression' }
        : localFunctionFact(sourceFile, expression.text, local);
    }
    if (
      ts.isFunctionDeclaration(statement) &&
      hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
    ) {
      const name = statement.name?.text;
      if (name === undefined) return { kind: 'anonymous' };
      return localFunctionFact(sourceFile, name, statement);
    }
    if (ts.isClassDeclaration(statement) && hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
      return { kind: 'class' };
    }
    if (ts.isExportDeclaration(statement)) {
      // `export { default } from '…'` and the local `export { X as default }`
      // are re-exports, never a local default function declaration.
      const clause = statement.exportClause;
      if (clause !== undefined && ts.isNamedExports(clause)) {
        for (const element of clause.elements) {
          if (element.name.text === 'default') return { kind: 'expression' };
        }
      }
    }
  }
  return null;
}

function propsParameterOf(node: ts.FunctionLikeDeclaration): string | null {
  const parameter = node.parameters[0];
  if (parameter === undefined) return null;
  if (ts.isIdentifier(parameter.name)) return parameter.name.text;
  return node.getSourceFile().text.slice(parameter.name.getStart(), parameter.name.getEnd());
}

/**
 * Admit one module to the generated-element lane. `site` is the host's fact;
 * this function never derives a tag and never reads the filesystem.
 */
export function admitGeneratedElementSite(
  sourceFile: ts.SourceFile,
  site: GeneratedElementSite,
): GeneratedElementSiteAdmissionResult {
  const fact = findDefaultExport(sourceFile);
  if (
    fact === null ||
    fact.kind === 'class' ||
    fact.kind === 'expression' ||
    fact.kind === 'anonymous'
  ) {
    return { kind: 'declined' };
  }
  if (!hasIslandPolicyStatement(sourceFile)) {
    return {
      kind: 'refused',
      diagnostics: [
        diagnosticAt(
          sourceFile,
          fact.node,
          GENERATED_ELEMENT_DIAGNOSTIC.MISSING_SITE_MARKER,
          `the generated element site "${site.tag}" requires the island policy statement ` +
            '`export const openElement = defineIslandConfig({ ... })` in the same module',
        ),
      ],
    };
  }
  return {
    kind: 'admitted',
    admission: {
      componentName: fact.name,
      defaultExportSpan: fact.span,
      propsParameter: propsParameterOf(fact.node),
    },
  };
}

/**
 * The M09-1a props gate. `component.propsParam` names an identifier parameter;
 * the admission's AST fact also catches a destructured parameter, which the
 * model spells as null. Both are the same authoring fact: the root takes props.
 */
export function gateGeneratedElementRootProps(
  admission: GeneratedElementSiteAdmission,
  component: FunctionModelComponent,
): readonly IrDiagnostic[] {
  if (admission.propsParameter === null && component.propsParam === null) return [];
  const parameter = component.propsParam ?? admission.propsParameter ?? 'props';
  return [
    {
      severity: 'error',
      code: GENERATED_ELEMENT_DIAGNOSTIC.UNDECLARED_PROPS,
      message:
        `the generated element root component takes a props parameter "${parameter}", but ` +
        'M09-1 cannot declare attributes or property conversion yet; remove the parameter ' +
        'or pass props through an admitted binding source',
      span: component.span,
      origin: 'module',
    },
  ];
}

/**
 * The M09-1a bindings gate. The generated body reads `host.bindings[*]`; no
 * production binding source exists for a function island in this slice, so a
 * non-empty requirement fails closed instead of mounting with a missing value.
 */
export function gateGeneratedElementBindings(
  file: string,
  leaf: GeneratedLeafModule,
): readonly IrDiagnostic[] {
  if (leaf.requiredBindings.length === 0) return [];
  return [
    {
      severity: 'error',
      code: GENERATED_ELEMENT_DIAGNOSTIC.UNBOUND_BINDING,
      message:
        `the generated element root requires host binding(s) ${leaf.requiredBindings
          .map((name) => `"${name}"`)
          .join(', ')}, but no production binding source exists in M09-1; ` +
        'pass the values as module imports or wait for the binding import channel',
      span: { file, start: 0, end: 0, line: 1, column: 1 },
      origin: 'module',
    },
  ];
}
