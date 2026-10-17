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
  type StreamOwner,
  serializeCompiledProgram,
} from './internal/compiled/server/index.ts';
import { convertToAttribute } from './internal/compiled/facade-host.ts';
import { sheetResourceUrls } from './internal/compiled/style-links.ts';
import { requestTimeStyleLinks } from './internal/compiled/server/style-links.ts';
import type { DocumentStyleResources } from './internal/core/html-escape.ts';
import type {
  CompiledElementMetadata,
  CompiledPropertyMetadata,
  PartProgram,
} from '@openelement/protocol/part-program';
import {
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
import type { CompiledProgramHost } from './internal/compiled/server/index.ts';
import { type TrustedHtml, trustedHtmlValue } from './internal/core/security.ts';

export { collectPublicProps } from './internal/core/props-utils.ts';
export type { SsrAdmissionDecision } from '@openelement/protocol/render';
export { consumeContext, createContext, provideContext } from './internal/core/index.ts';
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

/** Compiled class statics consumed by the server-render entry. */
interface CompiledComponentConstructor extends CustomElementConstructor {
  __partProgram?: PartProgram;
  __compiledProperties?: CompiledPropertyMetadata[];
  __elementMetadata?: CompiledElementMetadata;
  __computedFields?: Record<
    string,
    (signals: Record<string, ReturnType<typeof signal>>) => ReturnType<typeof signal>
  >;
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

function failUncompiled(ctor: object, tag: string): never {
  raiseFrameworkError(
    'ssr',
    FacadeErrorCode.PROGRAM_MISSING,
    `[openElement] <${tag}> (${classNameOf(ctor)}) has no compiled Part Program. ` +
      'renderToString only serializes classes produced by the OpenElement compiler ' +
      '(@openelement/compiler open:compiled-element transform).',
  );
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

function seedCompiledProperties(
  ctor: CompiledComponentConstructor,
  props: Record<string, unknown>,
  pendingProperties: ReadonlySet<string> = new Set(),
  preserveNull = false,
): {
  signals: Record<string, ReturnType<typeof signal>>;
  hostAttrs: Array<readonly [string, unknown]>;
} {
  const properties = Array.isArray(ctor.__compiledProperties)
    ? ctor.__compiledProperties
    : ctor.__partProgram!.metadata.properties;
  const signals: Record<string, ReturnType<typeof signal>> = {};
  const hostAttrs: Array<readonly [string, unknown]> = [];
  for (const record of properties) {
    if (record.computed) continue;
    if (pendingProperties.has(record.name)) {
      signals[record.name] = {
        get value(): never {
          throw new OpenElementError(
            `[openElement] pending property "${record.name}" was read while creating a stream shell.`,
            { code: FacadeErrorCode.STREAM_PENDING_READ, phase: 'ssr' },
          );
        },
        subscribe: () => () => {},
      } as unknown as ReturnType<typeof signal>;
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
  if (!program) failUncompiled(resolvedClass, typeof input === 'string' ? input : '<unknown>');
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
              const nestedClass =
                typeof customElements === 'undefined'
                  ? undefined
                  : (customElements.get(nested.tag) as CompiledComponentConstructor | undefined);
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
