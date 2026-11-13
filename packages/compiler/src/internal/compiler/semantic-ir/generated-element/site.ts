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
import { camelToKebab, isSafeAttributeName } from '@openelement/protocol/forbidden-sinks';
import type { RootMode } from '@openelement/protocol/part-program';
import { literalValue } from '../../semantic-core/analyze-module.ts';
import { createModuleIntrinsicBindings } from '../../semantic-core/module-analysis.ts';
import { forbiddenSinkReason } from '@openelement/protocol/forbidden-sinks';
import { type SourceSpan } from '../../semantic-core/scope-resolution.ts';
import { type FunctionModelComponent } from '../../semantic-core/function-frontend.ts';
import type { IrDiagnostic } from '../types.ts';
import type { GeneratedLeafModule } from '../generated-leaf/generate.ts';
import {
  GENERATED_ELEMENT_DIAGNOSTIC,
  type GeneratedElementDefaultGraph,
  type GeneratedElementPlatformProperty,
  type GeneratedElementPlatformPropertyType,
  type GeneratedElementPrimitiveType,
  type GeneratedElementSite,
} from './contract.ts';

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
   * The native `delegatesFocus` fact the sidecar declares; false covers both an
   * absent key and an explicit `false` (the same descriptor behavior). The
   * reader has already refused `true` without `root: 'shadow'`.
   */
  readonly delegatesFocus: boolean;
  /**
   * Whether the sidecar declares a `properties` table at all (an empty table
   * counts). A declared table replaces the M09-1a props gate with the
   * type/table cross-check in {@link admitGeneratedElementProperties}.
   */
  readonly propertiesDeclared: boolean;
  /**
   * The resolved primitive property rows the emitter writes into the
   * descriptor, in sidecar authored order. Empty when no table is declared or
   * the declared table is empty.
   */
  readonly properties: readonly GeneratedElementPlatformProperty[];
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

/**
 * The platform facts the compiler lane reads from the authored sidecar.
 *
 * `root` is the descriptor root mode (`light | shadow-open`), or undefined
 * when the author pinned none (the shell's own `light` default then owns it).
 * `delegatesFocus` is the native focus-delegation fact; false covers both an
 * absent key and an explicit `false`, which are the same descriptor behavior.
 */
export interface IslandMetadataFacts {
  readonly root: RootMode | undefined;
  readonly delegatesFocus: boolean;
  /**
   * The parsed `properties` table, or undefined when the sidecar declares no
   * table at all (an empty table is `[]` and is a declaration). Resolution to
   * the typed props member list happens in the admission, which is the layer
   * that can see the root component's parameter.
   */
  readonly properties: readonly IslandPropertyDeclaration[] | undefined;
}

/**
 * One sidecar `properties` entry as read from the authored AST: the platform
 * facts a typed props member cannot express, with the attribute channel
 * already resolved (omitted ⇒ `camelToKebab(name)`, `false` ⇒ null) so this
 * reader and the router scanner compare one vocabulary.
 */
export interface IslandPropertyDeclaration {
  readonly name: string;
  readonly attribute: string | null;
  /**
   * True when the sidecar spells `attribute` explicitly (a string or `false`).
   * Non-primitive rows require the explicit `false` spelling; an omitted key
   * would derive a kebab attribute and silently open the JSON-attribute path.
   */
  readonly attributeExplicit: boolean;
  readonly reflect: boolean;
  /**
   * Authored default. Primitives carry the literal value; non-primitive rows
   * carry either the recursively literal array/object graph or the
   * trustedHtml literal string (already proven from the canonical import).
   */
  readonly default?: IslandPropertyDefault;
  /** The table entry node, for source-located diagnostics. */
  readonly node: ts.Node;
}

/**
 * The sidecar default forms this reader can prove statically. A
 * `trustedHtml` default is kept as the literal HTML string plus its provenance
 * tag; the compiler lane brands it only for a `trustedHtml` typed member.
 */
export type IslandPropertyDefault =
  | {
      readonly kind: 'literal';
      readonly value: string | number | boolean | GeneratedElementDefaultGraph;
    }
  | { readonly kind: 'trustedHtml'; readonly html: string };

/**
 * The result of reading the sidecar's platform facts from the authored AST.
 *
 * `absent` means the module has no island policy statement at all; a sidecar
 * that declares no platform key still reads as `read` with the default facts,
 * so the caller can tell "no sidecar" from "sidecar with no facts".
 */
export type IslandMetadataRead =
  | { readonly kind: 'absent' }
  | { readonly kind: 'read'; readonly facts: IslandMetadataFacts }
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

function delegatesFocusDiagnostic(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
): IrDiagnostic {
  return diagnosticAt(
    sourceFile,
    node,
    GENERATED_ELEMENT_DIAGNOSTIC.DELEGATES_FOCUS_INVALID,
    message,
  );
}

function propertyDiagnostic(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
  code: string = GENERATED_ELEMENT_DIAGNOSTIC.PROPERTY_INVALID,
): IrDiagnostic {
  return diagnosticAt(sourceFile, node, code, message);
}

/** The identifier spelling the generated props record / accessors can expose. */
const IDENTIFIER_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const ISLAND_PROPERTY_FIELDS: ReadonlySet<string> = new Set(['reflect', 'attribute', 'default']);

/**
 * Resolve one declared attribute name the way the shell will: a missing
 * `attribute` key derives `camelToKebab(name)`, `false` means no attribute
 * channel, and a string is lowercased and screened by the canonical safe
 * attribute predicate. The scanner applies the identical rule; the drift
 * guard compares the resolved forms.
 */
function resolveDeclaredAttribute(name: string, raw: ts.Expression): string | null {
  if (raw.kind === ts.SyntaxKind.FalseKeyword) return null;
  return (ts.isStringLiteral(raw) ? raw.text : name).toLowerCase();
}

/**
 * The bounded depth of an admitted literal default graph. The graph is known
 * at compile time; the bound keeps the generated factory small and prevents a
 * pathological nested default from becoming a build hazard.
 */
const PROPERTY_DEFAULT_MAX_DEPTH = 8;

function defaultGraphDepthOk(value: unknown, depth: number): boolean {
  if (depth > PROPERTY_DEFAULT_MAX_DEPTH) return false;
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((entry) => defaultGraphDepthOk(entry, depth + 1));
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).every((entry) =>
      defaultGraphDepthOk(entry, depth + 1),
    );
  }
  return false;
}

/**
 * The canonical trustedHtml TYPE provenance (design §3.3): exactly a named
 * `TrustedHtml` import from '@openelement/element', no alias, not shadowed by
 * a same-module declaration. Checked syntactically; the compiler does not
 * import the element package.
 */
function canonicalTrustedHtmlTypeName(sourceFile: ts.SourceFile): boolean {
  let imported = false;
  let shadowed = false;
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== '@openelement/element'
    ) {
      continue;
    }
    const clause = statement.importClause;
    if (clause === undefined || clause.namedBindings === undefined) continue;
    if (!ts.isNamedImports(clause.namedBindings)) continue;
    for (const element of clause.namedBindings.elements) {
      // Alias-followed import spellings are deliberately NOT admitted: the
      // reference must be the canonical `TrustedHtml` name.
      if (element.propertyName === undefined && element.name.text === 'TrustedHtml')
        imported = true;
    }
  }
  for (const statement of sourceFile.statements) {
    if (
      (ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isFunctionDeclaration(statement)) &&
      statement.name?.text === 'TrustedHtml'
    ) {
      shadowed = true;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === 'TrustedHtml') {
          shadowed = true;
        }
      }
    }
  }
  return imported && !shadowed;
}

/**
 * Read one sidecar `default` initializer into the proven default vocabulary.
 *
 * Accepted forms: a static primitive, a bounded recursively literal
 * array/object graph (`literalValue`; spreads/identifiers/functions and
 * `__proto__` already refuse there), or a `trustedHtml('<literal>')` call whose
 * callee is the canonical runtime import (the class-lane provenance rule).
 * Anything else refuses with a source-located message.
 */
function readPropertyDefault(
  sourceFile: ts.SourceFile,
  initializer: ts.Expression,
  context: string,
):
  | { readonly kind: 'read'; readonly value: IslandPropertyDefault }
  | {
      readonly kind: 'refused';
      readonly message: string;
    } {
  const literal = literalValue(initializer, sourceFile);
  if (literal !== undefined && defaultGraphDepthOk(literal, 0)) {
    if (literal === null) {
      return {
        kind: 'refused',
        message: `openElement.properties.${context} must not be null; declare an explicit literal default`,
      };
    }
    return { kind: 'read', value: { kind: 'literal', value: literal } };
  }
  if (ts.isCallExpression(initializer)) {
    const intrinsics = createModuleIntrinsicBindings(sourceFile);
    const resolution = intrinsics.resolveIntrinsic(initializer.expression, 'trustedHtml');
    if (!resolution.canonical) {
      return {
        kind: 'refused',
        message:
          `openElement.properties.${context} must be created by the canonical ` +
          "`trustedHtml(...)` import from '@openelement/element'; a same-name or aliased callee " +
          'is not admitted',
      };
    }
    if (initializer.arguments.length !== 1) {
      return {
        kind: 'refused',
        message: `openElement.properties.${context} trustedHtml(...) takes exactly one literal string`,
      };
    }
    const html = initializer.arguments[0]!;
    if (!ts.isStringLiteral(html) && !ts.isNoSubstitutionTemplateLiteral(html)) {
      return {
        kind: 'refused',
        message: `openElement.properties.${context} trustedHtml(...) requires a literal string argument`,
      };
    }
    return { kind: 'read', value: { kind: 'trustedHtml', html: html.text } };
  }
  return {
    kind: 'refused',
    message:
      `openElement.properties.${context} must be a static string, number, or boolean literal, ` +
      'a recursively literal array/object graph, or trustedHtml(<literal string>)',
  };
}

/**
 * Read the sidecar's `properties` table from the authored AST.
 *
 * The shape is the platform-fact complement of the typed props parameter:
 * an object map keyed by member name, each entry carrying `reflect`,
 * `attribute` and `default` only. It is deliberately narrower than the
 * scanner's parser in one direction (it needs the same facts) and identical
 * in the other (fail closed on anything not provable from literal text). The
 * type/name cross-check is the admission's job because only it sees the root
 * component's parameter.
 */
function readIslandPropertyTable(
  sourceFile: ts.SourceFile,
  node: ts.Expression,
):
  | { readonly kind: 'read'; readonly declarations: readonly IslandPropertyDeclaration[] }
  | {
      readonly kind: 'refused';
      readonly diagnostic: IrDiagnostic;
    } {
  const refuse = (at: ts.Node, message: string) => ({
    kind: 'refused' as const,
    diagnostic: propertyDiagnostic(sourceFile, at, message),
  });
  if (!ts.isObjectLiteralExpression(node)) {
    return refuse(node, 'openElement.properties must be an object of static property entries');
  }
  const declarations: IslandPropertyDeclaration[] = [];
  const names = new Set<string>();
  const attributes = new Set<string>();
  for (const entry of node.properties) {
    if (!ts.isPropertyAssignment(entry)) {
      return refuse(
        entry,
        'openElement.properties must contain only static property entries; ' +
          `"${entry.getText(sourceFile)}" cannot be read statically`,
      );
    }
    const name = staticPropertyName(entry.name);
    if (name === null) {
      return refuse(
        entry.name,
        `the openElement.properties key "${entry.name.getText(sourceFile)}" is not a static ` +
          'property name',
      );
    }
    if (!IDENTIFIER_NAME.test(name)) {
      return refuse(
        entry.name,
        `openElement.properties key "${name}" must be an identifier naming a typed props member`,
      );
    }
    const sinkReason = forbiddenSinkReason('prop', name);
    if (sinkReason !== null) {
      return refuse(
        entry.name,
        `openElement.properties key "${name}" is not an admissible property name: ${sinkReason}`,
      );
    }
    // A duplicate NAME is refused before any attribute resolution: with
    // `attribute: false` (or distinct explicit attributes) the resolved
    // attribute set cannot see it, and the shell would throw a duplicate
    // property at class creation instead of the build failing here (D2).
    if (names.has(name)) {
      return refuse(
        entry.name,
        `openElement.properties declares property "${name}" more than once`,
      );
    }
    names.add(name);
    const table = entry.initializer;
    if (!ts.isObjectLiteralExpression(table)) {
      return refuse(table, `openElement.properties.${name} must be an object`);
    }
    const seenFields = new Set<string>();
    let reflect = false;
    let attribute: string | null | undefined;
    let attributeExplicit = false;
    let defaultValue: IslandPropertyDefault | undefined;
    for (const field of table.properties) {
      if (!ts.isPropertyAssignment(field)) {
        return refuse(
          field,
          `openElement.properties.${name} must contain only static key/value pairs; ` +
            `"${field.getText(sourceFile)}" cannot be read statically`,
        );
      }
      const fieldName = staticPropertyName(field.name);
      if (fieldName === null || !ISLAND_PROPERTY_FIELDS.has(fieldName)) {
        return refuse(
          field.name,
          `openElement.properties.${name} does not accept ` +
            `"${field.name.getText(sourceFile)}" — admitted options are reflect, attribute, and ` +
            'default (the property type comes from the typed props parameter)',
        );
      }
      if (seenFields.has(fieldName)) {
        return refuse(field, `openElement.properties.${name} declares ${fieldName} more than once`);
      }
      seenFields.add(fieldName);
      if (fieldName === 'reflect') {
        if (
          field.initializer.kind !== ts.SyntaxKind.TrueKeyword &&
          field.initializer.kind !== ts.SyntaxKind.FalseKeyword
        ) {
          return refuse(
            field.initializer,
            `openElement.properties.${name}.reflect must be a static boolean literal`,
          );
        }
        reflect = field.initializer.kind === ts.SyntaxKind.TrueKeyword;
      } else if (fieldName === 'attribute') {
        if (
          field.initializer.kind !== ts.SyntaxKind.FalseKeyword &&
          !ts.isStringLiteral(field.initializer)
        ) {
          return refuse(
            field.initializer,
            `openElement.properties.${name}.attribute must be a static string literal or false`,
          );
        }
        attribute = resolveDeclaredAttribute(name, field.initializer);
        attributeExplicit = true;
        if (attribute !== null) {
          if (attribute.length === 0 || !isSafeAttributeName(attribute)) {
            return refuse(
              field.initializer,
              `openElement.properties.${name}.attribute "${attribute}" is not a safe HTML ` +
                'attribute name',
            );
          }
        }
      } else {
        const parsed = readPropertyDefault(sourceFile, field.initializer, `${name}.default`);
        if (parsed.kind === 'refused') return refuse(field.initializer, parsed.message);
        defaultValue = parsed.value;
      }
    }
    if (reflect && attribute === null) {
      return refuse(
        entry,
        `openElement.properties.${name} cannot reflect without an attribute channel ` +
          '(attribute: false)',
      );
    }
    const effectiveAttribute = attribute === undefined ? camelToKebab(name) : attribute;
    if (effectiveAttribute !== null) {
      if (attributes.has(effectiveAttribute)) {
        return refuse(
          entry,
          `openElement.properties declares attribute "${effectiveAttribute}" more than once`,
        );
      }
      attributes.add(effectiveAttribute);
    }
    declarations.push({
      name,
      attribute: effectiveAttribute,
      attributeExplicit,
      reflect,
      ...(defaultValue === undefined ? {} : { default: defaultValue }),
      node: entry,
    });
  }
  return { kind: 'read', declarations };
}

/**
 * Read the sidecar's platform facts (`root`, `delegatesFocus`) from the
 * authored AST (D-root-source, 2026-11-13).
 *
 * The router's static scanner is the authority for the sidecar's accepted
 * shape, its accepted key set and its error text; this reader exists because
 * the compiler lane must not carry these facts across the host boundary. It is
 * deliberately narrower than the scanner: it reads the keys it needs, and it
 * refuses — instead of guessing — whenever a value cannot be proven from the
 * literal text (`OEIR_GENERATED_ELEMENT_ROOT_INVALID` /
 * `OEIR_GENERATED_ELEMENT_DELEGATES_FOCUS_INVALID`, source-located).
 *
 * The author-facing vocabulary is the sidecar's `'light' | 'shadow'`; the
 * descriptor's `'shadow'` is the DSD default, which the shell spells
 * `shadow-open`. Closed roots have no author spelling (`D-closed`), so no
 * mapping to `shadow-closed` exists here. `delegatesFocus: true` requires
 * `root: 'shadow'`, exactly as the scanner and the runtime authoring surface
 * enforce it: a light root has no shadow boundary to delegate focus through.
 */
export function readIslandMetadata(sourceFile: ts.SourceFile): IslandMetadataRead {
  const descriptor = islandPolicyObjectLiteral(sourceFile);
  if (descriptor === null) return { kind: 'absent' };
  let seenRoot = false;
  let declaredRoot: 'light' | 'shadow' | null = null;
  let seenDelegatesFocus = false;
  let delegatesFocus = false;
  let delegatesFocusSpan: ts.Node | null = null;
  let seenProperties = false;
  let properties: readonly IslandPropertyDeclaration[] | undefined;
  for (const property of descriptor.properties) {
    // A spread, a shorthand, a method or a computed key makes the object's key
    // set unprovable: a platform fact could hide behind it, so nothing is read.
    if (!ts.isPropertyAssignment(property)) {
      return {
        kind: 'refused',
        diagnostic: rootDiagnostic(
          sourceFile,
          property,
          'the openElement sidecar must contain only static key/value pairs; ' +
            `"${property.getText(sourceFile)}" cannot be read statically, so the platform facts ` +
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
            'property name, so the platform facts cannot be established',
        ),
      };
    }
    if (name === 'root') {
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
      declaredRoot = initializer.text;
      continue;
    }
    if (name === 'properties') {
      if (seenProperties) {
        return {
          kind: 'refused',
          diagnostic: propertyDiagnostic(
            sourceFile,
            property,
            'the openElement sidecar declares properties more than once, so the property table is ' +
              'ambiguous',
          ),
        };
      }
      seenProperties = true;
      const read = readIslandPropertyTable(sourceFile, property.initializer);
      if (read.kind === 'refused') return read;
      properties = read.declarations;
      continue;
    }
    if (name !== 'delegatesFocus') continue;
    if (seenDelegatesFocus) {
      return {
        kind: 'refused',
        diagnostic: delegatesFocusDiagnostic(
          sourceFile,
          property,
          'the openElement sidecar declares delegatesFocus more than once, so the focus fact is ' +
            'ambiguous',
        ),
      };
    }
    seenDelegatesFocus = true;
    delegatesFocusSpan = property;
    const initializer = property.initializer;
    if (
      initializer.kind !== ts.SyntaxKind.TrueKeyword &&
      initializer.kind !== ts.SyntaxKind.FalseKeyword
    ) {
      return {
        kind: 'refused',
        diagnostic: delegatesFocusDiagnostic(
          sourceFile,
          initializer,
          'openElement.delegatesFocus must be a static literal, got dynamic value ' +
            `"${initializer.getText(sourceFile)}"`,
        ),
      };
    }
    delegatesFocus = initializer.kind === ts.SyntaxKind.TrueKeyword;
  }
  const root: RootMode | undefined =
    declaredRoot === null ? undefined : declaredRoot === 'light' ? 'light' : 'shadow-open';
  if (delegatesFocus && root !== 'shadow-open') {
    return {
      kind: 'refused',
      diagnostic: diagnosticAt(
        sourceFile,
        delegatesFocusSpan ?? descriptor,
        GENERATED_ELEMENT_DIAGNOSTIC.DELEGATES_FOCUS_WITHOUT_SHADOW,
        'openElement.delegatesFocus requires root: "shadow" — a light root has no shadow ' +
          'boundary to delegate focus through',
      ),
    };
  }
  return { kind: 'read', facts: { root, delegatesFocus, properties } };
}

/**
 * The one-fact view of {@link readIslandMetadata} kept for the root-only
 * callers and the drift guard's root half. It adds no parsing of its own: the
 * `absent`/`root`/`refused` union is a projection of the platform read.
 */
export function readIslandRoot(sourceFile: ts.SourceFile): IslandRootRead {
  const read = readIslandMetadata(sourceFile);
  if (read.kind === 'absent') return { kind: 'absent' };
  if (read.kind === 'refused') return read;
  return read.facts.root === undefined
    ? { kind: 'absent' }
    : { kind: 'root', root: read.facts.root };
}

/**
 * Property names that would replace platform/lifecycle surface on the element
 * prototype. The shell owns this list (`generated-element/shell.ts`
 * `RESERVED_PROPERTY_NAMES`) and refuses a descriptor that names one; the
 * compiler lane refuses earlier so the author gets a source-located build
 * error. The copy is a fast-fail SUBSET: the properties suite asserts every
 * name here is refused by the shell too (an over-refusal is the drift that
 * matters); a new shell-reserved name this list misses still fails closed at
 * class creation, so no unguarded silent failure exists.
 */
export const RESERVED_GENERATED_ELEMENT_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  'constructor',
  'connectedCallback',
  'disconnectedCallback',
  'attributeChangedCallback',
  'adoptedCallback',
  'observedAttributes',
  'dispose',
]);

/** One admitted member of the root component's typed props parameter. */
interface TypedPropsMember {
  readonly name: string;
  /** Primitive member, or the property-only non-primitive family. */
  readonly kind: 'primitive' | 'array' | 'object' | 'trustedHtml';
  readonly type: GeneratedElementPlatformPropertyType;
  readonly node: ts.Node;
}

type TypedPropsRead =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'read';
      readonly parameter: ts.ParameterDeclaration;
      readonly members: readonly TypedPropsMember[];
    }
  | { readonly kind: 'refused'; readonly diagnostic: IrDiagnostic };

/** The type's zero value, matching the shell's `normalizeProperty` default. */
function zeroPropertyValue(type: GeneratedElementPrimitiveType): string | number | boolean {
  if (type === 'boolean') return false;
  if (type === 'number') return 0;
  return '';
}

/** Why a props annotation could not be resolved, with the offending node. */
type PropsTypeResolution =
  | { readonly members: readonly ts.TypeElement[] }
  | { readonly reason: string; readonly node?: ts.Node };

/** Same-module `interface`/`type` declarations with the given name. */
function propsTypeDeclarations(
  sourceFile: ts.SourceFile,
  name: string,
): readonly (ts.InterfaceDeclaration | ts.TypeAliasDeclaration)[] {
  const declarations: Array<ts.InterfaceDeclaration | ts.TypeAliasDeclaration> = [];
  for (const statement of sourceFile.statements) {
    if (
      (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) &&
      statement.name.text === name
    ) {
      declarations.push(statement);
    }
  }
  return declarations;
}

/**
 * Resolve a props annotation to its member list without a type checker.
 *
 * Two local, statically provable shapes are admitted: an inline object type
 * literal, and a same-module non-generic `type`/`interface` alias of one
 * (an interface with heritage clauses is refused because its member list is
 * not provable from this file). An imported, generic, union or otherwise
 * computed type refuses: the generated props record cannot be cross-checked
 * against a declaration this module does not own.
 *
 * Two author-reachable shapes that a naive first-match walk gets wrong are
 * refused here, not guessed:
 *
 * - a cyclic alias chain (`type A = A`, `type A = B; type B = A`, longer
 *   cycles). The visited-name set turns the walk into a finite proof and the
 *   cycle refuses with `PROPS_TYPE_UNSUPPORTED` instead of overflowing the
 *   compiler stack (B1);
 * - a props name with more than one same-module declaration (TypeScript
 *   declaration merging). Reading only the first declaration would either
 *   refuse a legal merged interface or silently emit rows for half of it, so
 *   the merged shape is refused as unprovable (D1).
 */
function resolvePropsTypeMembers(
  sourceFile: ts.SourceFile,
  typeNode: ts.TypeNode,
  visited: ReadonlySet<string> = new Set(),
): PropsTypeResolution {
  if (ts.isParenthesizedTypeNode(typeNode)) {
    return resolvePropsTypeMembers(sourceFile, typeNode.type, visited);
  }
  if (ts.isTypeLiteralNode(typeNode)) return { members: typeNode.members };
  if (!ts.isTypeReferenceNode(typeNode) || !ts.isIdentifier(typeNode.typeName)) {
    return {
      reason: `the props type "${typeNode.getText(sourceFile)}" is not an object type literal`,
      node: typeNode,
    };
  }
  if (typeNode.typeArguments !== undefined && typeNode.typeArguments.length > 0) {
    return {
      reason: `the props type "${typeNode.getText(sourceFile)}" is generic`,
      node: typeNode,
    };
  }
  const name = typeNode.typeName.text;
  if (visited.has(name)) {
    return {
      reason:
        `the props type "${name}" is cyclic/self-referential; the lane cannot prove a ` +
        'member list from it — declare the members inline or in an acyclic local alias',
      node: typeNode,
    };
  }
  const declarations = propsTypeDeclarations(sourceFile, name);
  if (declarations.length === 0) {
    return {
      reason:
        `the props type "${name}" is not declared in this module; the generated element lane ` +
        'admits an inline object type literal or a local type/interface alias',
      node: typeNode,
    };
  }
  if (declarations.length > 1) {
    return {
      reason:
        `the props type "${name}" is declared more than once in this module (merged ` +
        'declarations are not admitted); declare one interface or type alias so its member ' +
        'list is provable',
      node: declarations[1]!.name,
    };
  }
  const nextVisited = new Set(visited);
  nextVisited.add(name);
  const declaration = declarations[0]!;
  if (ts.isInterfaceDeclaration(declaration)) {
    if (declaration.typeParameters !== undefined) {
      return { reason: `the props interface "${name}" is generic`, node: declaration.name };
    }
    if ((declaration.heritageClauses ?? []).length > 0) {
      return {
        reason: `the props interface "${name}" has extends clauses this lane cannot prove`,
        node: declaration.name,
      };
    }
    return { members: declaration.members };
  }
  if (declaration.typeParameters !== undefined) {
    return { reason: `the props type alias "${name}" is generic`, node: declaration.name };
  }
  return resolvePropsTypeMembers(sourceFile, declaration.type, nextVisited);
}

/**
 * Prove that a type node denotes an opaque object shape: an inline type
 * literal, or a same-module single, non-generic, heritage-free, acyclic
 * interface/type alias chain that ends in one. Members of the object are NOT
 * inspected (the design keeps the shape opaque); only the default literal graph
 * is checked.
 */
function proveObjectShape(
  sourceFile: ts.SourceFile,
  typeNode: ts.TypeNode,
  visited: ReadonlySet<string> = new Set(),
):
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string; readonly node?: ts.Node } {
  if (ts.isParenthesizedTypeNode(typeNode)) {
    return proveObjectShape(sourceFile, typeNode.type, visited);
  }
  if (ts.isTypeLiteralNode(typeNode)) return { ok: true };
  if (!ts.isTypeReferenceNode(typeNode) || !ts.isIdentifier(typeNode.typeName)) {
    return {
      ok: false,
      reason: `the value type "${typeNode.getText(sourceFile)}" is not an object type literal`,
      node: typeNode,
    };
  }
  if (typeNode.typeArguments !== undefined && typeNode.typeArguments.length > 0) {
    return {
      ok: false,
      reason: `the value type "${typeNode.getText(sourceFile)}" is generic`,
      node: typeNode,
    };
  }
  const name = typeNode.typeName.text;
  if (visited.has(name)) {
    return {
      ok: false,
      reason:
        `the value type "${name}" is cyclic/self-referential; the lane cannot prove a ` +
        'literal default graph for it',
      node: typeNode,
    };
  }
  const declarations = propsTypeDeclarations(sourceFile, name);
  if (declarations.length === 0) {
    return {
      ok: false,
      reason:
        `the value type "${name}" is not declared in this module; only an inline object type ` +
        'literal or a local type/interface alias is admitted',
      node: typeNode,
    };
  }
  if (declarations.length > 1) {
    return {
      ok: false,
      reason:
        `the value type "${name}" is declared more than once in this module (merged declarations ` +
        'are not admitted)',
      node: declarations[1]!.name,
    };
  }
  const nextVisited = new Set(visited);
  nextVisited.add(name);
  const declaration = declarations[0]!;
  if (ts.isInterfaceDeclaration(declaration)) {
    if (declaration.typeParameters !== undefined) {
      return {
        ok: false,
        reason: `the value interface "${name}" is generic`,
        node: declaration.name,
      };
    }
    if ((declaration.heritageClauses ?? []).length > 0) {
      return {
        ok: false,
        reason: `the value interface "${name}" has extends clauses this lane cannot prove`,
        node: declaration.name,
      };
    }
    return { ok: true };
  }
  if (declaration.typeParameters !== undefined) {
    return {
      ok: false,
      reason: `the value type alias "${name}" is generic`,
      node: declaration.name,
    };
  }
  return proveObjectShape(sourceFile, declaration.type, nextVisited);
}

/** Is this exactly the canonical `TrustedHtml` type reference? */
function isCanonicalTrustedHtmlType(sourceFile: ts.SourceFile, typeNode: ts.TypeNode): boolean {
  if (!ts.isTypeReferenceNode(typeNode) || !ts.isIdentifier(typeNode.typeName)) return false;
  if (typeNode.typeName.text !== 'TrustedHtml') return false;
  if (typeNode.typeArguments !== undefined && typeNode.typeArguments.length > 0) return false;
  return canonicalTrustedHtmlTypeName(sourceFile);
}

/**
 * The admitted value type of one props member:
 * primitive keyword, `T[]`/`Array<T>` (primitive or opaque object element),
 * opaque object shape, or the canonical TrustedHtml type. `ReadonlyArray`,
 * tuples, nested arrays, nested TrustedHtml and imported non-brand types refuse.
 */
/**
 * Local names bound to the canonical `TrustedHtml` type import, including
 * aliases. Used only by the defensive nested-brand scan below; top-level type
 * admission still requires the exact canonical name.
 */
function trustedHtmlTypeLocalNames(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== '@openelement/element'
    ) {
      continue;
    }
    const clause = statement.importClause;
    if (clause?.namedBindings === undefined || !ts.isNamedImports(clause.namedBindings)) continue;
    for (const element of clause.namedBindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;
      if (importedName === 'TrustedHtml') names.add(element.name.text);
    }
  }
  return names;
}

/**
 * Defensive nested-brand scan for opaque object shapes (design §3.3: nested
 * `TrustedHtml` refuses until a type-honest nested carrier exists). The object
 * shape stays opaque for ordinary members, but a type reference to the
 * canonical `TrustedHtml` (or a canonical aliased import / local alias chain
 * that resolves to it) anywhere inside the shape is rejected. Imported types
 * that hide the brand behind an alias not visible in this module remain the
 * documented opaque boundary.
 */
function findNestedTrustedHtml(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  brandLocals: ReadonlySet<string>,
  visited: ReadonlySet<string> = new Set(),
): ts.Node | null {
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    const name = node.typeName.text;
    if (brandLocals.has(name)) return node;
    const declarations = propsTypeDeclarations(sourceFile, name);
    if (declarations.length === 1 && !visited.has(name)) {
      const nextVisited = new Set(visited);
      nextVisited.add(name);
      const declaration = declarations[0]!;
      if (ts.isInterfaceDeclaration(declaration)) {
        for (const member of declaration.members) {
          const found = findNestedTrustedHtml(sourceFile, member, brandLocals, nextVisited);
          if (found !== null) return found;
        }
        return null;
      }
      if (ts.isTypeAliasDeclaration(declaration)) {
        return findNestedTrustedHtml(sourceFile, declaration.type, brandLocals, nextVisited);
      }
    }
  }
  let found: ts.Node | null = null;
  ts.forEachChild(node, (child) => {
    if (found !== null) return;
    found = findNestedTrustedHtml(sourceFile, child, brandLocals, visited);
  });
  return found;
}

function resolveValueMemberType(
  sourceFile: ts.SourceFile,
  typeNode: ts.TypeNode,
):
  | { readonly kind: TypedPropsMember['kind']; readonly type: GeneratedElementPlatformPropertyType }
  | {
      readonly reason: string;
      readonly node: ts.Node;
    } {
  const brandLocals = trustedHtmlTypeLocalNames(sourceFile);
  const primitive: GeneratedElementPrimitiveType | null =
    typeNode.kind === ts.SyntaxKind.StringKeyword
      ? 'string'
      : typeNode.kind === ts.SyntaxKind.NumberKeyword
        ? 'number'
        : typeNode.kind === ts.SyntaxKind.BooleanKeyword
          ? 'boolean'
          : null;
  if (primitive !== null) return { kind: 'primitive', type: primitive };
  if (isCanonicalTrustedHtmlType(sourceFile, typeNode)) {
    return { kind: 'trustedHtml', type: 'trustedHtml' };
  }
  if (
    ts.isTypeReferenceNode(typeNode) &&
    ts.isIdentifier(typeNode.typeName) &&
    typeNode.typeName.text === 'TrustedHtml'
  ) {
    return {
      reason:
        'TrustedHtml must be exactly the canonical named type import from ' +
        "'@openelement/element' (no alias, no local rebinding/shadowing)",
      node: typeNode,
    };
  }
  const arrayElement = (
    element: ts.TypeNode,
  ):
    | { readonly ok: true }
    | { readonly ok: false; readonly reason: string; readonly node?: ts.Node } => {
    if (
      element.kind === ts.SyntaxKind.StringKeyword ||
      element.kind === ts.SyntaxKind.NumberKeyword ||
      element.kind === ts.SyntaxKind.BooleanKeyword
    ) {
      return { ok: true };
    }
    return proveObjectShape(sourceFile, element);
  };
  if (ts.isTupleTypeNode(typeNode)) {
    return {
      reason:
        `the props member type "${typeNode.getText(sourceFile)}" is a tuple; this lane admits ` +
        'T[] or Array<T> with a primitive or opaque object element',
      node: typeNode,
    };
  }
  if (ts.isArrayTypeNode(typeNode)) {
    const element = arrayElement(typeNode.elementType);
    if (!element.ok) {
      return {
        reason:
          `the array element type "${typeNode.elementType.getText(sourceFile)}" is not admitted ` +
          `(${element.reason})`,
        node: element.node ?? typeNode.elementType,
      };
    }
    const nestedBrand = findNestedTrustedHtml(sourceFile, typeNode.elementType, brandLocals);
    if (nestedBrand !== null) {
      return {
        reason:
          'a nested TrustedHtml inside an opaque array element is not admitted; declare a ' +
          'top-level property-only trustedHtml member instead',
        node: nestedBrand,
      };
    }
    return { kind: 'array', type: 'array' };
  }
  if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) {
    const referenceName = typeNode.typeName.text;
    if (referenceName === 'ReadonlyArray') {
      return {
        reason:
          `the props member type "${typeNode.getText(sourceFile)}" uses ReadonlyArray; this ` +
          'lane admits T[] or Array<T>',
        node: typeNode,
      };
    }
    if (referenceName === 'Array') {
      const args = typeNode.typeArguments;
      if (args === undefined || args.length !== 1) {
        return {
          reason: `the props member type "${typeNode.getText(sourceFile)}" must have exactly one type argument`,
          node: typeNode,
        };
      }
      const element = arrayElement(args[0]!);
      if (!element.ok) {
        return {
          reason: `the array element type "${args[0]!.getText(sourceFile)}" is not admitted (${element.reason})`,
          node: element.node ?? args[0]!,
        };
      }
      const nestedBrand = findNestedTrustedHtml(sourceFile, args[0]!, brandLocals);
      if (nestedBrand !== null) {
        return {
          reason:
            'a nested TrustedHtml inside an opaque array element is not admitted; declare a ' +
            'top-level property-only trustedHtml member instead',
          node: nestedBrand,
        };
      }
      return { kind: 'array', type: 'array' };
    }
  }
  const objectShape = proveObjectShape(sourceFile, typeNode);
  if (objectShape.ok) {
    const nestedBrand = findNestedTrustedHtml(sourceFile, typeNode, brandLocals);
    if (nestedBrand !== null) {
      return {
        reason:
          'a nested TrustedHtml inside an opaque object shape is not admitted; declare a ' +
          'top-level property-only trustedHtml member instead',
        node: nestedBrand,
      };
    }
    return { kind: 'object', type: 'object' };
  }
  return {
    reason:
      `the props member type "${typeNode.getText(sourceFile)}" is not an admitted value type ` +
      `(${objectShape.reason}); this lane admits string/number/boolean, T[] or Array<T> of a ` +
      'primitive or opaque object, an opaque object shape, or the canonical TrustedHtml type',
    node: objectShape.node ?? typeNode,
  };
}

/**
 * Read the root component's typed props parameter as an admitted member list.
 *
 * The parameter must be a named identifier (the generated props record is
 * exposed as `props.<member>`; a destructured parameter has no name to read)
 * and its annotation must resolve to local object type members. Only
 * `string`/`number`/`boolean` members are admitted. An optional member is
 * refused because the generated record always supplies a declared value, so
 * the annotation would understate the runtime surface; that is this lane's
 * fail-closed admission choice, not a platform constraint (a future decision
 * could admit optional members by mapping absence to the declared default).
 */
function readTypedProps(
  sourceFile: ts.SourceFile,
  node: ts.FunctionLikeDeclaration,
): TypedPropsRead {
  const parameter = node.parameters[0];
  if (parameter === undefined) return { kind: 'none' };
  if (!ts.isIdentifier(parameter.name)) {
    return {
      kind: 'refused',
      diagnostic: propertyDiagnostic(
        sourceFile,
        parameter,
        'the root component declares properties, but its props parameter is destructured; the ' +
          'generated element reads a named props record — use `props: { … }` and `props.member`',
        GENERATED_ELEMENT_DIAGNOSTIC.PROPS_TYPE_UNSUPPORTED,
      ),
    };
  }
  if (parameter.type === undefined) {
    return {
      kind: 'refused',
      diagnostic: propertyDiagnostic(
        sourceFile,
        parameter,
        `the root component's props parameter "${parameter.name.text}" has no type annotation; ` +
          'declare its primitive members inline (`props: { label: string }`) so the sidecar ' +
          'property table can be cross-checked',
        GENERATED_ELEMENT_DIAGNOSTIC.PROPS_TYPE_UNSUPPORTED,
      ),
    };
  }
  const resolved = resolvePropsTypeMembers(sourceFile, parameter.type);
  if ('reason' in resolved) {
    return {
      kind: 'refused',
      diagnostic: propertyDiagnostic(
        sourceFile,
        resolved.node ?? parameter.type,
        resolved.reason,
        GENERATED_ELEMENT_DIAGNOSTIC.PROPS_TYPE_UNSUPPORTED,
      ),
    };
  }
  const members: TypedPropsMember[] = [];
  const seen = new Set<string>();
  for (const member of resolved.members) {
    if (!ts.isPropertySignature(member)) {
      return {
        kind: 'refused',
        diagnostic: propertyDiagnostic(
          sourceFile,
          member,
          'the props type must contain only primitive property signatures; ' +
            `"${member.getText(sourceFile)}" is not one`,
          GENERATED_ELEMENT_DIAGNOSTIC.PROPS_TYPE_UNSUPPORTED,
        ),
      };
    }
    const name = ts.isIdentifier(member.name)
      ? member.name.text
      : ts.isStringLiteral(member.name)
        ? member.name.text
        : null;
    if (name === null || !IDENTIFIER_NAME.test(name)) {
      return {
        kind: 'refused',
        diagnostic: propertyDiagnostic(
          sourceFile,
          member.name,
          `the props member "${member.name.getText(sourceFile)}" is not an identifier the ` +
            'generated props record can expose',
          GENERATED_ELEMENT_DIAGNOSTIC.PROPS_TYPE_UNSUPPORTED,
        ),
      };
    }
    const sinkReason = forbiddenSinkReason('prop', name);
    if (sinkReason !== null) {
      return {
        kind: 'refused',
        diagnostic: propertyDiagnostic(
          sourceFile,
          member.name,
          `the props member "${name}" is not an admissible property name: ${sinkReason}`,
          GENERATED_ELEMENT_DIAGNOSTIC.PROPS_TYPE_UNSUPPORTED,
        ),
      };
    }
    if (seen.has(name)) {
      return {
        kind: 'refused',
        diagnostic: propertyDiagnostic(
          sourceFile,
          member.name,
          `the props type declares "${name}" more than once`,
          GENERATED_ELEMENT_DIAGNOSTIC.PROPS_TYPE_UNSUPPORTED,
        ),
      };
    }
    seen.add(name);
    if (member.questionToken !== undefined) {
      return {
        kind: 'refused',
        diagnostic: propertyDiagnostic(
          sourceFile,
          member.name,
          `the props member "${name}" is optional; this lane requires the declared type to ` +
            'match the runtime surface (the generated element always supplies a value), so ' +
            'declare the member required and put the initial value in the sidecar default. ' +
            'This is a lane admission rule, not a platform requirement.',
          GENERATED_ELEMENT_DIAGNOSTIC.PROPS_TYPE_UNSUPPORTED,
        ),
      };
    }
    const typeNode = member.type;
    if (typeNode === undefined) {
      return {
        kind: 'refused',
        diagnostic: propertyDiagnostic(
          sourceFile,
          member,
          `the props member "${name}" has no type annotation; declare one so the sidecar ` +
            'property table can be cross-checked',
          GENERATED_ELEMENT_DIAGNOSTIC.PROPS_TYPE_UNSUPPORTED,
        ),
      };
    }
    const resolvedType = resolveValueMemberType(sourceFile, typeNode);
    if ('reason' in resolvedType) {
      return {
        kind: 'refused',
        diagnostic: propertyDiagnostic(
          sourceFile,
          resolvedType.node,
          `the props member "${name}" is not admitted: ${resolvedType.reason}`,
          GENERATED_ELEMENT_DIAGNOSTIC.PROPS_TYPE_UNSUPPORTED,
        ),
      };
    }
    members.push({ name, kind: resolvedType.kind, type: resolvedType.type, node: member });
  }
  return { kind: 'read', parameter, members };
}

type GeneratedElementPropertiesAdmission =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'admitted';
      readonly properties: readonly GeneratedElementPlatformProperty[];
    }
  | { readonly kind: 'refused'; readonly diagnostics: readonly IrDiagnostic[] };

/**
 * Cross-check the sidecar declaration against the typed props parameter and
 * resolve the descriptor rows.
 *
 * `none` means the sidecar declares no `properties` table at all: the M09-1a
 * behavior stands (a props parameter is refused by the later gate). A declared
 * table is a contract in BOTH directions — every typed member needs an entry
 * (so the shell's props record exposes it with a declared type/default) and
 * every entry needs a typed member (so a typo or a stale entry cannot silently
 * produce an attribute nobody reads). Nothing is inferred silently in either
 * direction; `properties: {}` with a type-literal `{}` parameter is the one
 * empty-match shape and emits `properties: []`.
 */
function admitGeneratedElementProperties(
  sourceFile: ts.SourceFile,
  node: ts.FunctionLikeDeclaration,
  declared: readonly IslandPropertyDeclaration[] | undefined,
): GeneratedElementPropertiesAdmission {
  if (declared === undefined) return { kind: 'none' };
  const typed = readTypedProps(sourceFile, node);
  if (typed.kind === 'refused') return { kind: 'refused', diagnostics: [typed.diagnostic] };
  if (typed.kind === 'none') {
    if (declared.length === 0) return { kind: 'admitted', properties: [] };
    return {
      kind: 'refused',
      diagnostics: [
        propertyDiagnostic(
          sourceFile,
          node,
          'the openElement sidecar declares properties, but the root component takes no props ' +
            'parameter; add `props` with the same primitive members',
          GENERATED_ELEMENT_DIAGNOSTIC.PROPERTY_MISMATCH,
        ),
      ],
    };
  }
  const declaredNames = new Set(declared.map((entry) => entry.name));
  const typedNames = new Set(typed.members.map((member) => member.name));
  const missing = typed.members
    .filter((member) => !declaredNames.has(member.name))
    .map((member) => member.name);
  const extra = declared.filter((entry) => !typedNames.has(entry.name)).map((entry) => entry.name);
  if (missing.length > 0 || extra.length > 0) {
    const parts: string[] = [];
    if (missing.length > 0) {
      parts.push(
        `typed member(s) without a sidecar entry: ${missing.map((n) => `"${n}"`).join(', ')}`,
      );
    }
    if (extra.length > 0) {
      parts.push(
        `sidecar entry(ies) without a typed member: ${extra.map((n) => `"${n}"`).join(', ')}`,
      );
    }
    return {
      kind: 'refused',
      diagnostics: [
        propertyDiagnostic(
          sourceFile,
          typed.parameter,
          'the openElement properties table and the typed props parameter disagree — ' +
            parts.join('; ') +
            '. Every declared attribute must have a typed member that reads it, and every typed ' +
            'primitive member must be declared so the element exposes it.',
          GENERATED_ELEMENT_DIAGNOSTIC.PROPERTY_MISMATCH,
        ),
      ],
    };
  }
  const byName = new Map(typed.members.map((member) => [member.name, member]));
  const properties: GeneratedElementPlatformProperty[] = [];
  for (const declaration of declared) {
    const member = byName.get(declaration.name)!;
    if (RESERVED_GENERATED_ELEMENT_PROPERTY_NAMES.has(declaration.name)) {
      return {
        kind: 'refused',
        diagnostics: [
          propertyDiagnostic(
            sourceFile,
            declaration.node,
            `the property name "${declaration.name}" collides with the element lifecycle ` +
              'surface; rename the props member and its sidecar entry',
          ),
        ],
      };
    }
    if (member.kind === 'primitive') {
      // An omitted sidecar `default` means the type zero value — never an
      // "undefined" property channel: the resolved value is what the emitted
      // row spells, and the shell's props record always exposes a value.
      const literalDefault =
        declaration.default !== undefined && declaration.default.kind === 'literal'
          ? declaration.default.value
          : undefined;
      const declaredDefault =
        typeof literalDefault === 'string' ||
        typeof literalDefault === 'number' ||
        typeof literalDefault === 'boolean'
          ? literalDefault
          : undefined;
      const defaultValue =
        declaredDefault === undefined
          ? zeroPropertyValue(member.type as GeneratedElementPrimitiveType)
          : declaredDefault;
      if (declaration.default !== undefined && declaredDefault === undefined) {
        return {
          kind: 'refused',
          diagnostics: [
            propertyDiagnostic(
              sourceFile,
              declaration.node,
              declaration.default.kind === 'trustedHtml'
                ? `the primitive property "${declaration.name}" cannot default to trustedHtml(...)`
                : `the property "${declaration.name}" default must be a static ${member.type} ` +
                    'literal to match the typed member; array/object defaults belong to ' +
                    'property-only non-primitive members',
            ),
          ],
        };
      }
      if (typeof defaultValue !== member.type) {
        return {
          kind: 'refused',
          diagnostics: [
            propertyDiagnostic(
              sourceFile,
              declaration.node,
              `the property "${declaration.name}" default must be a ${member.type} literal to ` +
                `match the typed member, got ${typeof defaultValue}`,
            ),
          ],
        };
      }
      properties.push({
        name: declaration.name,
        attribute: declaration.attribute,
        type: member.type,
        reflect: declaration.reflect,
        default: defaultValue,
      });
      continue;
    }

    // ── property-only non-primitive rows ───────────────────────────────────
    if (!declaration.attributeExplicit || declaration.attribute !== null) {
      return {
        kind: 'refused',
        diagnostics: [
          propertyDiagnostic(
            sourceFile,
            declaration.node,
            `the non-primitive property "${declaration.name}" must declare attribute: false ` +
              'explicitly: no attribute or JSON wire carries it',
            GENERATED_ELEMENT_DIAGNOSTIC.PROPERTY_INVALID,
          ),
        ],
      };
    }
    if (declaration.reflect) {
      return {
        kind: 'refused',
        diagnostics: [
          propertyDiagnostic(
            sourceFile,
            declaration.node,
            `the non-primitive property "${declaration.name}" cannot reflect: it has no ` +
              'attribute channel',
            GENERATED_ELEMENT_DIAGNOSTIC.PROPERTY_INVALID,
          ),
        ],
      };
    }
    if (declaration.default === undefined) {
      return {
        kind: 'refused',
        diagnostics: [
          propertyDiagnostic(
            sourceFile,
            declaration.node,
            `the non-primitive property "${declaration.name}" requires an explicit literal ` +
              'default (array/object literal graph or trustedHtml(<literal string>))',
            GENERATED_ELEMENT_DIAGNOSTIC.PROPERTY_INVALID,
          ),
        ],
      };
    }
    if (member.kind === 'trustedHtml') {
      if (declaration.default.kind !== 'trustedHtml') {
        return {
          kind: 'refused',
          diagnostics: [
            propertyDiagnostic(
              sourceFile,
              declaration.node,
              `the trustedHtml property "${declaration.name}" must default to the canonical ` +
                'trustedHtml(<literal string>) value',
              GENERATED_ELEMENT_DIAGNOSTIC.PROPERTY_INVALID,
            ),
          ],
        };
      }
      properties.push({
        name: declaration.name,
        attribute: null,
        type: member.type,
        reflect: false,
        default: declaration.default.html,
      });
      continue;
    }
    if (declaration.default.kind !== 'literal') {
      return {
        kind: 'refused',
        diagnostics: [
          propertyDiagnostic(
            sourceFile,
            declaration.node,
            `the ${member.kind} property "${declaration.name}" cannot default to trustedHtml(...)`,
            GENERATED_ELEMENT_DIAGNOSTIC.PROPERTY_INVALID,
          ),
        ],
      };
    }
    const graph = declaration.default.value;
    const shapeOk =
      member.kind === 'array'
        ? Array.isArray(graph)
        : typeof graph === 'object' && graph !== null && !Array.isArray(graph);
    if (!shapeOk) {
      return {
        kind: 'refused',
        diagnostics: [
          propertyDiagnostic(
            sourceFile,
            declaration.node,
            `the ${member.kind} property "${declaration.name}" default must be a recursively ` +
              `literal ${member.kind === 'array' ? 'array' : 'object'} graph`,
            GENERATED_ELEMENT_DIAGNOSTIC.PROPERTY_INVALID,
          ),
        ],
      };
    }
    properties.push({
      name: declaration.name,
      attribute: null,
      type: member.type,
      reflect: false,
      defaultGraph: graph,
    });
  }
  return { kind: 'admitted', properties };
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
  const metadata = readIslandMetadata(sourceFile);
  if (metadata.kind === 'refused') {
    return { kind: 'refused', diagnostics: [metadata.diagnostic] };
  }
  const facts =
    metadata.kind === 'read'
      ? metadata.facts
      : { root: undefined, delegatesFocus: false, properties: undefined };
  const propertiesAdmission = admitGeneratedElementProperties(
    sourceFile,
    fact.node,
    facts.properties,
  );
  if (propertiesAdmission.kind === 'refused') {
    return { kind: 'refused', diagnostics: propertiesAdmission.diagnostics };
  }
  const properties = propertiesAdmission.kind === 'admitted' ? propertiesAdmission.properties : [];
  return {
    kind: 'admitted',
    admission: {
      componentName: fact.name,
      defaultExportSpan: fact.span,
      root: facts.root,
      delegatesFocus: facts.delegatesFocus,
      propertiesDeclared: propertiesAdmission.kind === 'admitted',
      properties,
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
  // A declared property table has already been cross-checked against the
  // typed props parameter by the admission; the M09-1a "props with no
  // attribute channel" refusal would be wrong for it.
  if (admission.propertiesDeclared) return [];
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
