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
 * silently left shadowing the accessor.
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
 * Out of scope for this slice: shadow DOM / DSD, slots, event declarations,
 * forms, `delegatesFocus`, styles/theme, property reflection beyond the three
 * primitive types, and third-party Web Component qualification.
 *
 * @module ./shell.ts
 */

import { camelToKebab, isSafeAttributeName } from '@openelement/protocol/forbidden-sinks';
import {
  AuthoringErrorCode,
  CompilerErrorCode,
  frameworkError,
  type ErrorPhase,
} from '@openelement/protocol/errors';
import {
  coercePropertyValue,
  convertFromAttribute,
  convertToAttribute,
  type PropertyConversionRecord,
} from '../../core/property-conversion.ts';
import { LifetimeScope } from '../lifetime-scope.ts';
import { claimRecipe, insertRecipe, type Projection, type Recipe } from '../runtime/recipe.ts';
import { removeNodes } from '../runtime/values.ts';
import { signal } from '../../signal/framework.ts';
import type { WritableSignal } from '../../signal/types.ts';

/** The three primitive property types this slice admits. */
export type GeneratedElementPropertyType = 'string' | 'number' | 'boolean';

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
  /** Value used before any attribute or property write. */
  readonly default?: string | number | boolean;
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
  readonly defaultValue: string | number | boolean;
  readonly conversion: PropertyConversionRecord;
}

interface NormalizedDescriptor {
  readonly properties: readonly NormalizedProperty[];
  readonly byAttribute: ReadonlyMap<string, NormalizedProperty>;
  readonly createRecipe: (
    owner: LifetimeScope,
    host: GeneratedElementHost<Record<string, unknown>>,
  ) => Recipe<Record<string, unknown>>;
  readonly createBindings?: () => Readonly<Record<string, unknown>>;
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
  /** A generated region exists (including an empty-output region). */
  mounted: boolean;
  connecting: boolean;
  reflecting: boolean;
  /** The first connect reconciled pre-upgrade own data properties. */
  ownPropertiesReconciled: boolean;
}

const states = new WeakMap<HTMLElement, ElementState>();

const PROPERTY_TYPES: ReadonlySet<string> = new Set(['string', 'number', 'boolean']);

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
]);

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
  if (!PROPERTY_TYPES.has(property.type)) {
    descriptorError(`property "${name}" has unsupported type ${String(property.type)}`);
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
  const defaultValue = property.default ?? defaultForType;
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

  return {
    properties,
    byAttribute,
    createRecipe: descriptor.createRecipe as NormalizedDescriptor['createRecipe'],
    ...(descriptor.createBindings === undefined
      ? {}
      : { createBindings: descriptor.createBindings }),
  };
}

function createState(descriptor: NormalizedDescriptor): ElementState {
  const values = new Map<string, unknown>();
  const props: Record<string, unknown> = {};
  for (const property of descriptor.properties) {
    values.set(property.name, property.defaultValue);
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
    mounted: false,
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
  if (!property.reflect || property.attribute === null) return;
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
 */
function reconcilePreUpgradeProperties(element: HTMLElement, state: ElementState): void {
  if (state.ownPropertiesReconciled) return;
  state.ownPropertiesReconciled = true;
  const record = element as unknown as Record<string, unknown>;
  for (const property of state.descriptor.properties) {
    if (!Object.prototype.hasOwnProperty.call(element, property.name)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(element, property.name);
    if (descriptor === undefined || !('value' in descriptor)) continue;
    if (descriptor.configurable === false) {
      throw new TypeError(
        `[generated-element] pre-upgrade own property "${property.name}" is non-configurable; ` +
          'the shell cannot reconcile it with the generated accessor.',
      );
    }
    const value: unknown = descriptor.value;
    delete record[property.name];
    if (restatesDefault(property, value) || value === null || value === undefined) continue;
    setProperty(element, state, property, coercePropertyValue(property.conversion, value), true);
  }
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
  if (!property.reflect || property.attribute === null) return;
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

  class GeneratedElementShell extends HTMLElement implements GeneratedElement {
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
      // Must precede createRecipe: the recipe reads host.props on creation.
      reconcilePreUpgradeProperties(this, state);
      state.connecting = true;
      const owner = new LifetimeScope();
      try {
        const recipe = normalized.createRecipe(owner, hostFor(state));
        // Claim when a generated region already exists (disconnect retained the
        // DOM, or the element was server-rendered). Otherwise mount.
        const projection =
          state.mounted || this.childNodes.length > 0
            ? claimRecipe(owner, recipe, this)
            : insertRecipe(owner, recipe, this);
        state.owner = owner;
        state.projection = projection;
        state.ownedNodes = projection.nodes;
        state.mounted = true;
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

    /** Explicit teardown; internal escape hatch, not author API. */
    dispose(detachOwnedNodes = true): void {
      const state = stateOf(this);
      const projection = state.projection;
      const owner = state.owner;
      const owned = state.ownedNodes;
      state.projection = null;
      state.owner = null;
      state.ownedNodes = null;

      if (!detachOwnedNodes) {
        // Plain disposal releases the ownership record with the projection. It
        // does not leave a retained range behind for a later dispose(true) to
        // "upgrade" into a detach: the range cleanup is gone on the first
        // disposal (the LifetimeScope one-shot rule). `mounted` stays as-is so
        // a reconnect can still claim the retained DOM.
        captureCleanupFailures([() => projection?.dispose(false), () => owner?.dispose(false)]);
        return;
      }

      state.mounted = false;
      captureCleanupFailures([
        () => projection?.dispose(true),
        // The projection's range cleanup normally removes the region; remove
        // the recorded owned range explicitly as well so a throwing cleanup
        // cannot leave it behind. This is still only the owned range: never
        // `childNodes` (host-appended / borrowed / never-mounted DOM stays).
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

  for (const property of normalized.properties) {
    Object.defineProperty(GeneratedElementShell.prototype, property.name, {
      configurable: true,
      enumerable: false,
      get(this: HTMLElement): unknown {
        return stateOf(this).values.get(property.name);
      },
      set(this: HTMLElement, value: unknown): void {
        const state = stateOf(this);
        setProperty(this, state, property, coercePropertyValue(property.conversion, value), true);
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
