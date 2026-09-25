/**
 * Deliberate root-facade implementation boundary. Not a package subpath.
 *
 * v0.44: this facade re-exports only modules that survived the compiled
 * Part Program reentry. The legacy VNode renderer, runtime JSX factories,
 * hydration-scope runtime, island registration and client-runtime helpers
 * were removed; the server-render entry (`renderDsd`) and the pre-upgrade
 * capture bootstrap are reimplemented over the compiled serializer and the
 * compiled claim capture/replay seam.
 */
import {
  createDeferredServerExecutor,
  type DeferredServerOwner,
  serializeCompiledProgram,
} from './internal/compiled/server/index.ts';
import { scopeCompiledLightCss } from './internal/compiled/style.ts';
import type {
  CompiledElementMetadata,
  CompiledPropertyMetadata,
  PartProgram,
} from './internal/protocol/part-program.ts';
import { FacadeErrorCode, OpenElementError } from './internal/core/errors.ts';
import { signal } from './internal/signal/index.ts';
import type { CompiledProgramHost } from './internal/compiled/server/index.ts';
import type { RenderOutput } from './internal/protocol/render.ts';
import { type TrustedHtml, trustedHtmlValue } from './internal/core/security.ts';

export { collectPublicProps } from './internal/core/props-utils.ts';
export type { RenderOutput, SsrAdmissionDecision } from './internal/protocol/render.ts';
export { consumeContext, createContext, provideContext } from './internal/core/index.ts';
export type { Context, RenderError } from './internal/core/index.ts';
export { assertValidTagName, isValidTagName } from './internal/core/tag-utils.ts';
export { ERROR_PREFIX } from './internal/protocol/errors.ts';
export {
  formatError,
  OpenElementError,
  reportError,
  setErrorTelemetryHook,
} from './internal/core/errors.ts';
export type { ErrorTelemetryHook } from './internal/protocol/errors.ts';
export { computed, effect, signal } from './internal/signal/index.ts';
export type { ReadonlySignal, Signal } from './internal/protocol/signal.ts';
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
  documentStreamParts,
  escapeAttr,
  escapeHtml,
  wrapInDocument,
} from './internal/core/html-escape.ts';
export type { IslandOptions } from './internal/protocol/island.ts';
export { StyleSheet } from './internal/core/style-sheet.ts';
export { createLogger } from './internal/core/logger.ts';
export type { Logger } from './internal/core/logger.ts';
export type { StyleSheetLike } from './internal/protocol/style-sheet.ts';
export { deepGetElementById, ensureDeepFragmentNavigation } from './internal/core/deep-fragment.ts';
export { ensurePreHydrationClickCapture } from './open-element-implementation.ts';

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
  styles?: unknown;
  delegatesFocus?: boolean;
}

/**
 * Collect a compiled class's static styles as CSS text for the DSD template
 * (legacy collectStyleCss parity): the serializer inlines the result as one
 * marked <style> element so never-upgrading hosts (pages) still ship their
 * component styles in the SSR payload.
 */
function collectStaticStyleCss(ctor: CompiledComponentConstructor): string | undefined {
  const styles = ctor.styles;
  if (!styles) return undefined;
  const sheets = Array.isArray(styles) ? styles : [styles];
  let css = '';
  for (const sheet of sheets) {
    const rules = (sheet as { cssRules?: ArrayLike<{ cssText: string }> } | undefined)?.cssRules;
    if (!rules) continue;
    try {
      for (const rule of Array.from(rules)) css += rule.cssText + '\n';
    } catch {
      // Cross-origin or otherwise unreadable sheets are skipped (legacy parity).
    }
  }
  return css === '' ? undefined : css;
}

/**
 * Options for one `renderDsd()` call: the compiled component class to
 * serialize, the values projected onto its compiled properties, optional
 * route/source diagnostics metadata, the nested compiled tags the build
 * admitted, and trusted parent-owned light children keyed by slot name.
 */
export interface RenderDsdOptions {
  componentClass?: CustomElementConstructor;
  props?: Record<string, unknown>;
  sourceInfo?: { route?: string; source?: string };
  /** Build-admitted nested compiled tags. Omitted means shell-only rendering. */
  ssrRenderableTags?: readonly string[];
  /** Trusted parent-owned light children keyed by slot name. */
  projectedChildren?: ReadonlyMap<string, TrustedHtml>;
}

/** Element-private normalized options used while recursively composing components. */
interface InternalRenderDsdOptions extends Omit<RenderDsdOptions, 'projectedChildren'> {
  hostAttrs?: readonly (readonly [string, unknown])[];
  projectedChildren?: ReadonlyMap<string, string>;
}

function classNameOf(ctor: object): string {
  return (ctor as { name?: string }).name ?? 'anonymous';
}

function failUncompiled(ctor: object, tag: string): never {
  throw new OpenElementError(
    `[openElement] <${tag}> (${classNameOf(ctor)}) has no compiled Part Program. ` +
      'renderDsd only serializes classes produced by the 0.44 compiler ' +
      '(@openelement/element/compiler open:compiled-element transform).',
    { code: FacadeErrorCode.PROGRAM_MISSING, phase: 'ssr' },
  );
}

/** Serialize one compiled property value for a host attribute. */
function serializePropertyValue(record: CompiledPropertyMetadata, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (record.type === 'boolean') return value ? '' : null;
  if (record.type === 'array' || record.type === 'object') return JSON.stringify(value);
  return String(value);
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
      return Boolean(value);
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
            `[openElement] pending property "${record.name}" was read while creating a deferred shell.`,
            { code: FacadeErrorCode.PROGRAM_MISSING, phase: 'ssr' },
          );
        },
        subscribe: () => () => {},
      } as unknown as ReturnType<typeof signal>;
      continue;
    }
    const present = preserveNull
      ? Object.prototype.hasOwnProperty.call(props, record.name)
      : record.name in props;
    const value = present
      ? coerceServerProp(record, props[record.name], preserveNull)
      : record.default;
    signals[record.name] = signal(value);
    if (record.attribute !== null) {
      const serialized = serializePropertyValue(record, value);
      if (serialized !== serializePropertyValue(record, record.default) && serialized !== null) {
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
          'Rebuild the component through the 0.44 compiler.',
        { code: FacadeErrorCode.COMPUTED_FACTORY_MISSING, phase: 'ssr' },
      );
    }
    signals[record.name] = factory(signals);
  }
  return { signals, hostAttrs };
}

/** Maps route-local deferred fields to the compiled Part or Region owners they update. */
export interface DeferredDsdManifest {
  program: { version: number; tag: string; sha256: string };
  fields: readonly {
    field: string;
    signal: string;
    owners: readonly { kind: 'part' | 'region'; index: number }[];
  }[];
}

/** Inputs for a request-scoped deferred DSD server executor. */
export interface CreateDeferredDsdOptions {
  componentClass: CustomElementConstructor;
  props?: Record<string, unknown>;
  manifest: DeferredDsdManifest;
  instanceId: string;
  documentToken?: string;
}

/** Initial shell, typed seed, and bounded updates for a deferred DSD request. */
export interface DeferredDsdExecutor {
  readonly shell: string;
  readonly owner: DeferredServerOwner;
  readonly seed: Record<
    string,
    { state: 'resolved'; type: string; value: unknown } | {
      state: 'pending';
      type: string;
    } | {
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
      { code: FacadeErrorCode.PROGRAM_MISSING, phase: 'ssr' },
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
 * Create one request-local deferred shell from a generated route manifest.
 * The manifest hash is checked against the exact runtime wire program before
 * any shell can be produced.
 */
export async function createDeferredDsdExecutor(
  options: CreateDeferredDsdOptions,
): Promise<DeferredDsdExecutor> {
  const ctor = options.componentClass as CompiledComponentConstructor;
  const program = ctor.__partProgram;
  if (!program) failUncompiled(ctor, '<unknown>');
  if (
    !options.manifest || !Array.isArray(options.manifest.fields) ||
    !options.manifest.program || typeof options.manifest.program.sha256 !== 'string'
  ) {
    throw new OpenElementError(
      '[openElement] deferred route manifest is malformed.',
      { code: FacadeErrorCode.PROGRAM_MISSING, phase: 'ssr' },
    );
  }
  const { sourceMap: _sourceMap, ...wireProgram } = program;
  const bytes = new TextEncoder().encode(JSON.stringify(wireProgram));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
  const manifest = options.manifest;
  if (
    manifest.program.version !== program.version || manifest.program.tag !== program.tag ||
    manifest.program.sha256 !== sha256
  ) {
    throw new OpenElementError(
      `[openElement] deferred route manifest does not match compiled program <${program.tag}>.`,
      { code: FacadeErrorCode.PROGRAM_MISSING, phase: 'ssr' },
    );
  }
  const properties = Array.isArray(ctor.__compiledProperties)
    ? ctor.__compiledProperties
    : program.metadata.properties;
  if (
    properties.some((record) =>
      record.name === '__proto__' || record.name === 'constructor' ||
      record.name === 'prototype'
    )
  ) {
    throw new OpenElementError(
      '[openElement] reserved compiled property name cannot enter a deferred seed.',
      { code: FacadeErrorCode.PROGRAM_MISSING, phase: 'ssr' },
    );
  }
  const propertyNames = new Set(properties.map((record) => record.name));
  const pending = new Set<string>();
  const deferredProperties = new Map<string, CompiledPropertyMetadata>();
  const selectedParts: number[] = [];
  for (const field of manifest.fields) {
    if (
      !field.field || field.signal !== field.field || pending.has(field.field) ||
      !propertyNames.has(field.field)
    ) {
      throw new OpenElementError(
        `[openElement] invalid deferred field "${field.field}" in route manifest.`,
        { code: FacadeErrorCode.PROGRAM_MISSING, phase: 'ssr' },
      );
    }
    const record = properties.find((property) => property.name === field.field)!;
    if (record.computed || record.attribute !== null || record.reflect) {
      throw new OpenElementError(
        `[openElement] deferred property "${field.field}" must be writable and nonreflecting.`,
        { code: FacadeErrorCode.PROGRAM_MISSING, phase: 'ssr' },
      );
    }
    pending.add(field.field);
    deferredProperties.set(field.field, record);
    for (const owner of field.owners) {
      const part = program.parts[owner.index];
      if (
        !part || part.index !== owner.index ||
        (part.k !== 'text' && part.k !== 'when' && part.k !== 'each') ||
        part.signal !== field.signal ||
        owner.kind !== (part.k === 'text' ? 'part' : 'region')
      ) {
        throw new OpenElementError(
          `[openElement] deferred field "${field.field}" has an invalid Part owner ${owner.index}.`,
          { code: FacadeErrorCode.PROGRAM_MISSING, phase: 'ssr' },
        );
      }
      selectedParts.push(owner.index);
    }
    if (field.owners.length === 0) {
      throw new OpenElementError(
        `[openElement] deferred field "${field.field}" has no Part owners.`,
        { code: FacadeErrorCode.PROGRAM_MISSING, phase: 'ssr' },
      );
    }
  }
  const props = options.props ?? {};
  const { signals, hostAttrs } = seedCompiledProperties(ctor, props, pending, true);
  const seed: DeferredDsdExecutor['seed'] = {};
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
  if (options.documentToken) {
    hostAttrs.push(['data-oe-stream-request', options.documentToken]);
    hostAttrs.push([
      'data-oe-stream-program',
      `${manifest.program.version}:${manifest.program.sha256}`,
    ]);
    hostAttrs.push(['data-oe-stream-instance', options.instanceId]);
  }
  const mode = program.root.kind === 'light'
    ? 'light'
    : program.root.kind === 'shadow-open'
    ? 'open'
    : 'closed';
  const owner: DeferredServerOwner = {
    program,
    version: program.version,
    instanceId: options.instanceId,
  };
  const styleCss = collectStaticStyleCss(ctor);
  const executor = createDeferredServerExecutor(
    program,
    { signals, handlers: {} },
    { owner, pendingParts: selectedParts },
    {
      mode,
      hostAttrs,
      dsd: ctor.delegatesFocus === true ? { delegatesFocus: true } : undefined,
      styleCss: mode === 'light' && styleCss
        ? scopeCompiledLightCss(program.tag, styleCss)
        : styleCss,
    },
  );
  return {
    shell: executor.shell,
    owner,
    seed,
    resolvedValue(field, value) {
      const record = deferredProperties.get(field);
      if (!record) {
        throw new OpenElementError(
          `[openElement] unknown deferred field "${field}".`,
          { code: FacadeErrorCode.PROGRAM_MISSING, phase: 'ssr' },
        );
      }
      return jsonSeed(value === null ? null : coerceServerProp(record, value), field);
    },
    serializeResolved(field, value) {
      const entry = manifest.fields.find((candidate) => candidate.field === field);
      if (!entry) {
        throw new OpenElementError(
          `[openElement] unknown deferred field "${field}".`,
          { code: FacadeErrorCode.PROGRAM_MISSING, phase: 'ssr' },
        );
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
 * classes — there is no runtime JSX fallback renderer in 0.44.
 */
function renderDsdAtDepth(
  input: string | CustomElementConstructor,
  options: InternalRenderDsdOptions = {},
  depth = 0,
): RenderOutput {
  if (depth > 8) {
    throw new OpenElementError(
      '[openElement] nested element expansion exceeded the depth bound; cyclic component composition is not renderable.',
      { code: FacadeErrorCode.COMPOSITION_DEPTH, phase: 'ssr' },
    );
  }
  const resolvedClass = (options.componentClass ??
    (typeof input === 'string'
      ? (typeof customElements !== 'undefined' ? customElements.get(input) : undefined)
      : input)) as CompiledComponentConstructor | undefined;
  if (!resolvedClass) {
    throw new OpenElementError(
      `[openElement] renderDsd(${
        typeof input === 'string' ? JSON.stringify(input) : 'class'
      }) found no compiled class: pass options.componentClass or register the tag. ` +
        'The 0.44 serializer reads the compiled statics from the class and fails ' +
        'closed for unregistered components.',
      { code: FacadeErrorCode.PROGRAM_MISSING, phase: 'ssr' },
    );
  }
  const program = resolvedClass.__partProgram;
  if (!program) failUncompiled(resolvedClass, typeof input === 'string' ? input : '<unknown>');
  const tag = program.tag;
  if (typeof input === 'string' && input !== tag) {
    throw new OpenElementError(
      `[openElement] renderDsd tag "${input}" does not match the compiled program tag "${tag}".`,
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

  const mode = program.root.kind === 'light'
    ? 'light'
    : program.root.kind === 'shadow-open'
    ? 'open'
    : 'closed';
  const host: CompiledProgramHost = { signals, handlers: {} };
  const staticStyleCss = collectStaticStyleCss(resolvedClass);
  const admitted = new Set(options.ssrRenderableTags ?? []);
  const html = serializeCompiledProgram(program, host, {
    mode,
    hostAttrs,
    // SSR/CSR parity (#1226): the client kernel passes the compiled
    // delegatesFocus static to attachShadow; the DSD template must carry the
    // matching shadowrootdelegatesfocus marker or the claimed shadow root
    // silently loses focus delegation.
    dsd: resolvedClass.delegatesFocus === true ? { delegatesFocus: true } : undefined,
    styleCss: mode === 'light' && staticStyleCss
      ? scopeCompiledLightCss(tag, staticStyleCss)
      : staticStyleCss,
    projectedChildren: options.projectedChildren,
    renderNestedElement: admitted.size === 0 ? undefined : (nested) => {
      if (!admitted.has(nested.tag)) return undefined;
      const nestedClass = typeof customElements === 'undefined'
        ? undefined
        : customElements.get(nested.tag) as CompiledComponentConstructor | undefined;
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
        const attribute = nested.attributes.find(([name]) =>
          name === record.name || name === record.attribute
        );
        // Boolean attributes are true by presence, including the canonical
        // static JSX encoding `name=""`. Do not feed the empty serialized
        // value through Boolean("") or the nested host loses its state.
        if (attribute) {
          nestedProps[record.name] = record.type === 'boolean'
            ? true
            : coerceServerProp(record, attribute[1]);
        }
      }
      const passthrough = nested.attributes.filter(([name]) => !propertyAttributes.has(name));
      const nestedMode = nestedClass.__partProgram.root.kind;
      const rendered = renderDsdAtDepth(nested.tag, {
        componentClass: nestedClass,
        props: nestedProps,
        sourceInfo: options.sourceInfo,
        ssrRenderableTags: options.ssrRenderableTags,
        hostAttrs: passthrough,
        projectedChildren: nestedMode === 'light' ? nested.projectedChildren : undefined,
      }, depth + 1).html;
      if (nestedMode === 'light') return rendered;
      const closing = `</${nested.tag}>`;
      return nested.children === ''
        ? rendered
        : rendered.slice(0, -closing.length) + nested.children + closing;
    },
  });

  return {
    html,
    errors: [],
    metrics: {
      tagName: tag,
      renderTimeMs: 0,
      templateSize: html.length,
      layer: mode === 'light' ? 'light-dom' : 'dsd-interactive',
      hasError: false,
      nestingDepth: 0,
    },
    hydrationHints: [],
  };
}

/** Server-render one compiled element through canonical Element composition. */
export function renderDsd(
  input: string | CustomElementConstructor,
  options: RenderDsdOptions = {},
): RenderOutput {
  const { projectedChildren, ...publicOptions } = options;
  const normalizedProjectedChildren = projectedChildren
    ? new Map(
      [...projectedChildren].map(([slot, value]) => [slot, trustedHtmlValue(value)] as const),
    )
    : undefined;
  return renderDsdAtDepth(input, {
    ...publicOptions,
    projectedChildren: normalizedProjectedChildren,
  });
}
