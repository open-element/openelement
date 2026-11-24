// Single-file cohesion is a deliberate trade against small-parts granularity (comply-or-explain, design-principles.md:16-19): the root-facade implementation boundary is ONE surface — the server-render entry (`renderToString`: compiled Part Program serializer dispatch, generated-host registry pairing, light-host attribute writing, property seeding), the pre-upgrade capture bootstrap over the claim capture/replay seam, and the core/protocol/signal surface a compiled module resolves against — because a page root and a NESTED host must render and seed through the same decision table (serializer selection, host-attribute merge, prop seed) rather than two that can disagree; the boundary is that it is NOT a package subpath: it hosts no compiler, no second serializer and no DOM executor of its own, and every compiled/runtime fact it re-exports keeps its own owner.
/**
 * Deliberate root-facade implementation boundary. Not a package subpath.
 *
 * This facade exposes the server-render entry (`renderToString`, implemented over
 * the compiled Part Program serializer) and the pre-upgrade capture bootstrap
 * (implemented over the compiled claim capture/replay seam), alongside the
 * shared core/protocol/signal surface re-exported below.
 */
import { normalizeHostAttributePairs } from './internal/compiled/server/index.ts';
import { SSR_REGISTRY_GENERATED_HOSTS } from '@openelement/protocol/registry-markers';
// The NEUTRAL conversion table, not the facade's re-export of it: the facade is
// the class lane's host and goes away with it, while this function is shared by
// both lanes' property records (F16 deletion prep).
import { requestTimeIslandStyleLinks } from './internal/compiled/server/style-links.ts';
import type { DocumentStyleResources } from './internal/core/html-escape.ts';
import { escapeAttrValue } from './internal/core/html-escape.ts';
import type {
  CompiledElementMetadata,
  CompiledPropertyMetadata,
  PartProgram,
} from '@openelement/protocol/part-program';
import {
  ErrorCode,
  FacadeErrorCode,
  OpenElementError,
  raiseFrameworkError,
} from './internal/core/errors.ts';
import { MAX_COMPOSITION_DEPTH } from '@openelement/protocol/policy';
import type {
  NestedHostFallback,
  NestedHostRequest,
} from './internal/compiled/runtime/nested-host.ts';
import type { CompiledSignalLike } from './internal/compiled/server/index.ts';
import { type TrustedHtml, trustedHtmlValue } from './internal/core/security.ts';
import { substituteSlotAnchors } from './internal/compiled/slot-anchors.ts';
import { CompiledProgramValidationError } from './internal/compiled/runtime/values.ts';
import { DATA_OE_LIGHT_PROJECTION } from './internal/compiled/generated-element/runtime-only-host-attributes.ts';

export { collectPublicProps } from './internal/core/props-utils.ts';
export type { SsrAdmissionDecision } from '@openelement/protocol/render';
export {
  consumeContext,
  createContext,
  provideContext,
  releaseConsumedContext,
} from './internal/core/index.ts';
export type { Context, RenderError } from './internal/core/index.ts';
export { assertValidTagName, isValidTagName } from './internal/core/tag-utils.ts';
export { ERROR_PREFIX } from '@openelement/protocol/errors';
export {
  formatError,
  OpenElementError,
  reportError,
  setErrorTelemetryHook,
} from './internal/core/errors.ts';
export type { ErrorTelemetryHook } from '@openelement/protocol/errors';
export { computed, effect, signal } from './internal/signal/index.ts';
export type { ReadonlySignal, Signal } from '@openelement/protocol/signal';
export {
  onConnect,
  onDispose,
  onError,
  onPropertyChange,
  ref,
  useContext,
  useHost,
} from './internal/core/compile-lifecycle.ts';
export {
  DANGEROUS_KEYS,
  isDangerousKey,
  isSafeAttributeName,
  trustedHtml,
} from './internal/core/security.ts';
export { injectPropsSafe } from './internal/core/security.ts';
export type { TrustedHtml } from './internal/core/security.ts';
export {
  createDocumentStyleResources,
  documentStreamParts,
  escapeAttr,
  escapeHtml,
  wrapInDocument,
} from './internal/core/html-escape.ts';
export type { DocumentStyleResources } from './internal/core/html-escape.ts';
// Streamed-frame admission policy (#1412 companion): the single source the
// build manifest scan, the stream executor admission, and the generated
// browser installer all consume.
export {
  STREAM_FRAME_FORBIDDEN_TAGS,
  STREAM_FRAME_UNSAFE_URL,
  STREAM_FRAME_URL_ATTRIBUTES,
  STREAM_FRAME_URL_CONTROL_MAX,
  unsafeStreamFrameAttribute,
} from '@openelement/protocol/stream-frame-policy';
// Numeric build/runtime policy budgets (internal/protocol/policy.ts): the
// same single-source contract for the streaming admission numbers.
export {
  IDLE_FALLBACK_TIMEOUT_MS,
  MAX_ACTION_BODY_BYTES,
  MAX_COMPOSITION_DEPTH,
  STREAM_MAX_FIELDS,
  STREAM_MAX_OWNERS,
  STREAM_MAX_PAYLOAD_LENGTH,
  STREAM_MAX_SEED_PROPERTIES,
  STREAM_TIMEOUT_MS,
} from '@openelement/protocol/policy';
export type { IslandOptions } from '@openelement/protocol/island';
export { StyleSheet } from './internal/core/style-sheet.ts';
export { createLogger } from './internal/core/logger.ts';
export type { Logger } from './internal/core/logger.ts';
export type { StyleSheetLike } from '@openelement/protocol/style-sheet';
export { deepGetElementById, ensureDeepFragmentNavigation } from './internal/core/deep-fragment.ts';
export { ensurePreHydrationClickCapture } from './internal/compiled/runtime/pre-upgrade-events.ts';

// ─── Server-render entry (compiled serializer) ─────────────────────

/**
 * The signal capability the compiled server host and its computed factories
 * actually consume: a readable protocol signal, never a writable promise.
 */
type CompiledSignalRecord = Record<string, CompiledSignalLike<unknown>>;

/** Compiled class statics consumed by the server-render entry. */
interface CompiledComponentConstructor extends CustomElementConstructor {
  /** The descriptor's authoritative custom-element name for constructor-form SSR. */
  __oeTag?: string;
  __partProgram?: PartProgram;
  __compiledProperties?: CompiledPropertyMetadata[];
  __elementMetadata?: CompiledElementMetadata;
  /**
   * The build-time ROOT MODE (`light` | `shadow`). Its own static rather than a
   * read of `__partProgram.root.kind`, so dispatch never depends on the
   * execution artifact (C07–C11).
   */
  __computedFields?: Record<string, (signals: CompiledSignalRecord) => CompiledSignalLike<unknown>>;
  /**
   * The emitted property table (`static props`), whose `default` holds the
   * authored initializer verbatim — the only carrier of a non-serializable
   * default (a `trustedHtml(...)` capability object) at SSR time.
   */
  props?: Record<string, { default?: unknown }>;
  styles?: unknown;
  delegatesFocus?: boolean;
  /** Marks a compiled ErrorBoundary subclass (the public base sets it). */
  isErrorBoundary?: boolean;
  /**
   * True when the compiler admitted static class candidates for this component
   * (alpha15 S lane, emitted by the compiler on shadow-root components that
   * carry utility classes). The SSR serializer then declares the server
   * build's component stylesheet as external `<link>` nodes in the DSD
   * template; a false/absent flag means the component needs none.
   */
  __oeUtilityClasses?: boolean;
}

/** The compiled tag a diagnostic names, or `<unknown>` for a foreign class. */
/**
 * The half of {@linkcode DocumentStyleResources} a render needs: it only ever
 * reports the sheets it discovered, so the seam is typed by that one method
 * and stays assignable from any structurally identical collector.
 */
export type DocumentStyleSink = Pick<DocumentStyleResources, 'add'>;

/**
 * Options for one `renderToString()` call: the compiled component class to
 * serialize, the values projected onto its compiled properties, optional
 * route/source diagnostics metadata, the nested compiled tags the build
 * admitted, and trusted parent-owned light children keyed by slot name.
 */
export interface RenderToStringOptions {
  componentClass?: CustomElementConstructor;
  props?: Record<string, unknown>;
  sourceInfo?: { route?: string; source?: string };
  /** Build-admitted nested compiled tags. Omitted means shell-only rendering. */
  ssrRenderableTags?: readonly string[];
  /** Trusted parent-owned light children keyed by slot name. */
  projectedChildren?: ReadonlyMap<string, TrustedHtml>;
  /**
   * Trusted parent-owned light children emitted AFTER the host's DSD template
   * (a shadow-root host's slotted content). This is the shadow-side sibling of
   * `projectedChildren`: a light root substitutes projections into its own
   * `<slot>` elements, a shadow root distributes appended light DOM natively.
   * Both are the compiled children channel — compiler-produced final HTML
   * carrying the trustedHtml brand, never loader data — and a value on a LIGHT
   * root fails closed (its children are projections, not appendages).
   */
  hostChildren?: TrustedHtml;
  /**
   * `16b-EB` (execution plan §19.2): the report channel for a descendant producer
   * that threw while the enclosing error boundary owns it.
   *
   * The boundary supplies this; the renderer routes the caught failure here
   * instead of failing the whole render, and renders the boundary's fallback
   * bytes in the failing descendant's place. OMITTED is the no-boundary render:
   * the failure re-raises, which is the unchanged pre-`16b-EB` behaviour, so this
   * can never become a silent swallow.
   */
  onNestedFailure?: (error: unknown) => void;
  /** Sheet URLs a nested LIGHT child lifted into the enclosing template (F16). */
  nestedStyleSink?: Set<string>;
  /**
   * The render's document stylesheet collection (alpha15 S lane, S-C1.2).
   * Every light-root component serialized in this render reports its external
   * sheet URLs here, and the document wrapper declares them in the head. The
   * caller owns the collection's lifetime — one per document render — so
   * styles discovered for one page can never reach another page's head.
   */
  documentStyles?: DocumentStyleSink;
}

/** Element-private normalized options used while recursively composing components. */
interface InternalRenderToStringOptions extends Omit<
  RenderToStringOptions,
  'projectedChildren' | 'hostChildren'
> {
  hostAttrs?: readonly (readonly [string, unknown])[];
  projectedChildren?: ReadonlyMap<string, string>;
  /** Caller authored a child list that may project after a later update. */
  lightProjectionIntent?: boolean;
  /** The brand-checked, reserved form of {@linkcode RenderToStringOptions.hostChildren}. */
  hostChildren?: string;
  /** The resource tree that owns styles discovered by this render. */
  styleDestination?: NestedStyleDestination;
  /** Live stylesheet destination inherited while composing nested light roots. */
  nestedStyleLinkSink?: NestedStyleLinkSink;
}

function classNameOf(ctor: object): string {
  return (ctor as { name?: string }).name ?? 'anonymous';
}

/**
 * Serialize one LIGHT-root generated host: the element tag, its canonical
 * attribute pairs and the compiled content (with caller projections
 * substituted into it) as the host's children.
 *
 * The producer is content-only because that is exactly what a light root owns —
 * its region is the host's children, not a template. The attribute pairs go
 * through the SAME normalization the shadow host producer receives, so a light
 * and a shadow host spell the same authored attributes identically.
 *
 * `projectedChildren` is the compiled children channel's light-side half. A
 * generated light producer names each of its `<slot>` elements with an
 * `oe:s:` / `oe:/s:` anchor pair, so substitution is a walk over the producer's
 * OWN marker comments — there is no markup pattern match and no second parse of
 * the content. A projection that names a slot the content does not declare
 * fails closed with the serializer's validation identity, exactly like the
 * class lane's `projectedChildren` check.
 */
/**
 * The light-root class static's result: the serialized content plus the seeded
 * host attribute pairs (`__oeHostAttributes`) it computed but has no wrapper to
 * return. A string is the pre-existing shape and carries no pairs, so an older
 * emitted module keeps rendering byte-identically.
 */
interface LightSsrResult {
  readonly content: string;
  readonly hostAttributes: readonly (readonly [string, string])[] | undefined;
  /**
   * The declared rows whose ONLY host wire is the JSON seed (`array`/`object`
   * rows, and since the 2026-11-23 ADR-0181 A5 amendment the property-only
   * primitives). The shell owns that set; the light writer only needs the names.
   * A caller pair addressed to one of them has no attribute channel — the
   * descriptor refuses one and `observedAttributes` never observes it — so the
   * writer must not spell it as text. Absent for the string shape (an older
   * emitted module), which keeps the pre-existing bytes.
   */
  readonly seedRows?: readonly string[];
}

function lightResult(rendered: unknown, lane: string, tag: string): LightSsrResult {
  if (typeof rendered === 'string') return { content: rendered, hostAttributes: undefined };
  if (
    rendered !== null &&
    typeof rendered === 'object' &&
    typeof (rendered as LightSsrResult).content === 'string'
  ) {
    return rendered as LightSsrResult;
  }
  throw new OpenElementError(
    `[openElement] the ${lane} generated element <${tag}> produced ${typeof rendered} instead ` +
      'of an HTML string; the compiler-emitted `__ssr` producer must always return serialized ' +
      'content.',
    { code: FacadeErrorCode.PROGRAM_MISSING, phase: 'ssr' },
  );
}

/**
 * Merge the caller's authored attribute pairs with the ones the class static
 * seeded. The seeded pair for a name REPLACES the authored one: it is the
 * canonical converted value the claim will re-read, and the JSON seed is
 * emitted only by the seeder.
 *
 * `seedRows` names the rows the JSON seed ALREADY carries — the seeder's own
 * verdict, never re-derived here. Such a row is property-only: the descriptor
 * refuses an attribute for it and `observedAttributes` never observes one, so a
 * pair naming it is not a second spelling of the row. Leaving it on the tag is
 * worse than redundant — the host writer normalizes pairs through the class
 * lane's value algebra, which is `String()` for anything that is not
 * `class`/`style`, so an array arrives as `items="[object Object],…"`. Both
 * sides are dropped for those names, and the value travels on
 * `data-oe-prop-seed` alone (the ONE channel `applyGeneratedPropSeed` reads).
 * The family is every JSON-seedable `array`/`object` row plus, since the
 * 2026-11-23 ADR-0181 A5 amendment, the property-only primitives. Primitive
 * rows with an attribute channel and static attributes keep their bytes; a row
 * the seed does not carry is untouched.
 */
function mergeHostAttributes(
  authored: readonly (readonly [name: string, value: unknown])[] | undefined,
  seeded: readonly (readonly [string, string])[] | undefined,
  seedRows: readonly string[] | undefined,
): readonly (readonly [name: string, value: unknown])[] | undefined {
  const carried = (name: string): boolean => seedRows?.includes(name) === true;
  const authoredPairs =
    seedRows === undefined || seedRows.length === 0 || authored === undefined
      ? authored
      : authored.filter(([name]) => !carried(name));
  const seededPairs =
    seedRows === undefined || seedRows.length === 0 || seeded === undefined
      ? seeded
      : seeded.filter(([name]) => !carried(name));
  if (seededPairs === undefined || seededPairs.length === 0) return authoredPairs;
  const byName = new Map<string, unknown>();
  for (const [name, value] of authoredPairs ?? []) byName.set(name, value);
  for (const [name, value] of seededPairs) byName.set(name, value);
  return [...byName];
}

function serializeLightGeneratedHost(
  tag: string,
  content: string,
  authoredAttributes: readonly (readonly [string, unknown])[] | undefined,
  projectedChildren?: ReadonlyMap<string, string>,
  lightProjectionIntent = false,
): string {
  const pairs =
    authoredAttributes === undefined
      ? []
      : normalizeHostAttributePairs(authoredAttributes).attributes.map(
          (attribute) => [attribute.name, attribute.bare ? '' : attribute.value] as const,
        );
  const attributes = pairs.map(([name, value]) => ` ${name}="${escapeAttrValue(value)}"`).join('');
  // The marker is the light-root OWNERSHIP fact, not an authored attribute: the
  // class lane's serializer always writes it, and the claim path plus the
  // light-root CSS scope both key off it. A generated light host that omitted it
  // would serialize the right CONTENT under the wrong ownership contract, and
  // the divergence would only surface when something asked the DOM whose
  // children those were.
  // Order matches the class lane's serializer (authored attributes first, the
  // marker last), so a consumer keying off attribute order — a snapshot, a
  // string patch, a CSS attribute selector list — sees one spelling.
  const children = projectSlotAnchors(content, projectedChildren);
  const hasProjectedChildren =
    lightProjectionIntent ||
    [...(projectedChildren?.values() ?? [])].some((html) => html.length > 0);
  const projectionMarker = hasProjectedChildren ? ` ${DATA_OE_LIGHT_PROJECTION}` : '';
  return `<${tag}${attributes} data-oe-light${projectionMarker}>${children}</${tag}>`;
}

/**
 * Substitute caller projections into a generated light producer's anchored slot
 * regions, translating this module's one failure shape into the serializer's
 * existing validation identity.
 *
 * The substitution itself lives in `./internal/compiled/slot-anchors.ts`: it
 * walks the producer's OWN slot-anchor comments and never inspects element
 * markup, so there is no second HTML parser here and no markup pattern match.
 */
function projectSlotAnchors(
  content: string,
  projectedChildren: ReadonlyMap<string, string> | undefined,
): string {
  const result = substituteSlotAnchors(content, projectedChildren);
  if ('path' in result) {
    throw new CompiledProgramValidationError(result.path, result.message);
  }
  return result.html;
}

function compiledTagOf(ctor: CompiledComponentConstructor): string | undefined {
  if (typeof ctor.__oeTag === 'string' && ctor.__oeTag !== '') return ctor.__oeTag;
  const registry = typeof customElements === 'undefined' ? undefined : customElements;
  const getName = (
    registry as unknown as
      | { getName?: (value: CustomElementConstructor) => string | null }
      | undefined
  )?.getName;
  if (typeof getName !== 'function') return undefined;
  const name = getName.call(registry, ctor);
  return typeof name === 'string' && name !== '' ? name : undefined;
}

function compositionDepthError(): OpenElementError {
  return new OpenElementError(
    '[openElement] nested element expansion exceeded the depth bound; cyclic component composition is not renderable.',
    { code: FacadeErrorCode.COMPOSITION_DEPTH, phase: 'ssr' },
  );
}

function failUncompiled(ctor: object, tag: string): never {
  raiseFrameworkError(
    'ssr',
    FacadeErrorCode.PROGRAM_MISSING,
    `[openElement] <${tag}> (${classNameOf(ctor)}) has no compiled Part Program. ` +
      'renderToString only serializes classes produced by the OpenElement compiler ' +
      '(@openelement/compiler open:compiled-element transform).',
  );
}

/** The compiler-emitted generated host producer the entry's registry guard pairs with a tag. */
type RegisteredGeneratedHostRenderer = (
  props: Readonly<Record<string, unknown>>,
  lightChildren: string | undefined,
  attributes: readonly (readonly [string, string])[] | undefined,
  styleLinks?: readonly string[],
  /**
   * The render's nested-host expander (P-6). Appended LAST so a producer emitted
   * before this slice — which declares only the four leading parameters — stays a
   * valid implementation: the extra argument is simply ignored.
   */
  nestedHost?: unknown,
) => unknown;

/**
 * Resolve one registered generated host renderer from the ONE protocol pair
 * table the generated entry's registry guard writes
 * (`SSR_REGISTRY_GENERATED_HOSTS`).
 *
 * `undefined` means "this tag is not a generated host": the caller keeps the
 * compiled-class path byte-identical. A malformed table, or a present-but-
 * invalid entry, fails closed with the existing program-missing identity —
 * treating it as absent would silently dispatch the tag to a different renderer
 * (L1 fail-closed rule, shared by the root page path and nested expansion).
 */
function registeredGeneratedHostRenderer(tag: string): RegisteredGeneratedHostRenderer | undefined {
  const registry =
    typeof customElements === 'undefined'
      ? undefined
      : (customElements as unknown as Record<string, unknown>);
  const rawTable = registry === undefined ? undefined : registry[SSR_REGISTRY_GENERATED_HOSTS];
  if (rawTable === undefined) return undefined;
  if (!(rawTable instanceof Map)) {
    throw new OpenElementError(
      "[openElement] the SSR registry's generated-host table is malformed " +
        '(expected a Map); the generated entry registry guard is its only writer.',
      { code: FacadeErrorCode.PROGRAM_MISSING, phase: 'ssr' },
    );
  }
  const table = rawTable as Map<string, unknown>;
  if (!table.has(tag)) return undefined;
  const hostRenderer = table.get(tag);
  if (typeof hostRenderer !== 'function') {
    throw new OpenElementError(
      `[openElement] admitted generated host <${tag}> is paired with a ` +
        `${typeof hostRenderer} renderer; the registry guard only writes the ` +
        'compiler-emitted host function.',
      { code: FacadeErrorCode.PROGRAM_MISSING, phase: 'ssr' },
    );
  }
  return hostRenderer as RegisteredGeneratedHostRenderer;
}

/**
 * The stylesheet URLs a DSD template being BUILT must declare (F16).
 *
 * A shadow host's template declares its OWN per-island sheets plus the sheets of
 * every nested LIGHT child that is actually expanded into it: a light root owns no
 * template, so its content lands in the enclosing one and a document-head link
 * cannot reach content inside a shadow tree. A nested SHADOW child declares its
 * links in ITS OWN template and contributes nothing here.
 *
 * The list is LIVE and filled in authored order while the enclosing producer
 * builds its content. That is the only correct moment: a producer is a STRING
 * BUILDER, so once it returns, the template bytes are fixed. The compiler-emitted
 * wrapper evaluates `content:` before it serializes the host, and the nested-host
 * expander handed to that content appends here as each light child expands — so
 * `serializeGeneratedElementHtml` reads the complete list.
 *
 * PRE-FILLING this sink from the render's admission set is what shipped the F16
 * union defect: an app-wide admission set says which tags MAY expand, not which
 * ones ARE in this template, so every shadow template declared every styled island
 * in the application (`/generated` carried 7 marked links for 1 own sheet).
 */
interface NestedStyleLinkSink {
  /** The live URL list the host producer serializes (own links first). */
  readonly links: readonly string[];
  /** How many resources the list carries. */
  readonly size: number;
  /** Append declared URLs, deduplicated: a sheet is one resource, one link. */
  add(urls: readonly string[] | null | undefined): void;
}

function createNestedStyleLinkSink(): NestedStyleLinkSink {
  const links: string[] = [];
  const seen = new Set<string>();
  return {
    get links(): readonly string[] {
      return links;
    },
    get size(): number {
      return links.length;
    },
    add(urls: readonly string[] | null | undefined): void {
      if (urls === null || urls === undefined) return;
      for (const url of urls) {
        if (typeof url !== 'string' || url === '' || seen.has(url)) continue;
        seen.add(url);
        links.push(url);
      }
    },
  };
}

/**
 * Build the nested-host expander for ONE render (P-6, 2026-11-21).
 *
 * The class lane expands a nested custom-element host because its serializer walks
 * `renderNestedElement` for every `*-*` tag. A generated element's `__ssr` is a
 * STRING BUILDER, so it needs an expander handed to it — and EVERY generated
 * markup producer needs the same one: a light root, a shadow host, and a page
 * root. This factory is that single implementation; before it the body lived
 * inline in the light-root branch only, so a shadow page's `<open-dialog>` stayed
 * a bare tag while both other lanes expanded theirs.
 *
 * The expander reuses the SAME nested dispatch the class lane uses — the registry
 * pair channel, then a light-root class static, then the compiled class — so a
 * nested host expands identically from either parent lane. The admission set is
 * the render's own `ssrRenderableTags`; a tag outside it answers `undefined` and
 * the producer keeps its literal bytes. Returns `undefined` when the render
 * admits nothing, so a project with no admitted nested tag emits no expander.
 *
 * `sharedStyleSink` carries the enclosing template's live sheet list into a
 * nested LIGHT child's own content: that content lands in the SAME enclosing
 * template, so any light descendant it expands must lift into the same list
 * (`F16` trap: a producer is a string builder, so the list cannot be amended
 * after it returns). A shadow host's own content starts a fresh sink.
 */
type NestedStyleDestination = 'document' | 'shadow';

function createNestedHostExpander(
  options: InternalRenderToStringOptions,
  depth: number,
  sharedStyleSink?: NestedStyleLinkSink,
  styleDestination: NestedStyleDestination = 'shadow',
): ((request: NestedHostRequest) => string | undefined | NestedHostFallback) | undefined {
  const admittedNested = new Set(options.ssrRenderableTags ?? []);
  if (admittedNested.size === 0) return undefined;
  const nestedStyleSink = sharedStyleSink ?? createNestedStyleLinkSink();
  const expander = (request: NestedHostRequest): string | undefined | NestedHostFallback => {
    if (!admittedNested.has(request.tag)) return undefined;
    // `16b-EB` (execution plan §19.2): a descendant producer that throws is owned
    // by the enclosing error boundary, so the throw must not fail the whole
    // render. Catching HERE is what makes the boundary's fallback bytes possible
    // at all — the producer is the failing phase, and this is the only frame that
    // both knows the failure and can still emit the boundary's reset output. A
    // render with NO boundary keeps the pre-`16b-EB` behaviour because this
    // re-raises when the host supplies no reporter.
    try {
      return expandNestedHostOnce(options, depth, request, nestedStyleSink, styleDestination);
    } catch (error) {
      if (options.onNestedFailure === undefined) throw error;
      options.onNestedFailure(error);
      return request.fallback;
    }
  };
  // The enclosing producer reads the lifted sheets back off the expander it was
  // given, so the collector never widens the producer's signature.
  return Object.assign(expander, { nestedStyleSink });
}

/** The live sink a render's expander carries, or undefined when it has none. */
function nestedStyleSinkOf(expander: unknown): NestedStyleLinkSink | undefined {
  return (expander as { nestedStyleSink?: NestedStyleLinkSink } | undefined)?.nestedStyleSink;
}

/** One expansion attempt: the registry pair, then a light class static, then the class. */
function expandNestedHostOnce(
  options: InternalRenderToStringOptions,
  depth: number,
  request: NestedHostRequest,
  /**
   * The enclosing template's live sheet list (F16): a nested LIGHT child's
   * sheets cannot live in the child, which has no template, so they are
   * appended to the template being built.
   */
  nestedStyleSink: NestedStyleLinkSink,
  styleDestination: NestedStyleDestination,
): string | undefined {
  if (depth + 1 > MAX_COMPOSITION_DEPTH) throw compositionDepthError();
  return expandNestedHostInner(options, depth, request, nestedStyleSink, styleDestination);
}

function expandNestedHostInner(
  options: InternalRenderToStringOptions,
  depth: number,
  request: NestedHostRequest,
  nestedStyleSink: NestedStyleLinkSink,
  styleDestination: NestedStyleDestination,
): string | undefined {
  const nestedGenerated = registeredGeneratedHostRenderer(request.tag);
  if (nestedGenerated !== undefined) {
    // A generated SHADOW host declares its own links inside its own template and
    // lifts nothing; only a producer with no `styleLinks` slot (a LIGHT root, which
    // has no template to put them in) contributes to the enclosing one. The
    // producer's own arity is that fact: a shadow host declares
    // `(props, lightChildren, attributes, styleLinks, nestedHost)`, a light root
    // takes no `styleLinks` slot.
    const liftsIntoEnclosingTemplate = nestedGenerated.length < 5;
    if (liftsIntoEnclosingTemplate) {
      nestedStyleSink.add(requestTimeIslandStyleLinks(request.tag));
    }
    // RECURSION (P-6): the child's own content is expanded by the SAME factory, so
    // a generated shadow host nested inside another keeps its inner components —
    // otherwise the gap would simply move one level down. A lifted LIGHT child's
    // own content lands in the SAME enclosing template, so it keeps the sink.
    return renderRegisteredGeneratedHost(
      request.tag,
      nestedGenerated,
      undefined,
      request.children === '' ? undefined : request.children,
      request.attributes,
      createNestedHostExpander(
        options,
        depth + 1,
        liftsIntoEnclosingTemplate ? nestedStyleSink : undefined,
        liftsIntoEnclosingTemplate ? styleDestination : 'shadow',
      ),
    );
  }
  const nestedClass = (
    typeof customElements === 'undefined' ? undefined : customElements.get(request.tag)
  ) as CompiledComponentConstructor | undefined;
  if (nestedClass === undefined) return undefined;
  const nestedLightSsr = (nestedClass as { __ssr?: unknown }).__ssr;
  if (typeof nestedLightSsr === 'function') {
    // A generated light root owns no template. Its caller children must enter
    // through the same anchored projection channel as a page-root light host,
    // including each authored named slot group. Its descendants keep the
    // enclosing style destination: document head for a light page, DSD template
    // for a shadow parent.
    const groups =
      request.groups ?? (request.children === '' ? [] : [['', request.children] as const]);
    const projectedChildren = new Map<string, string>();
    for (const [slotName, html] of groups) {
      projectedChildren.set(slotName, (projectedChildren.get(slotName) ?? '') + html);
    }
    return renderToStringAtDepth(
      request.tag,
      {
        componentClass: nestedClass,
        props: {},
        hostAttrs: request.attributes,
        projectedChildren,
        lightProjectionIntent: request.hasChildren === true || request.children !== '',
        ssrRenderableTags: options.ssrRenderableTags,
        documentStyles: options.documentStyles,
        nestedStyleLinkSink: nestedStyleSink,
        styleDestination,
        onNestedFailure: options.onNestedFailure,
      },
      depth + 1,
    );
  }
  // A class nested host expands through the class serializer, which owns its own
  // nested walk — so the depth recursion stays the one serializer's, not a second
  // dispatcher.
  return renderToStringAtDepth(
    request.tag,
    {
      componentClass: nestedClass,
      props: {},
      ssrRenderableTags: options.ssrRenderableTags,
      documentStyles: options.documentStyles,
      nestedStyleLinkSink: nestedStyleSink,
      styleDestination,
      onNestedFailure: options.onNestedFailure,
    },
    depth + 1,
  );
}

/**
 * Render one paired generated host through the ONE typed channel shared by the
 * generated page ROOT path and nested expansion: the compiler-emitted host
 * producer receives the props/lightChildren/attributes plus the per-island
 * stylesheet URLs from the same request-time style-link channel the generated
 * entry fills.
 *
 * `null` is the explicit "declared but carrier unavailable" state and fails
 * closed instead of rendering the host silently unstyled (M09-2e / #1803).
 * A non-string result is a malformed emitted artifact and fails closed too.
 */
function renderRegisteredGeneratedHost(
  tag: string,
  hostRenderer: RegisteredGeneratedHostRenderer,
  props: Readonly<Record<string, unknown>> | undefined,
  lightChildren: string | undefined,
  attributes: readonly (readonly [string, string])[] | undefined,
  /**
   * The render's nested-host expander (P-6, 2026-11-21). A generated shadow host
   * is a STRING BUILDER exactly like a light root, so the components inside its
   * template reach their producer only through this expander. Omitted means no
   * expansion, which is the pre-P-6 answer for a call site that has none.
   */
  nestedHost?: unknown,
): string {
  const islandStyleLinks = requestTimeIslandStyleLinks(tag);
  if (islandStyleLinks === null) {
    throw new OpenElementError(
      `[openElement] admitted generated host <${tag}> declares ` +
        'IslandConfig.styles on a shadow root, but this render has no DSD ' +
        'style-link carrier for it (the dev server emits no style assets). ' +
        'Run a production build, or remove the declaration; rendering it ' +
        'unstyled would silently drop the authored sheets.',
      { code: ErrorCode.SSR_RENDER_ERROR, phase: 'ssr' },
    );
  }
  // P-6 ARGUMENT ORDER: the producer's parameters are, in order,
  // (props, lightChildren, attributes, styleLinks?, nestedHost). A producer whose
  // module declares no stylesheet channel omits `styleLinks`, so the expander must
  // still travel in the FIFTH position — passing it fourth handed a function to a
  // parameter the producer treats as a URL list, and the leaf then saw no expander
  // at all. Both optional slots are therefore always passed, in order.
  //
  // The template's link list starts from THIS host's per-island plan entry and is
  // then filled LIVE by the expander as a nested LIGHT child is actually expanded
  // into the content (F16): reading an app-wide union here is the defect, and
  // reading a pre-filled list is the same defect one level down — a tag the
  // admission set admits is not necessarily content in this template. The live
  // list is complete when the DSD leaf serializes because the compiler-emitted
  // wrapper builds `content:` before it spreads `styleLinks`; the leaf appends
  // during that build. A render with no expander has no lift channel, so its list
  // is just its own sheets (`undefined` keeps the pre-existing bytes for a host
  // that declares none).
  const sink = nestedStyleSinkOf(nestedHost) ?? createNestedStyleLinkSink();
  sink.add(islandStyleLinks);
  const styleLinks = nestedHost === undefined && sink.size === 0 ? undefined : sink.links;
  const rendered = hostRenderer(props ?? {}, lightChildren, attributes, styleLinks, nestedHost);
  if (typeof rendered !== 'string') {
    throw new OpenElementError(
      `[openElement] admitted generated host <${tag}> produced ` +
        `${typeof rendered} instead of an HTML string; the compiler-emitted host ` +
        'producer must always return the serialized host markup.',
      { code: ErrorCode.SSR_RENDER_ERROR, phase: 'ssr' },
    );
  }
  return rendered;
}

/** Coerce a JS-side prop value per the compiled converter record. */
/*
 * The streamed-page shell (StreamShellManifest, CreateStreamShellOptions,
 * StreamShellExecutor, createStreamShellExecutor, jsonSeed and the shell
 * assembly) is DELETED with the class lane's compiled stream channel
 * (2026-11-24). The executor's one identity input was
 * `componentClass.__partProgram` — the wire program the class compiler
 * emitted — and every consumer of it retired with renderIntent.stream
 * (owner decision 2026-11-22; Alpha18 owns the replacement carrier).
 */

/**
 * Server-render one compiled element to deterministic HTML.
 *
 * Generated server entries call this with the tag and its compiled class; the
 * class's `__partProgram`/metadata statics drive the serializer. Initial
 * signal values come from `props` (coerced per the compiled converters),
 * falling back to the compiled defaults. Attribute-backed properties whose
 * serialized value differs from the compiled default are emitted as host
 * attributes so the client claim rebuilds the same signal state. The root
 * mode comes from `program.root.kind` (light content vs. DSD open/closed).
 *
 * Fails closed with `OE_PROGRAM_MISSING` for unregistered or uncompiled
 * classes — there is no runtime JSX fallback renderer.
 */
function renderToStringAtDepth(
  input: string | CustomElementConstructor,
  options: InternalRenderToStringOptions = {},
  depth = 0,
): string {
  if (depth > MAX_COMPOSITION_DEPTH) throw compositionDepthError();
  // M11-2 generated page root: a generated element page carries no
  // `__partProgram`; its server artifact is the compiler-emitted host producer
  // the entry paired with the tag through the ONE registry guard. Dispatch
  // through the SAME pair channel the nested expansion uses, BEFORE any class
  // or program probe, so the generated page root and a nested generated host
  // cannot diverge. A tag that is not paired (every compiled class page) keeps
  // the class path byte-identical.
  if (typeof input === 'string') {
    const rootGeneratedHostRenderer = registeredGeneratedHostRenderer(input);
    if (rootGeneratedHostRenderer !== undefined) {
      // A generated host reached through the server function lane's `__ssr`
      // carries authored children (its composition groups) and passthrough host
      // attributes; a generated PAGE root carries neither. Forward both so a
      // nested generated host keeps its slotted light DOM — the class path's
      // nested expansion and this dispatch stay the same host artifact.
      // Absent author data stays absent: the generated PAGE root passes
      // neither, and the producer sees exactly what the pre-composition lane
      // passed (undefined), not an empty list.
      const hostAttributes =
        options.hostAttrs === undefined
          ? undefined
          : normalizeHostAttributePairs(options.hostAttrs).attributes.map(
              (attribute) => [attribute.name, attribute.bare ? '' : attribute.value] as const,
            );
      // A page ROOT has no enclosing render, so there is nothing above it to
      // expand INTO it — but its own content still needs an expander for the
      // components inside its template (P-6). `nestedHostFor` is built below from
      // the same request-record contract the nested path uses.
      return renderRegisteredGeneratedHost(
        input,
        rootGeneratedHostRenderer,
        options.props,
        options.hostChildren,
        hostAttributes,
        createNestedHostExpander(options, 0),
      );
    }
  }
  const resolvedClass = (options.componentClass ??
    (typeof input === 'string'
      ? typeof customElements !== 'undefined'
        ? customElements.get(input)
        : undefined
      : input)) as CompiledComponentConstructor | undefined;
  if (!resolvedClass) {
    throw new OpenElementError(
      `[openElement] renderToString(${
        typeof input === 'string' ? JSON.stringify(input) : 'class'
      }) found no compiled class: pass options.componentClass or register the tag. ` +
        'The serializer reads the compiled statics from the class and fails ' +
        'closed for unregistered components.',
      { code: FacadeErrorCode.PROGRAM_MISSING, phase: 'ssr' },
    );
  }
  const resolvedTag = typeof input === 'string' ? input : compiledTagOf(resolvedClass);
  const tagForDiagnostics = resolvedTag ?? '<unknown>';
  const program = resolvedClass.__partProgram;
  if (!program) {
    // A LIGHT-root generated element serializes its own children, so its
    // compiled artifact is the shell-attached static `__ssr()` (the compiler
    // emits the leaf producer and the descriptor's `ssrProducer` row; the shell
    // installs it on the class). No Part Program, no registry pair, no DSD
    // wrapper: the host's children ARE the region, exactly as on the client.
    const lightSsr = (resolvedClass as { __ssr?: unknown }).__ssr;
    if (typeof lightSsr === 'function') {
      if (resolvedTag === undefined) {
        throw new OpenElementError(
          '[openElement] renderToString(class) cannot derive the custom-element tag for this generated light root; ' +
            'render it by its registered tag or use a constructor emitted by the generated-element runtime.',
          { code: FacadeErrorCode.PROGRAM_MISSING, phase: 'ssr' },
        );
      }
      // #1800 (alpha16 closeout): a LIGHT-root generated element's declared
      // sheets are a DOCUMENT resource — the asset is emitted and its URL
      // recorded by the client build (`island-style-declarations.ts`), but until
      // now nothing declared it, so the sheet reached no document and the island
      // rendered unstyled. A light root's content IS the document's content, so
      // the document head is the only owner that can deliver its CSS (the same
      // rule the class lane's light root follows through
      // `documentStyleResourcesOf`). `null` keeps the shadow primitive's explicit
      // "declared but carrier unavailable" refusal: a dev render with no emitted
      // assets must fail loudly rather than emit an unstyled island.
      const declaredLightSheets = requestTimeIslandStyleLinks(resolvedTag);
      if (declaredLightSheets === null) {
        throw new OpenElementError(
          `[openElement] admitted generated light host <${
            resolvedTag
          }> declares IslandConfig.styles, but this render has no emitted asset ` +
            'carrier for it (the dev server emits no style assets). Run a production ' +
            'build, or remove the declaration; rendering it unstyled would silently ' +
            'drop the authored sheets.',
          { code: ErrorCode.SSR_RENDER_ERROR, phase: 'ssr' },
        );
      }
      if (declaredLightSheets !== undefined && declaredLightSheets.length > 0) {
        if (options.styleDestination === 'shadow')
          options.nestedStyleLinkSink?.add(declaredLightSheets);
        else options.documentStyles?.add(declaredLightSheets);
      }
      // alpha16 nested-expansion: a generated light-root host's `__ssr` is a
      // string builder, so a custom-element tag inside its markup would stay an
      // unexpanded tag (a second descriptor-less element, not DSD). The class
      // lane expands because its serializer walks `renderNestedElement`; this is
      // the same walk for the generated lane, supplied as ONE expander the
      // producer calls per dash tag.
      //
      // The expander reuses the SAME nested dispatch the class lane uses — the
      // registry pair channel, then a light-root class static, then the compiled
      // class — so a nested host expands identically from either parent lane.
      // The admission set is the render's own `ssrRenderableTags`; a tag outside
      // it answers `undefined` and the producer keeps its literal bytes.
      // P-6 (2026-11-21): the expander is built by ONE factory shared by every
      // render entry that produces generated markup — the light root, the shadow
      // host (page root and nested), and the class lane's own nested walk. It was
      // inline here only, which is why a shadow page's inner components stayed
      // unexpanded tags.
      const styleDestination: NestedStyleDestination = options.styleDestination ?? 'document';
      const nestedHost = createNestedHostExpander(
        options,
        depth,
        options.nestedStyleLinkSink,
        styleDestination,
      );

      // Pass the host attribute pairs: the class static now folds them through
      // the shell's own seeder/resolver so a declared row gets its server value.
      // Before this, a light-root component with any row threw on `props.x`.
      // The expander stays the producer's ONE host argument (its shell-side
      // wrapper builds the host record), so `16b-EB`'s report channel rides the
      // CATCH inside the expander rather than a widened producer ABI: a caught
      // descendant failure is handed to the boundary's reporter when the render
      // has one, and re-raised when it does not — the unchanged pre-`16b-EB`
      // whole-render failure.
      const rendered = (
        lightSsr as (input?: unknown, attributes?: unknown, nestedHost?: unknown) => unknown
      ).call(resolvedClass, options.props, options.hostAttrs, nestedHost);
      const light = lightResult(rendered, 'light-root', resolvedTag);
      const renderedContent = light.content;
      if (styleDestination === 'document') {
        options.documentStyles?.add(nestedStyleSinkOf(nestedHost)?.links ?? []);
      }
      // The producer is content-only (the shadow lane's `<Name>__ssrHost` wraps
      // its own DSD template). A light root's region IS the host's children, so
      // the serializer owns the host element: the tag plus the canonical
      // attribute pairs, then the compiled content with the caller's projections
      // substituted into the producer's anchored slots.
      return serializeLightGeneratedHost(
        resolvedTag,
        renderedContent,
        mergeHostAttributes(options.hostAttrs, light.hostAttributes, light.seedRows),
        options.projectedChildren,
        options.lightProjectionIntent,
      );
    }
    failUncompiled(resolvedClass, tagForDiagnostics);
  }
  // The class lane is deleted: a resolved class that carries a `__partProgram` is
  // no longer renderable here. Failing with the same coded error the compiler
  // surface uses keeps a stale artifact from rendering silently.
  failUncompiled(resolvedClass, tagForDiagnostics);
}

/** Server-render one compiled element through canonical Element composition:
 * returns the serialized DSD `html` string directly. */
export function renderToString(
  input: string | CustomElementConstructor,
  options: RenderToStringOptions = {},
): string {
  const { projectedChildren, hostChildren, ...publicOptions } = options;
  const normalizedProjectedChildren = projectedChildren
    ? new Map(
        [...projectedChildren].map(([slot, value]) => [slot, trustedHtmlValue(value)] as const),
      )
    : undefined;
  return renderToStringAtDepth(input, {
    ...publicOptions,
    projectedChildren: normalizedProjectedChildren,
    // The shadow-side sibling goes through the same ONE brand check: only
    // compiler-produced trusted HTML may append light children to a host.
    ...(hostChildren === undefined ? {} : { hostChildren: trustedHtmlValue(hostChildren) }),
  });
}
