/**
 * M09-1a — the generated native element emitter.
 *
 * `generateElementModule` is APPEND-ONLY over the landed M07a leaf generator:
 * it calls `generateLeafModule`, keeps its text, source map and placements
 * byte-identical, and appends one CE tail. It renames no leaf symbol and
 * rewrites no leaf line, so the leaf source map and every placement stay
 * valid; the appended lines carry no authored source and no map segments
 * (their absence is stated on the result as `tail`, not implied).
 *
 * The tail:
 *
 * - imports the internal M09-0/M09-shadow shell by its compiler-private
 *   specifier;
 * - builds a descriptor with `tag`, `root`, `properties: []` and the leaf's
 *   exported `create<Name>Recipe` factory;
 * - constructs the class and default-exports it, with one named alias and the
 *   tag constant, so the existing island entry (`mod[exportName] ?? mod.default`)
 *   receives a constructor without any entry-selection change;
 * - executes NO `customElements.define` and never mentions the registry.
 *
 * Fixed identifier collisions fail closed instead of producing a module that
 * cannot parse: the tail's module-scope names, the alias and the import
 * binding are checked against the leaf text before the tail is appended.
 * A hostless module (site null) returns the leaf result unchanged.
 */

import ts from 'typescript';
import { generateLeafModule, type GeneratedLeafModule } from '../generated-leaf/generate.ts';
import type { FunctionModelModule } from '../../semantic-core/function-frontend.ts';
import type { IrDiagnostic } from '../types.ts';
import {
  GENERATED_ELEMENT_DIAGNOSTIC,
  GENERATED_ELEMENT_SHELL_SPECIFIER,
  type GeneratedElementSite,
} from './contract.ts';

/** The emitter's result: the leaf contract plus the exact appended tail. */
export interface GeneratedElementModule extends GeneratedLeafModule {
  /** The untouched leaf text the tail was appended to, or null when refused. */
  readonly leaf: string | null;
  /**
   * The appended CE tail, byte-for-byte, or null when the site is absent or the
   * emitter refused. It deliberately has no authored source and no source-map
   * segments; the returned `sourceMap` is the leaf's, unchanged.
   */
  readonly tail: string | null;
}

export interface GenerateElementModuleOptions {
  /**
   * The default-exported root component's local name. Required when a site is
   * present; the lane always passes the fact from site admission. A single
   * component module may omit it, which keeps direct emitter tests small.
   */
  readonly rootComponent?: string;
  /** The authored source for the leaf source map (required for `sourcesContent`). */
  readonly authoredSource?: string;
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function moduleDiagnostic(file: string, code: string, message: string): IrDiagnostic {
  return {
    severity: 'error',
    code,
    message,
    span: { file, start: 0, end: 0, line: 1, column: 1 },
    origin: 'module',
  };
}

/**
 * A conservative whole-token occurrence test: `ProfileElement` must not hide
 * inside `ProfileElementExtra`, but a same-token occurrence in a string or
 * comment is still a fail-closed collision. JavaScript module scope is the
 * only question; text conservatism is the safe direction.
 */
function identifierOccurs(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])`).test(text);
}

/** The parser check the leaf generator applies to its own artifact. */
function parsesAsModule(text: string): boolean {
  const source = ts.createSourceFile(
    'generated-element.js',
    text,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.JS,
  );
  const parseDiagnostics = (source as unknown as { parseDiagnostics?: readonly unknown[] })
    .parseDiagnostics;
  return (parseDiagnostics ?? []).length === 0;
}

function emptyResult(
  leaf: GeneratedLeafModule,
  diagnostics: readonly IrDiagnostic[],
): GeneratedElementModule {
  return {
    module: null,
    sourceMap: leaf.sourceMap,
    placements: leaf.placements,
    requiredBindings: leaf.requiredBindings,
    requiredProps: leaf.requiredProps,
    requiresPropsChanged: leaf.requiresPropsChanged,
    diagnostics,
    leaf: null,
    tail: null,
  };
}

/**
 * Append the M09-1a CE tail to one generated leaf module.
 *
 * `site` null is the hostless case: the result is byte-identical to
 * `generateLeafModule`'s (the proof in `generated-element.emitter.test.ts`).
 * The admission gates that read the authored AST live in `site.ts`; this
 * function is the text stage and refuses only emitter invariants.
 */
export function generateElementModule(
  module: FunctionModelModule,
  site: GeneratedElementSite | null,
  options: GenerateElementModuleOptions = {},
): GeneratedElementModule {
  const leaf = generateLeafModule(module, {
    ...(options.authoredSource === undefined ? {} : { authoredSource: options.authoredSource }),
  });
  const leafText = leaf.module;
  if (leafText === null) {
    return {
      ...emptyResult(leaf, leaf.diagnostics),
      // The leaf failed before any tail existed; its diagnostics propagate.
      leaf: null,
      tail: null,
    };
  }
  if (site === null) {
    return {
      module: leafText,
      sourceMap: leaf.sourceMap,
      placements: leaf.placements,
      requiredBindings: leaf.requiredBindings,
      requiredProps: leaf.requiredProps,
      requiresPropsChanged: leaf.requiresPropsChanged,
      diagnostics: leaf.diagnostics,
      leaf: leafText,
      tail: null,
    };
  }

  const rootName =
    options.rootComponent ??
    (module.components.length === 1 ? module.components[0]!.name : undefined);
  if (rootName === undefined || !IDENTIFIER.test(rootName)) {
    return emptyResult(leaf, [
      moduleDiagnostic(
        module.file,
        GENERATED_ELEMENT_DIAGNOSTIC.NOT_A_COMPONENT,
        'the generated element emitter needs one named default-exported component to append a CE tail',
      ),
    ]);
  }
  if (!module.components.some((component) => component.name === rootName)) {
    return emptyResult(leaf, [
      moduleDiagnostic(
        module.file,
        GENERATED_ELEMENT_DIAGNOSTIC.NOT_A_COMPONENT,
        `the default export "${rootName}" is not a component of this module`,
      ),
    ]);
  }

  const names = {
    descriptor: '__oeElementDescriptor',
    element: `__oe${rootName}Element`,
    alias: `${rootName}Element`,
    tag: '__oeElementTag',
    shellImport: 'createGeneratedElementClass',
  };
  const collisions = Object.values(names).filter((name) => identifierOccurs(leafText, name));
  if (collisions.length > 0) {
    return emptyResult(leaf, [
      moduleDiagnostic(
        module.file,
        GENERATED_ELEMENT_DIAGNOSTIC.NAME_COLLISION,
        `the generated element tail identifiers already occur in the leaf module: ${collisions
          .map((name) => `"${name}"`)
          .join(', ')}`,
      ),
    ]);
  }

  const root = site.root ?? 'light';
  const tail = [
    '',
    '// ---- generated native element (M09-1) ----',
    `import { createGeneratedElementClass } from ${JSON.stringify(GENERATED_ELEMENT_SHELL_SPECIFIER)};`,
    '',
    `const ${names.descriptor} = {`,
    `  tag: ${JSON.stringify(site.tag)},`,
    `  root: ${JSON.stringify(root)},`,
    '  properties: [],',
    `  createRecipe: create${rootName}Recipe,`,
    '};',
    '',
    `const ${names.element} = createGeneratedElementClass(${names.descriptor});`,
    '',
    `export default ${names.element};`,
    `export { ${names.element} as ${names.alias} };`,
    `export const ${names.tag} = ${JSON.stringify(site.tag)};`,
    '',
  ].join('\n');

  const emitted = `${leafText}${tail}`;
  if (!parsesAsModule(emitted)) {
    return emptyResult(leaf, [
      moduleDiagnostic(
        module.file,
        GENERATED_ELEMENT_DIAGNOSTIC.INVALID_ARTIFACT,
        'the emitted module with the generated element tail does not parse as JavaScript',
      ),
    ]);
  }
  return {
    module: emitted,
    // The leaf map is reused, not rebuilt: its segments describe the same
    // prefix lines; the appended tail has no authored source.
    sourceMap: leaf.sourceMap,
    placements: leaf.placements,
    requiredBindings: leaf.requiredBindings,
    requiredProps: leaf.requiredProps,
    requiresPropsChanged: leaf.requiresPropsChanged,
    diagnostics: [],
    leaf: leafText,
    tail,
  };
}
