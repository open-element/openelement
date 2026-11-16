// Single-file cohesion is a deliberate trade against small-parts granularity (comply-or-explain, design-principles.md:16-19): the generated element's lifecycle — class construction, mount-vs-claim selection, attribute conversion, property reflection, the props record, dispose and reconnect — mutates one shared connection/instance state, so it is one shell; the boundary is INTERNAL COMPILER CONTRACT: a narrow descriptor plus the generated factory in, a Custom Element class out, with imports of neither facade-host.ts, runtime-program.ts, the kernel, nor the Part Program executor.
/**
 * M09-0 — the runtime shell that turns one generated leaf module into a
 * Custom Element.
 *
 * This file is an INTERNAL COMPILER CONTRACT, not author syntax and not a
 * generic program interpreter. A future M09-1 class emitter supplies a narrow
 * descriptor (tag, declared properties, the generated `create<Name>Recipe`
 * factory, optionally the setup/instance factory, and optionally the legacy
 * bindings factory); this shell only:
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
 * - disposes the projection and the per-connection scope with `dispose(false)`
 *   on disconnect (DOM retained) and adopts that retained DOM with a FRESH
 *   connection scope on reconnect, while the element-lifetime instance scope is
 *   retained (the LC-0 seam below). The top-level node range owned by the last
 *   successful mount/claim is recorded on the element state, so `dispose(true)`
 *   removes exactly that range: host-appended
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
 * Supported reconnect boundary (LC-0 descriptor-fixture retention seam): the
 * shell owns a three-tier owner tree. `instance` is one element/island-lifetime
 * `LifetimeScope`, created on the first connection and RETAINED across a
 * disconnect; `connection` is an `instance.child()` created per successful
 * connect and disposed `dispose(false)` on disconnect; the projection is the
 * existing per-mount/claim child of `connection`. FOR A DESCRIPTOR THAT
 * SUPPLIES `createInstance(owner, host)` the factory is called ONCE per element
 * on first connect (from the same call-once/retain site the legacy
 * `createBindings()` uses) and its returned bindings record is retained for the
 * element lifetime, so setup-owned signals/private state and the `propsChanged`
 * signal survive a disconnect/reconnect: the reconnect claim runs under a fresh
 * connection scope and does not repeat that factory. Setup cleanups register on
 * the instance owner and run only at explicit teardown. This is the O2
 * root-instance half of the `16b-LC` obligation, not the full §4.1d
 * reconnect-resource contract. The ROOT generated setup split is now WIRED: the
 * compiler emits one module-local `__oe_rootInstance(owner, host)` factory for
 * the root and the emitted descriptor supplies it as `createInstance`
 * (T3/`16b-LC-1`), so the generated root mount/claim alias that retained record
 * instead of re-evaluating its setup locals inside `<Name>__claim`. THIS fixture
 * still supplies the descriptor by hand (descriptor-fixture evidence, not
 * generated-path evidence; the generated-path evidence is the compiler's
 * `generated-element.root-instance.*` tests).
 *
 * DEPTH-1 NESTED RETENTION (LC-2) is wired here: the host record carries the
 * logical `instance` scope, so the generated ROOT mount/claim body can open one
 * instance pass on it and retain its DIRECT hostless children
 * (`retainChildInstance` in `runtime/instance-ledger.ts`). On a failed connect
 * the shell aborts that pass (evicting only entries created in the attempt and
 * keeping committed entries for the retry); at explicit teardown
 * (`dispose(false)`, `dispose(true)`) and at the failed-first-connect rollback
 * it releases every retained child explicitly (`releaseRetainedChildren`)
 * BEFORE destroying the instance scope, because ledger bookkeeping and the
 * structural index are a strong hold while reachable, not a GC cleanup
 * contract. Depth >= 2 retention (a retained child retaining its own children)
 * and cross-ledger transactions remain OWED and are NOT claimed by this seam;
 * a child body emits today's legacy text for its own references. The shell has
 * no author `onConnect`/`onDispose` callbacks and makes no claim about
 * focus/selection or other platform state across the disconnect window.
 *
 * Explicit teardown is `dispose(true)` on the element; it removes only the node
 * range the shell mounted or claimed and destroys the retained instance in the
 * requested mode (a plain `dispose(false)` releases the record without
 * detaching; the scope one-shot rule keeps a later `dispose(true)` from
 * upgrading it). After teardown the instance/bindings are null, so a later
 * connect creates a NEW instance and re-runs setup: dispose is not disconnect.
 * There is no public author API here: the module is not re-exported from a
 * package barrel and the descriptor is built by the compiler.
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
// The class lane's theme broadcaster: it mirrors the document's `data-theme`
// onto every connected host (and keeps it in sync), which is what makes the
// shared token sheet's `:host([data-theme])` overrides apply inside a shadow
// root. A generated host links the same sheet, so it joins the same manager.
import { themeManager } from '../../../open-element-styles.ts';
import { ElementFormController } from '../../../open-element-form.ts';
import {
  coercePropertyValue,
  convertFromAttribute,
  convertToAttribute,
  type PropertyConversionRecord,
} from '../../core/property-conversion.ts';
import { isTrustedHtmlValue, trustedHtml } from '../../core/security.ts';
import { LifetimeScope } from '../lifetime-scope.ts';
import { abortInstancePass, releaseRetainedChildren } from '../runtime/instance-ledger.ts';
import { claimRecipe, insertRecipe, type Projection, type Recipe } from '../runtime/recipe.ts';
import { CompiledProgramValidationError, removeNodes } from '../runtime/values.ts';
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

/** The attribute name a declared row observes (the compiler's one derivation). */
function hostPropertyAttribute(property: GeneratedElementProperty): string | null {
  if (property.attribute === null) return null;
  return property.attribute ?? camelToKebab(property.name);
}

/**
 * Compiler-private record key carrying the merged host-attribute pairs from the
 * generated host producer's seed. The emitted `__ssrHost` wrapper and the shell
 * share this ONE literal (like the other compiler-owned `__oe_` names); authored
 * identifiers cannot carry the prefix, so it cannot collide. Non-enumerable: the
 * content record the leaf reads keeps exactly its declared keys.
 */
const GENERATED_HOST_ATTRIBUTES = '__oeHostAttributes';

/**
 * Internal identity for a supplied primitive value that has NO SSR→claim
 * attribute channel: a `boolean false` against a presence-default `true`.
 * Rendering it would silently diverge (the server content carries `false` while
 * the claim can only re-read the presence default). The property-only
 * (`attribute: false`) primitive case stays the recorded ADR-0181 A5 boundary.
 * Fail closed with an internal `OEIR_LEAF_*` identity (no public catalogue row).
 */
const UNSEEDABLE_PROPERTY = 'OEIR_LEAF_UNSEEDABLE_PROPERTY';

/** The canonical primitive fallback for a declared row (same rule as the client). */
function primitiveRowFallback(property: GeneratedElementProperty): unknown {
  return (
    property.default ?? (property.type === 'boolean' ? false : property.type === 'number' ? 0 : '')
  );
}

/**
 * Seed the generated host producer's content props from the host's canonical
 * attribute pairs (M11 complete vertical).
 *
 * The generated element's server artifact is the emitted `<Name>__ssrHost`,
 * which must produce the SAME content the client class renders after upgrade.
 * Static/authored host attributes are standard SSR input, so the producer seeds
 * them here through the canonical compiled-property conversion
 * (`convertFromAttribute`, the same leaf the shell's own attribute channel
 * uses) plus the declared primitive default — never a server-only second
 * conversion table.
 *
 * Precedence mirrors the shell's initial state: a supplied property value (the
 * parent's in-process channel, which also travelled as a host attribute) wins
 * over the attribute wire; a primitive row supplied by neither falls back to
 * its declared default. Non-primitive rows (`array`/`object`/`trustedHtml`)
 * have no attribute channel and their generated factory default materialises
 * per CLIENT instance; this host path deliberately does not fabricate one (no
 * server->client value wire), so an unsupplied non-primitive row stays absent
 * rather than pretending a seed exists.
 *
 * Pure: the input records are never mutated.
 */
export function seedGeneratedElementHostProperties<P extends object = Record<string, unknown>>(
  properties: readonly GeneratedElementProperty[] | undefined,
  props: P | undefined,
  attributes: readonly (readonly [string, string])[] | undefined,
): Record<string, unknown> {
  const supplied = (props ?? {}) as Record<string, unknown>;
  const seeded: Record<string, unknown> = {};
  const pairs = attributes ?? [];
  for (const property of properties ?? []) {
    // A supplied property value (the parent's in-process channel, which also
    // travelled as a host attribute) wins over the attribute wire. It is
    // delegated LAZILY: the pre-M09-2b contract is that the producer fold never
    // executes a supplied getter, and that each leaf read reads it again — an
    // eager spread here would break both (see the non-primitive SSR host test).
    // A supplied `undefined` is NOT a supplied value: the canonical client
    // coercion resets it to the declared default, and this fold must produce the
    // same content (review B2). The fallback is applied lazily inside the getter
    // so the getter is still read per read, never during seeding.
    if (Object.prototype.hasOwnProperty.call(supplied, property.name)) {
      // Primitive rows carry a canonical default even when the descriptor omits
      // the literal: `true` -> false/0/'' per the client's own coercion. This is
      // the same undefined -> default rule the shell resolver and the client
      // property conversion apply; non-primitive rows keep the resolver/factory
      // boundary (no fabricated seed here).
      const primitiveFallback = PRIMITIVE_PROPERTY_TYPES.has(property.type)
        ? (property.default ??
          (property.type === 'boolean' ? false : property.type === 'number' ? 0 : ''))
        : undefined;
      Object.defineProperty(seeded, property.name, {
        enumerable: true,
        configurable: false,
        get: () => {
          const value = supplied[property.name];
          return value === undefined && primitiveFallback !== undefined ? primitiveFallback : value;
        },
      });
      continue;
    }
    const propertyType = property.type;
    if (propertyType !== 'string' && propertyType !== 'number' && propertyType !== 'boolean') {
      // No attribute form and no fabricated factory default (documented above):
      // the shell resolver still supplies the client default LAZILY, so an
      // unused non-primitive row is never materialized by this fold.
      continue;
    }
    // The seed input is the DECLARED attribute only (review B3): the compiler
    // emits the row's attribute name and the parent serializer emits attributes
    // under that name. Matching `property.name` (or a lowercased property name)
    // would be a second, invented attribute dialect the client's
    // `observedAttributes` does not observe. Wire attributes are compared
    // case-insensitively (HTML attribute names are), but the DECLARED name is
    // the only candidate.
    const attribute = hostPropertyAttribute(property);
    let matched: string | undefined;
    if (attribute !== null) {
      const wantedAttribute = attribute.toLowerCase();
      for (const [name, value] of pairs) {
        if (typeof name !== 'string' || typeof value !== 'string') continue;
        if (name.toLowerCase() === wantedAttribute) {
          matched = value;
          break;
        }
      }
    }
    if (matched !== undefined) {
      seeded[property.name] =
        propertyType === 'string'
          ? matched
          : convertFromAttribute(
              { converter: propertyType, type: propertyType, default: property.default },
              matched,
            );
      continue;
    }
    // Neither the dynamic channel nor the attribute wire supplied the row: the
    // declared primitive default is the client's initial state, so the server
    // content must start from the same value.
    if (property.default !== undefined) seeded[property.name] = property.default;
  }
  // A property the descriptor does not declare is not a content input; keep the
  // historical pass-through so a supplied extra value is still readable by the
  // leaf exactly as before, again without executing its getter eagerly.
  for (const name of Object.keys(supplied)) {
    if (Object.prototype.hasOwnProperty.call(seeded, name)) continue;
    Object.defineProperty(seeded, name, {
      enumerable: true,
      configurable: false,
      get: () => supplied[name],
    });
  }

  // M11-2 parity: project the SAME seeded record into the canonical host
  // attribute pairs the client claim re-reads. The conversion is the canonical
  // `convertToAttribute` over the descriptor row's declared type/default — never
  // a field-name guess. One read per attribute-backed declared row (a supplied
  // getter therefore runs exactly once here; leaf reads still read it again),
  // and the pair is emitted only when the serialized value differs from the
  // serialized declared default (the class lane's own host-attribute rule).
  const computed: Array<readonly [string, string]> = [];
  const computedByName = new Set<string>();
  for (const property of properties ?? []) {
    if (!PRIMITIVE_PROPERTY_TYPES.has(property.type)) continue;
    const attribute = hostPropertyAttribute(property);
    const record = { converter: property.type, type: property.type, default: property.default };
    const fallback = primitiveRowFallback(property);
    if (attribute === null) {
      // Property-only primitive: no attribute carries the value to the claim.
      // Supplied differing values stay a RECORDED boundary (ADR-0181 A5 does not
      // claim attribute:false seed parity); only the boolean presence case below
      // is provably divergent against a presence-true default and fails closed.
      continue;
    }
    const seededValue = seeded[property.name];
    const serialized = convertToAttribute(record as never, seededValue);
    const serializedFallback = convertToAttribute(record as never, fallback);
    if (serialized === null) {
      // `boolean false` has no presence form. If the declared default is the
      // presence-true boolean, the claim would restore `true`: fail closed.
      if (!Object.is(seededValue, fallback)) {
        throw new CompiledProgramValidationError(
          'hostAttributes',
          `${UNSEEDABLE_PROPERTY}: ${property.name} is a boolean whose false value cannot be ` +
            'expressed as an attribute while its declared default renders as presence-true; the ' +
            'claim would re-read the default.',
        );
      }
      continue;
    }
    if (serialized === serializedFallback) continue;
    const key = attribute.toLowerCase();
    computedByName.add(key);
    computed.push([attribute, serialized] as const);
  }
  const merged: Array<readonly [string, string]> = [];
  for (const [name, value] of pairs) {
    if (typeof name !== 'string' || typeof value !== 'string') continue;
    const key = name.toLowerCase();
    const replacement = computed.find((pair) => pair[0].toLowerCase() === key);
    if (replacement !== undefined) {
      merged.push(replacement);
      computedByName.delete(key);
      continue;
    }
    merged.push([name, value] as const);
  }
  for (const pair of computed) {
    if (!computedByName.has(pair[0].toLowerCase())) continue;
    merged.push(pair);
  }
  // A supplied prop wins over the attribute wire for CONTENT; the same precedence
  // applies to the host tag so the SSR markup and the claim seed cannot disagree.
  // No computed pair and no caller attributes keeps the historical shape (the
  // emitted wrapper then falls back to the caller attributes verbatim).
  Object.defineProperty(seeded, GENERATED_HOST_ATTRIBUTES, {
    value: merged.length === 0 ? undefined : merged,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return seeded;
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
 * Deliberately NOT exported: it is a structural detail of the descriptor's
 * `createInstance` member, not a new named consumable API. A host/test builds
 * the argument structurally; no symbol is added to the package surface.
 */
interface GeneratedElementInstanceHost<P extends object = Record<string, unknown>> {
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

/** The element surface the shell adds beyond `HTMLElement`. */
export interface GeneratedElement extends HTMLElement {
  /**
   * Explicit teardown. Detach mode (`true`, the default) removes only the node
   * range this shell mounted or claimed; it never infers ownership from the
   * current children. Plain mode (`false`) releases the projection, the
   * retained instance and the ownership record without detaching the retained
   * DOM, so a later `dispose(true)` cannot upgrade that released handle into a
   * detach. Either mode destroys the retained instance once (its setup cleanups
   * run, first error surfaced after every cleanup was attempted); a later
   * connect therefore creates a NEW instance and re-runs setup (dispose is not
   * disconnect).
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
  readonly createInstance?: (
    owner: LifetimeScope,
    host: GeneratedElementInstanceHost<Record<string, unknown>>,
  ) => Readonly<Record<string, unknown>>;
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
  /**
   * The element/island-lifetime setup scope (LC-0). Created on the first
   * connection and retained across a disconnect; owns setup-owned resources and
   * is disposed exactly once by explicit teardown. Null until the first connect
   * or after teardown/failed first connect.
   */
  instance: LifetimeScope | null;
  /**
   * The per-connection lineage scope: `instance.child()`, created on every
   * successful connect and disposed `dispose(false)` on disconnect. Owns
   * connection-scoped resources; owns no DOM.
   */
  connection: LifetimeScope | null;
  projection: Projection<Record<string, unknown>> | null;
  /**
   * Top-level nodes owned by the last successful mount/claim. Retained across
   * disconnect so a later teardown removes exactly the generated region (never
   * host-appended or borrowed DOM); cleared when ownership is released.
   */
  ownedNodes: readonly Node[] | null;
  /**
   * The retained setup record: `createInstance`'s return value (or the legacy
   * `createBindings` record). Survives disconnect; nulled by teardown/failed
   * first connect so a later connect re-runs setup on a new instance.
   */
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
  /**
   * Element-lifetime `onPropertyChange` registrations. The compiled setup
   * registers through the internal `__oe_onPropertyChange` runtime property on
   * the instance host record; the list is cleared with the instance at teardown
   * so a listener never runs after its owner is gone.
   */
  readonly propertyChangeCallbacks: PropertyChangeListener[];
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

function normalizeDescriptor(descriptor: GeneratedElementDescriptor): NormalizedDescriptor {
  const cached = normalizedByDescriptor.get(descriptor);
  if (cached !== undefined) return cached;
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

  const normalized: NormalizedDescriptor = {
    rootMode,
    delegatesFocus,
    formAssociated,
    form,
    properties,
    byAttribute,
    createRecipe: descriptor.createRecipe as NormalizedDescriptor['createRecipe'],
    ...(descriptor.createInstance === undefined
      ? {}
      : { createInstance: descriptor.createInstance as NormalizedDescriptor['createInstance'] }),
    ...(descriptor.createBindings === undefined
      ? {}
      : { createBindings: descriptor.createBindings }),
  };
  normalizedByDescriptor.set(descriptor, normalized);
  return normalized;
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
    instance: null,
    connection: null,
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
    propertyChangeCallbacks: [],
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
  notifyPropertyChange(element, state, property.name);
}

/**
 * Run the element-lifetime change listeners for one DECLARED property after its
 * value (and its reflection) is committed. The env is built here, exactly like
 * the lifecycle env: the owning element, the instance-lifetime signal and the
 * changed row. Every listener runs; the first error surfaces after the last one
 * (the existing first-error rule), and the value write itself is never rolled
 * back by a listener.
 */
function notifyPropertyChange(element: HTMLElement, state: ElementState, name: string): void {
  const listeners = state.propertyChangeCallbacks;
  if (listeners.length === 0) return;
  const signal = state.instance?.signal ?? new AbortController().signal;
  // `states` is a getter so the one-shot ElementInternals record is attached
  // only for a component that actually reads it.
  const event = {
    host: element,
    signal,
    name,
    value: state.values.get(name),
    get states(): CustomStateSet {
      return ensureFormInternals(element, state).states;
    },
  };
  let firstError: unknown;
  let failed = false;
  for (const listener of [...listeners]) {
    try {
      listener(event);
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

/**
 * The compiler-private runtime property that carries the element a connection
 * belongs to. The generated code reads it when it builds the `env` argument of
 * an `onConnect(env)` / `onDispose(env)` callback. It is attached as a
 * NON-enumerable runtime property: the exported host types
 * (`GeneratedElementHost`, `GeneratedElementInstanceHost`) are unchanged, no
 * exported symbol is added, and no host-record key enumeration changes.
 */
const HOST_ELEMENT_PROPERTY = '__oe_hostElement';

/**
 * The compiler-private runtime property that registers an element-lifetime
 * `onPropertyChange` listener. Like `__oe_hostElement` it rides the instance
 * host record as a NON-enumerable property: no exported type or symbol changes.
 */
const PROPERTY_CHANGE_PROPERTY = '__oe_onPropertyChange';

/**
 * The compiler-private runtime property that exposes the element's
 * `CustomStateSet` (`ElementInternals.states`) to a generated component's env.
 * A getter: the one-shot internals record is attached on first read, so an
 * element that never touches custom states pays nothing.
 */
const INTERNALS_STATES_PROPERTY = '__oe_states';

/** One registered change listener (the env is built by the shell). */
type PropertyChangeListener = (event: {
  readonly host: HTMLElement;
  readonly signal: AbortSignal;
  readonly states: CustomStateSet;
  readonly name: string;
  readonly value: unknown;
}) => void;

/** Attach the owning element to a host record without changing its shape. */
function withHostElement<T extends object>(record: T, element: HTMLElement): T {
  Object.defineProperty(record, HOST_ELEMENT_PROPERTY, {
    value: element,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return record;
}

/**
 * Attach the element's custom-state channel to a host record. The getter
 * attaches `ElementInternals` on first read (the record is shared with the form
 * and closed-root paths, so a second attach is impossible) and returns the
 * live `CustomStateSet`.
 */
function withInternalsStates<T extends object>(
  record: T,
  element: HTMLElement,
  state: ElementState,
): T {
  Object.defineProperty(record, INTERNALS_STATES_PROPERTY, {
    get: () => ensureFormInternals(element, state).states,
    enumerable: false,
    configurable: false,
  });
  return record;
}

/**
 * Attach the element-lifetime change-registration channel to a host record.
 * Both host records carry it (the instance record the setup factory receives
 * and the connection record the recipe receives), so a depth-1 retained child's
 * generated setup host can forward the SAME channel as a plain property.
 */
function withPropertyChangeChannel<T extends object>(record: T, state: ElementState): T {
  Object.defineProperty(record, PROPERTY_CHANGE_PROPERTY, {
    value: (listener: PropertyChangeListener): void => {
      state.propertyChangeCallbacks.push(listener);
    },
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return record;
}

function hostFor(
  state: ElementState,
  element: HTMLElement,
): GeneratedElementHost<Record<string, unknown>> {
  return withInternalsStates(
    withPropertyChangeChannel(
      withHostElement(
        {
          // `ensureInstance` publishes the retained setup record before this host is
          // built; the empty fallback keeps the contract total for a hand-built
          // descriptor that names neither factory.
          bindings: state.bindings ?? {},
          // The one logical instance (LC-2 nesting): the generated root body opens a
          // pass on it and retains direct hostless children. Omitted while no
          // instance exists (hand-built descriptor without createInstance); the
          // retention path is only emitted for a generated root, whose instance is
          // always established before this host is built.
          instance: state.instance ?? undefined,
          props: state.props,
          propsChanged: state.propsChanged,
        },
        element,
      ),
      state,
    ),
    element,
    state,
  );
}

function instanceHostFor(
  state: ElementState,
  element: HTMLElement,
): GeneratedElementInstanceHost<Record<string, unknown>> {
  return withInternalsStates(
    withPropertyChangeChannel(
      withHostElement(
        {
          props: state.props,
          propsChanged: state.propsChanged,
        },
        element,
      ),
      state,
    ),
    element,
    state,
  );
}

/**
 * Create and retain the element/island-lifetime instance scope and its setup
 * record (LC-0). Called from the first connect's call-once/retain site.
 *
 * The setup factory receives a real owner: setup-owned resources register on it
 * and are released only by explicit teardown. A throw is rolled back HERE with
 * every setup cleanup attempted (detach mode, because a failed setup never
 * attaches a region) and the ORIGINAL setup error rethrown; the fields are
 * cleared so the next connect retries setup on a fresh instance.
 */
function ensureInstance(state: ElementState, element: HTMLElement): LifetimeScope {
  const existing = state.instance;
  if (existing !== null) return existing;
  const instance = new LifetimeScope();
  try {
    const record =
      state.descriptor.createInstance !== undefined
        ? state.descriptor.createInstance(instance, instanceHostFor(state, element))
        : (state.descriptor.createBindings?.() ?? {});
    state.instance = instance;
    state.bindings = record;
    return instance;
  } catch (error) {
    try {
      instance.dispose(true);
    } catch {
      // Keep the original setup error; every cleanup was still attempted.
    }
    state.instance = null;
    state.bindings = null;
    throw error;
  }
}

/**
 * Release a FAILED connect's own state without letting a cleanup error replace
 * the original connect/claim error: every step runs, in order, errors dropped.
 */
function releaseIgnoringErrors(steps: readonly (() => void)[]): void {
  for (const step of steps) {
    try {
      step();
    } catch {
      // The original connect/claim error is what surfaces.
    }
  }
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
  if (formAuthorDisabledOf(state) || form.effectiveDisabled) {
    states.delete('enabled');
    states.add('disabled');
  } else {
    states.delete('disabled');
    states.add('enabled');
  }
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
      // Join the document-theme broadcast before any paint decision: the shared
      // component sheet carries `:root, :host` light defaults, and its dark
      // overrides key off `[data-theme]` on the host. Without the mirror a
      // generated shadow root would pin the light tokens in either theme.
      themeManager.connect(this);
      // The one-shot ElementInternals record must exist before closed-root
      // discovery; attach it before any property reconciliation so a form value
      // write during reconciliation can publish immediately. A coded failure
      // leaves no projection/DOM write.
      if (state.form !== null) attachForm(this, state);
      // Must precede createRecipe: the recipe reads host.props on creation.
      reconcilePreUpgradeProperties(this, state);
      state.connecting = true;
      // A retained instance is what makes reconnect a re-arm rather than a
      // re-setup. It is resolved inside the try so a root failure allocates no
      // instance; a failed FIRST connect is rolled back below, while a failed
      // RECONNECT keeps the retained instance (a claim failure must not destroy
      // surviving setup state).
      const hadInstance = state.instance !== null;
      let connection: LifetimeScope | null = null;
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
        const instance = ensureInstance(state, this);
        // The connection scope is created per successful connect and disposed
        // plain on disconnect; the instance above is retained across it.
        connection = instance.child();
        const recipe = normalized.createRecipe(connection, hostFor(state, this));
        // Reconnect and dispose(false) retain the region; dispose(true) marks it
        // absent and the next connect mounts even when foreign nodes remain in
        // the root. The decision is never re-derived from current childNodes.
        const projection =
          state.regionState === 'present'
            ? claimRecipe(connection, recipe, parent)
            : insertRecipe(connection, recipe, parent);
        state.connection = connection;
        state.projection = projection;
        state.ownedNodes = projection.nodes;
        state.regionState = 'present';
      } catch (error) {
        state.connection = null;
        state.projection = null;
        // A failed mount/claim aborted the root instance pass (LC-2): evict
        // exactly the entries created in this attempt and keep every
        // pre-existing retained entry (with its previous structural index) for
        // a retry. This runs before any release/disposal below; a disposal that
        // follows must not observe an open pass. Cleanup errors are dropped —
        // the original connect/claim error is what surfaces.
        if (state.instance !== null) abortInstancePass(state.instance);
        // Keep any ownership recorded by an earlier successful mount/claim: a
        // failed re-claim borrowed no new DOM and must not adopt the host's
        // children. The recipe/projection rolled back its own child scope.
        const release: Array<() => void> = [() => connection?.dispose(false)];
        if (!hadInstance && state.instance !== null) {
          // Setup was created by THIS connect and never became the retained
          // instance: dispose it in detach mode (a failed setup attaches no
          // region) and clear the record so the next connect re-runs setup on a
          // NEW instance. The cleanup chain is inner-first and its errors never
          // replace the original connect/claim error.
          const instance = state.instance;
          state.instance = null;
          state.bindings = null;
          state.propertyChangeCallbacks.length = 0;
          // Failed-first-connect rollback (LC-2): release every retained child
          // bookkeeping entry and plain-dispose its retained scope BEFORE the
          // instance is destroyed. The ledger is not a GC contract, and the
          // owner-teardown release must run while the owner is still live (a
          // cleanup observing `instance.disposed` sees false). Its errors never
          // replace the original connect/claim error.
          release.push(() => releaseRetainedChildren(instance));
          release.push(() => instance.dispose(true));
        }
        releaseIgnoringErrors(release);
        throw error;
      } finally {
        state.connecting = false;
      }
    }

    disconnectedCallback(): void {
      const state = stateOf(this);
      themeManager.disconnect(this);
      const projection = state.projection;
      const connection = state.connection;
      state.projection = null;
      state.connection = null;
      // Keep the owned node range AND the retained instance/bindings: the
      // generated DOM and setup-owned state survive the disconnect (LC-0).
      // Plain disposal releases the projection's and the connection scope's
      // resources but keeps the DOM for a later reconnect (model note §4.1d's
      // current non-detach path). The connection scope owns no DOM; dispose it
      // after the projection so a reconnect re-arms on a fresh scope. Both run,
      // and the projection's error (the first one) is what surfaces.
      captureCleanupFailures([() => projection?.dispose(false), () => connection?.dispose(false)]);
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
      const connection = state.connection;
      const instance = state.instance;
      const owned = state.ownedNodes;
      const hadOwnedRegion = projection !== null || owned !== null;
      state.projection = null;
      state.connection = null;
      state.instance = null;
      state.bindings = null;
      state.ownedNodes = null;
      // The instance is being destroyed: drop its change listeners before any
      // teardown cleanup runs, so none can observe a dying owner.
      state.propertyChangeCallbacks.length = 0;

      if (!detachOwnedNodes) {
        // Plain disposal releases the ownership record with the projection and
        // destroys the retained instance in plain mode: setup cleanups run, but
        // range cleanups are dropped, so it does not leave a retained range
        // behind for a later dispose(true) to "upgrade" into a detach. The
        // region fact stays present so a reconnect can still claim the DOM.
        // `releaseRetainedChildren` (LC-2) runs after the pre-existing steps and
        // before the instance is destroyed: `captureCleanupFailures` surfaces
        // the FIRST error, so a projection/connection teardown error still wins,
        // while a release error wins only over a later `instance.dispose` error.
        captureCleanupFailures([
          () => projection?.dispose(false),
          () => connection?.dispose(false),
          () => {
            if (instance !== null) releaseRetainedChildren(instance);
          },
          () => instance?.dispose(false),
        ]);
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
        () => connection?.dispose(false),
        // LC-2 owner teardown: release every retained child instance
        // (bookkeeping + plain-disposed retained scopes) BEFORE the instance
        // scope is destroyed, so no entry/record outlives the owner and the
        // release runs while the owner is still live. First-error precedence is
        // the `captureCleanupFailures` order above: earlier teardown errors
        // win, a release error wins only over `instance.dispose`.
        () => {
          if (instance !== null) releaseRetainedChildren(instance);
        },
        // Detach mode matches the owned-range handling above: the instance
        // itself owns setup resources, and only explicit detach teardown asks
        // its range cleanups to run (LIFO; first error surfaces after every
        // cleanup was attempted).
        () => instance?.dispose(true),
      ]);
    }
  }

  Object.defineProperty(GeneratedElementShell, 'observedAttributes', {
    configurable: true,
    value: observedAttributes,
  });

  if (normalized.delegatesFocus) {
    // The class lane's emitted static carries this platform fact; a generated
    // class exposes the same static so consumers (and the accessibility suite)
    // read the focus-delegation decision off the constructor.
    Object.defineProperty(GeneratedElementShell, 'delegatesFocus', {
      configurable: true,
      value: true,
    });
  }

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
