/**
 * M09-1a — the compiler-private contract between the generated native element
 * emitter and the landed M09-0/M09-shadow runtime shell.
 *
 * This module carries no behavior: it names the one internal shell specifier
 * the emitted tail imports, the host-supplied site fact that admits an island
 * file to the lane, and the closed set of internal `OEIR_GENERATED_ELEMENT_*`
 * diagnostics. None of these is author syntax, a package export, or part of
 * the public `RuntimeErrorCode` catalogue.
 *
 * Descriptor ABI (owned by the shell; read by the emitted tail):
 *
 * - `tag` (required string) — a hyphenated custom-element name. M09-1a takes it
 *   from the host site fact; the emitter never derives it and never invents a
 *   second source.
 * - `root` (optional `RootMode`) — `light | shadow-open | shadow-closed`. The
 *   shell defaults to `light`; the emitter omits the property when the author
 *   pinned no root. Since D-root-source (2026-11-13) the value is read by the
 *   compiler lane from the authored island sidecar
 *   (`site.ts` `readIslandMetadata`), not supplied on the host site fact: the
 *   host fact carries only the tag, so the root can never go stale between the
 *   host's scan and this transform. The sidecar's `'shadow'` is the DSD
 *   default and maps to `shadow-open`; closed roots have no author spelling
 *   (`D-closed`), so nothing maps to `shadow-closed` yet.
 * - `delegatesFocus` (optional `boolean`) — the native shadow-root focus
 *   delegation fact. The emitter emits it only when the sidecar declares
 *   `delegatesFocus: true`; `true` with a non-shadow root is refused by the
 *   sidecar reader (and again by the emitter), and the emitted
 *   `<Name>__ssrHost` threads it into the DSD template's typed option set so
 *   the parser-adopted root carries `shadowrootdelegatesfocus`.
 * - `properties` (optional array) — the declared primitive property rows the
 *   M09-2b lane emits: exactly the shell's landed `GeneratedElementProperty`
 *   shape (`name`, `attribute`, `type`, `reflect`, `default`). The authoring
 *   source is the island sidecar `properties` table cross-checked against the
 *   root component's typed props parameter; the shell owns observedAttributes,
 *   conversion, reflection and defaults. A module with no declaration emits
 *   `properties: []` exactly as M09-1a did. Array/object/`trustedHtml`
 *   conversion and custom converters are NOT representable here (the shell's
 *   `PROPERTY_TYPES` admits the three primitives only).
 * - `createRecipe` (required function) — the leaf's exported
 *   `create<Name>Recipe` factory. The claim stays reachable only through the
 *   returned `recipe.claim`; no leaf symbol is renamed.
 * - `createBindings` — never emitted by M09-1a (the bindings gate fails closed
 *   before the tail is built).
 *
 * The emitted tail executes no `customElements.define`; registration remains
 * the router entry's decision and belongs to M09-1b.
 */

import type { ImportClassifier } from '../../semantic-core/scope-resolution.ts';

/**
 * The internal shell specifier the emitted CE module imports.
 *
 * Deliberately NOT a package `exports` subpath in M09-1a: the directory is
 * still excluded from `@openelement/element`'s packed `files` set, and the
 * compiler lane has no production caller. M09-1b deletes the exclusion, adds
 * the export subpath, and points the emitted module at the exported spelling.
 * Source-level M09-1a tests alias this specifier to the workspace source; the
 * unresolved spelling cannot reach a real build because no production host
 * passes a site fact yet.
 */
export const GENERATED_ELEMENT_SHELL_SPECIFIER =
  '@openelement/element/internal/compiled/generated-element/shell';

/**
 * The host-supplied fact that admits one module to the generated-element lane.
 * It is an internal compiler option value, never author syntax: the router
 * derives it from the island path (M09-1b) and the compiler cannot derive it
 * itself because the island transform runs after this compiler plugin.
 *
 * The fact carries the TAG only. The root used to ride here too; D-root-source
 * (2026-11-13) moved it to the compiler lane's own read of the authored
 * sidecar (`site.ts` `readIslandRoot`), so one stale host scan can no longer
 * pin a root that the source no longer declares.
 */
export interface GeneratedElementSite {
  /** The custom-element tag the host's island pipeline will register. */
  readonly tag: string;
}

/** Host hook for the site fact; returning null keeps the lane inert. */
export type GeneratedElementSiteResolver = (moduleId: string) => GeneratedElementSite | null;

/** The three primitive property types the generated-element shell admits. */
export type GeneratedElementPrimitiveType = 'string' | 'number' | 'boolean';

/**
 * One resolved property row the emitter writes into the descriptor.
 *
 * This is the compiler-side mirror of the shell's landed
 * `GeneratedElementProperty`: the same five facts, already resolved from the
 * sidecar table and the typed props member (attribute name, primitive type,
 * reflection, declared/zero default). `attribute: null` is a property-only
 * channel; the shell derives observedAttributes from the non-null rows.
 *
 * It is deliberately NOT `GeneratedElementProperty` itself: the compiler lane
 * must not import the browser runtime shell (the emitted module is the only
 * consumer of the shell specifier), so the descriptor ABI stays a structural
 * contract on both sides of the boundary.
 */
export interface GeneratedElementPlatformProperty {
  /** JS property name and the key the generated props record exposes. */
  readonly name: string;
  /** Resolved attribute name, or null for a property-only channel. */
  readonly attribute: string | null;
  readonly type: GeneratedElementPrimitiveType;
  /** Reflect property writes back to the attribute. */
  readonly reflect: boolean;
  /** Declared literal initial value or the type's zero value. */
  readonly default: string | number | boolean;
}

/**
 * The internal diagnostic codes this lane can raise. They follow the shell's
 * `OEIR_*` convention and are deliberately absent from the public error
 * catalogue and the interface snapshot.
 */
export const GENERATED_ELEMENT_DIAGNOSTIC = {
  /** A site module default-exports a function that is not an admitted component. */
  NOT_A_COMPONENT: 'OEIR_GENERATED_ELEMENT_NOT_A_COMPONENT',
  /** The root component takes a props parameter; M09-1a cannot declare attributes. */
  UNDECLARED_PROPS: 'OEIR_GENERATED_ELEMENT_UNDECLARED_PROPS',
  /** The generated body reads `host.bindings[*]` and no binding source exists. */
  UNBOUND_BINDING: 'OEIR_GENERATED_ELEMENT_UNBOUND_BINDING',
  /** A fixed CE-tail identifier already occurs in the leaf text. */
  NAME_COLLISION: 'OEIR_GENERATED_ELEMENT_NAME_COLLISION',
  /** The host admitted the module but the island sidecar is absent. */
  MISSING_SITE_MARKER: 'OEIR_GENERATED_ELEMENT_MISSING_SITE_MARKER',
  /**
   * The sidecar's `root` cannot be read as one of `'light' | 'shadow'`
   * (a dynamic value, another literal, a duplicate key, or a config object
   * whose key set is not static). The router scanner's `ISLAND_METADATA_ERROR`
   * remains the author-facing authority; this code is the lane's own
   * fail-closed verdict inside the compiler.
   */
  ROOT_INVALID: 'OEIR_GENERATED_ELEMENT_ROOT_INVALID',
  /**
   * The sidecar's `delegatesFocus` cannot be read as one boolean literal (a
   * dynamic value, a duplicate key, or a config object whose key set is not
   * static). Like `ROOT_INVALID`, this is the lane's fail-closed verdict; the
   * router scanner's `ISLAND_METADATA_ERROR` remains the author-facing
   * authority and the two readers are held together by the seam drift guard.
   */
  DELEGATES_FOCUS_INVALID: 'OEIR_GENERATED_ELEMENT_DELEGATES_FOCUS_INVALID',
  /**
   * The sidecar declares `delegatesFocus: true` without `root: 'shadow'`. A
   * light root has no shadow boundary to delegate focus through; the shell's
   * descriptor validation refuses the pair too, so the lane refuses before a
   * module exists instead of shipping a class that throws on evaluation.
   */
  DELEGATES_FOCUS_WITHOUT_SHADOW: 'OEIR_GENERATED_ELEMENT_DELEGATES_FOCUS_WITHOUT_SHADOW',
  /**
   * The root component's props parameter cannot be read as a typed primitive
   * member list: no annotation, a destructured/rest parameter, an imported or
   * generic type, a non-property member, an optional member or a non-primitive
   * member type. The generated element's props record is a fixed
   * string/number/boolean table; anything it cannot express fails closed
   * instead of being silently dropped from the attribute channel.
   */
  PROPS_TYPE_UNSUPPORTED: 'OEIR_GENERATED_ELEMENT_PROPS_TYPE_UNSUPPORTED',
  /**
   * The sidecar `properties` table and the typed props member list disagree
   * (a declared key with no typed member or a typed member with no entry, or a
   * declaration without a props parameter). The two declarations are
   * cross-checked, never inferred one from the other.
   */
  PROPERTY_MISMATCH: 'OEIR_GENERATED_ELEMENT_PROPERTY_MISMATCH',
  /**
   * One sidecar property entry is not representable: an unknown option, a
   * non-literal default, an unsafe attribute name, a duplicate attribute, a
   * reflected property with no attribute channel, a reserved lifecycle name, or
   * a default whose literal type does not match the typed member.
   */
  PROPERTY_INVALID: 'OEIR_GENERATED_ELEMENT_PROPERTY_INVALID',
  /** The appended tail did not parse (an emitter invariant, not author input). */
  INVALID_ARTIFACT: 'OEIR_GENERATED_ELEMENT_INVALID_ARTIFACT',
} as const;

/**
 * The function lane's import classifier: the canonical core factories the
 * function grammar knows. The class lane's `CORE_VOCABULARY` has no `signal`
 * entry, and the function frontend had no production caller before this lane
 * (R12), so an omitted classifier would turn known factories into incidental
 * refusals. Only the two factory names the function grammar admits are named;
 * every other import stays host-classified by the caller.
 */
export const GENERATED_ELEMENT_IMPORT_CLASSIFIER: ImportClassifier = {
  classifySymbol: (specifier, importedName) => {
    if (specifier !== '@openelement/element') return undefined;
    if (importedName === 'signal' || importedName === 'computed') return 'factory';
    return 'value';
  },
  classifyValue: () => undefined,
  classifyCall: (specifier, importedName) => {
    if (specifier !== '@openelement/element') return undefined;
    if (importedName === 'signal') return { call: 'signal' };
    if (importedName === 'computed') return { call: 'computed' };
    return undefined;
  },
};
