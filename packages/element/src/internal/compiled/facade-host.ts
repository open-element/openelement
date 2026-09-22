/**
 * facade-host.ts — compiled property contract for the public OpenElement
 * facade (v0.44).
 *
 * Everything the public base class needs to turn the compiler-emitted statics
 * (`__compiledProperties`, `__partProgram`) into live element behavior:
 * engine-backed signals, prototype accessors with guarded attribute
 * reflection, attribute conversion, own-property reconciliation (generated
 * field initializers / pre-upgrade sets), and program handler binding.
 *
 * The class shell itself lives in src/open-element-implementation.ts; this
 * module owns no lifecycle state of its own.
 */

import { FacadeErrorCode, OpenElementError } from '../core/errors.ts';
import type {
  CompiledElementMetadata,
  CompiledPropertyMetadata,
  PartProgram,
  ProgramPart,
} from '../protocol/part-program.ts';
import type { CompiledElementKernel } from './runtime/kernel.ts';
import { signal } from '../signal/index.ts';
import type { WritableSignal } from '../signal/types.ts';

/** Compiled statics emitted by the 0.44 compiler onto the generated class. */
export interface CompiledStatics {
  __partProgram?: PartProgram;
  __compiledProperties?: CompiledPropertyMetadata[];
  __elementMetadata?: CompiledElementMetadata;
  /**
   * Derived-signal factories for computed fields (`x = computed(() => ...)`):
   * each factory builds the field's read-only signal over the instance's
   * plain property signals. Emitted only when the class declares computeds.
   */
  __computedFields?: Record<
    string,
    (signals: Record<string, WritableSignal<unknown>>) => WritableSignal<unknown>
  >;
  styles?: unknown;
  delegatesFocus?: boolean;
  formAssociated?: boolean;
  isErrorBoundary?: boolean;
}

/** Facade element surface the property contract touches. */
export interface FacadeElementLike {
  hasAttribute(name: string): boolean;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/** Per-instance property state (signals, reflection guard, pending values). */
export interface FacadePropertyState {
  readonly properties: CompiledPropertyMetadata[];
  readonly signals: Record<string, WritableSignal<unknown>>;
  /** Attribute currently being written by property reflection (loop guard). */
  reflecting: string | null;
  /** Property values set as JS properties before upgrade; applied at connect. */
  pendingOwnValues: Map<string, unknown> | null;
  /** True after the first connect reconciled generated field initializers. */
  ownPropertiesReconciled: boolean;
  /** Wired by the facade once the kernel exists; drives post-connect reflection. */
  kernel?: CompiledElementKernel;
}

export function classNameOf(ctor: object): string {
  return (ctor as { name?: string }).name ?? 'anonymous';
}

/** Convert a raw attribute string into the compiled property value. */
export function convertFromAttribute(record: CompiledPropertyMetadata, raw: string): unknown {
  switch (record.converter) {
    case 'boolean':
      return true;
    case 'number': {
      const parsed = Number(raw);
      return Number.isNaN(parsed) ? 0 : parsed;
    }
    case 'array':
    case 'object': {
      try {
        return JSON.parse(raw);
      } catch {
        return record.default;
      }
    }
    default:
      return raw;
  }
}

/** Serialize a property value for attribute reflection. */
export function convertToAttribute(
  record: CompiledPropertyMetadata,
  value: unknown,
): string | null {
  if (value === null || value === undefined) return null;
  if (record.type === 'boolean') return value ? '' : null;
  if (record.type === 'array' || record.type === 'object') return JSON.stringify(value);
  return String(value);
}

/** Coerce a JS-side property assignment into the compiled property type. */
export function coercePropertyValue(record: CompiledPropertyMetadata, value: unknown): unknown {
  if (value === null || value === undefined) return record.default;
  switch (record.type) {
    case 'boolean':
      return Boolean(value);
    case 'number':
      return typeof value === 'number' ? value : convertFromAttribute(record, String(value));
    case 'array':
      return Array.isArray(value) ? value : convertFromAttribute(record, String(value));
    case 'object':
      return typeof value === 'object' ? value : convertFromAttribute(record, String(value));
    default:
      return typeof value === 'string' ? value : String(value);
  }
}

function ownDataValue(element: object, name: string): { found: boolean; value?: unknown } {
  if (!Object.prototype.hasOwnProperty.call(element, name)) return { found: false };
  const descriptor = Object.getOwnPropertyDescriptor(element, name);
  if (!descriptor || !('value' in descriptor)) return { found: false };
  return { found: true, value: descriptor.value };
}

/**
 * Whether an own data property value merely restates the compiled default
 * (the generated field initializer's contract, see reconcileOwnProperties)
 * rather than carrying a real pre-upgrade assignment. Arrays/objects compare
 * structurally because the compiler default for them is typically an inline
 * literal evaluated per instance.
 */
function restatesDefault(record: CompiledPropertyMetadata, value: unknown): boolean {
  const fallback = record.default;
  if (value === fallback) return true;
  if (Array.isArray(fallback) || (typeof fallback === 'object' && fallback !== null)) {
    return JSON.stringify(value) === JSON.stringify(fallback);
  }
  return false;
}

/**
 * Create the per-instance property state: one signal per compiled property at
 * its compiled default, plus any property values set as own data properties
 * before upgrade (captured and deleted so the prototype accessors take over;
 * applied last at connect — pre-upgrade JS sets win over attributes).
 *
 * Two passes: plain property signals first, then computed fields derive their
 * read-only signals over them (declaration order) via the generated
 * `__computedFields` factories — #723 semantics: dependencies compile into
 * Part/Region subscriptions, and a computed field is just another signal the
 * Parts subscribe to.
 */
export function createFacadePropertyState(
  element: FacadeElementLike,
  properties: CompiledPropertyMetadata[],
  computedFactories?: CompiledStatics['__computedFields'],
): FacadePropertyState {
  const signals: Record<string, WritableSignal<unknown>> = {};
  const pending = new Map<string, unknown>();
  const record = element as unknown as Record<string, unknown>;
  for (const property of properties) {
    if (property.computed) continue;
    const own = ownDataValue(element, property.name);
    if (own.found) {
      // Generated class-field initializers restate the compiled default
      // (reconcileOwnProperties' own contract). They are NOT pre-upgrade JS
      // sets: capturing a restated default into pendingOwnValues would let it
      // clobber the SSR attribute promotion at connect (applyPendingOwnValues
      // runs after syncAttributesToSignals), so a computed field deriving from
      // the property would claim against default-value-derived chrome while
      // the SSR DOM was rendered from the injected props — the
      // "[compiled-claim] item attribute drift" seen on every non-default
      // locale page (#1318). Only a value that actually differs from the
      // compiled default is a real pre-upgrade set.
      if (!restatesDefault(property, own.value)) {
        pending.set(property.name, own.value);
      }
      delete record[property.name];
    }
    signals[property.name] = signal<unknown>(property.default);
  }
  for (const property of properties) {
    if (!property.computed) continue;
    const factory = computedFactories?.[property.name];
    if (!factory) {
      throw new OpenElementError(
        `[openElement] compiled property "${property.name}" is marked computed but the class ` +
          'carries no __computedFields factory for it. Rebuild the component through the ' +
          '0.44 compiler so the generated class and its Part Program agree.',
        { code: FacadeErrorCode.COMPUTED_FACTORY_MISSING, phase: 'csr' },
      );
    }
    signals[property.name] = factory(signals);
  }
  return {
    properties,
    signals,
    reflecting: null,
    pendingOwnValues: pending,
    ownPropertiesReconciled: false,
  };
}

/** Constructors whose prototype already carries the compiled accessors. */
const accessorInstalled = new WeakSet<object>();

/**
 * Install the signal-backed property accessors on the subclass prototype.
 * Runs once per constructor; instance own data properties (generated class
 * field initializers, pre-upgrade sets) shadow them until connect, where they
 * are captured into the signals and deleted.
 */
export function installAccessors(
  properties: CompiledPropertyMetadata[],
  proto: object,
  states: WeakMap<object, FacadePropertyState>,
): void {
  if (accessorInstalled.has(proto)) return;
  accessorInstalled.add(proto);
  for (const record of properties) {
    if (Object.getOwnPropertyDescriptor(proto, record.name)) continue;
    if (record.computed) {
      // Derived fields are read-only: the computed signal owns the value and
      // there is no attribute channel (the compiler enforces attribute: false
      // and reflect: false). Writes fail closed instead of silently
      // desyncing the derived value from its sources.
      Object.defineProperty(proto, record.name, {
        configurable: true,
        enumerable: true,
        get(this: FacadeElementLike): unknown {
          return states.get(this)?.signals[record.name]?.value;
        },
        set(): void {
          throw new OpenElementError(
            `[openElement] computed property "${record.name}" is read-only: it derives from ` +
              'its source signals. Assign the source properties instead.',
            { code: FacadeErrorCode.COMPUTED_READONLY, phase: 'csr' },
          );
        },
      });
      continue;
    }
    Object.defineProperty(proto, record.name, {
      configurable: true,
      enumerable: true,
      get(this: FacadeElementLike): unknown {
        return states.get(this)?.signals[record.name]?.value;
      },
      set(this: FacadeElementLike, value: unknown) {
        const state = states.get(this);
        if (!state) return;
        const sig = state.signals[record.name];
        if (!sig) return;
        const next = coercePropertyValue(record, value);
        if (Object.is(sig.value, next)) return;
        sig.value = next;
        // Post-connect reflection to the attribute, guarded against the
        // attribute -> property -> attribute loop.
        if (record.reflect && record.attribute !== null && state.kernel?.active) {
          const serialized = convertToAttribute(record, next);
          const current = this.getAttribute(record.attribute);
          if (current !== serialized) {
            state.reflecting = record.attribute;
            try {
              if (serialized === null) this.removeAttribute(record.attribute);
              else this.setAttribute(record.attribute, serialized);
            } finally {
              state.reflecting = null;
            }
          }
        }
      },
    });
  }
}

/**
 * Move generated field initializers (own data properties defined after
 * super()) into their signals. Runs once; they restate the compiled default,
 * so attributes (synced next) win over them.
 */
export function reconcileOwnProperties(
  element: FacadeElementLike,
  state: FacadePropertyState,
): void {
  if (state.ownPropertiesReconciled) return;
  state.ownPropertiesReconciled = true;
  const record = element as unknown as Record<string, unknown>;
  for (const property of state.properties) {
    if (property.computed) continue;
    const own = ownDataValue(element, property.name);
    if (!own.found) continue;
    delete record[property.name];
    state.signals[property.name].value = coercePropertyValue(property, own.value);
  }
}

/** Present attributes overwrite defaults via the compiled converters. */
export function syncAttributesToSignals(
  element: FacadeElementLike,
  state: FacadePropertyState,
): void {
  for (const record of state.properties) {
    if (record.attribute === null) continue;
    if (element.hasAttribute(record.attribute)) {
      const raw = element.getAttribute(record.attribute);
      state.signals[record.name].value = convertFromAttribute(record, raw ?? '');
    }
  }
}

/** Pre-upgrade JS property sets win over attributes; consumed once. */
export function applyPendingOwnValues(state: FacadePropertyState): void {
  const pending = state.pendingOwnValues;
  if (!pending) return;
  state.pendingOwnValues = null;
  for (const [name, value] of pending) {
    const record = state.properties.find((candidate) => candidate.name === name);
    if (record?.computed) continue;
    const sig = record ? state.signals[record.name] : undefined;
    // A pending null/undefined carries no pre-upgrade assignment intent
    // (coercePropertyValue would map it to the compiled default): letting it
    // through would clobber the attribute-promoted value at connect and
    // desync every computed field deriving from that property (#1318 — the
    // "[compiled-claim] item attribute drift" on non-default locales).
    if (value === null || value === undefined) continue;
    if (record && sig) sig.value = coercePropertyValue(record, value);
  }
}

/**
 * Route one observed attribute change into the compiled property contract:
 * convert per the compiled `converter` record and write through the accessor
 * (so reflect mirrors stay consistent); removal restores the compiled default
 * and re-mirrors it when the property reflects.
 */
export function handleCompiledAttributeChange(
  element: FacadeElementLike,
  state: FacadePropertyState,
  name: string,
  newValue: string | null,
): void {
  if (state.reflecting === name) return;
  const record = state.properties.find((candidate) => candidate.attribute === name);
  if (!record) return;
  const sig = state.signals[record.name];
  if (!sig) return;
  (element as unknown as Record<string, unknown>)[record.name] = newValue === null
    ? record.default
    : convertFromAttribute(record, newValue);
  // Real signals suppress equal-value notifications: when removal restores
  // the value the signal already holds, the accessor's short-circuit skips
  // the mirror — restore it explicitly (legacy reflect-removal contract).
  if (newValue === null && record.reflect && record.attribute !== null && state.kernel?.active) {
    const serialized = convertToAttribute(record, sig.value);
    if (serialized !== null && element.getAttribute(record.attribute) !== serialized) {
      state.reflecting = record.attribute;
      try {
        element.setAttribute(record.attribute, serialized);
      } finally {
        state.reflecting = null;
      }
    }
  }
}

/** Collect the handler names the program references on the host. */
function programHandlerNames(program: PartProgram): string[] {
  const names = new Set<string>();
  for (const part of program.parts as readonly ProgramPart[]) {
    if (part.k === 'event') {
      names.add(part.handler);
    }
  }
  return [...names];
}

/**
 * Bind every program-referenced handler to its instance method. A missing
 * method is a compile/linkage defect, so this fails closed (OE_HANDLER_MISSING).
 */
export function bindProgramHandlers(
  element: object,
  ctor: object,
  program: PartProgram,
): Record<string, (event: unknown) => void> {
  const handlers: Record<string, (event: unknown) => void> = {};
  const record = element as unknown as Record<string, unknown>;
  for (const name of programHandlerNames(program)) {
    const method = record[name];
    if (typeof method !== 'function') {
      throw new OpenElementError(
        `[openElement] <${classNameOf(ctor)}> is compiled to call handler "${name}", ` +
          'but the instance has no such method. Rebuild the component through the ' +
          '0.44 compiler so the generated class and its Part Program agree.',
        { code: FacadeErrorCode.HANDLER_MISSING, phase: 'csr' },
      );
    }
    handlers[name] = (method as (event: unknown) => void).bind(element);
  }
  return handlers;
}
