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
import type { RootMode } from '@openelement/protocol/part-program';
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
   * The root mode the sidecar itself declares, or undefined when the author
   * pinned none.
   *
   * D-root-source (2026-11-13): the compiler lane re-reads the authored
   * sidecar instead of receiving the root on the host site fact, so the fact
   * cannot go stale between the host's scan and this transform. The host fact
   * still owns the tag.
   */
  readonly root: RootMode | undefined;
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
  return islandPolicyObjectLiteral(sourceFile) !== null;
}

/**
 * The one locator for the sidecar statement's config object literal. Both the
 * marker check and {@link readIslandRoot} read through it, so the two can never
 * disagree about which statement is the island policy.
 */
function islandPolicyObjectLiteral(sourceFile: ts.SourceFile): ts.ObjectLiteralExpression | null {
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
    const descriptor = initializer.arguments[0]!;
    if (ts.isObjectLiteralExpression(descriptor)) return descriptor;
  }
  return null;
}

/**
 * The result of reading the sidecar's `root` from the authored AST.
 *
 * `absent` covers both "no sidecar in this module" and "a sidecar that pins no
 * root"; the caller distinguishes them with {@link hasIslandPolicyStatement}.
 */
export type IslandRootRead =
  | { readonly kind: 'absent' }
  | { readonly kind: 'root'; readonly root: RootMode }
  | { readonly kind: 'refused'; readonly diagnostic: IrDiagnostic };

/** The static property name of a key/value pair, or null when unreadable. */
function staticPropertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) && name.text.length > 0) return name.text;
  return null;
}

function rootDiagnostic(sourceFile: ts.SourceFile, node: ts.Node, message: string): IrDiagnostic {
  return diagnosticAt(sourceFile, node, GENERATED_ELEMENT_DIAGNOSTIC.ROOT_INVALID, message);
}

/**
 * Read the sidecar's `root` from the authored AST (D-root-source, 2026-11-13).
 *
 * The router's static scanner is the authority for the sidecar's accepted
 * shape, its accepted key set and its error text; this reader exists because
 * the compiler lane must not carry a root fact across the host boundary. It is
 * deliberately narrower than the scanner: it reads the ONE key it needs, and
 * it refuses — instead of guessing — whenever the value cannot be proven from
 * the literal text (`OEIR_GENERATED_ELEMENT_ROOT_INVALID`, source-located).
 *
 * The author-facing vocabulary is the sidecar's `'light' | 'shadow'`; the
 * descriptor's `'shadow'` is the DSD default, which the shell spells
 * `shadow-open`. Closed roots have no author spelling (`D-closed`), so no
 * mapping to `shadow-closed` exists here.
 */
export function readIslandRoot(sourceFile: ts.SourceFile): IslandRootRead {
  const descriptor = islandPolicyObjectLiteral(sourceFile);
  if (descriptor === null) return { kind: 'absent' };
  let seenRoot = false;
  let declared: 'light' | 'shadow' | null = null;
  for (const property of descriptor.properties) {
    // A spread, a shorthand, a method or a computed key makes the object's key
    // set unprovable: the root fact could hide behind it, so nothing is read.
    if (!ts.isPropertyAssignment(property)) {
      return {
        kind: 'refused',
        diagnostic: rootDiagnostic(
          sourceFile,
          property,
          'the openElement sidecar must contain only static key/value pairs; ' +
            `"${property.getText(sourceFile)}" cannot be read statically, so the root fact ` +
            'cannot be established',
        ),
      };
    }
    const name = staticPropertyName(property.name);
    if (name === null) {
      return {
        kind: 'refused',
        diagnostic: rootDiagnostic(
          sourceFile,
          property.name,
          `the openElement sidecar key "${property.name.getText(sourceFile)}" is not a static ` +
            'property name, so the root fact cannot be established',
        ),
      };
    }
    if (name !== 'root') continue;
    if (seenRoot) {
      return {
        kind: 'refused',
        diagnostic: rootDiagnostic(
          sourceFile,
          property,
          'the openElement sidecar declares root more than once, so the root fact is ambiguous',
        ),
      };
    }
    seenRoot = true;
    const initializer = property.initializer;
    if (!ts.isStringLiteral(initializer)) {
      return {
        kind: 'refused',
        diagnostic: rootDiagnostic(
          sourceFile,
          initializer,
          'openElement.root must be a static literal, got dynamic value ' +
            `"${initializer.getText(sourceFile)}"`,
        ),
      };
    }
    if (initializer.text !== 'light' && initializer.text !== 'shadow') {
      return {
        kind: 'refused',
        diagnostic: rootDiagnostic(
          sourceFile,
          initializer,
          `openElement.root has unsupported value "${initializer.text}"; ` +
            'use "light" or "shadow"',
        ),
      };
    }
    declared = initializer.text;
  }
  if (declared === null) return { kind: 'absent' };
  return { kind: 'root', root: declared === 'light' ? 'light' : 'shadow-open' };
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
  const rootRead = readIslandRoot(sourceFile);
  if (rootRead.kind === 'refused') {
    return { kind: 'refused', diagnostics: [rootRead.diagnostic] };
  }
  return {
    kind: 'admitted',
    admission: {
      componentName: fact.name,
      defaultExportSpan: fact.span,
      root: rootRead.kind === 'root' ? rootRead.root : undefined,
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
