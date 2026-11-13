/**
 * M09-0 — the runtime shell that turns one generated leaf module into a
 * Custom Element.
 *
 * This file is an INTERNAL COMPILER CONTRACT, not author syntax and not a
 * generic program interpreter. A future M09-1 class emitter supplies a narrow
 * descriptor (tag, declared properties, the generated `create<Name>Recipe`
 * factory, and optionally the bindings factory); this shell only:
 *
 * - builds the generated element class; explicit registration is the separate
 *   `defineGeneratedElement` helper (a test/emitter hook, not the M09
 *   registration decision);
 * - selects Mount (`insertRecipe`) when the element has no generated region
 *   yet, and Claim (`claimRecipe`) when server DOM or retained DOM exists;
 * - converts attributes through the import-free canonical leaf
 *   `internal/core/property-conversion.ts` (`convertFromAttribute` /
 *   `convertToAttribute` / `coercePropertyValue`) instead of re-deriving a
 *   conversion table. This shell does not import `facade-host.ts`,
 *   `runtime-program.ts`, the compiled kernel, or the Part Program executor;
 * - reflects declared properties back to attributes, including the
 *   reflect-removal contract: removing a reflected attribute restores the
 *   declared default in both channels, even when the property write itself is
 *   value-equal and would otherwise short-circuit;
 * - feeds the generated recipe a stable props record whose getters evaluate on
 *   every read, plus one `propsChanged` signal for the generated invalidation
 *   channel;
 * - disposes the projection with `dispose(false)` on disconnect (DOM retained)
 *   and adopts that retained DOM with a FRESH owner on reconnect. The top-level
 *   node range owned by the last successful mount/claim is recorded on the
 *   element state, so `dispose(true)` removes exactly that range: host-appended
 *   children, borrowed server DOM a failed claim never adopted, and DOM that
 *   was never mounted are left alone. The internal disconnect path retains that
 *   ownership record for reconnect/teardown; an explicit shell `dispose(false)`
 *   releases it, so a later `dispose(true)` cannot upgrade the released handle
 *   into a detach (the same one-shot ownership rule as
 *   `LifetimeScope`/`Projection`).
 * - resolves the root once (`./root.ts`), before the recipe: `light` uses the
 *   host, `shadow-open` adopts `host.shadowRoot` or attaches an open root, and
 *   `shadow-closed` adopts `ElementInternals.shadowRoot` or attaches a closed
 *   root. An existing DSD root is never replaced by `attachShadow`; the
 *   resolved ShadowRoot is retained across disconnect/reconnect/teardown. A
 *   shadow element's host light children are slotted content and are never
 *   claimed, owned or deleted by the shell. The first connect observes whether
 *   a generated region already exists (adopted SSR/DSD content) once and stores
 *   that fact on the element state; reconnect and teardown use that fact, not
 *   the current `parent.childNodes`, so foreign nodes left after `dispose(true)`
 *   never masquerade as a region that must be claimed.
 *
 * Upgrade contract: the constructor inspects no attributes and no children.
 * Parser-created markup is seeded by the platform's observed-attribute replay,
 * which runs `attributeChangedCallback` before `connectedCallback`, so the
 * recipe sees the converted attributes. On the first connect, before the
 * recipe is created, own data properties that shadow a declared accessor (a
 * pre-upgrade JS set, or a generated class-field restatement) are reconciled:
 * the own property is deleted and a real pre-upgrade value is written back
 * through the property contract, which makes a pre-upgrade JS set win over an
 * attribute while a value that merely restates the declared default is
 * ignored. A non-configurable own property fails loudly instead of being
 * silently left shadowing the accessor. Reconciliation validates the whole own
 * descriptor set before applying anything, and only records completion after
 * application, so a rejected connect can never leave a half-applied element or
 * let a later connect skip the check.
 *
 * Supported reconnect boundary: the shell-owned `propsChanged` signal and the
 * optional `createBindings()` record are created once and retained across a
 * disconnect/reconnect; the projection's subscriptions and the per-connection
 * root lineage scope are disposed on disconnect, and the reconnect claim gets a
 * fresh root scope. This is the narrow §4.1d "fresh root scope" path, not the
 * full §4.1d reconnect-resource contract. This shell has no author
 * `onConnect`/`onDispose` callbacks and makes no claim about focus/selection or
 * other platform state across the disconnect window.
 *
 * Explicit teardown is `dispose(true)` on the element; it removes only the node
 * range the shell mounted or claimed. There is no public author API here: the
 * module is not re-exported from a package barrel and the descriptor is built
 * by the compiler.
 *
 * M09-shadow now covers shadow DOM / DSD, native slots and `delegatesFocus`.
 * Out of scope for this slice: styles/theme (the separate style consumer),
 * event declarations, forms (`formAssociated`/`ElementInternals` ownership),
 * property reflection beyond the three primitive types, the M09-1 class
 * emitter/registration decision, and third-party Web Component qualification.
 *
 * @module ./shell.ts
 */

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
import { OpenElementBase } from '../../../open-element-base.ts';
import { ElementFormController } from '../../../open-element-form.ts';
import {
  coercePropertyValue,
  convertFromAttribute,
  convertToAttribute,
  type PropertyConversionRecord,
} from '../../core/property-conversion.ts';
import { isTrustedHtmlValue, trustedHtml } from '../../core/security.ts';
import { LifetimeScope } from '../lifetime-scope.ts';
import { claimRecipe, insertRecipe, type Projection, type Recipe } from '../runtime/recipe.ts';
import { removeNodes } from '../runtime/values.ts';
import { signal } from '../../signal/framework.ts';
import type { WritableSignal } from '../../signal/types.ts';
import {
  assertGeneratedRootOptions,
  generatedRootKind,
  resolveGeneratedElementRoot,
  SHELL_ROOT_MODE_MISMATCH,
  type ElementInternalsRecord,
  type GeneratedRootKind,
} from './root.ts';

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

/**
 * The generated element's ONE internal entry: the emitted module imports this
 * module's specifier for the class factory AND (M09-2a) for the host-level DSD
 * producer the appended `<Name>__ssrHost` calls. It is a re-export, not a
 * second implementation: `./dsd-ssr.ts` composes the canonical DSD spelling
 * (`../dsd.ts`) and is a browser-safe leaf. The producer is surfaced here
 * because the element package has exactly one generated-element export
 * subpath, and a second subpath would be new public surface (`D-packaging`).
 *
 * The consequence is stated rather than hidden: a module that imports this
 * specifier also has `dsd.ts` in its parse graph. A light generated module
 * never calls the producer and never emits `<Name>__ssrHost`, so the producer
 * is tree-shaken out of its shipped chunk; the two module-graph guards
 * (`generated-element.class.browser.test.ts` and
 * `generated-element.shadow.test.ts`) assert the rendered graph, and the
 * emitter's byte-identity test asserts the light tail text.
 */
export { serializeGeneratedElementHtml } from './dsd-ssr.ts';
export type { GeneratedElementSsrInput, GeneratedElementSsrRoot } from './dsd-ssr.ts';

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
   * Created once by `createBindings` and retained for the element lifetime.
   * Allocation-only: signals/computeds and plain data, never a resource that
   * needs cleanup (see {@linkcode GeneratedElementDescriptor.createBindings}).
   */
  readonly bindings: Readonly<Record<string, unknown>>;
  readonly props: Readonly<P>;
  /** Shell-owned invalidation channel; the same signal survives reconnect. */
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
   * discovery). The form value is the declared string `value` property; an
   * optional declared boolean `required` enables the valueMissing mirror and an
   * optional declared boolean non-reflecting `disabled` enables the
   * fieldset-enabled state. The shell owns all platform callbacks; there is no
   * author internals API and no separate `formValue` field.
   */
  readonly formAssociated?: boolean;
  readonly properties?: readonly GeneratedElementProperty[];
  readonly createRecipe: (owner: LifetimeScope, host: GeneratedElementHost<P>) => Recipe<P>;
  /**
   * Signals/computeds the generated mount requires. Called once per element on
   * first connection and the returned record is retained for the element
   * lifetime (the factory does not re-run across disconnect/reconnect).
   *
   * This factory runs without a `LifetimeScope` handle and the shell has no
   * owner on which to register a cleanup for it. The contract is therefore
   * allocation-only: it MUST NOT allocate effects, listeners, timers,
   * subscriptions, or any other resource that needs cleanup. It may allocate
   * signals/computeds and return plain data. An element-lifetime resource
   * owner is deliberately not invented here; a future descriptor that needs
   * cleanup ownership must carry it explicitly rather than leaking it through
   * this record.
   *
   * The shell does retain the record across reconnect, while the per-connection
   * root scope is disposed and recreated: resources the generated recipe
   * factory registers on that scope are released. Omitted means the generated
   * module must not require bindings; a missing binding still fails through the
   * generated module's own `OEIR_LEAF_MISSING_VALUE` contract.
   */
  readonly createBindings?: () => Readonly<Record<string, unknown>>;
}

/** The element surface the shell adds beyond `HTMLElement`. */
export interface GeneratedElement extends HTMLElement {
  /**
   * Explicit teardown. Detach mode (`true`, the default) removes only the node
   * range this shell mounted or claimed; it never infers ownership from the
   * current children. Plain mode (`false`) releases the projection and the
   * ownership record without detaching the retained DOM, so a later
   * `dispose(true)` cannot upgrade that released handle into a detach.
   */
  dispose(detachOwnedNodes?: boolean): void;
}

/** Constructor type returned by {@linkcode createGeneratedElementClass}. */
export type GeneratedElementConstructor = new () => GeneratedElement;

interface NormalizedProperty {
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

interface FormMapping {
  readonly value: NormalizedProperty;
  readonly required?: NormalizedProperty;
  readonly disabled?: NormalizedProperty;
}

interface NormalizedDescriptor {
  readonly rootMode: RootMode;
  readonly delegatesFocus: boolean;
  readonly formAssociated: boolean;
  readonly form: FormMapping | null;
  readonly properties: readonly NormalizedProperty[];
  readonly byAttribute: ReadonlyMap<string, NormalizedProperty>;
  readonly createRecipe: (
    owner: LifetimeScope,
    host: GeneratedElementHost<Record<string, unknown>>,
  ) => Recipe<Record<string, unknown>>;
  readonly createBindings?: () => Readonly<Record<string, unknown>>;
}

interface FormRuntime {
  readonly controller: ElementFormController;
  readonly mapping: FormMapping;
  /** Platform/ancestor-fieldset effective disabled, separate from the author property. */
  effectiveDisabled: boolean;
}

interface ElementState {
  readonly descriptor: NormalizedDescriptor;
  readonly values: Map<string, unknown>;
  readonly props: Readonly<Record<string, unknown>>;
  readonly propsChanged: WritableSignal<number>;
  /** Per-connection lineage scope; owns no DOM, disposed with the projection. */
  owner: LifetimeScope | null;
  projection: Projection<Record<string, unknown>> | null;
  /**
   * Top-level nodes owned by the last successful mount/claim. Retained across
   * disconnect so a later teardown removes exactly the generated region (never
   * host-appended or borrowed DOM); cleared when ownership is released.
   */
  ownedNodes: readonly Node[] | null;
  bindings: Readonly<Record<string, unknown>> | null;
  /**
   * The resolved claim/mount parent and its platform kind. Light holds the
   * host; shadow modes hold the ShadowRoot. The root is retained for the
   * element lifetime (disconnect, reconnect, teardown), never re-discovered.
   */
  root: HTMLElement | ShadowRoot | null;
  rootKind: GeneratedRootKind | null;
  /**
   * True only when `root` was created by this shell's `attachShadow()`.
   * A shell-created root has no pre-existing generated region, so its first
   * connect mounts; an adopted root (DSD or a foreign `attachShadow`) may carry
   * server-rendered content and is claimed on the first connect.
   */
  rootCreatedByShell: boolean;
  /**
   * The ONE element-lifetime ElementInternals record: closed-root discovery and
   * form association share it. Null-safe until a lazy attach needs it.
   */
  readonly internalsRecord: ElementInternalsRecord;
  /** Present only for a form-associated descriptor. */
  readonly form: FormRuntime | null;
  /**
   * Whether a generated region is known to exist at the resolved parent.
   *
   * `unobserved` is the first-connect state. It is observed exactly once from
   * the DOM the platform handed us (light children, or an adopted shadow root's
   * children), then the shell owns this fact. Reconnect never re-infers it from
   * `parent.childNodes`: after `dispose(true)` the root can legally retain
   * foreign nodes that are not a generated region, and treating their presence
   * as SSR input would force a claim that can never match (B2).
   */
  regionState: 'unobserved' | 'present' | 'absent';
  connecting: boolean;
  reflecting: boolean;
  /** The first connect reconciled pre-upgrade own data properties. */
  ownPropertiesReconciled: boolean;
}

const states = new WeakMap<HTMLElement, ElementState>();

const PROPERTY_TYPES: ReadonlySet<string> = new Set([
  'string',
  'number',
  'boolean',
  'array',
  'object',
  'trustedHtml',
]);
const PRIMITIVE_PROPERTY_TYPES: ReadonlySet<string> = new Set(['string', 'number', 'boolean']);
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

/**
 * Internal shell identity for a declared property the page locked with a
 * non-configurable own data property. `OEIR_` stays out of the exported
 * catalogue (M07-5 record): no `OE_` public code, no snapshot change.
 */
const PRE_UPGRADE_PROPERTY_LOCKED = 'OEIR_SHELL_PRE_UPGRADE_PROPERTY_LOCKED';
/** Internal write guards for the property-only non-primitive family. */
const PROPERTY_TYPE_MISMATCH = 'OEIR_SHELL_PROPERTY_TYPE_MISMATCH';
const UNTRUSTED_HTML_PROPERTY = 'OEIR_SHELL_UNTRUSTED_HTML_PROPERTY';
/**
 * The platform did not provide `attachInternals` (or the one-shot channel was
 * already consumed outside this shell). A form-associated generated element
 * must fail closed with this code instead of silently claiming form support it
 * does not have.
 */
const FORM_INTERNALS_UNAVAILABLE = 'OEIR_SHELL_FORM_INTERNALS_UNAVAILABLE';

function descriptorError(
  message: string,
  code: string = CompilerErrorCode.INVALID_SOURCE,
  phase: ErrorPhase = 'build',
): never {
  throw frameworkError(code, `[generated-element] ${message}`, { phase });
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
function materialiseDefault(property: NormalizedProperty): unknown {
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
function coercePropertyWrite(property: NormalizedProperty, value: unknown): unknown {
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

function normalizeDescriptor(descriptor: GeneratedElementDescriptor): NormalizedDescriptor {
  if (typeof descriptor.tag !== 'string' || !descriptor.tag.includes('-')) {
    descriptorError(
      'tag must be a hyphenated custom-element name',
      AuthoringErrorCode.INVALID_TAG_NAME,
      'validation',
    );
  }
  if (typeof descriptor.createRecipe !== 'function') {
    descriptorError('createRecipe must be the generated recipe factory');
  }
  if (descriptor.createBindings !== undefined && typeof descriptor.createBindings !== 'function') {
    descriptorError('createBindings must be a function when present');
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
  const formAssociated = descriptor.formAssociated === true;

  const properties = (descriptor.properties ?? []).map(normalizeProperty);
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
    if (value === undefined) {
      descriptorError('formAssociated requires a declared property named "value"');
    }
    if (value.type !== 'string') {
      descriptorError(`the form value property "value" must be a string, got ${value.type}`);
    }
    const required = byName.get('required');
    if (required !== undefined && required.type !== 'boolean') {
      descriptorError(
        `the optional form property "required" must be boolean, got ${required.type}`,
      );
    }
    const disabled = byName.get('disabled');
    if (disabled !== undefined && disabled.type !== 'boolean') {
      descriptorError(
        `the optional form property "disabled" must be boolean, got ${disabled.type}`,
      );
    }
    if (disabled?.reflect === true) {
      descriptorError(
        'the form property "disabled" must not reflect: the fieldset/authored disabled state ' +
          'must stay reversible',
      );
    }
    form = {
      value,
      ...(required === undefined ? {} : { required }),
      ...(disabled === undefined ? {} : { disabled }),
    };
  }

  return {
    rootMode,
    delegatesFocus,
    formAssociated,
    form,
    properties,
    byAttribute,
    createRecipe: descriptor.createRecipe as NormalizedDescriptor['createRecipe'],
    ...(descriptor.createBindings === undefined
      ? {}
      : { createBindings: descriptor.createBindings }),
  };
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
 * caller props; M11 owns producing that in-process record (no server→client
 * seed / JSON wire exists here).
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
      return PRIMITIVE_PROPERTY_TYPES.has(property.type)
        ? value
        : coercePropertyWrite(property, value);
    };
    Object.defineProperty(resolved, property.name, {
      enumerable: true,
      configurable: false,
      get: supplied ? readSupplied : defaultForRow,
    });
  }
  return resolved;
}

function createState(descriptor: NormalizedDescriptor): ElementState {
  const values = new Map<string, unknown>();
  const props: Record<string, unknown> = Object.create(null);
  for (const property of descriptor.properties) {
    values.set(property.name, materialiseDefault(property));
    Object.defineProperty(props, property.name, {
      enumerable: true,
      configurable: false,
      get: () => values.get(property.name),
    });
  }
  Object.freeze(props);
  return {
    descriptor,
    values,
    props,
    propsChanged: signal(0),
    owner: null,
    projection: null,
    ownedNodes: null,
    bindings: null,
    root: null,
    rootKind: null,
    rootCreatedByShell: false,
    internalsRecord: { internals: null },
    form:
      descriptor.form === null
        ? null
        : {
            controller: new ElementFormController(),
            mapping: descriptor.form,
            effectiveDisabled: false,
          },
    regionState: 'unobserved',
    connecting: false,
    reflecting: false,
    ownPropertiesReconciled: false,
  };
}

function stateOf(element: HTMLElement): ElementState {
  const state = states.get(element);
  if (state === undefined) {
    descriptorError('element has no shell state (constructed outside this module)');
  }
  return state;
}

function bumpProps(state: ElementState): void {
  state.propsChanged.value += 1;
}

/** Write one value into the props record's backing map, without reflection. */
function writeValue(state: ElementState, property: NormalizedProperty, value: unknown): boolean {
  if (Object.is(state.values.get(property.name), value)) return false;
  state.values.set(property.name, value);
  return true;
}

function reflectProperty(
  element: HTMLElement,
  state: ElementState,
  property: NormalizedProperty,
  value: unknown,
): void {
  if (!property.reflect || property.attribute === null || property.conversion === undefined) return;
  const serialized = convertToAttribute(property.conversion, value);
  state.reflecting = true;
  try {
    if (serialized === null) element.removeAttribute(property.attribute);
    else element.setAttribute(property.attribute, serialized);
  } finally {
    state.reflecting = false;
  }
}

function setProperty(
  element: HTMLElement,
  state: ElementState,
  property: NormalizedProperty,
  next: unknown,
  reflect: boolean,
): void {
  if (!writeValue(state, property, next)) return;
  if (reflect) reflectProperty(element, state, property, next);
  bumpProps(state);
  syncFormProperty(state, property);
}

/**
 * Run every cleanup even when one throws; surface the FIRST error only. This is
 * how teardown preserves the original resource/range error instead of letting a
 * later root-scope cleanup replace it.
 */
function captureCleanupFailures(cleanups: readonly (() => void)[]): void {
  let firstError: unknown;
  let failed = false;
  for (const cleanup of cleanups) {
    try {
      cleanup();
    } catch (error) {
      if (!failed) {
        firstError = error;
        failed = true;
      }
    }
  }
  if (failed) throw firstError;
}

/**
 * A generated class-field initializer restates the declared default; it is not
 * a pre-upgrade assignment (the old facade's `restatesDefault` contract). The
 * shell's property types are primitives, so identity is the whole comparison.
 */
function restatesDefault(property: NormalizedProperty, value: unknown): boolean {
  // Non-primitive defaults are per-owner materialisations; an own pre-upgrade
  // value is a caller write, never a restated default (no deep compare, no
  // shallow clone, identity preserved).
  if (!PRIMITIVE_PROPERTY_TYPES.has(property.type)) return false;
  return value === property.defaultValue;
}

/**
 * Reconcile own data properties that shadow a declared accessor. This is the
 * classic upgrade sequence:
 *
 * ```js
 * <oe-profile label="server">   // parser-created; not upgraded yet
 * el.label = 'pre';             // own data property, shadowing nothing yet
 * customElements.define(...);   // after upgrade the own property shadows the accessor
 * ```
 *
 * Runs once, on the first connect and before `createRecipe`: the own property is
 * read and deleted, then a real pre-upgrade value is written through the same
 * property contract (coercion + reflection), so it wins over the attribute the
 * platform replayed. A value that merely restates the declared default is
 * ignored. `null`/`undefined` carry no pre-upgrade assignment intent (old
 * facade contract) and are ignored too. A non-configurable own property cannot
 * be deleted: fail loudly instead of leaving the accessor silently shadowed.
 *
 * Two passes: validate every own data descriptor first, then apply. A locked
 * descriptor discovered after a configurable one therefore leaves the element
 * untouched (no earlier delete, write or reflection) instead of half-applied.
 * The descriptor snapshot also means no getter is invoked to read a value. The
 * completion flag is set only after the apply pass, so every later connect
 * retries the same loud rejection rather than skipping validation and mounting
 * the still-shadowed accessor.
 */
function reconcilePreUpgradeProperties(element: HTMLElement, state: ElementState): void {
  if (state.ownPropertiesReconciled) return;
  const record = element as unknown as Record<string, unknown>;
  const pending: Array<{ property: NormalizedProperty; value: unknown }> = [];

  // Validation pass: snapshot and check the whole declared own-descriptor set
  // without touching the element. `descriptor.value` does not run a getter, and
  // skipping accessor descriptors preserves the old "data properties only"
  // contract instead of inventing extra property reads.
  for (const property of state.descriptor.properties) {
    if (!Object.prototype.hasOwnProperty.call(element, property.name)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(element, property.name);
    if (descriptor === undefined || !('value' in descriptor)) continue;
    if (descriptor.configurable === false) {
      throw frameworkError(
        PRE_UPGRADE_PROPERTY_LOCKED,
        `[generated-element] pre-upgrade own property "${property.name}" is non-configurable; ` +
          'the shell cannot reconcile it with the generated accessor.',
        { phase: 'csr' },
      );
    }
    pending.push({ property, value: descriptor.value });
  }

  // Application pass: every descriptor validated, so a rejection above cannot
  // have produced a partial reconciliation.
  for (const { property, value } of pending) {
    delete record[property.name];
    if (restatesDefault(property, value) || value === null || value === undefined) continue;
    setProperty(element, state, property, coercePropertyWrite(property, value), true);
  }

  // Completion is recorded last: a failed connect retries the whole check
  // instead of skipping it on the next connect.
  state.ownPropertiesReconciled = true;
}

/**
 * The reflect-removal contract: after an attribute is removed the property is
 * back at its declared default, but the attribute mirror is not. Restore it
 * from the CURRENT value (not from the removal's `setProperty` result, whose
 * `Object.is` short-circuit may skip reflection entirely). A `null`
 * serialization means "attribute absent", which is already the removed state.
 */
function restoreReflectedDefault(
  element: HTMLElement,
  state: ElementState,
  property: NormalizedProperty,
): void {
  if (!property.reflect || property.attribute === null || property.conversion === undefined) return;
  const serialized = convertToAttribute(property.conversion, state.values.get(property.name));
  if (serialized === null) return;
  if (element.getAttribute(property.attribute) === serialized) return;
  state.reflecting = true;
  try {
    element.setAttribute(property.attribute, serialized);
  } finally {
    state.reflecting = false;
  }
}

function applyAttribute(
  element: HTMLElement,
  state: ElementState,
  property: NormalizedProperty,
  raw: string | null,
): void {
  if (!PRIMITIVE_PROPERTY_TYPES.has(property.type) || property.conversion === undefined) return;
  const next =
    raw === null ? property.defaultValue : convertFromAttribute(property.conversion, raw);
  setProperty(element, state, property, next, false);
  if (raw === null) restoreReflectedDefault(element, state, property);
}

function bindingsFor(state: ElementState): Readonly<Record<string, unknown>> {
  if (state.bindings === null) {
    state.bindings = state.descriptor.createBindings?.() ?? {};
  }
  return state.bindings;
}

function hostFor(state: ElementState): GeneratedElementHost<Record<string, unknown>> {
  return {
    bindings: bindingsFor(state),
    props: state.props,
    propsChanged: state.propsChanged,
  };
}

/**
 * Attach the one element-lifetime ElementInternals record, failing closed with
 * a coded error when the platform cannot provide the channel. The record is
 * shared with closed-root discovery; a second attach is impossible by
 * construction (the record is checked first and the controller caches its
 * injected result).
 */
function ensureFormInternals(element: HTMLElement, state: ElementState): ElementInternals {
  const existing = state.internalsRecord.internals;
  if (existing !== null) return existing;
  const attachInternals = (element as { attachInternals?: () => ElementInternals }).attachInternals;
  if (typeof attachInternals !== 'function') {
    throw frameworkError(
      FORM_INTERNALS_UNAVAILABLE,
      '[generated-element] formAssociated requires ElementInternals.attachInternals(), which this ' +
        'platform does not provide; form support is not claimed',
      { phase: 'csr' },
    );
  }
  let internals: ElementInternals;
  try {
    internals = attachInternals.call(element);
  } catch (error) {
    throw frameworkError(
      FORM_INTERNALS_UNAVAILABLE,
      '[generated-element] formAssociated could not attach ElementInternals; the one-shot ' +
        'channel was already consumed or the platform refused it',
      {
        phase: 'csr',
        cause: error instanceof Error ? error : new Error(String(error)),
      },
    );
  }
  state.internalsRecord.internals = internals;
  return internals;
}

function attachForm(element: HTMLElement, state: ElementState): void {
  state.form?.controller.attachWith(() => ensureFormInternals(element, state));
}

function formValueOf(state: ElementState): string {
  const form = state.form;
  if (form === null) return '';
  const value = state.values.get(form.mapping.value.name);
  return typeof value === 'string' ? value : '';
}

function formRequiredOf(state: ElementState): boolean {
  const required = state.form?.mapping.required;
  return required === undefined ? false : state.values.get(required.name) === true;
}

function formAuthorDisabledOf(state: ElementState): boolean {
  const disabled = state.form?.mapping.disabled;
  return disabled === undefined ? false : state.values.get(disabled.name) === true;
}

function syncFormValue(state: ElementState): void {
  const form = state.form;
  if (form === null) return;
  form.controller.setFormValue(formValueOf(state));
}

function syncFormValidity(state: ElementState): void {
  const form = state.form;
  if (form === null) return;
  const internals = form.controller.internals;
  if (internals === undefined) return;
  if (formRequiredOf(state) && formValueOf(state) === '') {
    internals.setValidity({ valueMissing: true }, 'Please fill out this field.');
  } else {
    internals.setValidity({});
  }
}

function syncFormStates(state: ElementState): void {
  const form = state.form;
  if (form === null) return;
  const states = form.controller.internals?.states;
  if (states === undefined) return;
  if (formRequiredOf(state) && formValueOf(state) === '') states.add('invalid');
  else states.delete('invalid');
  if (formAuthorDisabledOf(state) || form.effectiveDisabled) states.add('disabled');
  else states.delete('disabled');
}

function syncFormAll(state: ElementState): void {
  if (state.form === null) return;
  syncFormValue(state);
  syncFormValidity(state);
  syncFormStates(state);
}

/** Keep the form contract in step with one accepted declared-property write. */
function syncFormProperty(state: ElementState, property: NormalizedProperty): void {
  const form = state.form;
  if (form === null || form.controller.internals === undefined) return;
  if (property.name === form.mapping.value.name) {
    syncFormAll(state);
    return;
  }
  if (property.name === form.mapping.required?.name) {
    syncFormValidity(state);
    syncFormStates(state);
    return;
  }
  if (property.name === form.mapping.disabled?.name) {
    syncFormStates(state);
    return;
  }
}

/** Write the form value through the declared property and keep its attribute seed. */
function writeFormValue(element: HTMLElement, state: ElementState, next: string): void {
  const form = state.form;
  if (form === null) return;
  const property = form.mapping.value;
  setProperty(element, state, property, next, false);
  if (property.attribute !== null) {
    const serialized = convertToAttribute(property.conversion!, next);
    state.reflecting = true;
    try {
      if (serialized === null) element.removeAttribute(property.attribute);
      else element.setAttribute(property.attribute, serialized);
    } finally {
      state.reflecting = false;
    }
  }
}

/** `form.reset()` restores only the declared value source (never every property). */
function resetFormValue(element: HTMLElement, state: ElementState): void {
  const form = state.form;
  if (form === null) return;
  writeFormValue(element, state, String(form.mapping.value.defaultValue));
  syncFormAll(state);
}

function restoreFormValue(
  element: HTMLElement,
  state: ElementState,
  restored: File | string | FormData | null,
): void {
  if (typeof restored !== 'string') return;
  writeFormValue(element, state, restored);
  syncFormAll(state);
}

function setFormDisabled(state: ElementState, disabled: boolean): void {
  const form = state.form;
  if (form === null || form.effectiveDisabled === disabled) return;
  form.effectiveDisabled = disabled;
  syncFormStates(state);
}

/**
 * Resolve the root once and retain it on the element state. The stored root is
 * the element's lifetime claim/mount parent: a later connect reuses it even
 * after a recipe/claim failure, so a retry cannot silently attach a second
 * root or clear borrowed DOM.
 *
 * Existing-root option validation happens AFTER the root is recorded. A
 * mismatch therefore keeps the resolved root (and closed internals) for the
 * next connect, which re-reports the same coded failure instead of falling
 * through to a second `attachInternals()` and a different error identity.
 */
function rootFor(element: HTMLElement, state: ElementState): HTMLElement | ShadowRoot {
  if (state.root !== null) {
    const expected = generatedRootKind(state.descriptor.rootMode);
    if (state.rootKind !== expected) {
      throw frameworkError(
        SHELL_ROOT_MODE_MISMATCH,
        `[generated-element] retained root kind ${String(state.rootKind)} does not match descriptor root ${JSON.stringify(state.descriptor.rootMode)}`,
        { phase: 'csr' },
      );
    }
    if (state.rootKind !== 'light') {
      assertGeneratedRootOptions(
        state.root as ShadowRoot,
        state.rootKind,
        state.descriptor.delegatesFocus,
      );
    }
    return state.root;
  }
  const resolved = resolveGeneratedElementRoot(
    element,
    state.descriptor.rootMode,
    state.descriptor.delegatesFocus,
    state.internalsRecord,
  );
  state.root = resolved.root;
  state.rootKind = resolved.kind;
  state.rootCreatedByShell = resolved.created;
  if (resolved.kind !== 'light') {
    assertGeneratedRootOptions(
      resolved.root as ShadowRoot,
      resolved.kind,
      state.descriptor.delegatesFocus,
    );
  }
  return resolved.root;
}

/**
 * Build the element class for one descriptor without registering it. Exposed so
 * the M09-1 emitter can decide its registration point; consumers normally use
 * {@linkcode defineGeneratedElement}.
 */
export function createGeneratedElementClass<P extends object = Record<string, unknown>>(
  descriptor: GeneratedElementDescriptor<P>,
): GeneratedElementConstructor {
  const normalized = normalizeDescriptor(descriptor as GeneratedElementDescriptor);
  const observedAttributes = Object.freeze(
    normalized.properties
      .map((property) => property.attribute)
      .filter((attribute): attribute is string => attribute !== null),
  );

  class GeneratedElementShell extends OpenElementBase implements GeneratedElement {
    constructor() {
      super();
      const state = createState(normalized);
      states.set(this, state);
      // No attribute or child inspection here (custom-element conformance).
      // Parser-created markup is seeded by the platform's observed-attribute
      // replay, which runs attributeChangedCallback before connectedCallback.
    }

    connectedCallback(): void {
      const state = stateOf(this);
      if (state.projection !== null || state.connecting) return;
      // The one-shot ElementInternals record must exist before closed-root
      // discovery; attach it before any property reconciliation so a form value
      // write during reconciliation can publish immediately. A coded failure
      // leaves no projection/DOM write.
      if (state.form !== null) attachForm(this, state);
      // Must precede createRecipe: the recipe reads host.props on creation.
      reconcilePreUpgradeProperties(this, state);
      state.connecting = true;
      // This connection owner exists before root resolution. A coded root
      // failure creates no projection, no subscription and no generated DOM
      // write, but it is not a zero-allocation or zero-write connect: the
      // owner is released below and pre-upgrade reconciliation may already
      // have reflected a property to an attribute.
      const owner = new LifetimeScope();
      try {
        const parent = rootFor(this, state);
        // Publish the reconciled initial value/validity/state once the root (and
        // the shared internals record used by closed discovery) is resolved.
        syncFormAll(state);
        // Observe the first-connect DOM once, then keep the fact on the state.
        // A shell-created root starts empty (mount); an adopted root may carry
        // SSR/DSD content (claim); a light host's children are its generated
        // region. A shadow parent's light children are slotted content, so
        // they are never inspected here.
        if (state.regionState === 'unobserved') {
          const preexisting =
            state.rootKind === 'light'
              ? this.childNodes.length > 0
              : !state.rootCreatedByShell && parent.childNodes.length > 0;
          state.regionState = preexisting ? 'present' : 'absent';
        }
        const recipe = normalized.createRecipe(owner, hostFor(state));
        // Reconnect and dispose(false) retain the region; dispose(true) marks it
        // absent and the next connect mounts even when foreign nodes remain in
        // the root. The decision is never re-derived from current childNodes.
        const projection =
          state.regionState === 'present'
            ? claimRecipe(owner, recipe, parent)
            : insertRecipe(owner, recipe, parent);
        state.owner = owner;
        state.projection = projection;
        state.ownedNodes = projection.nodes;
        state.regionState = 'present';
      } catch (error) {
        state.owner = null;
        state.projection = null;
        // Keep any ownership recorded by an earlier successful mount/claim: a
        // failed re-claim borrowed no new DOM and must not adopt the host's
        // children. The recipe/projection rolled back its own child scope. This
        // root owner has no DOM range of its own; release it without detach and
        // never let its cleanup error replace the original failure.
        try {
          owner.dispose(false);
        } catch {
          // Keep the original construction/claim/activation error.
        }
        throw error;
      } finally {
        state.connecting = false;
      }
    }

    disconnectedCallback(): void {
      const state = stateOf(this);
      const projection = state.projection;
      const owner = state.owner;
      state.projection = null;
      state.owner = null;
      // Keep the owned node range: the generated DOM is retained across the
      // disconnect and a later teardown must still know exactly what it owns.
      // Plain disposal releases the projection owner's resources but keeps the
      // DOM for a later reconnect (model note §4.1d's current non-detach path).
      // The per-connection lineage scope owns no DOM; dispose it after the
      // projection so a reconnect always starts from a fresh root. Both run,
      // and the projection's error (the first one) is what surfaces.
      captureCleanupFailures([() => projection?.dispose(false), () => owner?.dispose(false)]);
    }

    attributeChangedCallback(
      name: string,
      _oldValue: string | null,
      newValue: string | null,
    ): void {
      const state = stateOf(this);
      if (state.reflecting) return;
      const property = state.descriptor.byAttribute.get(name.toLowerCase());
      if (property === undefined) return;
      applyAttribute(this, state, property, newValue);
    }

    /** Platform form hook: class parity no-op. */
    formAssociatedCallback(_form: HTMLFormElement | null): void {}

    /** Platform form reset hook: reset the declared value source only. */
    formResetCallback(): void {
      const state = stateOf(this);
      if (state.form === null) return;
      attachForm(this, state);
      resetFormValue(this, state);
    }

    /** Platform form restore hook: only a string state is mapped onto `value`. */
    formStateRestoreCallback(restored: File | string | FormData | null, _mode: string): void {
      const state = stateOf(this);
      if (state.form === null) return;
      attachForm(this, state);
      restoreFormValue(this, state, restored);
    }

    /** Platform fieldset-disabled hook: effective state, separate from the author property. */
    formDisabledCallback(disabled: boolean): void {
      const state = stateOf(this);
      if (state.form === null) return;
      attachForm(this, state);
      setFormDisabled(state, disabled);
    }

    /** Explicit teardown; internal escape hatch, not author API. */
    dispose(detachOwnedNodes = true): void {
      const state = stateOf(this);
      const projection = state.projection;
      const owner = state.owner;
      const owned = state.ownedNodes;
      const hadOwnedRegion = projection !== null || owned !== null;
      state.projection = null;
      state.owner = null;
      state.ownedNodes = null;

      if (!detachOwnedNodes) {
        // Plain disposal releases the ownership record with the projection. It
        // does not leave a retained range behind for a later dispose(true) to
        // "upgrade" into a detach: the range cleanup is gone on the first
        // disposal (the LifetimeScope one-shot rule). The region fact stays
        // present so a reconnect can still claim the retained DOM.
        captureCleanupFailures([() => projection?.dispose(false), () => owner?.dispose(false)]);
        return;
      }

      // Only a teardown that actually released an owned region makes the next
      // connect mount. A dispose(true) before any projection/claim (for example
      // on a not-yet-connected DSD host) removes nothing, so the borrowed SSR
      // content is still there and the next connect must still claim it.
      if (hadOwnedRegion) state.regionState = 'absent';
      captureCleanupFailures([
        () => projection?.dispose(true),
        // The projection's range cleanup normally removes the region; remove
        // the recorded owned range explicitly as well so a throwing cleanup
        // cannot leave it behind. This is still only the owned range: never
        // `childNodes` (host-appended / foreign / never-mounted DOM stays).
        () => {
          if (owned !== null) removeNodes(owned);
        },
        () => owner?.dispose(false),
      ]);
    }
  }

  Object.defineProperty(GeneratedElementShell, 'observedAttributes', {
    configurable: true,
    value: observedAttributes,
  });

  if (normalized.formAssociated) {
    // The platform reads the constructor static, not the descriptor; set it
    // before the outer entry calls customElements.define.
    Object.defineProperty(GeneratedElementShell, 'formAssociated', {
      configurable: true,
      value: true,
    });
  }

  for (const property of normalized.properties) {
    Object.defineProperty(GeneratedElementShell.prototype, property.name, {
      configurable: true,
      enumerable: false,
      get(this: HTMLElement): unknown {
        return stateOf(this).values.get(property.name);
      },
      set(this: HTMLElement, value: unknown): void {
        const state = stateOf(this);
        setProperty(this, state, property, coercePropertyWrite(property, value), true);
      },
    });
  }

  return GeneratedElementShell as GeneratedElementConstructor;
}

/**
 * Explicit registration: build the generated class and define it in the current
 * realm's `customElements` registry. Registration is the caller's deliberate
 * act; constructing the class alone does not register anything.
 *
 * This is a test/emitter hook, not the M09 registration contract: M09-1 still
 * owns the generated class ABI, the registration point, and the compiler/plugin
 * integration. Nothing here is exported from a package barrel.
 */
export function defineGeneratedElement<P extends object = Record<string, unknown>>(
  descriptor: GeneratedElementDescriptor<P>,
): GeneratedElementConstructor {
  const ctor = createGeneratedElementClass(descriptor);
  customElements.define(descriptor.tag, ctor as unknown as CustomElementConstructor);
  return ctor;
}
