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
 * - builds a descriptor with `tag`, the resolved `properties` rows (or `[]`),
 *   the leaf's exported `create<Name>Recipe` factory, `root` only when the
 *   authored sidecar pinned one (D-root-source: the lane reads it, the shell
 *   owns the `light` default), and `delegatesFocus: true` only when the
 *   sidecar declares it (the shell owns the `false` default);
 * - constructs the class and default-exports it, with one named alias and the
 *   tag constant, so the existing island entry (`mod[exportName] ?? mod.default`)
 *   receives a constructor without any entry-selection change;
 * - executes NO `customElements.define` and never mentions the registry;
 * - appends `<Name>__ssrHost(props, lightChildren?)` (M09-2a) ONLY when the
 *   descriptor root is a shadow mode AND the leaf emitted `<Name>__ssr`. The
 *   wrapper composes the content-only `<Name>__ssr` bytes with the canonical
 *   DSD template through the `generated-element/dsd-ssr.ts` leaf, so the host
 *   artifact the browser parser adopts and the root the descriptor pins come
 *   from ONE declaration. A `delegatesFocus: true` descriptor threads the typed
 *   DSD option into the same template (`shadowrootdelegatesfocus`), so the
 *   claimed root reports the same fact the descriptor does; without it the
 *   shell's root-option check would refuse the claim. A light root appends
 *   nothing: its tail keeps the exact M09-1a bytes.
 *
 * Fixed identifier collisions fail closed instead of producing a module that
 * cannot parse: the tail's module-scope names, the alias and the import
 * binding are checked against the leaf text before the tail is appended.
 * A hostless module (site null) returns the leaf result unchanged.
 */

import ts from 'typescript';
import type { RootMode } from '@openelement/protocol/part-program';
import { generateLeafModule, type GeneratedLeafModule } from '../generated-leaf/generate.ts';
import type { FunctionModelModule } from '../../semantic-core/function-frontend.ts';
import type { IrDiagnostic } from '../types.ts';
import {
  GENERATED_ELEMENT_DIAGNOSTIC,
  GENERATED_ELEMENT_SHELL_SPECIFIER,
  type GeneratedElementPlatformProperty,
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
  /**
   * The root mode the lane read from the authored sidecar (`site.ts`
   * `readIslandMetadata`, D-root-source 2026-11-13). Omitted when the author
   * pinned none, in which case the descriptor carries no `root` property and
   * the shell applies its own `light` default.
   */
  readonly root?: RootMode;
  /**
   * The `delegatesFocus` fact the lane read from the authored sidecar.
   * Omitted (or false) when the author pinned none, in which case the
   * descriptor carries no property and the shell applies its own `false`
   * default. `true` without a shadow descriptor root is refused here as well
   * as in the sidecar reader: the shell's descriptor validation would reject
   * the pair at class creation time.
   */
  readonly delegatesFocus?: boolean;
  /**
   * The resolved primitive property rows, in sidecar authored order. Omitted
   * (or empty) emits the M09-1a `properties: []` byte-for-byte; a non-empty
   * list is the shell's landed `GeneratedElementProperty` shape, so no shell
   * change is involved.
   */
  readonly properties?: readonly GeneratedElementPlatformProperty[];
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

/**
 * Does the leaf artifact export `<Name>__ssr`?
 *
 * The leaf generator emits `export function <Name>__ssr(…)` for every component
 * inside its producer slice and no `__ssr` export at all for a shape outside it
 * (its documented "no partial producer" rule: a condition, list, component
 * reference or insertion site yields no producer). The M09-2a host wrapper
 * calls that export, so it must be appended only when the declaration is there;
 * referencing an absent symbol would turn a compile-time fact into a runtime
 * `ReferenceError`. The check reads the leaf text this emitter itself produced,
 * not author input.
 */
function exportsSsrFunction(leafText: string, componentName: string): boolean {
  const escaped = componentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`export function ${escaped}__ssr\\s*\\(`).test(leafText);
}

/**
 * The descriptor root's DSD wire spelling, or null for a root that has no host
 * template. `light` (and an absent root, which the shell defaults to `light`)
 * produces no template, so no host wrapper is appended and the light tail stays
 * byte-identical. `D-closed` keeps `shadow-closed` unauthorable, but the
 * mapping is total so a future closed spelling cannot silently fall through to
 * an open template.
 */
function hostTemplateRoot(root: RootMode | undefined): 'open' | 'closed' | null {
  switch (root) {
    case 'shadow-open':
      return 'open';
    case 'shadow-closed':
      return 'closed';
    case 'light':
    case undefined:
      return null;
  }
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
 * The descriptor's `properties` rows, byte-for-byte. Every resolved row
 * spells all five descriptor facts explicitly (including `attribute: null` and
 * `reflect: false`) so the emitted declaration is reviewable without inferring
 * omitted-key semantics; the shell validates the same shape.
 */
function propertyRows(properties: readonly GeneratedElementPlatformProperty[]): string[] {
  if (properties.length === 0) return ['  properties: [],'];
  return [
    '  properties: [',
    ...properties.map((property) => {
      const attribute = property.attribute === null ? 'null' : JSON.stringify(property.attribute);
      return (
        `    { name: ${JSON.stringify(property.name)}, attribute: ${attribute}, ` +
        `type: ${JSON.stringify(property.type)}, reflect: ${String(property.reflect)}, ` +
        `default: ${JSON.stringify(property.default)} },`
      );
    }),
    '  ],',
  ];
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
    ssrHostImport: 'serializeGeneratedElementHtml',
    ssrHost: `${rootName}__ssrHost`,
  };
  const root = options.root;
  const templateRoot = hostTemplateRoot(root);
  // The M09-2a host wrapper is appended only for a shadow descriptor whose leaf
  // actually emitted the content-only `<Name>__ssr`. A light root (or an absent
  // root, which the shell defaults to light) appends nothing at all, so the
  // M09-1a light tail keeps its exact bytes.
  const delegatesFocus = options.delegatesFocus === true;
  if (delegatesFocus && templateRoot === null) {
    return emptyResult(leaf, [
      moduleDiagnostic(
        module.file,
        GENERATED_ELEMENT_DIAGNOSTIC.DELEGATES_FOCUS_WITHOUT_SHADOW,
        'delegatesFocus requires a shadow descriptor root; the shell refuses the pair at class ' +
          'creation time',
      ),
    ]);
  }
  const hostWrapper =
    templateRoot !== null && exportsSsrFunction(leafText, rootName)
      ? { root: templateRoot, name: names.ssrHost }
      : null;
  const collisionNames = [
    names.descriptor,
    names.element,
    names.alias,
    names.tag,
    names.shellImport,
    ...(hostWrapper === null ? [] : [names.ssrHostImport, names.ssrHost]),
  ];
  const collisions = collisionNames.filter((name) => identifierOccurs(leafText, name));
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

  const tail = [
    '',
    '// ---- generated native element (M09-1) ----',
    `import { ${[names.shellImport, ...(hostWrapper === null ? [] : [names.ssrHostImport])].join(', ')} } from ${JSON.stringify(GENERATED_ELEMENT_SHELL_SPECIFIER)};`,
    '',
    `const ${names.descriptor} = {`,
    `  tag: ${JSON.stringify(site.tag)},`,
    // No authored root → no descriptor property: the shell's own
    // `descriptor.root ?? 'light'` default is the single default owner.
    ...(root === undefined ? [] : [`  root: ${JSON.stringify(root)},`]),
    ...(delegatesFocus ? ['  delegatesFocus: true,'] : []),
    ...propertyRows(options.properties ?? []),
    `  createRecipe: create${rootName}Recipe,`,
    '};',
    '',
    `const ${names.element} = createGeneratedElementClass(${names.descriptor});`,
    '',
    `export default ${names.element};`,
    `export { ${names.element} as ${names.alias} };`,
    `export const ${names.tag} = ${JSON.stringify(site.tag)};`,
    // The host-level DSD producer (M09-2a). The content stays the leaf's
    // content-only `<Name>__ssr` bytes; the wrapper only adds the canonical
    // template through the one browser-safe producer leaf.
    ...(hostWrapper === null
      ? []
      : [
          '',
          '// ---- generated shadow host SSR (M09-2a) ----',
          `export function ${hostWrapper.name}(props, lightChildren) {`,
          `  return ${names.ssrHostImport}({`,
          `    tag: ${JSON.stringify(site.tag)},`,
          `    root: ${JSON.stringify(hostWrapper.root)},`,
          ...(delegatesFocus ? ['    dsd: { delegatesFocus: true },'] : []),
          `    content: ${rootName}__ssr(props, undefined),`,
          '    ...(lightChildren === undefined ? {} : { lightChildren }),',
          '  });',
          '}',
        ]),
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
