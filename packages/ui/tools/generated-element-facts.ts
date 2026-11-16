/**
 * Generated-element facts for the @openelement/ui manifest (alpha16, D-②
 * phase 1).
 *
 * The manifest generator's class branch reads authored class sources
 * (`@element`, `extends OpenElement`, `@property`). A function component has
 * none of those facts: it is admitted by the compiler's generated native
 * element lane, which EMITS the native class (`__oe<Name>Element` bound and
 * exported as `<Name>Element`). This module projects that emitted element into
 * the internal manifest vocabulary — nothing is re-parsed with a second reader
 * and nothing is invented:
 *
 * - admission (island sidecar, root/focus/form facts, typed props table) comes
 *   from the compiler's `admitGeneratedElementSite`;
 * - the JSX model for slot/part NAMES comes from `compileFunctionModule`;
 * - the emitted constructor identity comes from the real lane entry
 *   (`compileGeneratedElementIfAdmitted`) and is read from the emitted module's
 *   own export table — the emitted artifact is the authority, so this module
 *   carries no copy of the emitter's `<Name>Element` naming rule;
 * - the authored description is the first JSDoc summary paragraph of the
 *   default-exported component, read from the compiler-parsed `SourceFile`;
 * - events are deliberately absent: the function lane has no authored
 *   custom-event surface, and `on*` handler metadata is not an event catalogue;
 * - delivery policy (`layer`/`hydrate`/`status`, `ssr`/`dsd`, `tailwind`) is
 *   NOT a compiler fact and is not produced here.
 *
 * The module is pure (no filesystem access): the caller supplies the module
 * text and the host site fact (the tag), exactly as the compiler lane receives
 * it. Cross-package relative imports of compiler internals follow the
 * established repository tooling/test convention; the compiler excluded these
 * internals from its packed `files` set, and `packages/ui` does not ship its
 * tools, so no published artifact is affected.
 */

import ts from 'typescript';
import type {
  OpenElementAttribute,
  OpenElementCssPart,
  OpenElementSlot,
} from '@openelement/element';
import {
  CompiledElementError,
  parseDiagnostic,
} from '../../compiler/src/internal/compiler/semantic-core/compiler-diagnostics.ts';
import {
  compileFunctionModule,
  type FunctionModelComponent,
  type FunctionModelElement,
  type FunctionModelNode,
  type FunctionModelRecipe,
} from '../../compiler/src/internal/compiler/semantic-core/function-frontend.ts';
import { typescriptParser } from '../../compiler/src/internal/compiler/semantic-core/parse-module.ts';
import {
  compileGeneratedElementIfAdmitted,
  type CompiledGeneratedElement,
} from '../../compiler/src/internal/compiler/semantic-ir/generated-element/compile.ts';
import {
  GENERATED_ELEMENT_DIAGNOSTIC,
  GENERATED_ELEMENT_IMPORT_CLASSIFIER,
} from '../../compiler/src/internal/compiler/semantic-ir/generated-element/contract.ts';
import {
  admitGeneratedElementSite,
  findDefaultExport,
} from '../../compiler/src/internal/compiler/semantic-ir/generated-element/site.ts';

/** The package subpath prefix the UI manifest declarations use. */
const UI_PACKAGE_PREFIX = '@openelement/ui/';

/**
 * One authored module plus the host-supplied site fact (the same fact the
 * generated-element lane receives; the compiler never derives the tag).
 */
export interface GeneratedElementInput {
  /** Package-relative file name, e.g. `open-fn-card.tsx`. */
  readonly file: string;
  readonly source: string;
  /** The host site fact, mirroring `GeneratedElementSite.tag`. */
  readonly tag: string;
}

/**
 * The emitted-element facts the UI manifest can state truthfully.
 *
 * `className`/`exportName` are the emitted module's own named export (the
 * native class the lane produced), never the author function's name. `events`
 * is intentionally absent (see the module comment); policy is absent (the
 * caller owns delivery policy, and phase 1 adds none for fixtures).
 */
export interface GeneratedElementFacts {
  readonly tag: string;
  /** The emitted class's named export (`<Component>Element`). */
  readonly className: string;
  /** The same emitted export selector, written into `openElement.export`. */
  readonly exportName: string;
  /** `@openelement/ui/<file without .tsx>`. */
  readonly module: string;
  /** The host root the lane compiled this component with. */
  readonly root: 'light' | 'shadow';
  /** The authored `.css` specifiers (validated by the consuming build). */
  readonly styles: readonly string[];
  /** Authored JSDoc summary paragraph; `''` when the module has none. */
  readonly description: string;
  readonly attributes: readonly OpenElementAttribute[];
  readonly slots: readonly OpenElementSlot[];
  readonly cssParts: readonly OpenElementCssPart[];
}

/** One fail-closed refusal, source-located and coded by its producer. */
export interface GeneratedElementRefusal {
  readonly code: string;
  readonly message: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

/**
 * The projection result. `declined` is a structural opt-out (not a component
 * module for this lane: no default export, a class/re-export/expression
 * default); `refused` is a module the lane owns and must not project.
 */
export type GeneratedElementRead =
  | { readonly kind: 'admitted'; readonly facts: GeneratedElementFacts }
  | { readonly kind: 'declined' }
  | { readonly kind: 'refused'; readonly diagnostics: readonly GeneratedElementRefusal[] };

function refusal(
  code: string,
  message: string,
  file: string,
  line = 1,
  column = 1,
): GeneratedElementRefusal {
  return { code, message, file, line, column };
}

/** Read the emitted constructor identity from the emitted module's export table. */
function readEmittedIdentity(
  emitted: CompiledGeneratedElement,
  file: string,
): { readonly className: string } | { readonly diagnostics: readonly GeneratedElementRefusal[] } {
  // The appended tail is plain JavaScript (JSX is already lowered); parsing it
  // as JS with the compiler's own TypeScript dependency is the artifact read,
  // not a second parser and not a text pattern. The identity is whatever the
  // emitter actually exported, so no naming rule is duplicated here.
  const emittedFile = ts.createSourceFile(
    `${file}.emitted.js`,
    emitted.code,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.JS,
  );
  let defaultBinding: string | null = null;
  const exportedNames = new Map<string, string>();
  for (const statement of emittedFile.statements) {
    if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)) {
      defaultBinding = statement.expression.text;
      continue;
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        exportedNames.set((element.propertyName ?? element.name).text, element.name.text);
      }
    }
  }
  const alias = defaultBinding === null ? undefined : exportedNames.get(defaultBinding);
  if (alias === undefined || alias === '') {
    // The lane returned a module without the emitted-class export. That is an
    // emitter invariant, never author input; fail closed instead of forwarding
    // a declaration that names nothing.
    return {
      diagnostics: [
        refusal(
          'UI_MANIFEST_EMITTED_IDENTITY_MISSING',
          `the generated-element lane returned a module for '${file}' without a named export of ` +
            'its default-exported class; the manifest cannot name the emitted constructor',
          file,
        ),
      ],
    };
  }
  return { className: alias };
}

/** The first JSDoc summary paragraph of the default-exported component. */
function readAuthoredSummary(sourceFile: ts.SourceFile, node: ts.Node): string {
  const doc = ts
    .getJSDocCommentsAndTags(node)
    .find((comment): comment is ts.JSDoc => ts.isJSDoc(comment));
  if (doc === undefined) return '';
  const body = doc
    .getText(sourceFile)
    .replace(/^\/\*\*/, '')
    .replace(/\*\/\s*$/, '');
  const paragraph: string[] = [];
  for (const rawLine of body.split('\n')) {
    const line = rawLine.replace(/^\s*\*\s?/, '').trim();
    if (line === '') {
      // A blank line ends the summary paragraph; a tag block also does.
      if (paragraph.length > 0) break;
      continue;
    }
    if (line.startsWith('@')) break;
    paragraph.push(line);
  }
  return paragraph.join(' ').trim();
}

function staticAttribute(element: FunctionModelElement, name: string): string | null {
  for (const attribute of element.attributes) {
    if (attribute.name !== name || attribute.kind !== 'static') continue;
    return attribute.value;
  }
  return null;
}

function hasDynamicAttribute(element: FunctionModelElement, name: string): boolean {
  return element.attributes.some(
    (attribute) => attribute.name === name && attribute.kind === 'dynamic',
  );
}

interface SlotAndPartNames {
  readonly slots: string[];
  readonly cssParts: string[];
}

/**
 * Collect slot and CSS-part NAMES from the root component's lowered JSX model.
 *
 * Only static `name`/`part` attribute values are read: a dynamic value is
 * skipped rather than guessed, and no description text is synthesized (the
 * class branch's `Default slot` / `The 'x' part` prose is deliberately not
 * copied — the generated path has no authored slot/part docs convention).
 */
function collectSlotAndPartNames(component: FunctionModelComponent): SlotAndPartNames {
  const slots: string[] = [];
  const cssParts: string[] = [];
  const seenSlots = new Set<string>();
  const seenParts = new Set<string>();
  const addSlots = (element: FunctionModelElement): void => {
    if (element.tag !== 'slot') return;
    // A dynamic `name={…}` cannot be a manifest slot name; skip it.
    if (!hasDynamicAttribute(element, 'name')) {
      const name = (staticAttribute(element, 'name') ?? '').trim();
      if (!seenSlots.has(name)) {
        seenSlots.add(name);
        slots.push(name);
      }
    }
  };
  const addParts = (element: FunctionModelElement): void => {
    const part = staticAttribute(element, 'part');
    if (part === null) return;
    for (const name of part.trim().split(/\s+/)) {
      if (name === '' || seenParts.has(name)) continue;
      seenParts.add(name);
      cssParts.push(name);
    }
  };
  const visit = (node: FunctionModelNode): void => {
    switch (node.kind) {
      case 'element':
        addSlots(node);
        addParts(node);
        for (const child of node.children) visit(child);
        return;
      case 'fragment':
        for (const child of node.children) visit(child);
        return;
      case 'condition':
        for (const child of node.consequent) visit(child);
        for (const child of node.alternate ?? []) visit(child);
        return;
      case 'list':
        for (const child of node.template) visit(child);
        return;
      // text/dynamic-text/component-ref/insertion-site/children-projection
      // carry no intrinsic slot/part declaration of THIS component.
      default:
        return;
    }
  };
  const visitRecipe = (recipe: FunctionModelRecipe): void => {
    if (recipe.target.kind === 'fragment') {
      for (const child of recipe.target.children) visit(child);
      return;
    }
    visit(recipe.target);
  };
  for (const root of component.roots) visit(root);
  for (const recipe of component.recipes) visitRecipe(recipe);

  // The default slot is listed first; the remaining names keep authored order.
  const ordered = slots.includes('') ? ['', ...slots.filter((name) => name !== '')] : [...slots];
  return { slots: ordered, cssParts };
}

/** The author-facing message for a refusal list (used by the generator's throw). */
export function formatGeneratedElementRefusals(
  refusals: readonly GeneratedElementRefusal[],
): string {
  return refusals
    .map((item) => `  ${item.file}:${item.line}:${item.column} ${item.code}: ${item.message}`)
    .join('\n');
}

/**
 * Project one authored function module plus its host site fact into
 * emitted-element facts, or decline/refuse it.
 *
 * Sequence: one compiler parse (syntax + default export + admission + JSDoc),
 * the function frontend (JSX model), then the real lane entry (authoritative
 * admission + emit). A module is only projected when the lane actually emitted
 * it; the class name is read from that emitted artifact.
 */
export function readGeneratedElementFacts(input: GeneratedElementInput): GeneratedElementRead {
  const parsed = typescriptParser.parseModule(input.source, input.file);
  if (parsed.syntaxDiagnostics.length > 0) {
    return {
      kind: 'refused',
      diagnostics: parsed.syntaxDiagnostics.map((diagnostic) => {
        const located = parseDiagnostic(parsed.sourceFile, diagnostic);
        return refusal(
          located.code,
          located.message,
          located.file ?? input.file,
          located.line,
          located.character,
        );
      }),
    };
  }

  const defaultExport = findDefaultExport(parsed.sourceFile);
  if (defaultExport === null || defaultExport.kind !== 'local-function') {
    // Structural opt-outs (no default export, class/expression/anonymous
    // default) are not modules this lane owns.
    return { kind: 'declined' };
  }

  const siteAdmission = admitGeneratedElementSite(parsed.sourceFile, { tag: input.tag });
  if (siteAdmission.kind === 'declined') return { kind: 'declined' };
  if (siteAdmission.kind === 'refused') {
    return {
      kind: 'refused',
      diagnostics: siteAdmission.diagnostics.map((diagnostic) =>
        refusal(
          diagnostic.code,
          diagnostic.message,
          diagnostic.span.file,
          diagnostic.span.line,
          diagnostic.span.column,
        ),
      ),
    };
  }
  const admission = siteAdmission.admission;

  const frontend = compileFunctionModule(input.source, input.file, {
    importClassifier: GENERATED_ELEMENT_IMPORT_CLASSIFIER,
  });
  if (frontend.module === null) {
    return {
      kind: 'refused',
      diagnostics: frontend.diagnostics.map((diagnostic) =>
        refusal(
          diagnostic.code,
          diagnostic.message,
          diagnostic.file ?? input.file,
          diagnostic.line ?? 1,
          diagnostic.character ?? 1,
        ),
      ),
    };
  }
  const root: FunctionModelComponent | undefined = frontend.module.components.find(
    (component) => component.name === admission.componentName,
  );
  if (root === undefined) {
    const span = admission.defaultExportSpan;
    return {
      kind: 'refused',
      diagnostics: [
        refusal(
          GENERATED_ELEMENT_DIAGNOSTIC.NOT_A_COMPONENT,
          `the default export "${admission.componentName}" is a function, but the function ` +
            'frontend did not admit it as a component (a component returns JSX)',
          span.file,
          span.line,
          span.column,
        ),
      ],
    };
  }

  let emitted: CompiledGeneratedElement | null;
  try {
    emitted = compileGeneratedElementIfAdmitted(input.source, input.file, {
      site: { tag: input.tag },
    });
  } catch (error) {
    if (!(error instanceof CompiledElementError)) throw error;
    return {
      kind: 'refused',
      diagnostics: error.diagnostics.map((diagnostic) =>
        refusal(
          diagnostic.code,
          diagnostic.message,
          diagnostic.file ?? input.file,
          diagnostic.line ?? 1,
          diagnostic.character ?? 1,
        ),
      ),
    };
  }
  if (emitted === null) {
    // The lane declined a module whose admission already succeeded; defensive
    // closure so a lane ownership change cannot silently produce a declaration.
    return { kind: 'declined' };
  }
  const identity = readEmittedIdentity(emitted, input.file);
  if ('diagnostics' in identity) return { kind: 'refused', diagnostics: identity.diagnostics };

  const names = collectSlotAndPartNames(root);
  const attributes: OpenElementAttribute[] = [];
  for (const property of admission.properties) {
    if (property.attribute === null) continue; // property-only channel: no attribute
    const attribute: OpenElementAttribute = {
      name: property.attribute,
      type: property.type,
      // The shell's effective default: the authored sidecar default, or the
      // type's zero value when the sidecar declares none.
      default: String(property.default ?? ''),
      ...(property.reflect ? { reflects: true } : {}),
      ...(property.name === property.attribute ? {} : { fieldName: property.name }),
    };
    attributes.push(attribute);
  }

  // A `styles` key whose entries are not static string literals cannot be
  // published: the manifest is the only carrier a consuming build reads, and an
  // empty list would silently drop the authored sheets.
  if (admission.declaresStyles && admission.styles.length === 0) {
    return {
      kind: 'refused',
      diagnostics: [
        refusal(
          'UI_MANIFEST_STYLES_INVALID',
          `'${input.file}' declares openElement.styles but no static string specifier could be ` +
            'read from it; a published declaration must name its stylesheets as string literals',
          input.file,
        ),
      ],
    };
  }

  return {
    kind: 'admitted',
    facts: {
      tag: input.tag,
      className: identity.className,
      exportName: identity.className,
      module: `${UI_PACKAGE_PREFIX}${input.file.replace(/\.tsx$/, '')}`,
      root: admission.root === 'shadow-open' ? 'shadow' : 'light',
      styles: admission.styles,
      description: readAuthoredSummary(parsed.sourceFile, defaultExport.node),
      attributes,
      slots: names.slots.map((name) => ({ name })),
      cssParts: names.cssParts.map((name) => ({ name })),
    },
  };
}
