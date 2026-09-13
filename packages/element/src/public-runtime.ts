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
import { serializeCompiledProgram } from './internal/compiled/server/index.ts';
import { scopeCompiledLightCss } from './internal/compiled/style.ts';
import type {
  CompiledElementMetadata,
  CompiledPropertyMetadata,
  PartProgram,
} from './internal/compiled/program.ts';
import { OpenElementError } from './internal/core/errors.ts';
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
export { escapeAttr, escapeHtml, wrapInDocument } from './internal/core/html-escape.ts';
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
    { code: 'OE_PROGRAM_MISSING', phase: 'ssr' },
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
function coerceServerProp(record: CompiledPropertyMetadata, value: unknown): unknown {
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
      { code: 'OE_SSR_COMPOSITION_DEPTH', phase: 'ssr' },
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
      { code: 'OE_PROGRAM_MISSING', phase: 'ssr' },
    );
  }
  const program = resolvedClass.__partProgram;
  if (!program) failUncompiled(resolvedClass, typeof input === 'string' ? input : '<unknown>');
  const tag = program.tag;
  if (typeof input === 'string' && input !== tag) {
    throw new OpenElementError(
      `[openElement] renderDsd tag "${input}" does not match the compiled program tag "${tag}".`,
      { code: 'OE_PROGRAM_MISSING', phase: 'ssr' },
    );
  }

  const properties = Array.isArray(resolvedClass.__compiledProperties)
    ? resolvedClass.__compiledProperties
    : program.metadata.properties;
  const props = options.props ?? {};

  const signals: Record<string, ReturnType<typeof signal>> = {};
  const hostAttrs: Array<readonly [string, unknown]> = [...(options.hostAttrs ?? [])];
  for (const record of properties) {
    if (record.computed) continue;
    const value = record.name in props
      ? coerceServerProp(record, props[record.name])
      : record.default;
    signals[record.name] = signal(value);
    if (record.attribute !== null) {
      const serialized = serializePropertyValue(record, value);
      if (serialized !== serializePropertyValue(record, record.default) && serialized !== null) {
        hostAttrs.push([record.attribute, serialized] as const);
      }
    }
  }
  // Computed fields derive from the seeded plain signals — same factories the
  // client facade runs, so server output and client claim read one value set.
  const computedFactories = (resolvedClass as CompiledComponentConstructor).__computedFields;
  for (const record of properties) {
    if (!record.computed) continue;
    const factory = computedFactories?.[record.name];
    if (!factory) {
      throw new OpenElementError(
        `[openElement] <${tag}> computed property "${record.name}" has no generated factory. ` +
          'Rebuild the component through the 0.44 compiler.',
        { code: 'OE_COMPUTED_FACTORY_MISSING', phase: 'ssr' },
      );
    }
    signals[record.name] = factory(signals);
  }

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
          { code: 'OE_PROGRAM_MISSING', phase: 'ssr' },
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
