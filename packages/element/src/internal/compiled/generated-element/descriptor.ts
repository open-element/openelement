import {
  camelToKebab,
  forbiddenSinkReason,
  isSafeAttributeName,
} from '@openelement/protocol/forbidden-sinks';
import {
  AuthoringErrorCode,
  CompilerErrorCode,
  frameworkError,
  type ErrorPhase,
} from '@openelement/protocol/errors';
import type { RootMode } from '@openelement/protocol/part-program';
import type { StyleSheetLike } from '@openelement/protocol/style-sheet';
import {
  coercePropertyValue,
  type PropertyConversionRecord,
} from '../../core/property-conversion.ts';
import { isTrustedHtmlValue, trustedHtml } from '../../core/security.ts';
import type { WritableSignal } from '../../signal/types.ts';
import type { LifetimeScope } from '../lifetime-scope.ts';
import type { Recipe } from '../runtime/recipe.ts';

/**
 * Primitive property types (attribute/JS conversion) plus the property-only
 * non-primitive retention family: `array`/`object` (caller-owned references,
 * generated fresh-literal defaults) and `trustedHtml` (the existing brand).
 * Non-primitive rows have no attribute channel and never reflect.
 */
export type GeneratedElementPropertyType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'array'
  | 'object'
  | 'trustedHtml';

/** One compiler-declared property. Internal contract; not author syntax. */
export interface GeneratedElementProperty {
  /** JS property name and the key the generated props record exposes. */
  readonly name: string;
  /**
   * Attribute name. Omitted derives `camelToKebab(name)`; `null` declares a
   * property with no attribute channel. Names are lowercased and validated.
   */
  readonly attribute?: string | null;
  readonly type: GeneratedElementPropertyType;
  /** Reflect property writes back to the attribute. Requires an attribute. */
  readonly reflect?: boolean;
  /**
   * Declared default. Primitive rows carry the value; a `trustedHtml` row
   * carries the literal HTML string the shell brands per materialisation; an
   * array/object row carries the generated fresh-literal factory the shell
   * calls ONCE per element instance (the descriptor never holds a mutable
   * shared graph). Caller writes are never cloned.
   */
  readonly default?: string | number | boolean | (() => unknown);
}

/** The host record the generated recipe factory consumes. */
export interface GeneratedElementHost<P extends object = Record<string, unknown>> {
  /**
   * Created once by `createInstance` (or the legacy `createBindings` fallback)
   * and retained for the element lifetime. With `createInstance` the record is
   * the return value of that setup factory, so it may reference setup-owned
   * signals/computeds that live in the retained instance scope; with the legacy
   * `createBindings` it stays allocation-only (see
   * {@linkcode GeneratedElementDescriptor.createBindings}).
   */
  readonly bindings: Readonly<Record<string, unknown>>;
  /**
   * The enclosing LOGICAL instance scope (LC-2 nesting): the element/island
   * instance that survives a disconnect and dies only at explicit teardown.
   *
   * It is delivered so the generated ROOT mount/claim body can open one
   * instance pass on it and retain its direct hostless child instances
   * (`retainChildInstance`). A retained child's narrower host record — the one
   * supplied to the child's own body — is generated code (compiler-private),
   * so this shell type never carries the setup record; no other consumer reads
   * this field.
   */
  readonly instance?: LifetimeScope;
  readonly props: Readonly<P>;
  /** Shell-owned invalidation channel; the same signal survives reconnect. */
  readonly propsChanged: WritableSignal<number>;
}

/**
 * The setup-time host record the generated instance factory consumes.
 *
 * It deliberately excludes `bindings`: the factory PRODUCES that record (its
 * return value becomes `GeneratedElementHost.bindings`), so supplying a
 * bindings channel here would be circular. `props` and `propsChanged` are the
 * only host facts setup legitimately reads.
 *
 * Kept inside the descriptor and shell modules. Consumers build this argument
 * structurally through the descriptor's `createInstance` member.
 */
export interface GeneratedElementInstanceHost<P extends object = Record<string, unknown>> {
  readonly props: Readonly<P>;
  readonly propsChanged: WritableSignal<number>;
}

/**
 * The compiler-private descriptor for one generated element. `createRecipe` is
 * the generated module's own `create<Name>Recipe`; this shell never re-derives
 * mount/claim/SSR logic.
 */
export interface GeneratedElementDescriptor<P extends object = Record<string, unknown>> {
  readonly tag: string;
  /**
   * Root ownership mode. The three values are the protocol's existing
   * `RootMode`; `light` is the default. This is a compiler-private fact (the
   * same `root` fact the author's `@element(tag, { root })` already carries),
   * never a new author API.
   */
  readonly root?: RootMode;
  /**
   * Native `delegatesFocus` fact. Meaningful only for a shadow root; a light
   * descriptor that sets it is a compiler bug and fails descriptor validation.
   */
  readonly delegatesFocus?: boolean;
  /**
   * Associate the host with its surrounding native form through the shell's
   * ONE element-lifetime `ElementInternals` record (shared with closed-root
   * discovery). Two shapes, derived from the declared rows (no shape field):
   *
   * - value shape — a declared string `value` property is the form value
   *   source; an optional declared boolean `required` enables the valueMissing
   *   mirror and an optional declared boolean non-reflecting `disabled`
   *   enables the fieldset-enabled state.
   * - button shape — no declared `value` row: the element stays form-associated
   *   (`form.elements` membership, external `form=<id>` association) but
   *   publishes no form value, makes no validity claim and maps no reset or
   *   restore state; its optional declared boolean `disabled` row may reflect
   *   (the class open-button contract). A `required` row without `value` is
   *   refused (nothing to mirror).
   *
   * The shell owns all platform callbacks; there is no author internals API
   * and no separate `formValue` field.
   */
  readonly formAssociated?: boolean;
  readonly properties?: readonly GeneratedElementProperty[];
  /**
   * A CLIENT-ONLY island's declared stylesheets, as the sheet OBJECTS its
   * emitted `.css` imports resolve to (2026-11-20 client style-adoption slice).
   *
   * The compiler emits this row only for a CLIENT-ONLY island (`ssr: false`, or
   * the `hydrate: 'only'` coercion): such an island has no server render, so no
   * marked `<link>` can deliver its sheet and the browser creates the root. The
   * shell adopts these sheets into the root it created (`rootCreatedByShell`) —
   * or, for a light root, into the tree the element is in — through the class
   * lane's ONE `CompiledStyleScope`, and removes them again on disconnect so a
   * reconnect re-arms exactly one adoption.
   *
   * An SSR/DSD island never carries this row: its sheet IS the `<link>` inside
   * its template, and `sheetDeliveredByLink()` keeps that single delivery.
   *
   * Every entry must be a real sheet object (`replaceSync` callable). A string
   * — what a build that failed to intercept the import would hand over — fails
   * descriptor normalization with a coded build-phase error instead of
   * rendering the element silently unstyled.
   */
  readonly styles?: readonly StyleSheetLike[];
  /**
   * DEV-ONLY live sheets for an SSR/DSD island (owner decision, 2026-11-22).
   *
   * `styles` above is deliberately absent for an SSR island: its sheet IS the
   * marked `<link>` in its template, and `sheetDeliveredByLink()` keeps that one
   * delivery. But dev needs something a `<link>` cannot give it — HMR. A live
   * `CSSStyleSheet` held on `globalThis` is re-filled IN PLACE when the sheet
   * re-evaluates, so a CSS-only edit updates computed styles with no reload and no
   * flicker, and every root already holding that object re-renders. Replacing a
   * `<link>` href would re-parse and rebuild instead.
   *
   * So the two deliveries differ ON PURPOSE: build is one asset, one delivery; dev
   * is one live object, updated in place. A field rather than a mode flag keeps the
   * difference visible at the adoption site, and it is never emitted by the
   * compiler — the dev client entry injects it at runtime.
   */
  devLiveStyles?: readonly StyleSheetLike[];
  /**
   * The light-root SSR producer the compiler emits as `<Name>__ssr()`: a
   * parameterless function returning the content HTML the mount would build.
   *
   * Present only for a LIGHT (or absent) descriptor root — a shadow root has no
   * light DOM of its own to serialize, so its SSR path is the `<Name>__ssrHost`
   * wrapper declared next to the DSD template instead. The shell attaches this
   * as the class's static `__ssr` so the canonical serializer can reach it from
   * the registered constructor without a second registry (the class IS the
   * registration).
   */
  readonly ssrProducer?: () => string;
  readonly createRecipe: (owner: LifetimeScope, host: GeneratedElementHost<P>) => Recipe<P>;
  /**
   * The LC-0 descriptor-fixture retention factory (internal descriptor ABI
   * addition, compiler-private — no public export). Called ONCE per element, on
   * its first connection, with the retained element/island-lifetime owner. The
   * returned record becomes the generated recipe host's `bindings` and is
   * retained across disconnect/reconnect, so setup-owned signals/computeds and
   * private state survive the disconnect window; the reconnect claim runs
   * without repeating this factory.
   *
   * In the generated path the compiler now emits this factory for the ROOT
   * only (module-local `__oe_rootInstance`, T3/`16b-LC-1`) and the emitted
   * descriptor supplies it here, so the generated root mount/claim alias the
   * retained record instead of re-evaluating setup in `<Name>__claim`; a root
   * with no local setup snapshot emits no factory and the shell keeps the
   * `createBindings?.() ?? {}` fallback. Hosts/tests may still supply this
   * factory directly (descriptor-fixture evidence). Nested hostless children
   * keep their own per-claim evaluation: the generated-path fixture measures
   * that re-evaluation, while nested child retention remains OWED for
   * `16b-LC retained-child` and is not claimed here.
   *
   * The owner is a real cleanup channel: setup-owned effects, listeners, timers,
   * subscriptions and any other resource that needs cleanup register on it and
   * are released only by explicit teardown (`dispose`), never by a plain
   * disconnect. Setup MUST NOT append DOM: the projection owns the region.
   *
   * Mutually exclusive with `createBindings`: one descriptor names exactly one
   * call-once/retain site, so a descriptor carrying both fails descriptor
   * validation instead of creating a second setup path.
   */
  readonly createInstance?: (
    owner: LifetimeScope,
    host: GeneratedElementInstanceHost<P>,
  ) => Readonly<Record<string, unknown>>;
  /**
   * Legacy allocation-only bindings factory, kept for hosts/tests (M09-0 shell
   * tests). Called once per element on first connection and the returned record
   * is retained for the element lifetime (the factory does not re-run across
   * disconnect/reconnect).
   *
   * This factory runs without a `LifetimeScope` handle and the shell has no
   * owner on which to register a cleanup for it. The contract is therefore
   * allocation-only: it MUST NOT allocate effects, listeners, timers,
   * subscriptions, or any other resource that needs cleanup. It may allocate
   * signals/computeds and return plain data. A descriptor that needs
   * element-lifetime cleanup ownership uses `createInstance` instead of leaking
   * it through this record.
   *
   * The shell retains the record across reconnect, while the per-connection
   * scope is disposed and recreated: resources the generated recipe factory
   * registers on that scope are released. Omitted means the generated module
   * must not require bindings; a missing binding still fails through the
   * generated module's own `OEIR_LEAF_MISSING_VALUE` contract.
   */
  readonly createBindings?: () => Readonly<Record<string, unknown>>;
}

export interface NormalizedProperty {
  readonly name: string;
  readonly attribute: string | null;
  readonly type: GeneratedElementPropertyType;
  readonly reflect: boolean;
  /** Primitive value only; non-primitive defaults are materialised per owner. */
  readonly defaultValue?: string | number | boolean;
  /** Primitive-only conversion record; non-primitive rows bypass it entirely. */
  readonly conversion?: PropertyConversionRecord;
  /** Array/object fresh-literal factory (one call per element/SSR render). */
  readonly defaultFactory?: () => unknown;
  /** trustedHtml literal HTML; branded per materialisation. */
  readonly defaultHtml?: string;
}

/**
 * The bounded M09-2d form mapping, in one of two shapes derived from the
 * declared rows (no shape field is invented):
 *
 * - **value shape** — `value` is the declared string row; it is the form value
 *   source and carries the required→valueMissing mirror, reset and restore.
 *   A shadow input marked `data-form-validation="email"` opts the string
 *   `type` row into native email validation when its value is `email`.
 * - **button shape** — `value` is null (the sidecar declared no `value` row):
 *   the element stays form-associated (`form.elements` membership and the
 *   external `form=<id>` association resolve through the one internals record)
 *   but publishes no form value, makes no validity claim and never maps a
 *   reset/restore state. A declared boolean `disabled` row may reflect.
 */
export interface FormMapping {
  readonly value: NormalizedProperty | null;
  readonly required?: NormalizedProperty;
  readonly disabled?: NormalizedProperty;
  readonly type?: NormalizedProperty;
}

export interface NormalizedDescriptor {
  readonly rootMode: RootMode;
  readonly delegatesFocus: boolean;
  readonly formAssociated: boolean;
  readonly form: FormMapping | null;
  readonly properties: readonly NormalizedProperty[];
  readonly byAttribute: ReadonlyMap<string, NormalizedProperty>;
  /**
   * The client-only island's adopted sheets (see
   * {@link GeneratedElementDescriptor.styles}). Always an array; empty for every
   * SSR/DSD descriptor.
   */
  readonly styles: readonly StyleSheetLike[];
  /**
   * DEV-ONLY live sheets, carried through normalization untouched (see
   * {@link GeneratedElementDescriptor.devLiveStyles}). Never emitted by the
   * compiler; the dev client entry injects it.
   */
  readonly devLiveStyles?: readonly StyleSheetLike[];
  readonly createRecipe: (
    owner: LifetimeScope,
    host: GeneratedElementHost<Record<string, unknown>>,
  ) => Recipe<Record<string, unknown>>;
  readonly createInstance?: (
    owner: LifetimeScope,
    host: GeneratedElementInstanceHost<Record<string, unknown>>,
  ) => Readonly<Record<string, unknown>>;
  readonly createBindings?: () => Readonly<Record<string, unknown>>;
  readonly ssrProducer?: () => string;
}

const PROPERTY_TYPES: ReadonlySet<string> = new Set([
  'string',
  'number',
  'boolean',
  'array',
  'object',
  'trustedHtml',
]);
const NON_PRIMITIVE_PROPERTY_TYPES: ReadonlySet<string> = new Set([
  'array',
  'object',
  'trustedHtml',
]);

/**
 * Property names that would replace platform/lifecycle surface on the element
 * prototype. A descriptor that asks for one is a compiler bug, not a fallback.
 */
const RESERVED_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  'constructor',
  'connectedCallback',
  'disconnectedCallback',
  'attributeChangedCallback',
  'adoptedCallback',
  'observedAttributes',
  'dispose',
  'formAssociatedCallback',
  'formResetCallback',
  'formStateRestoreCallback',
  'formDisabledCallback',
]);

/** Internal write guards for the property-only non-primitive family. */
const PROPERTY_TYPE_MISMATCH = 'OEIR_SHELL_PROPERTY_TYPE_MISMATCH';
const UNTRUSTED_HTML_PROPERTY = 'OEIR_SHELL_UNTRUSTED_HTML_PROPERTY';

export function descriptorError(
  message: string,
  code: string = CompilerErrorCode.INVALID_SOURCE,
  phase: ErrorPhase = 'build',
): never {
  throw frameworkError(code, `[generated-element] ${message}`, { phase });
}

export function isPrimitivePropertyType(type: GeneratedElementPropertyType): boolean {
  return type === 'string' || type === 'number' || type === 'boolean';
}

function normalizeProperty(property: GeneratedElementProperty): NormalizedProperty {
  const name = property.name;
  if (typeof name !== 'string' || name.length === 0) {
    descriptorError('property name must be a non-empty string');
  }
  if (RESERVED_PROPERTY_NAMES.has(name)) {
    descriptorError(`property name "${name}" collides with the element lifecycle surface`);
  }
  const sinkReason = forbiddenSinkReason('prop', name);
  if (sinkReason !== null) {
    descriptorError(`property name "${name}" is not admissible: ${sinkReason}`);
  }
  if (!PROPERTY_TYPES.has(property.type)) {
    descriptorError(`property "${name}" has unsupported type ${String(property.type)}`);
  }

  if (NON_PRIMITIVE_PROPERTY_TYPES.has(property.type)) {
    // Property-only retention: no attribute/JSON channel, no reflection, an
    // explicit default carrier, and a write that never promotes an arbitrary
    // value (plain object/string) into trustedHtml.
    if (property.attribute !== null) {
      descriptorError(
        `property "${name}" type ${property.type} is property-only and must declare ` +
          'attribute: null (no attribute or JSON wire exists for it)',
      );
    }
    if (property.reflect === true) {
      descriptorError(
        `property "${name}" type ${property.type} cannot reflect: it has no attribute`,
      );
    }
    if (property.type === 'trustedHtml') {
      if (typeof property.default !== 'string') {
        descriptorError(
          `property "${name}" trustedHtml default must be the generated literal HTML string`,
        );
      }
      return {
        name,
        attribute: null,
        type: property.type,
        reflect: false,
        defaultHtml: property.default,
      };
    }
    if (typeof property.default !== 'function') {
      descriptorError(
        `property "${name}" ${property.type} default must be a generated fresh-literal factory ` +
          '(the descriptor never holds a mutable module-level default)',
      );
    }
    return {
      name,
      attribute: null,
      type: property.type,
      reflect: false,
      defaultFactory: property.default as () => unknown,
    };
  }

  let attribute: string | null;
  if (property.attribute === undefined) {
    attribute = camelToKebab(name);
  } else if (property.attribute === null) {
    attribute = null;
  } else if (typeof property.attribute === 'string' && property.attribute.length > 0) {
    attribute = property.attribute.toLowerCase();
  } else {
    descriptorError(`property "${name}" has an invalid attribute name`);
  }

  if (attribute !== null && !isSafeAttributeName(attribute)) {
    descriptorError(
      `property "${name}" attribute "${attribute}" is not a safe HTML attribute name`,
      AuthoringErrorCode.UNSAFE_ATTRIBUTE_NAME,
      'validation',
    );
  }
  const defaultForType: string | number | boolean =
    property.type === 'boolean' ? false : property.type === 'number' ? 0 : '';
  const rawDefault = property.default;
  if (
    rawDefault !== undefined &&
    typeof rawDefault !== 'string' &&
    typeof rawDefault !== 'number' &&
    typeof rawDefault !== 'boolean'
  ) {
    descriptorError(
      `property "${name}" default must be a ${property.type} primitive value; a factory/literal ` +
        'carrier belongs only to a property-only non-primitive row',
    );
  }
  const defaultValue =
    typeof rawDefault === 'string' ||
    typeof rawDefault === 'number' ||
    typeof rawDefault === 'boolean'
      ? rawDefault
      : defaultForType;
  if (typeof defaultValue !== property.type) {
    descriptorError(
      `property "${name}" default must be a ${property.type}, got ${typeof defaultValue}`,
    );
  }
  if (property.reflect === true && attribute === null) {
    descriptorError(`property "${name}" requests reflection but declares no attribute`);
  }

  const conversion: PropertyConversionRecord = {
    type: property.type,
    converter: property.type,
    default: defaultValue,
  };

  return {
    name,
    attribute,
    type: property.type,
    reflect: property.reflect === true,
    defaultValue,
    conversion,
  };
}

/** Materialise one property's default for one owner (instance or SSR render). */
export function materialiseDefault(property: NormalizedProperty): unknown {
  if (property.defaultFactory !== undefined) return property.defaultFactory();
  if (property.type === 'trustedHtml') return trustedHtml(property.defaultHtml ?? '');
  return property.defaultValue;
}

/**
 * The write guard for one declared property. Primitives keep the landed
 * coercion; array/object accept only a caller-owned value of the declared
 * shape (preserved by reference, never cloned); trustedHtml accepts only a
 * value this module branded (a plain `{ html }` object or a string fails
 * closed).
 */
export function coercePropertyWrite(property: NormalizedProperty, value: unknown): unknown {
  if (property.type === 'array') {
    if (!Array.isArray(value)) {
      throw frameworkError(
        PROPERTY_TYPE_MISMATCH,
        `[generated-element] property "${property.name}" expects an array value`,
        { phase: 'csr' },
      );
    }
    return value;
  }
  if (property.type === 'object') {
    const prototype =
      typeof value === 'object' && value !== null ? Object.getPrototypeOf(value) : undefined;
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      (prototype !== Object.prototype && prototype !== null)
    ) {
      throw frameworkError(
        PROPERTY_TYPE_MISMATCH,
        `[generated-element] property "${property.name}" expects a plain object value`,
        { phase: 'csr' },
      );
    }
    return value;
  }
  if (property.type === 'trustedHtml') {
    if (!isTrustedHtmlValue(value)) {
      throw frameworkError(
        UNTRUSTED_HTML_PROPERTY,
        `[generated-element] property "${property.name}" requires a value created by ` +
          'trustedHtml(); a plain object or string is not promoted',
        { phase: 'csr' },
      );
    }
    return value;
  }
  return coercePropertyValue(property.conversion!, value);
}

/**
 * Descriptor normalization is memoized by descriptor object identity — the
 * same contract as `runtime-program.ts`'s `normalizedByProgram`: a generated
 * module evaluates its `__oeElementDescriptor` literal once (the compiler
 * emits it as a module-level `const`; "the descriptor rows emitted above ARE
 * the input"), so every SSR render of that element — the emitted
 * `<Name>__ssrHost` resolves props per render — and the one class-definition
 * pass reuse the same normalized descriptor instead of re-running the
 * authoring-shape validation family and rebuilding the camelCase→kebab
 * attribute derivation and the per-name/attribute maps per render.
 *
 * The key is the descriptor object; there is no invalidation: the normalized
 * result is a pure function of the descriptor rows, and a descriptor mutated
 * after its first successful normalization is not re-normalized (descriptors
 * are compiler-built module literals, never mutable request inputs). The
 * normalized descriptor is read-only by contract — consumers read rows and
 * maps, never mutate them, and per-render/per-instance state (lazy defaults,
 * signal values) is allocated fresh downstream. Failures are not memoized: an
 * invalid descriptor re-validates and re-throws on every call, so rejection
 * behavior is unchanged.
 */
const normalizedByDescriptor = new WeakMap<GeneratedElementDescriptor, NormalizedDescriptor>();

export function normalizeDescriptor(descriptor: GeneratedElementDescriptor): NormalizedDescriptor {
  const cached = normalizedByDescriptor.get(descriptor);
  if (cached !== undefined) return cached;
  const normalized = normalizeDescriptorWithRows(descriptor, normalizeDeclaredProperties);
  normalizedByDescriptor.set(descriptor, normalized);
  return normalized;
}

type NormalizedRows = Pick<NormalizedDescriptor, 'properties' | 'byAttribute' | 'form'>;

export function normalizeRowlessDescriptor(
  descriptor: GeneratedElementDescriptor,
): NormalizedDescriptor {
  return normalizeDescriptorWithRows(descriptor, (rows, formAssociated) => {
    if (rows !== undefined && (!Array.isArray(rows) || rows.length !== 0)) {
      descriptorError('declared properties require the generated property runtime');
    }
    return {
      properties: [],
      byAttribute: new Map(),
      form: formAssociated ? { value: null } : null,
    };
  });
}

export function assertGeneratedElementTag(tag: string): void {
  if (typeof tag !== 'string' || !tag.includes('-')) {
    descriptorError(
      'tag must be a hyphenated custom-element name',
      AuthoringErrorCode.INVALID_TAG_NAME,
      'validation',
    );
  }
}

export function normalizeGeneratedStyles(
  declaredStyles: readonly StyleSheetLike[] | undefined,
): readonly StyleSheetLike[] {
  // A client-only island's sheets arrive as EMITTED MODULE IMPORTS (2026-11-20).
  // Validate the OBJECT here, before any DOM work: a build that failed to
  // intercept the `.css` import hands over a string (or nothing), and adopting
  // that would render the element silently unstyled. One coded descriptor error
  // is the fail-closed half of that contract; the compiler's
  // CLIENT_STYLES_UNWIRED refusal is the build-time half.
  //
  // Never read `cssRules`: a sheet whose `replace()` is still in flight throws
  // on that read in Firefox (the class lane's KR-2/Q1-B race), and adoption
  // needs no rule read at all.
  if (declaredStyles !== undefined && !Array.isArray(declaredStyles)) {
    descriptorError('styles must be an array of stylesheet objects when present');
  }
  const styles: readonly StyleSheetLike[] = declaredStyles ?? [];
  for (const [index, sheet] of styles.entries()) {
    if (
      typeof sheet !== 'object' ||
      sheet === null ||
      typeof (sheet as { replaceSync?: unknown }).replaceSync !== 'function'
    ) {
      descriptorError(
        `styles[${index}] is not a stylesheet object: a client-only island's declared sheet must ` +
          'arrive as the module-graph import the build intercepts, never as a string or a missing ' +
          'binding (refusing instead of rendering the element unstyled)',
      );
    }
  }
  return styles;
}

function normalizeDescriptorWithRows(
  descriptor: GeneratedElementDescriptor,
  normalizeRows: (
    rows: GeneratedElementDescriptor['properties'],
    formAssociated: boolean,
  ) => NormalizedRows,
): NormalizedDescriptor {
  assertGeneratedElementTag(descriptor.tag);
  if (typeof descriptor.createRecipe !== 'function') {
    descriptorError('createRecipe must be the generated recipe factory');
  }
  if (descriptor.createBindings !== undefined && typeof descriptor.createBindings !== 'function') {
    descriptorError('createBindings must be a function when present');
  }
  if (descriptor.createInstance !== undefined && typeof descriptor.createInstance !== 'function') {
    descriptorError('createInstance must be a function when present');
  }
  if (descriptor.createInstance !== undefined && descriptor.createBindings !== undefined) {
    descriptorError(
      'createInstance and createBindings are mutually exclusive: the descriptor must name exactly ' +
        'one call-once/retain setup site',
    );
  }
  const rootMode = descriptor.root ?? 'light';
  if (rootMode !== 'light' && rootMode !== 'shadow-open' && rootMode !== 'shadow-closed') {
    descriptorError(`root must be light, shadow-open or shadow-closed, got ${String(rootMode)}`);
  }
  if (descriptor.delegatesFocus !== undefined && typeof descriptor.delegatesFocus !== 'boolean') {
    descriptorError('delegatesFocus must be a boolean when present');
  }
  const delegatesFocus = descriptor.delegatesFocus === true;
  if (rootMode === 'light' && delegatesFocus) {
    descriptorError('delegatesFocus requires a shadow root');
  }
  if (descriptor.formAssociated !== undefined && typeof descriptor.formAssociated !== 'boolean') {
    descriptorError('formAssociated must be a boolean when present');
  }
  const styles = normalizeGeneratedStyles(descriptor.styles);
  const formAssociated = descriptor.formAssociated === true;

  return {
    rootMode,
    delegatesFocus,
    formAssociated,
    ...normalizeRows(descriptor.properties, formAssociated),
    styles,
    ...(descriptor.devLiveStyles === undefined ? {} : { devLiveStyles: descriptor.devLiveStyles }),
    createRecipe: descriptor.createRecipe as NormalizedDescriptor['createRecipe'],
    ...(descriptor.ssrProducer === undefined ? {} : { ssrProducer: descriptor.ssrProducer }),
    ...(descriptor.createInstance === undefined
      ? {}
      : { createInstance: descriptor.createInstance as NormalizedDescriptor['createInstance'] }),
    ...(descriptor.createBindings === undefined
      ? {}
      : { createBindings: descriptor.createBindings }),
  };
}

function normalizeDeclaredProperties(
  rows: GeneratedElementDescriptor['properties'],
  formAssociated: boolean,
): NormalizedRows {
  const properties = (rows ?? []).map(normalizeProperty);
  const names = new Set<string>();
  const byAttribute = new Map<string, NormalizedProperty>();
  for (const property of properties) {
    if (names.has(property.name)) {
      descriptorError(`duplicate property "${property.name}"`);
    }
    names.add(property.name);
    if (property.attribute !== null) {
      if (byAttribute.has(property.attribute)) {
        descriptorError(`duplicate attribute "${property.attribute}"`);
      }
      byAttribute.set(property.attribute, property);
    }
  }

  const byName = new Map(properties.map((property) => [property.name, property]));
  let form: FormMapping | null = null;
  if (formAssociated) {
    const value = byName.get('value');
    const required = byName.get('required');
    const disabled = byName.get('disabled');
    const type = byName.get('type');
    if (required !== undefined && required.type !== 'boolean') {
      descriptorError(
        `the optional form property "required" must be boolean, got ${required.type}`,
      );
    }
    if (disabled !== undefined && disabled.type !== 'boolean') {
      descriptorError(
        `the optional form property "disabled" must be boolean, got ${disabled.type}`,
      );
    }
    if (value === undefined) {
      // The button shape: no declared value row publishes no form value. The
      // element stays form-associated (form.elements membership and the
      // external `form=<id>` association resolve through the one internals
      // record); `required` mirrors valueMissing on the form value and is
      // refused here; a reflecting `disabled` row is the class open-button
      // contract and is admitted.
      if (required !== undefined) {
        descriptorError(
          'the optional form property "required" mirrors valueMissing on the declared form value; ' +
            'a form-associated descriptor without a "value" property publishes no form value',
        );
      }
    } else {
      if (value.type !== 'string') {
        descriptorError(`the form value property "value" must be a string, got ${value.type}`);
      }
      if (disabled?.reflect === true) {
        descriptorError(
          'the form property "disabled" must not reflect: the fieldset/authored disabled state ' +
            'must stay reversible',
        );
      }
    }
    form = {
      value: value ?? null,
      ...(required === undefined ? {} : { required }),
      ...(disabled === undefined ? {} : { disabled }),
      ...(type?.type === 'string' && value !== undefined ? { type } : {}),
    };
  }

  return { properties, byAttribute, form };
}
/**
 * One lazy, memoised default for one declared row of one SSR render. The
 * factory/brand runs at most once, and only when the leaf actually reads the
 * row; an unused declared row is never materialised.
 */
function lazyDefaultFor(property: NormalizedProperty): () => unknown {
  let materialised = false;
  let value: unknown;
  return () => {
    if (!materialised) {
      materialised = true;
      value = materialiseDefault(property);
    }
    return value;
  };
}

/**
 * Fold one in-process props record into a complete server-render props record.
 *
 * The record is getter-backed so the approved per-read props contract survives
 * the fold:
 * - a supplied row's getter delegates to the caller's record on every read
 *   (supplied array/object values stay caller-owned references; trustedHtml
 *   values are brand-checked on read; a supplied getter is never executed by
 *   the resolver itself, so an unused supplied row has no side effect);
 * - an omitted row (or a supplied row whose read yields `undefined`) uses a
 *   lazy memoised default: the generated factory/brand runs at most once per
 *   render and only if the leaf reads it;
 * - readers see a null-prototype record, and no row is ever assigned through
 *   `__proto__`-sensitive assignment.
 *
 * The generated `<Name>__ssrHost` calls this helper with the descriptor +
 * caller props; M11 owns producing that in-process record. The non-primitive
 * JSON seed is the SEEDER's channel (`data-oe-prop-seed`, produced by
 * `seedGeneratedElementHostProperties` and restored by the claim), never a
 * second value wire invented here.
 */
export function resolveGeneratedElementProps<P extends object = Record<string, unknown>>(
  descriptor: GeneratedElementDescriptor<P>,
  props?: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const normalized = normalizeDescriptor(descriptor as GeneratedElementDescriptor);
  const resolved: Record<string, unknown> = Object.create(null);
  for (const property of normalized.properties) {
    const defaultForRow = lazyDefaultFor(property);
    const supplied =
      props !== undefined && Object.prototype.hasOwnProperty.call(props, property.name);
    const readSupplied = (): unknown => {
      const value = props![property.name];
      if (value === undefined) return defaultForRow();
      return isPrimitivePropertyType(property.type) ? value : coercePropertyWrite(property, value);
    };
    Object.defineProperty(resolved, property.name, {
      enumerable: true,
      configurable: false,
      get: supplied ? readSupplied : defaultForRow,
    });
  }
  return resolved;
}
