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
 *   shell defaults to `light`; M09-1a emits the site's value when present.
 *   Production authoring cannot declare a shadow root until M09-2a, but the
 *   emitter accepts one so the browser evidence can prove DSD through the
 *   generated class.
 * - `properties` (optional array) — M09-1a always emits `[]`: the function
 *   model has no props type and the M09-1a admission gates refuse a props
 *   parameter outright. Property/attribute conversion is M09-2b.
 * - `createRecipe` (required function) — the leaf's exported
 *   `create<Name>Recipe` factory. The claim stays reachable only through the
 *   returned `recipe.claim`; no leaf symbol is renamed.
 * - `createBindings` — never emitted by M09-1a (the bindings gate fails closed
 *   before the tail is built).
 *
 * The emitted tail executes no `customElements.define`; registration remains
 * the router entry's decision and belongs to M09-1b.
 */

import type { RootMode } from '@openelement/protocol/part-program';
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
 */
export interface GeneratedElementSite {
  /** The custom-element tag the host's island pipeline will register. */
  readonly tag: string;
  /**
   * Root ownership mode. M09-1b's production site helper passes `light` only;
   * tests may pass a shadow mode to prove DSD through the generated class.
   */
  readonly root?: RootMode;
}

/** Host hook for the site fact; returning null keeps the lane inert. */
export type GeneratedElementSiteResolver = (moduleId: string) => GeneratedElementSite | null;

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
