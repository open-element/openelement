// Single-file cohesion is a deliberate trade against small-parts granularity (comply-or-explain, design-principles.md:16-19): the root-facade implementation boundary is ONE surface — the server-render entry (`renderToString`: compiled Part Program serializer dispatch, generated-host registry pairing, light-host attribute writing, property seeding), the pre-upgrade capture bootstrap over the claim capture/replay seam, and the core/protocol/signal surface a compiled module resolves against — because a page root and a NESTED host must render and seed through the same decision table (serializer selection, host-attribute merge, prop seed) rather than two that can disagree; the boundary is that it is NOT a package subpath: it hosts no compiler, no second serializer and no DOM executor of its own, and every compiled/runtime fact it re-exports keeps its own owner.
/**
 * Deliberate root-facade implementation boundary. Not a package subpath.
 *
 * This facade exposes the server-render entry (`renderToString`, implemented over
 * the compiled Part Program serializer) and the pre-upgrade capture bootstrap
 * (implemented over the compiled claim capture/replay seam), alongside the
 * shared core/protocol/signal surface re-exported below.
 */
import {
  createStreamServerExecutor,
  normalizeHostAttributePairs,
  type StreamOwner,
  serializeCompiledProgram,
} from './internal/compiled/server/index.ts';
import { SSR_REGISTRY_GENERATED_HOSTS } from '@openelement/protocol/registry-markers';
import { convertToAttribute } from './internal/compiled/facade-host.ts';
import { sheetResourceUrls } from './internal/compiled/style-links.ts';
import {
  requestTimeIslandStyleLinks,
  requestTimeStyleLinks,
} from './internal/compiled/server/style-links.ts';
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
  frameworkError,
  OpenElementError,
  raiseFrameworkError,
  reportError,
  StyleErrorCode,
} from './internal/core/errors.ts';
import {
  MAX_COMPOSITION_DEPTH,
  STREAM_MAX_FIELDS,
  STREAM_MAX_OWNERS,
  STREAM_MAX_SEED_PROPERTIES,
} from '@openelement/protocol/policy';
import { signal } from './internal/signal/index.ts';
import { serializeStyleLinks } from './internal/compiled/server/index.ts';
import type { CompiledProgramHost, CompiledSignalLike } from './internal/compiled/server/index.ts';
import { type TrustedHtml, trustedHtmlValue } from './internal/core/security.ts';
import { substituteSlotAnchors } from './internal/compiled/slot-anchors.ts';
import { CompiledProgramValidationError } from './internal/compiled/runtime/values.ts';

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
export { element, property } from './internal/core/compile-decorators.ts';
export {
  onConnect,
  onDispose,
  onError,
  onPropertyChange,
  ref,
  useContext,
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
  __partProgram?: PartProgram;
  __compiledProperties?: CompiledPropertyMetadata[];
  __elementMetadata?: CompiledElementMetadata;
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

/**
 * The declarative external stylesheet links this component's DSD template
 * declares (alpha15 S lane, S5-C).
 *
 * Two sources, in cascade order: the component's OWN sheets that an external
 * asset delivers (each adapter records its resource URL under
 * {@linkcode STYLE_SHEET_URL} — authored `.css` files and generated utility
 * sheets alike), then the framework's shared component stylesheet when the
 * compiler admitted classes for this component (utilities last — the Tailwind
 * convention). Light-root components take no links in their subtree: see
 * {@linkcode documentStyleResourcesOf}.
 */
function declaredStyleLinks(
  ctor: CompiledComponentConstructor,
  mode: 'light' | 'open' | 'closed',
): readonly string[] {
  if (mode === 'light') return [];
  const links = sheetResourceUrls(ctor.styles);
  if (ctor.__oeUtilityClasses === true) links.push(...requestTimeStyleLinks());
  return links;
}

/**
 * The external stylesheets a LIGHT-root component delivers (alpha15 S lane,
 * S-C1.2): its own sheets' resource URLs, reported to the render's document
 * so the document head declares them.
 *
 * A light root's content is the document's content, so the document — not the
 * component's subtree — is the only owner that can deliver its CSS: the head
 * link reaches the styled content without client JavaScript, and the client
 * adopts the same resource only when the document did not already link it.
 * The shared component (utility) sheet is deliberately absent: the compiler
 * excludes a light root's class candidates from it (its utility classes are
 * the document entry's job), so there is no per-component utility resource to
 * declare.
 */
function documentStyleResourcesOf(
  ctor: CompiledComponentConstructor,
  mode: 'light' | 'open' | 'closed',
): readonly string[] {
  return mode === 'light' ? sheetResourceUrls(ctor.styles) : [];
}

/**
 * A compiled class's static styles for the DSD template: the CSS TEXT a sheet
 * carries WITHOUT an external identity — an app-provided in-memory sheet,
 * never a framework-generated resource (those always ship as linked assets).
 * The links ride the serializer's `styleLinks` option; this text node is the
 * one remaining legitimate inline path, and it is author-owned data, not
 * framework stylesheet delivery.
 */
function collectStaticStyleCss(ctor: CompiledComponentConstructor): string | undefined {
  const styles = ctor.styles;
  if (!styles) return undefined;
  const sheets = Array.isArray(styles) ? styles : [styles];
  let css = '';
  for (const sheet of sheets) {
    if (sheetResourceUrls(sheet).length > 0) continue; // delivered by a link
    // The property ACCESS is part of the read, not setup: a cross-origin sheet
    // object throws from `cssRules` itself, and that must not take the whole
    // render down (alpha15 S lane, S-C2/S-10).
    try {
      const rules = (sheet as { cssRules?: ArrayLike<{ cssText: string }> } | undefined)?.cssRules;
      if (!rules) continue;
      for (const rule of Array.from(rules)) css += rule.cssText + '\n';
    } catch (cause) {
      // Reported, never silent (S-C2/S-10): author-owned URL-less data whose
      // bytes this renderer cannot read is SKIPPED with a diagnostic — the
      // renderer must not invent an external URL for it, and a page must not
      // fail because one component's sheet object is unreadable.
      reportError(
        frameworkError(
          StyleErrorCode.SHEET_RULES_UNREADABLE,
          `[compiled-styles] the URL-less style sheet of ${tagNameOf(ctor)} could not be read ` +
            `for server rendering and is skipped: ${
              cause instanceof Error ? cause.message : String(cause)
            }`,
          { phase: 'ssr', cause: cause instanceof Error ? cause : undefined },
        ),
      );
    }
  }
  return css === '' ? undefined : css;
}

/** The compiled tag a diagnostic names, or `<unknown>` for a foreign class. */
function tagNameOf(ctor: CompiledComponentConstructor): string {
  const tag = (ctor as { __partProgram?: { tag?: unknown } }).__partProgram?.tag;
  return typeof tag === 'string' && tag !== '' ? `<${tag}>` : '<unknown>';
}

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
  /** The brand-checked, reserved form of {@linkcode RenderToStringOptions.hostChildren}. */
  hostChildren?: string;
  /**
   * Whether the markup being rendered lands inside a SHADOW TREE — the DSD
   * template of an ancestor component. A light-root component's sheets are
   * delivered by the tree its content lands in, and a document-head link
   * cannot reach a shadow tree, so the nested call carries the fact instead of
   * assuming `ownerDocument`.
   */
  enclosingShadowRoot?: boolean;
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
   * The declared rows whose ONLY host wire is the JSON seed (`array`/`object`).
   * The shell owns that set; the light writer only needs the names. A caller
   * pair addressed to one of them has no attribute channel — the descriptor
   * refuses one and `observedAttributes` never observes it — so the writer must
   * not spell it as text. Absent for the string shape (an older emitted module),
   * which keeps the pre-existing bytes.
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
 * verdict, never re-derived here. A declared `array`/`object` row is
 * property-only: the descriptor refuses an attribute for it and
 * `observedAttributes` never observes one, so a pair naming it is not a second
 * spelling of the row. Leaving it on the tag is worse than redundant — the host
 * writer normalizes pairs through the class lane's value algebra, which is
 * `String()` for anything that is not `class`/`style`, so an array arrives as
 * `items="[object Object],…"`. Both sides are dropped for those names, and the
 * value travels on `data-oe-prop-seed` alone (the ONE channel
 * `applyGeneratedPropSeed` reads). Primitive rows and static attributes keep
 * their bytes; a row the seed does not carry is untouched.
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
  return `<${tag}${attributes} data-oe-light>${children}</${tag}>`;
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
  const rendered = hostRenderer(
    props ?? {},
    lightChildren,
    attributes,
    islandStyleLinks === undefined ? undefined : islandStyleLinks,
  );
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
function coerceServerProp(
  record: CompiledPropertyMetadata,
  value: unknown,
  preserveNull = false,
): unknown {
  if (value === null && preserveNull) return null;
  if (value === null || value === undefined) return record.default;
  switch (record.converter) {
    case 'boolean':
      // The empty string is the canonical bare-attribute encoding a `__ssr`
      // call carries (`<open-reading-shell rail>` lowers to `"rail": ""`):
      // attribute presence means TRUE, exactly as `convertFromAttribute`
      // reads it on the client and as the nested-class expansion at
      // `renderToStringAtDepth` guards it. `Boolean('')` would read false and
      // silently drop the flag on a nested host.
      return value === '' ? true : Boolean(value);
    case 'number': {
      if (typeof value === 'number') return value;
      const parsed = Number(value);
      return Number.isNaN(parsed) ? 0 : parsed;
    }
    case 'array':
      if (Array.isArray(value)) return value;
      return parseJsonProp(record, String(value));
    case 'object':
      if (typeof value === 'object') return value;
      return parseJsonProp(record, String(value));
    default:
      return typeof value === 'string' ? value : String(value);
  }
}

function parseJsonProp(record: CompiledPropertyMetadata, raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return record.default;
  }
}

/**
 * The property's initial value for a host the caller did not pass a prop for.
 *
 * The compiled metadata carries the SERIALIZABLE projection of the authored
 * default, which is `null` for the one admitted non-serializable default
 * shape — a `trustedHtml(...)` initializer (analyze-module.ts: the capability
 * object has no literal form, so the metadata default is null). The generated
 * class's own `static props` carries the authored initializer verbatim, so
 * the runtime capability object exists there (the same object the class field
 * initializer produces on the client). SSR must seed from THAT object, or the
 * html Part's brand check fails on the metadata's null and an island holding a
 * `@property html = trustedHtml(...)` cannot render (KR-12). Page components
 * always pass such fields through `props()`, which is why only islands felt
 * it. Plain fields project identically in both carriers; a class without
 * `static props` (compiled before the emission) keeps the metadata default
 * exactly as before.
 */
function compiledDefaultOf(
  ctor: CompiledComponentConstructor,
  record: CompiledPropertyMetadata,
): unknown {
  if (record.default !== null) return record.default;
  const runtimeDefault = ctor.props?.[record.name]?.default;
  return runtimeDefault === undefined ? record.default : runtimeDefault;
}

/**
 * A deferred property's read-only placeholder: no value exists while the
 * stream shell is built, so EVERY capability fails closed with the established
 * pending-read code — a read, an accidental write, and a subscription. A
 * silent no-op `subscribe` would let a computed factory (or an adapter) wait
 * for a value that can never arrive; refusing it keeps the observer path as
 * loud as the read path. The object advertises exactly the capability the
 * compiled server host consumes — a readable signal — rather than
 * impersonating a writable one.
 */
function pendingPropertySignal(name: string): CompiledSignalLike<unknown> {
  const refuse = (operation: 'read' | 'written' | 'subscribed'): never => {
    throw new OpenElementError(
      `[openElement] pending property "${name}" was ${operation} while creating a stream shell.`,
      { code: FacadeErrorCode.STREAM_PENDING_READ, phase: 'ssr' },
    );
  };
  return {
    get value(): unknown {
      return refuse('read');
    },
    set value(_next: unknown) {
      refuse('written');
    },
    subscribe: () => refuse('subscribed'),
  };
}

function seedCompiledProperties(
  ctor: CompiledComponentConstructor,
  props: Record<string, unknown>,
  pendingProperties: ReadonlySet<string> = new Set(),
  preserveNull = false,
): {
  signals: CompiledSignalRecord;
  hostAttrs: Array<readonly [string, unknown]>;
} {
  const properties = Array.isArray(ctor.__compiledProperties)
    ? ctor.__compiledProperties
    : ctor.__partProgram!.metadata.properties;
  // Null prototype (the client facade's `createFacadePropertyState` contract):
  // a compiled property named `__proto__` is a host signal entry, never the
  // record's prototype, so the server seed and the client claim read the same
  // signal for that name.
  const signals: CompiledSignalRecord = Object.create(null);
  const hostAttrs: Array<readonly [string, unknown]> = [];
  for (const record of properties) {
    if (record.computed) continue;
    if (pendingProperties.has(record.name)) {
      signals[record.name] = pendingPropertySignal(record.name);
      continue;
    }
    const present = preserveNull
      ? Object.prototype.hasOwnProperty.call(props, record.name)
      : record.name in props;
    const fallback = compiledDefaultOf(ctor, record);
    const value = present ? coerceServerProp(record, props[record.name], preserveNull) : fallback;
    signals[record.name] = signal(value);
    if (record.attribute !== null) {
      const serialized = convertToAttribute(record, value);
      if (serialized !== convertToAttribute(record, fallback) && serialized !== null) {
        hostAttrs.push([record.attribute, serialized] as const);
      }
    }
  }
  const computedFactories = ctor.__computedFields;
  for (const record of properties) {
    if (!record.computed) continue;
    const factory = computedFactories?.[record.name];
    if (!factory) {
      throw new OpenElementError(
        `[openElement] <${
          ctor.__partProgram!.tag
        }> computed property "${record.name}" has no generated factory. ` +
          'Rebuild the component through the OpenElement compiler.',
        { code: FacadeErrorCode.COMPUTED_FACTORY_MISSING, phase: 'ssr' },
      );
    }
    signals[record.name] = factory(signals);
  }
  return { signals, hostAttrs };
}

/** Maps route-local deferred fields to the compiled Part or Block owners they update. */
export interface StreamShellManifest {
  program: { version: number; tag: string; sha256: string };
  fields: readonly {
    field: string;
    signal: string;
    owners: readonly { kind: 'part' | 'region'; index: number }[];
  }[];
}

/** Inputs for a request-scoped stream shell executor. */
export interface CreateStreamShellOptions {
  componentClass: CustomElementConstructor;
  props?: Record<string, unknown>;
  manifest: StreamShellManifest;
  instanceId: string;
  documentToken?: string;
  /** The streamed document's stylesheet collection (see RenderToStringOptions). */
  documentStyles?: DocumentStyleSink;
}

/** Initial shell, typed seed, and bounded updates for a stream shell request. */
export interface StreamShellExecutor {
  readonly shell: string;
  readonly owner: StreamOwner;
  readonly seed: Record<
    string,
    | { state: 'resolved'; type: string; value: unknown }
    | {
        state: 'pending';
        type: string;
      }
    | {
        state: 'missing';
        type: string;
      }
  >;
  resolvedValue(field: string, value: unknown): unknown;
  serializeResolved(field: string, value: unknown): string[];
}

function jsonSeed(value: unknown, field: string): unknown {
  const reject = (): never => {
    throw new OpenElementError(
      `[openElement] deferred property "${field}" is not a JSON-safe typed value.`,
      { code: FacadeErrorCode.STREAM_VALUE_NOT_SERIALIZABLE, phase: 'ssr' },
    );
  };
  const seen = new Set<object>();
  const visit = (item: unknown): unknown => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (Array.isArray(item)) {
      if (seen.has(item)) reject();
      seen.add(item);
      const result = item.map(visit);
      seen.delete(item);
      return result;
    }
    if (item && typeof item === 'object' && Object.getPrototypeOf(item) === Object.prototype) {
      if (seen.has(item)) reject();
      seen.add(item);
      const result: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(item)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
          reject();
        }
        result[key] = visit(entry);
      }
      seen.delete(item);
      return result;
    }
    return reject();
  };
  try {
    return visit(value);
  } catch {
    return reject();
  }
}

/**
 * Create one request-local stream shell from a generated route manifest.
 * The manifest hash is checked against the exact runtime wire program before
 * any shell can be produced.
 */
export async function createStreamShellExecutor(
  options: CreateStreamShellOptions,
): Promise<StreamShellExecutor> {
  const ctor = options.componentClass as CompiledComponentConstructor;
  const program = ctor.__partProgram;
  if (!program) failUncompiled(ctor, '<unknown>');
  if (
    !options.manifest ||
    !Array.isArray(options.manifest.fields) ||
    !options.manifest.program ||
    typeof options.manifest.program.sha256 !== 'string'
  ) {
    throw new OpenElementError('[openElement] deferred route manifest is malformed.', {
      code: FacadeErrorCode.STREAM_MANIFEST_MALFORMED,
      phase: 'ssr',
    });
  }
  const { sourceMap: _sourceMap, ...wireProgram } = program;
  const bytes = new TextEncoder().encode(JSON.stringify(wireProgram));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  const manifest = options.manifest;
  if (
    manifest.program.version !== program.version ||
    manifest.program.tag !== program.tag ||
    manifest.program.sha256 !== sha256
  ) {
    throw new OpenElementError(
      `[openElement] deferred route manifest does not match compiled program <${program.tag}> (manifest ${manifest.program.tag}@v${manifest.program.version} vs compiled ${program.tag}@v${program.version}).`,
      { code: FacadeErrorCode.STREAM_MANIFEST_MISMATCH, phase: 'ssr' },
    );
  }
  const properties = Array.isArray(ctor.__compiledProperties)
    ? ctor.__compiledProperties
    : program.metadata.properties;
  if (
    properties.some(
      (record) =>
        record.name === '__proto__' || record.name === 'constructor' || record.name === 'prototype',
    )
  ) {
    throw new OpenElementError(
      '[openElement] reserved compiled property name cannot enter a deferred seed.',
      { code: FacadeErrorCode.STREAM_RESERVED_PROPERTY, phase: 'ssr' },
    );
  }
  // Same bounded budget the build manifest scan and the runtime/browser
  // front gate enforce (STREAM_MAX_FIELDS / STREAM_MAX_OWNERS): the
  // hand-written manifest path must fail loud here instead of emitting a
  // shell whose seed or frames the browser contractually discards.
  const manifestOwnerTotal = manifest.fields.reduce(
    (count, field) => count + field.owners.length,
    0,
  );
  if (manifest.fields.length > STREAM_MAX_FIELDS || manifestOwnerTotal > STREAM_MAX_OWNERS) {
    throw new OpenElementError(
      `[openElement] deferred manifest for <${program.tag}> exceeds the bounded ` +
        `deferred budget: ${manifest.fields.length} fields (max ${STREAM_MAX_FIELDS}), ` +
        `${manifestOwnerTotal} Part owners (max ${STREAM_MAX_OWNERS}). Defer fewer fields, reduce ` +
        'the deferred sinks per field, or split the page.',
      { code: FacadeErrorCode.STREAM_BUDGET_EXCEEDED, phase: 'ssr' },
    );
  }
  const propertyNames = new Set(properties.map((record) => record.name));
  const pending = new Set<string>();
  const deferredProperties = new Map<string, CompiledPropertyMetadata>();
  const selectedParts: number[] = [];
  for (const field of manifest.fields) {
    if (
      !field.field ||
      field.signal !== field.field ||
      pending.has(field.field) ||
      !propertyNames.has(field.field)
    ) {
      throw new OpenElementError(
        `[openElement] invalid deferred field "${field.field}" in route manifest.`,
        { code: FacadeErrorCode.STREAM_FIELD_INVALID, phase: 'ssr' },
      );
    }
    const record = properties.find((property) => property.name === field.field)!;
    if (record.computed || record.attribute !== null || record.reflect) {
      throw new OpenElementError(
        `[openElement] deferred property "${field.field}" must be writable and nonreflecting.`,
        { code: FacadeErrorCode.STREAM_FIELD_INVALID, phase: 'ssr' },
      );
    }
    pending.add(field.field);
    deferredProperties.set(field.field, record);
    for (const owner of field.owners) {
      const part = program.parts[owner.index];
      if (
        !part ||
        part.index !== owner.index ||
        (part.k !== 'text' && part.k !== 'when' && part.k !== 'each') ||
        part.signal !== field.signal ||
        owner.kind !== (part.k === 'text' ? 'part' : 'region')
      ) {
        throw new OpenElementError(
          `[openElement] deferred field "${field.field}" has an invalid Part owner ${owner.index}.`,
          { code: FacadeErrorCode.STREAM_FIELD_INVALID, phase: 'ssr' },
        );
      }
      selectedParts.push(owner.index);
    }
    if (field.owners.length === 0) {
      throw new OpenElementError(
        `[openElement] deferred field "${field.field}" has no Part owners.`,
        { code: FacadeErrorCode.STREAM_FIELD_INVALID, phase: 'ssr' },
      );
    }
  }
  const props = options.props ?? {};
  const { signals, hostAttrs } = seedCompiledProperties(ctor, props, pending, true);
  const seed: StreamShellExecutor['seed'] = {};
  for (const record of properties) {
    if (record.computed) continue;
    if (pending.has(record.name)) {
      seed[record.name] = { state: 'pending', type: record.type };
    } else if (
      !Object.prototype.hasOwnProperty.call(props, record.name) ||
      signals[record.name].value === undefined
    ) {
      seed[record.name] = { state: 'missing', type: record.type };
    } else {
      seed[record.name] = {
        state: 'resolved',
        type: record.type,
        value: jsonSeed(signals[record.name].value, record.name),
      };
    }
  }
  // The browser seed contract rejects any seed carrying more than
  // STREAM_MAX_SEED_PROPERTIES typed properties — and it rejects the WHOLE
  // seed, so an oversized component would silently fail to hydrate instead
  // of failing loud here.
  if (Object.keys(seed).length > STREAM_MAX_SEED_PROPERTIES) {
    throw new OpenElementError(
      `[openElement] deferred stream seed for <${program.tag}> carries ${
        Object.keys(seed).length
      } properties; the browser seed contract accepts at most ${STREAM_MAX_SEED_PROPERTIES}. ` +
        'Trim the component property surface or the seed is silently rejected at hydration.',
      { code: FacadeErrorCode.STREAM_BUDGET_EXCEEDED, phase: 'ssr' },
    );
  }
  if (options.documentToken) {
    hostAttrs.push(['data-oe-stream-request', options.documentToken]);
    hostAttrs.push([
      'data-oe-stream-program',
      `${manifest.program.version}:${manifest.program.sha256}`,
    ]);
    hostAttrs.push(['data-oe-stream-instance', options.instanceId]);
  }
  const mode =
    program.root.kind === 'light'
      ? 'light'
      : program.root.kind === 'shadow-open'
        ? 'open'
        : 'closed';
  const owner: StreamOwner = {
    program,
    version: program.version,
    instanceId: options.instanceId,
  };
  const styleCss = collectStaticStyleCss(ctor);
  // The shell's light-root stylesheets belong to the streamed document, not to
  // the shell (S-C1.2): they are reported before the document halves are
  // serialized, exactly as a synchronous render reports them.
  options.documentStyles?.add(documentStyleResourcesOf(ctor, mode));
  const executor = createStreamServerExecutor(
    program,
    { signals, handlers: {} },
    { owner, pendingParts: selectedParts },
    {
      mode,
      hostAttrs,
      dsd: ctor.delegatesFocus === true ? { delegatesFocus: true } : undefined,
      styleCss,
      styleLinks: declaredStyleLinks(ctor, mode),
    },
  );
  return {
    shell: executor.shell,
    owner,
    seed,
    resolvedValue(field, value) {
      const record = deferredProperties.get(field);
      if (!record) {
        throw new OpenElementError(`[openElement] unknown deferred field "${field}".`, {
          code: FacadeErrorCode.STREAM_UNKNOWN_FIELD,
          phase: 'ssr',
        });
      }
      return jsonSeed(value === null ? null : coerceServerProp(record, value), field);
    },
    serializeResolved(field, value) {
      const entry = manifest.fields.find((candidate) => candidate.field === field);
      if (!entry) {
        throw new OpenElementError(`[openElement] unknown deferred field "${field}".`, {
          code: FacadeErrorCode.STREAM_UNKNOWN_FIELD,
          phase: 'ssr',
        });
      }
      const record = deferredProperties.get(field)!;
      const seededValue = value === null ? null : coerceServerProp(record, value);
      return entry.owners.map((part) => executor.serializeResolved(owner, part.index, seededValue));
    },
  };
}

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
  if (depth > MAX_COMPOSITION_DEPTH) {
    throw new OpenElementError(
      '[openElement] nested element expansion exceeded the depth bound; cyclic component composition is not renderable.',
      { code: FacadeErrorCode.COMPOSITION_DEPTH, phase: 'ssr' },
    );
  }
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
      return renderRegisteredGeneratedHost(
        input,
        rootGeneratedHostRenderer,
        options.props,
        options.hostChildren,
        hostAttributes,
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
  const program = resolvedClass.__partProgram;
  if (!program) {
    // A LIGHT-root generated element serializes its own children, so its
    // compiled artifact is the shell-attached static `__ssr()` (the compiler
    // emits the leaf producer and the descriptor's `ssrProducer` row; the shell
    // installs it on the class). No Part Program, no registry pair, no DSD
    // wrapper: the host's children ARE the region, exactly as on the client.
    const lightSsr = (resolvedClass as { __ssr?: unknown }).__ssr;
    if (typeof lightSsr === 'function') {
      // Pass the host attribute pairs: the class static now folds them through
      // the shell's own seeder/resolver so a declared row gets its server value.
      // Before this, a light-root component with any row threw on `props.x`.
      const rendered = (lightSsr as (input?: unknown, attributes?: unknown) => unknown).call(
        resolvedClass,
        options.props,
        options.hostAttrs,
      );
      const light = lightResult(
        rendered,
        'light-root',
        typeof input === 'string' ? input : '<unknown>',
      );
      const renderedContent = light.content;
      // The producer is content-only (the shadow lane's `<Name>__ssrHost` wraps
      // its own DSD template). A light root's region IS the host's children, so
      // the serializer owns the host element: the tag plus the canonical
      // attribute pairs, then the compiled content with the caller's projections
      // substituted into the producer's anchored slots.
      return serializeLightGeneratedHost(
        typeof input === 'string' ? input : '<unknown>',
        renderedContent,
        mergeHostAttributes(options.hostAttrs, light.hostAttributes, light.seedRows),
        options.projectedChildren,
      );
    }
    failUncompiled(resolvedClass, typeof input === 'string' ? input : '<unknown>');
  }
  const tag = program.tag;
  if (typeof input === 'string' && input !== tag) {
    throw new OpenElementError(
      `[openElement] renderToString tag "${input}" does not match the compiled program tag "${tag}".`,
      { code: FacadeErrorCode.PROGRAM_MISSING, phase: 'ssr' },
    );
  }

  const props = options.props ?? {};
  // Computed fields derive from the seeded plain signals — same factories the
  // client facade runs, so server output and client claim read one value set.
  const { signals, hostAttrs: seededAttrs } = seedCompiledProperties(resolvedClass, props);
  const hostAttrs: Array<readonly [string, unknown]> = [
    ...(options.hostAttrs ?? []),
    ...seededAttrs,
  ];

  const mode =
    program.root.kind === 'light'
      ? 'light'
      : program.root.kind === 'shadow-open'
        ? 'open'
        : 'closed';
  const host: CompiledProgramHost = { signals, handlers: {} };
  const staticStyleCss = collectStaticStyleCss(resolvedClass);
  // A light root's external sheets are the resources of the TREE its content
  // lands in (S-C1.2): the document for a document-level component, whose owner
  // writes them into the head — or the ENCLOSING SHADOW ROOT when an ancestor's
  // DSD template owns the subtree, where the head link cannot reach them and the
  // nested render declares them inside that template instead (see
  // `renderNestedElement`). Either way the component's own subtree carries no
  // scoped text: `collectStaticStyleCss` already skips every sheet that has a
  // URL, and the URL-less sheets that remain are the in-memory/dev shims, whose
  // bytes the build (or the author) already scoped.
  if (!(mode === 'light' && options.enclosingShadowRoot === true)) {
    options.documentStyles?.add(documentStyleResourcesOf(resolvedClass, mode));
  }
  const admitted = new Set(options.ssrRenderableTags ?? []);
  /** Serialize this element's program once (re-run by the boundary capture below). */
  const serializeOnce = (): string =>
    serializeCompiledProgram(program, host, {
      mode,
      hostAttrs,
      // SSR/CSR parity (#1226): the client kernel passes the compiled
      // delegatesFocus static to attachShadow; the DSD template must carry the
      // matching shadowrootdelegatesfocus marker or the claimed shadow root
      // silently loses focus delegation.
      dsd: resolvedClass.delegatesFocus === true ? { delegatesFocus: true } : undefined,
      // The static style TEXT an in-memory (URL-less) sheet carries, verbatim.
      // Scoping is not applied here: a light root's boundary is written into
      // its emitted asset at build time, and a sheet without an external
      // identity is author-provided data this renderer has no mandate to
      // rewrite (S-C1.2).
      styleCss: staticStyleCss,
      styleLinks: declaredStyleLinks(resolvedClass, mode),
      projectedChildren: options.projectedChildren,
      // The compiled children channel's shadow-side half: light children a
      // compiled parent (or a server function page's __ssr call) hands a
      // shadow-root host ride after the DSD template. The serializer fails
      // closed if the root is light — projections, not appendages.
      ...(options.hostChildren === undefined ? {} : { hostChildren: options.hostChildren }),
      renderNestedElement:
        admitted.size === 0
          ? undefined
          : (nested) => {
              if (!admitted.has(nested.tag)) return undefined;
              // M11-2: a generated element class carries no `__partProgram`;
              // its server artifact is the compiler-emitted `<Name>__ssrHost`
              // the entry paired with the class through the ONE registry guard.
              // The pair table is the protocol marker the guard writes; a hit
              // is dispatched BEFORE the class path, through the SAME helper the
              // generated page root uses (styleLinks + fail-closed checks
              // included), with no class read and no program probe.
              //
              // STREAM BOUNDARY (OWED, L3 — characterized, not supported):
              // the deferred/stream executor never reaches this branch — it
              // structurally refuses `renderNestedElement` (and
              // projectedChildren/closed roots) at admission
              // (`createStreamServerExecutor`, pinned by
              // stream-server-executor.test.ts and the generated-host-nested
              // stream-boundary test). Generated hosts are synchronous-SSR
              // only; streaming/deferred DSD for them is explicitly owed to a
              // later, separately approved slice and this branch claims no
              // stream support.
              const generatedHostRenderer = registeredGeneratedHostRenderer(nested.tag);
              if (generatedHostRenderer !== undefined) {
                // The ONE host-attribute value algebra is reused: the class
                // serializer's host writer and this typed pair channel cannot
                // drift. Presence rides as the canonical empty-string pair.
                const normalizedAttributes = normalizeHostAttributePairs(nested.attributes);
                const hostAttributes = normalizedAttributes.attributes.map(
                  (attribute) => [attribute.name, attribute.bare ? '' : attribute.value] as const,
                );
                return renderRegisteredGeneratedHost(
                  nested.tag,
                  generatedHostRenderer,
                  nested.properties,
                  nested.children,
                  hostAttributes,
                );
              }
              const nestedClass =
                typeof customElements === 'undefined'
                  ? undefined
                  : (customElements.get(nested.tag) as CompiledComponentConstructor | undefined);
              // A LIGHT-root generated element serializes its own children and
              // has no Part Program and no registry pair, so the nested path
              // reaches its compiled producer through the class static the
              // shell installed (the same one the root path uses).
              const nestedLightSsr = (nestedClass as { __ssr?: unknown } | undefined)?.__ssr;
              if (nestedClass !== undefined && typeof nestedLightSsr === 'function') {
                const rendered = (
                  nestedLightSsr as (input?: unknown, attributes?: unknown) => unknown
                ).call(nestedClass, nested.properties, nested.attributes);
                const nestedLight = lightResult(rendered, 'nested light-root', nested.tag);
                // The nested host's authored children arrive as the parent
                // serializer's own per-slot groups (`nested.projectedChildren`),
                // exactly the map the class-lane nested expansion hands a light
                // child. A generated light host substitutes them into its
                // anchored slots; a projection naming a slot it does not declare
                // fails closed inside the serializer.
                return serializeLightGeneratedHost(
                  nested.tag,
                  nestedLight.content,
                  mergeHostAttributes(
                    nested.attributes,
                    nestedLight.hostAttributes,
                    nestedLight.seedRows,
                  ),
                  nested.projectedChildren,
                );
              }
              if (!nestedClass?.__partProgram) {
                throw new OpenElementError(
                  `[openElement] admitted nested component <${nested.tag}> is not registered with a compiled Part Program.`,
                  { code: FacadeErrorCode.PROGRAM_MISSING, phase: 'ssr' },
                );
              }
              const nestedProperties = Array.isArray(nestedClass.__compiledProperties)
                ? nestedClass.__compiledProperties
                : nestedClass.__partProgram.metadata.properties;
              const nestedProps: Record<string, unknown> = { ...nested.properties };
              const propertyAttributes = new Set<string>();
              for (const record of nestedProperties) {
                propertyAttributes.add(record.name);
                if (record.attribute !== null) propertyAttributes.add(record.attribute);
                if (record.name in nestedProps) continue;
                const attribute = nested.attributes.find(
                  ([name]) => name === record.name || name === record.attribute,
                );
                // Boolean attributes are true by presence, including the canonical
                // static JSX encoding `name=""`. Do not feed the empty serialized
                // value through Boolean("") or the nested host loses its state.
                if (attribute) {
                  nestedProps[record.name] =
                    record.type === 'boolean' ? true : coerceServerProp(record, attribute[1]);
                }
              }
              const passthrough = nested.attributes.filter(
                ([name]) => !propertyAttributes.has(name),
              );
              const nestedMode = nestedClass.__partProgram.root.kind;
              const rendered = renderToStringAtDepth(
                nested.tag,
                {
                  componentClass: nestedClass,
                  props: nestedProps,
                  sourceInfo: options.sourceInfo,
                  ssrRenderableTags: options.ssrRenderableTags,
                  hostAttrs: passthrough,
                  projectedChildren: nestedMode === 'light' ? nested.projectedChildren : undefined,
                  // A nested light-root component's sheets belong to the same
                  // render's sink as its parent's (S-C1.2) — unless this parent
                  // is itself a shadow template, in which case the child's
                  // content lands in a tree the document head cannot reach and
                  // its links are emitted below.
                  documentStyles: options.documentStyles,
                  enclosingShadowRoot: mode !== 'light',
                },
                depth + 1,
              );
              if (nestedMode === 'light') {
                // This parent renders into a DSD template, so the child's
                // content is shadow-tree content: declare its sheets as marked
                // links INSIDE that template, the one place a stylesheet can
                // reach it. Same link shape as every other component sheet, so
                // the client's delivery check recognizes the resource and does
                // not adopt a second copy.
                if (mode === 'light') return rendered;
                const nestedLinks = serializeStyleLinks(sheetResourceUrls(nestedClass.styles));
                if (nestedLinks === '') return rendered;
                // LEADING style nodes, not trailing ones: the light root's own
                // claim tolerates only leading marked style nodes
                // (`leadingStaticStyleNodeCount`) and fails closed on a trailing
                // one — the island's activation would die behind its own
                // delivery node. The serializer's light-root shape already
                // emits its style nodes before the content, so match it. The
                // `>` searched for here is the opening tag's terminator: host
                // attribute values are escaped at emission
                // (`serializeAttribute`), so no raw `>` can occur before it.
                const openEnd = rendered.indexOf('>') + 1;
                return rendered.slice(0, openEnd) + nestedLinks + rendered.slice(openEnd);
              }
              const closing = `</${nested.tag}>`;
              return nested.children === ''
                ? rendered
                : rendered.slice(0, -closing.length) + nested.children + closing;
            },
    });

  // SSR boundary capture: a subtree evaluation throw (this element's own
  // serialized derivations, or a nested recursion surfacing from a deeper
  // non-boundary element) must render the boundary's fallback branch instead
  // of 500-ing the route. The try wraps THIS element's serialization — the
  // recursion inside renderNestedElement surfaces here at the nearest
  // boundary because non-boundary elements rethrow. The repair re-serializes
  // the same program with the `hasError` signal forced true: a compiled
  // boundary's fallback is a `when` Block over that signal (the same
  // dependency the client's publication flips), so the re-run takes the
  // fallback branch and never re-enters the failed subtree. The signals
  // record is per-call, so the override cannot leak into sibling renders;
  // an element without the declared property simply carries an unread
  // signal. P7 prior art: React SSR error boundaries substitute fallback
  // UI for a failed subtree; the compiled difference is that the branch is
  // the program's own Block, not a second renderer.
  let html: string;
  try {
    html = serializeOnce();
  } catch (error) {
    if (resolvedClass.isErrorBoundary !== true) throw error;
    signals.hasError = signal(true);
    html = serializeOnce();
  }
  // Fail-closed boundary capture is observable through the branch taken, not
  // through a metrics field (alpha15 R.0-3 deleted the RenderOutput shell and
  // its hardcoded-zero metrics with it): a captured render carries the
  // fallback branch bytes, an uncaught throw still propagates.
  return html;
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
