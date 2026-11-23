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
 * - for a CLIENT-ONLY island (`ssr: false` / `hydrate: 'only'`), imports each
 *   declared `.css` specifier as a REAL module edge and carries the bindings on
 *   the descriptor's `styles` row (2026-11-20): no server render exists to
 *   deliver the sheet, so the shell adopts these objects into the root it
 *   creates. A client-only declaration with no static specifier refuses at build
 *   time instead of rendering unstyled;
 * - builds a descriptor with `tag`, the resolved `properties` rows (or `[]`),
 *   the leaf's exported `create<Name>Recipe` factory, `createInstance` only
 *   when the leaf generator reported a root setup factory (T3 / 16b-LC-1 —
 *   the row is driven by `rootInstanceFactory`, the generator's own emission
 *   decision, never by scanning the emitted text), `root` only when the
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
 *
 * The result also reports the emitted host-wrapper export name
 * (`ssrHostExport`) as build metadata, produced by the SAME `hostWrapper`
 * decision that appends the wrapper. It is return-only: the field never
 * changes the module text, and callers must read it instead of re-deriving the
 * name from the emitted artifact (M11 review §3/§4.1). The inherited
 * `rootInstanceFactory` field is the same kind of return-only metadata for the
 * T3 root setup factory: non-null exactly when the leaf wrote the declaration.
 */

import ts from 'typescript';
import type { RootMode } from '@openelement/protocol/part-program';
import { generateLeafModule, type GeneratedLeafModule } from '../generated-leaf/generate.ts';
import { quoteGeneratedJavaScriptValue } from '../generated-leaf/codegen-literals.ts';
import type { FunctionModelModule } from '../../semantic-core/function-frontend.ts';
import type { IrDiagnostic } from '../types.ts';
import {
  GENERATED_ELEMENT_DIAGNOSTIC,
  GENERATED_ELEMENT_SHELL_SPECIFIER,
  type GeneratedElementDefaultGraph,
  type GeneratedElementPlatformProperty,
  type GeneratedElementSite,
} from './contract.ts';
import { collectStaticClassCandidates } from '../generated-leaf/generate.ts';
// The ONE compiler-private field name for the nested-host expander (P-6).
import { NESTED_HOST_EXPANDER } from '@openelement/protocol/style-sheet';

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
  /**
   * The emitted host-wrapper export name (`<root>__ssrHost`), or null when no
   * wrapper was appended. It is the compiler-owned emitted export identity for
   * the DSD host producer: null covers a hostless module (site absent), a
   * light/absent descriptor root, and a shadow root whose leaf emitted no
   * `<root>__ssr` producer. Callers carry this string as build metadata; they
   * must not scan or suffix-derive it from the emitted module.
   */
  readonly ssrHostExport: string | null;
}

/**
 * Compiler-private record key + local name of the generated host producer's
 * canonical host-attribute projection (M11-2). The shell's seed helper attaches
 * the merged caller+computed pairs under this ONE literal key; the emitted
 * wrapper reads it with the same literal (like the other `__oe_` compiler-owned
 * names, authored identifiers cannot carry the prefix).
 */
const HOST_ATTRIBUTES_KEY = '__oeHostAttributes';
const HOST_ATTRIBUTES_VAR = '__oeHostAttrs';

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
   * The `formAssociated` fact the lane read from the authored sidecar. True
   * writes the descriptor row and lets the shell install the native static and
   * its single ElementInternals owner; false/absent emits nothing.
   */
  readonly formAssociated?: boolean;
  /**
   * The resolved primitive property rows, in sidecar authored order. Omitted
   * (or empty) emits the M09-1a `properties: []` byte-for-byte; a non-empty
   * list is the shell's landed `GeneratedElementProperty` shape, so no shell
   * change is involved.
   */
  readonly properties?: readonly GeneratedElementPlatformProperty[];
  /** The authored source for the leaf source map (required for `sourcesContent`). */
  readonly authoredSource?: string;
  /**
   * M09-2e / #1803 compiler-private marker: the authored sidecar declares
   * `styles`, so this shadow host's DSD template will carry the canonical
   * marked link prefix. Emits the typed styleLinks channel and the claim prefix
   * walk; omitted keeps the pre-slice bytes exactly.
   */
  readonly styleLinkPrefix?: boolean;
  /**
   * The sidecar's client-only fact (2026-11-20 client style-adoption slice):
   * the build's effective phase — explicit `ssr: false`, or `hydrate: 'only'`,
   * exactly as the lane admission read it. A client-only island has no server
   * render, so its declared sheets are emitted as REAL module-graph imports and
   * carried on the descriptor for the shell to adopt into the root it creates.
   * `ssr: true`/absent (the SSR case) changes no byte.
   */
  readonly clientOnly?: boolean;
  /**
   * The sidecar's declared `.css` specifiers, in authored order, when it
   * declares `styles` at all. Present with an empty list is a FAIL-CLOSED
   * state for a client-only island: the declaration promised a sheet but no
   * static specifier reached the emitter, which would render unstyled. The
   * router scan owns the author-facing shape refusals; this option is the
   * emitter's own closure over the same fact.
   */
  readonly styles?: readonly string[];
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
    // A refusal returns no module: keep the "non-null exactly when an emitted
    // module carries the factory" invariant rather than echoing leaf metadata.
    rootInstanceFactory: null,
    requiredBindings: leaf.requiredBindings,
    requiredProps: leaf.requiredProps,
    requiresPropsChanged: leaf.requiresPropsChanged,
    // A refused module contributes no candidates: the stylesheet must not
    // compile utilities for markup that never shipped.
    classCandidates: [],
    diagnostics,
    leaf: null,
    tail: null,
    ssrHostExport: null,
  };
}

/** Render one admitted literal default graph as JavaScript source. */
function renderDefaultGraph(graph: GeneratedElementDefaultGraph): string {
  if (graph === null) return 'null';
  // Authored default strings and keys are embedded in generated JavaScript:
  // use the one compiler code-literal boundary (JSON.stringify plus the
  // script-context escapes), never a bare JSON.stringify (CodeQL
  // js/bad-code-sanitization; M09-2c helper).
  if (typeof graph === 'string') return quoteGeneratedJavaScriptValue(graph);
  if (typeof graph === 'number' || typeof graph === 'boolean') return String(graph);
  if (Array.isArray(graph)) {
    return `[${graph.map((entry) => renderDefaultGraph(entry)).join(', ')}]`;
  }
  const entries = Object.entries(graph as Readonly<Record<string, GeneratedElementDefaultGraph>>);
  return `{ ${entries
    .map(([key, value]) => `${quoteGeneratedJavaScriptValue(key)}: ${renderDefaultGraph(value)}`)
    .join(', ')} }`;
}

interface PropertyEmission {
  /** Module-level fresh-literal default factories (array/object rows). */
  readonly factoryLines: readonly string[];
  /** The descriptor row lines, including the trailing `,` on each row. */
  readonly rowLines: readonly string[];
  /** New module-scope identifiers the factory lines declare. */
  readonly identifiers: readonly string[];
  /** True when at least one non-primitive row needs the SSR props resolver. */
  readonly usesPropsResolver: boolean;
  /**
   * True when at least one descriptor row has an attribute channel. Only then
   * does the emitted host producer need the canonical attribute projection from
   * the seeded record (M11-2 SSR->claim parity); a module without attribute rows
   * keeps the pre-slice wrapper bytes exactly.
   */
  readonly hasAttributeRows: boolean;
  /**
   * The host producer must consume the seeder's merged attribute pairs, which
   * happens for THREE reasons: the descriptor has an attribute-backed row (the
   * M11-2 canonical projection), a JSON-seedable non-primitive row (D-18c) whose
   * seed travels as one shell-owned host attribute, or — since the 2026-11-23
   * ADR-0181 A5 amendment — a PROPERTY-ONLY PRIMITIVE row, which has no attribute
   * pair of its own and reaches the claim on that same seed. The predicate is the
   * seeder's own ("any row the JSON seed may carry"), restated here because the
   * compiler cannot import the shell; a descriptor whose only row is a
   * property-only `trustedHtml` brand (the one row type the seed excludes) still
   * emits no attribute seed, keeping those bytes unchanged.
   */
  readonly emitsHostAttributeSeed: boolean;
}

/**
 * The descriptor's `properties` rows, byte-for-byte.
 *
 * Primitive and trustedHtml rows spell the value directly (trustedHtml carries
 * the literal HTML string; the shell brands it per materialisation). Array and
 * object rows emit ONE module-level fresh-literal factory each and the row
 * references that factory name, so the descriptor never holds a mutable shared
 * default graph: the shell calls it once per element instance and the SSR
 * resolver once per render. A module with no table keeps `properties: []`
 * exactly as M09-1a.
 */
function buildPropertyEmission(
  properties: readonly GeneratedElementPlatformProperty[],
): PropertyEmission {
  if (properties.length === 0) {
    return {
      factoryLines: [],
      rowLines: ['  properties: [],'],
      identifiers: [],
      usesPropsResolver: false,
      hasAttributeRows: false,
      emitsHostAttributeSeed: false,
    };
  }
  const factoryLines: string[] = [];
  const identifiers: string[] = [];
  let usesPropsResolver = false;
  const rows = properties.map((property, index) => {
    const attribute = property.attribute === null ? 'null' : JSON.stringify(property.attribute);
    let defaultValue = '';
    if (property.type === 'array' || property.type === 'object') {
      const factoryName = `__oePropertyDefault${index}`;
      identifiers.push(factoryName);
      factoryLines.push(
        `const ${factoryName} = () => (${renderDefaultGraph(property.defaultGraph!)});`,
      );
      defaultValue = factoryName;
      usesPropsResolver = true;
    } else if (property.type === 'trustedHtml') {
      defaultValue = quoteGeneratedJavaScriptValue(property.default);
      usesPropsResolver = true;
    } else {
      defaultValue = quoteGeneratedJavaScriptValue(property.default);
    }
    return (
      `    { name: ${JSON.stringify(property.name)}, attribute: ${attribute}, ` +
      `type: ${JSON.stringify(property.type)}, reflect: ${String(property.reflect)}, ` +
      `default: ${defaultValue} },`
    );
  });
  return {
    factoryLines,
    rowLines: ['  properties: [', ...rows, '  ],'],
    identifiers,
    usesPropsResolver,
    hasAttributeRows: properties.some((property) => property.attribute !== null),
    // Every declared row reaches the claim on one of the seed's channels (the
    // canonical attribute projection for an attribute-backed row, and the JSON
    // seed for an `array`/`object` row or — since the 2026-11-23 ADR-0181 A5
    // amendment — for a property-only PRIMITIVE row) — EXCEPT an
    // `attribute: null` `trustedHtml` brand, which the seed structurally
    // excludes (a brand cannot be rebuilt from JSON). A brand-only descriptor
    // therefore keeps its pre-amendment bytes with no seeder call.
    emitsHostAttributeSeed: properties.some(
      (property) => property.attribute !== null || property.type !== 'trustedHtml',
    ),
  };
}

/**
 * Append the M09-1a CE tail to one generated leaf module./**
 * Append the M09-1a CE tail to one generated leaf module.
 *
 * `site` null is the hostless case: the result is byte-identical to
 * `generateLeafModule`'s (the proof in `generated-element.emitter.test.ts`).
 * The admission gates that read the authored AST live in `site.ts`; this
 * function is the text stage and refuses only emitter invariants.
 */
/**
 * The host record a shadow host producer hands its leaf's `__ssr`.
 *
 * The leaf already routes every custom-element tag through the ONE `nestedHost`
 * helper, which reads the expander off this record (`nestedHost.ts`'s
 * `NESTED_HOST_PROPERTY`). The LIGHT root's producer has always supplied it; the
 * SHADOW wrapper did not, which is why a shadow page's inner components rendered
 * as bare tags. This is the record's spelling, kept in one place so the emitted
 * bytes and the runtime helper can never drift about the field name.
 */
const NESTED_HOST_RECORD_ARG = `nestedHost === undefined ? undefined : { "${NESTED_HOST_EXPANDER}": nestedHost }`;

export function generateElementModule(
  module: FunctionModelModule,
  site: GeneratedElementSite | null,
  options: GenerateElementModuleOptions = {},
): GeneratedElementModule {
  // T3 / 16b-LC-1: the root marker must be known BEFORE the leaf call because
  // the leaf owns where the root setup initializers are evaluated. It is the
  // SAME candidate the tail below validates; an invalid/absent root passes no
  // marker, so the existing diagnostics and byte paths are unchanged. The
  // option is compiler-private (never author syntax, never a site fact) and is
  // passed only for a site module — a hostless leaf stays byte-identical.
  const rootCandidate =
    site === null
      ? undefined
      : (options.rootComponent ??
        (module.components.length === 1 ? module.components[0]!.name : undefined));
  const rootInstanceName =
    rootCandidate !== undefined &&
    IDENTIFIER.test(rootCandidate) &&
    module.components.some((component) => component.name === rootCandidate)
      ? rootCandidate
      : undefined;
  // M09-2e / #1803: derived from the authored sidecar by the lane admission,
  // never from a host fact. An unstyled module passes nothing, so its bytes
  // stay exactly the pre-slice output.
  //
  // P-3 (2026-11-21): a shadow module whose ONLY styling is utility classes
  // declares no `styles`, yet its DSD template still needs the build's shared
  // COMPONENT sheet (the compiler collected those tokens as class candidates).
  // Without the channel the host producer has no parameter to receive the link
  // and the shadow tree renders unstyled — measured on the ui-dogfood TSX-only
  // Tailwind probe. The condition is the module's OWN candidate fact, so a module
  // with neither declarations nor candidates keeps the pre-slice bytes.
  const shadowModule = options.root === 'shadow-open' || options.root === 'shadow-closed';
  // TWO reasons to grow the channel, with DIFFERENT strictness:
  //  - the sidecar DECLARED `styles` -> the author promised sheets, so a render
  //    with no URLs is a broken artifact and fails closed (pre-existing rule);
  //  - the module merely HAS class candidates -> the app may or may not run a
  //    utility engine, so absent URLs are lawful and the producer renders without
  //    a link. Making this strict would turn "no utility engine" into a build
  //    failure for every shadow component.
  const declaredStyles = options.styleLinkPrefix === true;
  const utilityChannel = shadowModule && collectStaticClassCandidates(module).length > 0;
  const styleLinkPrefix = declaredStyles || utilityChannel;
  // 2026-11-20 client style adoption: only the client-only fact (`ssr: false`
  // or `hydrate: 'only'`), read by the SAME lane admission that supplies the
  // declared list. The imports are emitted for a client-only island only — an
  // SSR island's sheet is already delivered by the marked `<link>` inside its
  // DSD template, and adding a module-graph copy would change bytes for a
  // second delivery that the link-delivery guard then has to undo.
  const clientOnly = options.clientOnly === true;
  const clientStyles = clientOnly ? (options.styles ?? []) : [];
  const leaf = generateLeafModule(module, {
    ...(options.authoredSource === undefined ? {} : { authoredSource: options.authoredSource }),
    ...(rootInstanceName === undefined ? {} : { rootInstance: rootInstanceName }),
    ...(styleLinkPrefix ? { claimStyleLinkPrefix: true } : {}),
    // Slot anchors are a LIGHT-root feature only: a light root's children are
    // projections into its own `<slot>` elements, so its producer must name
    // them. A shadow root distributes its light children through the platform
    // and a hostless module is not a host, so both keep the pre-slice bytes.
    ...(hostTemplateRoot(options.root) === null ? { lightRoot: true } : {}),
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
      rootInstanceFactory: leaf.rootInstanceFactory,
      requiredBindings: leaf.requiredBindings,
      requiredProps: leaf.requiredProps,
      requiresPropsChanged: leaf.requiresPropsChanged,
      classCandidates: leaf.classCandidates,
      diagnostics: leaf.diagnostics,
      leaf: leafText,
      tail: null,
      ssrHostExport: null,
    };
  }

  const rootName = rootCandidate;
  if (rootName === undefined || !IDENTIFIER.test(rootName)) {
    return emptyResult(leaf, [
      moduleDiagnostic(
        module.file,
        GENERATED_ELEMENT_DIAGNOSTIC.NOT_A_COMPONENT,
        'the generated element emitter needs one named default-exported component to append a CE tail',
      ),
    ]);
  }
  // Fail closed BEFORE a descriptor exists: a client-only island that declares
  // `styles` but reaches this stage with no static specifier would ship a
  // root the browser creates with nothing to adopt — an unstyled render with no
  // error. The router scan owns the author-facing list-shape refusals; this is
  // the lane's own closure over the SAME sidecar fact (shim #24's failure
  // behaviour, kept by the client style slice).
  if (clientOnly && options.styles !== undefined && clientStyles.length === 0) {
    return emptyResult(leaf, [
      moduleDiagnostic(
        module.file,
        GENERATED_ELEMENT_DIAGNOSTIC.CLIENT_STYLES_UNWIRED,
        'this island declares openElement.styles and is client-only (ssr: false), but no static ' +
          '.css specifier reached the emitter. A client-only island has no DSD template to carry ' +
          'the stylesheet link, so the sheet can only arrive through a module-graph import: ' +
          'refusing instead of rendering the element unstyled',
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
    // M11 complete vertical: the emitted host producer seeds its content props
    // from the host's canonical attribute pairs through the shell's ONE
    // attribute-conversion surface (the same leaf the client shell's
    // `attributeChangedCallback` path uses) plus the declared primitive
    // defaults. The descriptor rows emitted above ARE the input; nothing is
    // re-derived and no second conversion table exists.
    hostPropsSeed: 'seedGeneratedElementHostProperties',
    hostPropsVar: '__oeHostProps',
    propsResolver: 'resolveGeneratedElementProps',
    ssrHost: `${rootName}__ssrHost`,
    // The light-root SSR producer name (the leaf's parameterless `<Name>__ssr`).
    ssrProducer: `${rootName}__ssr`,
    // 2026-11-20 client style adoption: one module-scope import binding per
    // declared sheet. The name is compiler-owned and collision-checked against
    // the leaf text like every other tail identifier.
    styleImport: (index: number): string => `__oeStyle${index}`,
  };
  const root = options.root;
  const templateRoot = hostTemplateRoot(root);
  // The M09-2a host wrapper is appended only for a shadow descriptor whose leaf
  // actually emitted the content-only `<Name>__ssr`. A light root (or an absent
  // root, which the shell defaults to light) appends nothing at all, so the
  // M09-1a light tail keeps its exact bytes.
  const delegatesFocus = options.delegatesFocus === true;
  const formAssociated = options.formAssociated === true;
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
  // A CLIENT-ONLY island with NO declared sheet has no server render, so it must
  // have no host producer — stated here rather than inferred from the leaf's
  // silence. Inference is how it worked until F16: the leaf declined `__ssr` for a
  // property channel, which incidentally kept such islands producerless, and
  // admitting that channel exposed how fragile the dependency was.
  //
  // A client-only island that DOES declare sheets keeps the wrapper: its
  // `styleLinks` channel is the SSR/DSD half of "one asset, one delivery", and the
  // client row is additive on top of it.
  const producerlessClientOnly = options.clientOnly === true && clientStyles.length === 0;
  const hostWrapper =
    !producerlessClientOnly && templateRoot !== null && exportsSsrFunction(leafText, rootName)
      ? { root: templateRoot, name: names.ssrHost }
      : null;
  const propertyEmission = buildPropertyEmission(options.properties ?? []);
  const collisionNames = [
    names.descriptor,
    names.element,
    names.alias,
    names.tag,
    names.shellImport,
    ...clientStyles.map((_, index) => names.styleImport(index)),
    ...propertyEmission.identifiers,
    ...(propertyEmission.usesPropsResolver && hostWrapper !== null ? [names.propsResolver] : []),
    ...(hostWrapper === null
      ? []
      : [
          names.ssrHostImport,
          names.hostPropsSeed,
          names.hostPropsVar,
          names.ssrHost,
          ...(styleLinkPrefix ? ['styleLinks'] : []),
        ]),
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
  // T3 / 16b-LC-1: the descriptor row is driven by the leaf generator's OWN
  // emission decision (`rootInstanceFactory` is non-null exactly when the
  // factory declaration was written), never by scanning the emitted text. A
  // root with no local setup snapshot keeps today's descriptor bytes (and the
  // shell's `createBindings?.() ?? {}` path); the compiler-owned name is
  // deliberately absent from the tail collision list above.
  const rootInstanceFactory = leaf.rootInstanceFactory;

  const tail = [
    '',
    '// ---- generated native element (M09-1) ----',
    `import { ${[
      names.shellImport,
      ...(propertyEmission.usesPropsResolver && hostWrapper !== null ? [names.propsResolver] : []),
      ...(hostWrapper === null ? [] : [names.ssrHostImport, names.hostPropsSeed]),
    ].join(', ')} } from ${JSON.stringify(GENERATED_ELEMENT_SHELL_SPECIFIER)};`,
    // 2026-11-20 client style adoption: a client-only island's declared sheets
    // ride REAL module-graph edges. The router build's style-asset intercept
    // answers each specifier with the sheet adapter (a `CSSStyleSheet` carrying
    // the emitted asset URL), so the descriptor below receives objects, not
    // strings, and the sheet is the SAME emitted asset the build-time
    // declaration already produces (the emitter dedups by content-hash file).
    ...clientStyles.map(
      (specifier, index) => `import ${names.styleImport(index)} from ${JSON.stringify(specifier)};`,
    ),
    '',
    ...propertyEmission.factoryLines,
    ...(propertyEmission.factoryLines.length === 0 ? [] : ['']),
    `const ${names.descriptor} = {`,
    `  tag: ${JSON.stringify(site.tag)},`,
    // No authored root → no descriptor property: the shell's own
    // `descriptor.root ?? 'light'` default is the single default owner.
    ...(root === undefined ? [] : [`  root: ${JSON.stringify(root)},`]),
    ...(delegatesFocus ? ['  delegatesFocus: true,'] : []),
    ...(formAssociated ? ['  formAssociated: true,'] : []),
    ...propertyEmission.rowLines,
    // A client-only island's sheets are carried to the shell as imported sheet
    // objects; every other lane keeps its pre-slice descriptor bytes (the SSR
    // lane's sheet is the marked `<link>` inside the DSD template).
    ...(clientStyles.length === 0
      ? []
      : [`  styles: [${clientStyles.map((_, index) => names.styleImport(index)).join(', ')}],`]),
    `  createRecipe: create${rootName}Recipe,`,
    // T3 / 16b-LC-1: the root setup factory is the descriptor's call-once
    // retained setup site (compiler-private member the shell already owns from
    // LC-0). Emitted only when the leaf declared it; `createBindings` remains
    // never emitted.
    ...(rootInstanceFactory === null ? [] : [`  createInstance: ${rootInstanceFactory},`]),
    // A LIGHT (or absent) descriptor root serializes its own children, so its
    // SSR entry point is the leaf's parameterless `<Name>__ssr` — the shadow
    // root's `<Name>__ssrHost` DSD wrapper has no light DOM to produce. The row
    // is emitted only when the leaf really emitted that producer, and the shell
    // attaches it as the class's static `__ssr` (one class = one registration).
    ...(root !== undefined && root !== 'light'
      ? []
      : exportsSsrFunction(leafText, rootName)
        ? [`  ssrProducer: ${names.ssrProducer},`]
        : []),
    '};',
    '',
    `const ${names.element} = createGeneratedElementClass(${names.descriptor});`,
    '',
    `export default ${names.element};`,
    `export { ${names.element} as ${names.alias} };`,
    `export const ${names.tag} = ${JSON.stringify(site.tag)};`,
    // The host-level DSD producer (M09-2a; M11 complete vertical). The content
    // stays the leaf's content-only `<Name>__ssr` bytes; the wrapper adds the
    // canonical template through the one browser-safe producer leaf, and seeds
    // the content props from the host's canonical attribute pairs through the
    // shell's ONE attribute-conversion surface. Static/authored host attributes
    // are therefore standard SSR input (not a dynamic-only channel), while the
    // parent's in-process property channel still wins when both carry a value.
    ...(hostWrapper === null
      ? []
      : [
          '',
          '// ---- generated shadow host SSR (M09-2a) ----',
          // P-6 (2026-11-21): the SHADOW host producer receives the SAME nested-host
          // expander the LIGHT root's producer receives, in the same last position.
          // Without it a shadow page's inner components stayed unexpanded tags while
          // the class lane and the light lane both expanded theirs — a parity gap,
          // not a design boundary. Appended LAST so every existing caller's argument
          // positions are unchanged.
          // FIXED PARAMETER POSITIONS (P-6): the producer ALWAYS declares
          // `(props, lightChildren, attributes, styleLinks, nestedHost)`, even when
          // this module has no stylesheet channel. An optional parameter that
          // shifts position with a build fact makes the CALLER'S argument order
          // depend on the callee's styling — the runtime would hand a function to
          // `styleLinks` and the leaf would never see its expander. Declaring the
          // slot always keeps one order for every module.
          `export function ${hostWrapper.name}(props, lightChildren, attributes, styleLinks, nestedHost) {`,
          // Mixed generated-element/entry artifacts: the new producer requires
          // the declared stylesheet URLs, but an old 3-arg caller (or a missing
          // carrier) would otherwise render the shadow host silently unstyled.
          // Fail closed before any seed/serialization work; the per-URL shape
          // stays owned by the canonical marked-link serializer.
          // ONLY the DECLARED case fails closed. A module that merely has class
          // candidates takes the channel tolerantly: an app with no utility engine
          // legitimately passes no URLs, and failing it closed would turn "no
          // utility engine" into a build error for every shadow component.
          ...(declaredStyles
            ? [
                '  if (!Array.isArray(styleLinks) || styleLinks.length === 0) throw new Error("OEIR_LEAF_MISSING_VALUE: styleLinks (the styled generated element received no declared stylesheet URLs; mixed generated-element/entry artifacts or a missing style-link carrier)");',
              ]
            : []),
          ...(propertyEmission.emitsHostAttributeSeed
            ? [
                `  const ${names.hostPropsVar} = ${names.hostPropsSeed}(${names.descriptor}.properties, props, attributes);`,
                `  const ${HOST_ATTRIBUTES_VAR} = ${names.hostPropsVar}.${HOST_ATTRIBUTES_KEY};`,
                `  return ${names.ssrHostImport}({`,
                `    tag: ${JSON.stringify(site.tag)},`,
                `    root: ${JSON.stringify(hostWrapper.root)},`,
                ...(delegatesFocus ? ['    dsd: { delegatesFocus: true },'] : []),
                `    content: ${rootName}__ssr(${
                  propertyEmission.usesPropsResolver
                    ? `${names.propsResolver}(${names.descriptor}, ${names.hostPropsVar})`
                    : names.hostPropsVar
                }, ${NESTED_HOST_RECORD_ARG}),`,
                '    ...(lightChildren === undefined ? {} : { lightChildren }),',
                `    ...(attributes === undefined && ${HOST_ATTRIBUTES_VAR} === undefined ? {} : { attributes: ${HOST_ATTRIBUTES_VAR} === undefined ? attributes : ${HOST_ATTRIBUTES_VAR} }),`,
                ...(styleLinkPrefix
                  ? ['    ...(styleLinks === undefined ? {} : { styleLinks }),']
                  : []),
                '  });',
                '}',
              ]
            : [
                `  const ${names.hostPropsVar} = ${names.hostPropsSeed}(${names.descriptor}.properties, props, attributes);`,
                `  return ${names.ssrHostImport}({`,
                `    tag: ${JSON.stringify(site.tag)},`,
                `    root: ${JSON.stringify(hostWrapper.root)},`,
                ...(delegatesFocus ? ['    dsd: { delegatesFocus: true },'] : []),
                `    content: ${rootName}__ssr(${
                  propertyEmission.usesPropsResolver
                    ? `${names.propsResolver}(${names.descriptor}, ${names.hostPropsVar})`
                    : names.hostPropsVar
                }, ${NESTED_HOST_RECORD_ARG}),`,
                '    ...(lightChildren === undefined ? {} : { lightChildren }),',
                '    ...(attributes === undefined ? {} : { attributes }),',
                ...(styleLinkPrefix
                  ? ['    ...(styleLinks === undefined ? {} : { styleLinks }),']
                  : []),
                '  });',
                '}',
              ]),
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
    rootInstanceFactory: leaf.rootInstanceFactory,
    requiredBindings: leaf.requiredBindings,
    requiredProps: leaf.requiredProps,
    requiresPropsChanged: leaf.requiresPropsChanged,
    classCandidates: leaf.classCandidates,
    diagnostics: [],
    leaf: leafText,
    tail,
    // Return-only build metadata from the SAME hostWrapper decision above: the
    // name is exactly what the appended `export function` declares, or null
    // when no wrapper exists. The emitted bytes never carry this field.
    ssrHostExport: hostWrapper === null ? null : hostWrapper.name,
  };
}
