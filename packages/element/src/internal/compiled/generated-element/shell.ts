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
 * a child body emits today's legacy text for its own references. The shell runs
 * no author `onConnect`/`onDispose` callback ITSELF: the generated mount/claim
 * prologue replays the retained callbacks on the per-connection scope the shell
 * hands it, and the shell owns only the scope those callbacks register on. It
 * makes no claim about focus/selection or other platform state across the
 * disconnect window.
 *
 * ERROR BOUNDARY (`16b-EB`): the shell is the ONE owner of the author-facing
 * `onError` handler list and of the two capture points it can honestly attribute
 * to one element. The compiled setup registers a handler through the
 * compiler-private `__oe_onError` host-record property (non-enumerable, like the
 * change channel). At a capture point the shell builds
 * `{ host, signal, states, error }` and runs every handler:
 *
 * 1. the `connectedCallback` catch that already existed — the same rollback runs
 *    (unchanged), then the handler runs instead of the error escaping, leaving
 *    the element in its defined post-failure state (no projection, no listeners,
 *    region fact intact, a later reconnect retries);
 * 2. the update phase, through the `__oe_reportError` sink the generated
 *    `guardUpdate(fn, sink)` call passes for refresh subscriptions and DOM
 *    listeners — the executor's existing helper, so the subscription and the
 *    listener stay live for the next write/dispatch.
 *
 * An async REJECTION is deliberately NOT a capture point: there is no scheduler
 * and no global `unhandledrejection` listener, so a rejection is not
 * attributable to one element. With NO registered handler every capture point
 * keeps its pre-`16b-EB` behaviour exactly (rethrow and roll back at connect,
 * propagate out of the signal writer or the platform dispatch otherwise). The
 * handler list is cleared wherever the change list is cleared, so no handler
 * runs after its owner is gone. No exported symbol or type is added: both
 * channels are runtime properties on the host records the compiler already
 * builds.
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
import { CompiledContextService, contextChannelFor } from '../runtime/context.ts';
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
 * Compiler-private record key carrying the names of the declared rows whose ONLY
 * host wire is the JSON prop seed. Non-enumerable, beside the pairs, and written
 * by the same seeder that decided the payload — never re-derived by a consumer,
 * because the derivation would also claim rows the seed does not actually carry
 * (a supplied getter is deliberately not read, so it gets no seed) and that
 * difference is exactly the one that would turn a filtered pair into a lost
 * value.
 */
const GENERATED_PROP_SEED_ROWS = '__oePropSeedRows';

/**
 * The host attribute carrying the JSON seed for NON-PRIMITIVE declared rows
 * (ADR-0182 D-18c / M11-3). A non-primitive row (`array`/`object`) has no
 * attribute wire, so before this channel the server rendered the row's DEFAULT
 * while a supplied value existed only on the client — the content a visitor saw
 * and the state the component upgraded into were different facts.
 *
 * Shape: `{"<rowName>": <json value>, …}`. Only JSON-encodable rows are carried;
 * `trustedHtml` is excluded on purpose (a brand cannot be reconstructed from
 * JSON, and promoting a plain string back to it would be a raw-markup channel —
 * D-18c records that as a separate decision).
 *
 * Claim acceptance: the shell parses the payload, validates every name against
 * the descriptor's JSON-seedable rows, and writes the values BEFORE setup. An
 * unparseable payload or an unknown row fails closed through the existing
 * claim-mismatch identity rather than silently keeping the default.
 */
const GENERATED_PROP_SEED = 'data-oe-prop-seed';

/** The declared row types a JSON seed may carry (D-18c). */
const JSON_SEEDABLE_PROPERTY_TYPES: ReadonlySet<string> = new Set(['array', 'object']);

/**
 * The claim rejected the non-primitive prop seed. It shares the claim-mismatch
 * FAMILY (the markup and the declared rows disagree) but carries its own
 * identity because the cause is a wire fact, not a DOM-structure fact: a
 * consumer seeing this code should look at the seed payload, not at the tree.
 */
const PROP_SEED_MISMATCH = 'OEIR_SHELL_PROP_SEED_MISMATCH';

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

  // D-18c / M11-3: the NON-PRIMITIVE half of the same seed. A JSON-seedable row
  // that the caller supplied is serialized onto one host attribute so the claim
  // can restore it; without this the server rendered the declared default while
  // the client value existed only in memory. The row is read ONCE here, which
  // matches the attribute rows above — the supplied-getter "read per read"
  // contract is about the fold not running it eagerly and each leaf read
  // reading again, both still true.
  const propSeed: Record<string, unknown> = {};
  for (const property of properties ?? []) {
    if (!JSON_SEEDABLE_PROPERTY_TYPES.has(property.type)) continue;
    if (!Object.prototype.hasOwnProperty.call(supplied, property.name)) continue;
    // NEVER execute an accessor here. The supplied-getter contract is "read per
    // read, and only when a reader asks": a data property is safe to read once
    // for the seed, but a getter must be deferred to the content leaf, exactly
    // as the fold below does. A caller passing a getter for a non-primitive row
    // therefore gets no seed — the content still renders their value, and the
    // claim keeps the declared default, which is the pre-D-18c behaviour rather
    // than a silent double-read.
    const own = Object.getOwnPropertyDescriptor(supplied, property.name);
    if (own === undefined || !('value' in own)) continue;
    const value = own.value;
    if (value === undefined) continue;
    // JSON is the wire: a value that cannot round-trip would arrive as a
    // different fact, so refuse rather than silently degrade to the default.
    let encoded: string;
    try {
      encoded = JSON.stringify(value);
    } catch {
      throw new CompiledProgramValidationError(
        'props',
        `${UNSEEDABLE_PROPERTY}: ${property.name} is declared property-only but its supplied ` +
          'value is not JSON-encodable, so the JSON seed cannot carry it faithfully.',
      );
    }
    if (encoded === undefined) {
      throw new CompiledProgramValidationError(
        'props',
        `${UNSEEDABLE_PROPERTY}: ${property.name} is declared property-only but its supplied ` +
          `value serializes to ${String(encoded)} under JSON; the seed would not round-trip.`,
      );
    }
    propSeed[property.name] = value;
  }
  if (Object.keys(propSeed).length > 0) {
    // One host attribute, one JSON document. The attribute name is
    // compiler-owned (`data-oe-` prefix, reserved), which is also what lets the
    // claim treat it as a shell-owned slot instead of a static-seed entry.
    merged.push([GENERATED_PROP_SEED, JSON.stringify(propSeed)] as const);
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
  // The rows this seed actually carries, beside the pairs. A row with no
  // attribute channel has exactly ONE host wire — this seed — so a caller pair
  // naming it must not become text on the host tag. Only the seeder can name
  // that set honestly (it is the code that decided what the payload holds), and
  // a consumer re-deriving it from the descriptor would be a second, looser
  // rule that also dropped a row supplied through no channel at all.
  Object.defineProperty(seeded, GENERATED_PROP_SEED_ROWS, {
    value: Object.keys(propSeed),
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return seeded;
}

/**
 * Wrap a light-root producer so it receives the same seeded, resolved props a
 * shadow root's `__ssrHost` gives its template.
 *
 * `input` is what an SSR caller can supply — the host attribute pairs the
 * serializer already carries, or a plain props record. Both are folded through
 * the SAME two helpers the shadow lane uses (`seedGeneratedElementHostProperties`
 * for the attribute wire, `resolveGeneratedElementProps` for the declared
 * defaults), so a light and a shadow root cannot disagree about what a row's
 * server value is.
 */
function lightSsrProducer(
  descriptor: NormalizedDescriptor,
  producer: () => unknown,
): (input?: unknown, attributes?: readonly (readonly [string, string])[]) => unknown {
  return (input?: unknown, attributes?: readonly (readonly [string, string])[]) => {
    const supplied =
      input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : undefined;
    // The seeder is typed against the PUBLIC property row (`default`) while the
    // shell holds the NORMALIZED one (`defaultValue`); projecting between them is
    // this wrapper's job. Passing normalized rows straight through made the
    // seeder see `default: undefined` and take its boolean-presence branch for a
    // STRING row.
    const rows = descriptor.properties.map((property) => ({
      name: property.name,
      attribute: property.attribute,
      type: property.type,
      reflect: property.reflect,
      ...(property.defaultValue === undefined ? {} : { default: property.defaultValue }),
    }));
    const seeded = seedGeneratedElementHostProperties(rows, supplied, attributes);
    // Resolve to the complete server props record from the ALREADY-NORMALIZED
    // rows: `resolveGeneratedElementProps` would re-normalize a descriptor this
    // shell has already built, and its `createRecipe`/`tag` requirements are the
    // emitter's contract, not something a server render should have to restate.
    // The semantics are the resolver's: a supplied row wins (each read re-reads
    // the caller's record), an omitted one uses the declared default.
    const resolved: Record<string, unknown> = Object.create(null);
    for (const property of descriptor.properties) {
      // Read through the SEEDED record, not the caller's input: the seeder is
      // what resolves an attribute-pair source and applies the declared default,
      // and it is getter-backed so each read re-reads the caller's value (the
      // per-read contract). Reading `supplied` directly would bypass the
      // attribute channel entirely.
      const hasSeeded = Object.prototype.hasOwnProperty.call(seeded, property.name);
      Object.defineProperty(resolved, property.name, {
        enumerable: true,
        configurable: false,
        get: hasSeeded
          ? () => (seeded as Record<string, unknown>)[property.name]
          : () => materialiseDefault(property),
      });
    }
    // The seeded record's non-enumerable `__oeHostAttributes` is the canonical
    // attribute channel: the declared-attribute rows AND the JSON seed for
    // `attribute: false` rows. A light root has no `<Name>__ssrHost` wrapper to
    // return it, and its serializer (unlike the DSD producer) writes the host tag
    // itself, so the pairs must ride back to that caller. Exposed as a second
    // property on the result rather than a changed return type, so the content
    // string the shadow path and every existing caller expect is unchanged.
    const content = (producer as (props: unknown, host: undefined) => unknown).call(
      undefined,
      resolved,
      undefined,
    );
    const hostAttributes = (seeded as Record<string, unknown>)[GENERATED_HOST_ATTRIBUTES] as
      | readonly (readonly [string, string])[]
      | undefined;
    // The declared rows whose ONLY host wire is the JSON seed — the seeder's own
    // verdict, read off the record beside the pairs rather than re-derived. A row
    // with no attribute channel has exactly ONE host wire (that seed); the
    // descriptor refuses an attribute for it and `observedAttributes` never
    // observes one, so a caller pair naming it is not a second spelling of the
    // row: it is a raw value the light writer's normalizer would `String()`,
    // turning an array into `[object Object],…`. The light host writer drops such
    // a pair on both sides (the seeded list still carries the caller's verbatim
    // pair for these rows); the value reaches the claim on `data-oe-prop-seed`
    // alone. A row the seed does NOT carry stays listed nowhere and keeps its
    // bytes, so this cannot silently discard a value.
    const seedRows = ((seeded as Record<string, unknown>)[GENERATED_PROP_SEED_ROWS] ??
      []) as readonly string[];
    return { content, hostAttributes, seedRows };
  };
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

/**
 * The bounded M09-2d form mapping, in one of two shapes derived from the
 * declared rows (no shape field is invented):
 *
 * - **value shape** — `value` is the declared string row; it is the form value
 *   source and carries the required→valueMissing mirror, reset and restore.
 * - **button shape** — `value` is null (the sidecar declared no `value` row):
 *   the element stays form-associated (`form.elements` membership and the
 *   external `form=<id>` association resolve through the one internals record)
 *   but publishes no form value, makes no validity claim and never maps a
 *   reset/restore state. A declared boolean `disabled` row may reflect.
 */
interface FormMapping {
  readonly value: NormalizedProperty | null;
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
  readonly ssrProducer?: () => string;
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
  /**
   * Element-lifetime `onError` handlers (`16b-EB`). The compiled setup
   * registers through the internal `__oe_onError` runtime property on the
   * instance host record; the list is cleared with the instance at teardown so
   * a handler never runs after its owner is gone.
   *
   * An EMPTY list is the pre-`16b-EB` behaviour: every capture point rethrows
   * exactly as it did before this channel existed. The shell does not install a
   * global `window` listener, a scheduler or a retry loop — the capture points
   * are the two places that already had a `try`/`catch` or a dispatch seam
   * (connect/claim, and the `guardUpdate` wrapper around update-phase work).
   */
  readonly errorHandlers: ErrorHandler[];
  /**
   * The one update-phase reporter closure this element hands to generated
   * `guardUpdate` calls, created lazily on first read. It re-reads
   * {@linkcode errorHandlers} at dispatch time, so caching it cannot go stale:
   * a handler registered after a subscription is still honored, and a list
   * cleared by teardown makes the reporter rethrow (the unchanged behaviour).
   */
  errorReporter: ((error: unknown) => void) | null;
  /**
   * The ONE `16b-CTX` context scope of this generated element (`null` until a
   * module that uses the intrinsics asks for it). It is created by the compiled
   * setup through the compiler-private `__oe_context` channel and retained for
   * the element lifetime: the owner-scope tree, the provider intents and the
   * consumer bridges all live there, and the shell drives its connection
   * lifecycle beside the instance/connection scopes.
   */
  context: CompiledContextService | null;
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
    const required = byName.get('required');
    const disabled = byName.get('disabled');
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
    ...(descriptor.ssrProducer === undefined ? {} : { ssrProducer: descriptor.ssrProducer }),
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
    errorHandlers: [],
    errorReporter: null,
    context: null,
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
  // `16b-CTX`: a declared-row commit is this runtime's ONE provider-change
  // event. The providers re-read their value thunks and republish only what
  // actually changed, so a subscribed consumer observes the new value exactly
  // once and an unchanged write notifies nobody. No author `computed` and no
  // extra subscription channel is introduced.
  state.context?.refreshProviders();
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
 * Restore the non-primitive declared rows the SSR producer serialized into
 * {@link GENERATED_PROP_SEED} (ADR-0182 D-18c / M11-3).
 *
 * The attribute is the SHELL's slot, not an author attribute: it is written by
 * the emitted `__ssrHost` and removed here, so the same markup re-claims
 * identically (the claim's static-seed check excludes it, and an absent seed
 * leaves every row at its declared default exactly as before).
 *
 * Fail closed on anything the descriptor cannot explain: an unparseable
 * payload, a non-object, an unknown row name, or a row the descriptor does not
 * declare as JSON-seedable. Silently keeping the default would render a page
 * whose visible content and upgraded state disagree — the defect this channel
 * exists to remove — so it uses the existing claim-mismatch identity.
 */
function applyGeneratedPropSeed(element: HTMLElement, state: ElementState): void {
  // A descriptor with no JSON-seedable row can never carry this attribute, so
  // the shell must not even ASK for it: the constructor/connect path is
  // contractually attribute-read-free unless a declared row needs one.
  if (
    !state.descriptor.properties.some((property) => JSON_SEEDABLE_PROPERTY_TYPES.has(property.type))
  ) {
    return;
  }
  const raw = element.getAttribute(GENERATED_PROP_SEED);
  if (raw === null) return;
  const where = `[${GENERATED_PROP_SEED}]`;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw frameworkError(
      PROP_SEED_MISMATCH,
      `[generated-element] ${where} the prop seed is not valid JSON`,
      {
        phase: 'csr',
      },
    );
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw frameworkError(
      PROP_SEED_MISMATCH,
      `[generated-element] ${where} the prop seed must be a JSON object`,
      { phase: 'csr' },
    );
  }
  const byName = new Map(state.descriptor.properties.map((property) => [property.name, property]));
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    const property = byName.get(name);
    if (property === undefined || !JSON_SEEDABLE_PROPERTY_TYPES.has(property.type)) {
      throw frameworkError(
        PROP_SEED_MISMATCH,
        `[generated-element] ${where} the prop seed names "${name}", which is not a ` +
          'JSON-seedable declared row',
        { phase: 'csr' },
      );
    }
    writeValue(state, property, coercePropertyWrite(property, value));
  }
  // The seed is consumed once: leaving it would make a later re-claim re-apply a
  // stale value over a user's write.
  element.removeAttribute(GENERATED_PROP_SEED);
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
 * The compiler-private runtime property that registers the element-lifetime
 * `onError` handler(s) (`16b-EB`). Same posture as
 * `__oe_onPropertyChange`: a NON-enumerable property on the host records the
 * compiler-owned setup factory receives, so no exported type or symbol changes
 * and a depth-1 retained child's generated setup host can forward the channel
 * as a plain property.
 */
const ERROR_HANDLER_PROPERTY = '__oe_onError';

/**
 * The compiler-private runtime property that hands generated code its
 * update-phase error sink (`16b-EB`).
 *
 * It is a GETTER, deliberately: registration order must not matter. A depth-1
 * retained child registers its handler from `<Name>__setup`, which runs AFTER
 * the retaining reference site already built the host literals, and a module
 * whose root has no `onError` but whose child does must still guard the child's
 * refreshes.
 *
 * The getter always returns the ONE cached reporter closure for this element;
 * the closure re-reads the live handler list at DISPATCH time and rethrows the
 * original error when the list is empty. That keeps the "no handler ⇒ unchanged
 * propagation" rule true even for a refresh subscribed before its handler was
 * registered, and it is why an empty list cannot leave a stale swallowing
 * closure behind. A module with no `onError` intrinsic never reads this
 * property: its generated subscriptions stay the bare two-name
 * `bindSignalWrites` call.
 */
const ERROR_REPORT_PROPERTY = '__oe_reportError';

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

/**
 * One registered `16b-EB` error handler. Registered by the compiled setup
 * through {@linkcode ERROR_HANDLER_PROPERTY}; the shell builds the env at the
 * capture point, because only the shell knows which signal owns the failing
 * phase.
 */
type ErrorHandler = (env: {
  readonly host: HTMLElement;
  readonly signal: AbortSignal;
  readonly states: CustomStateSet;
  readonly error: unknown;
}) => void;

/**
 * The compiler-private runtime property that hands generated code its `16b-CTX`
 * context scope.
 *
 * A GETTER on the host records, deliberately: registration order must not
 * matter, and a depth-1 retained child's setup host forwards the same channel.
 * The getter returns the SAME adapter object for a given element, so repeated
 * reads cannot build a second owner chain.
 *
 * The emitted text names three calls, not the service:
 *
 * - `use(token)` — one persistent consumer-local signal.
 * - `provider(token, read)` — one owner-scope provider with a value thunk.
 * - `owner()` — a CHILD owner scope of this one. A hostless generated component
 *   (one that creates no element) calls this once in its retained setup and
 *   registers there, so it is a child of the element anchor rather than the
 *   anchor itself. Two sibling hostless children therefore cannot see each
 *   other's providers, while both still resolve the element's ancestors.
 *
 * The ROOT uses the anchor directly (no `owner()`), which is what makes a root
 * provider visible to every depth-1 child.
 */
const CONTEXT_SCOPE_PROPERTY = '__oe_context';

/**
 * One memoised adapter per `CompiledContextService`, so identity is stable.
 *
 * The adapter itself lives in the context engine (`contextChannelFor`), because
 * the SAME three-call shape backs the CLIENT anchor and the SERVER render scope:
 * one spelling in emitted code, one adapter type, and the phase decides which
 * scope is behind it. The shell only memoises nothing here — it reads the engine
 * function directly — so there cannot be two adapter definitions to drift.
 */

/**
 * Attach the `16b-CTX` context-scope channel to a host record.
 *
 * Both host records carry it (the instance record the setup factory receives and
 * the connection record the recipe receives), exactly like the change and error
 * channels, so a depth-1 retained child's generated setup host forwards the SAME
 * channel as a plain property and its `owner()` lands on the element's anchor.
 */
function withContextChannel<T extends object>(
  record: T,
  element: HTMLElement,
  state: ElementState,
): T {
  Object.defineProperty(record, CONTEXT_SCOPE_PROPERTY, {
    get: () => contextChannelFor(contextScopeFor(element, state)),
    enumerable: false,
    configurable: false,
  });
  return record;
}

/**
 * The ONE context scope of this element, created on first use.
 *
 * Its parent resolver walks the generated ANCESTOR element chain, so a nested
 * generated element's consumers resolve through its ancestors' scopes as well as
 * its own. The resolver is consulted on every connect, so a reconnect after a
 * DOM move joins the right tree and a reconnect in place re-joins the same one.
 */
function contextScopeFor(element: HTMLElement, state: ElementState): CompiledContextService {
  if (state.context !== null) return state.context;
  const scope = new CompiledContextService(element, () => nearestGeneratedContextScope(element));
  state.context = scope;
  return scope;
}

/**
 * The nearest generated ANCESTOR element's context scope, or null.
 *
 * Crosses shadow roots through `host` (a shadow root's host is a legitimately
 * generated element ancestor), skips the element itself, and stops at the
 * outermost generated element — a class-lane or foreign ancestor contributes
 * nothing, exactly like the protocol path where a non-providing ancestor is
 * silent.
 */
function nearestGeneratedContextScope(element: HTMLElement): CompiledContextService | null {
  let node: Node | null = element.parentNode;
  while (node !== null) {
    if (node instanceof HTMLElement) {
      const candidate = states.get(node);
      if (candidate?.context != null) return candidate.context;
      node = node.parentNode;
      continue;
    }
    node = node instanceof ShadowRoot ? node.host : node.parentNode;
  }
  return null;
}

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

/**
 * Attach the element-lifetime `onError` registration channel to a host record
 * (`16b-EB`). Both host records carry it, exactly like the change channel, so a
 * depth-1 retained child's generated setup host can forward the SAME channel as
 * a plain property. An element with no compiled `onError` never calls it and
 * pays one non-enumerable define per host record.
 */
function withErrorHandlerChannel<T extends object>(record: T, state: ElementState): T {
  Object.defineProperty(record, ERROR_HANDLER_PROPERTY, {
    value: (handler: ErrorHandler): void => {
      state.errorHandlers.push(handler);
    },
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return record;
}

/**
 * Attach the update-phase error sink to a host record (`16b-EB`).
 *
 * A getter, so the reader observes whatever handlers are registered when a
 * refresh is subscribed (a retained child registers from its `<Name>__setup`,
 * which runs after the parent's host literals were built). The closure is
 * cached on the state because it re-reads the handler list at dispatch time —
 * caching it cannot make it stale.
 */
function withErrorReportChannel<T extends object>(
  record: T,
  element: HTMLElement,
  state: ElementState,
): T {
  Object.defineProperty(record, ERROR_REPORT_PROPERTY, {
    get: () => (state.errorReporter ??= errorReporterFor(element, state)),
    enumerable: false,
    configurable: false,
  });
  return record;
}

/**
 * Run a captured `16b-EB` throw through one snapshot of registered handlers.
 *
 * `handlers` is passed explicitly because the CONNECT capture point must run the
 * handlers of the instance that failed AFTER that instance's rollback has
 * already cleared the live list. Every handler runs (a throwing handler must not
 * hide the others), and the FIRST handler error is rethrown in place of the
 * original: the boundary's own failure is what the page needs to see, while the
 * original value stays reachable through `env.error`.
 *
 * An EMPTY snapshot means "no boundary": the caller keeps its unchanged
 * rethrow/rollback path. This function never swallows silently.
 *
 * The env is built here: `host` is the element the failing work belongs to,
 * `signal` is the signal of the phase that threw (the per-connection scope for a
 * connect/claim failure — by dispatch time it is aborted, because rollback
 * disposed that connection; the instance-lifetime signal otherwise), and
 * `states` is a getter so the one-shot internals record is attached only for a
 * handler that reads it.
 */
function runErrorHandlers(
  element: HTMLElement,
  state: ElementState,
  signal: AbortSignal,
  error: unknown,
  handlers: readonly ErrorHandler[],
): void {
  const env = {
    host: element,
    signal,
    error,
    get states(): CustomStateSet {
      return ensureFormInternals(element, state).states;
    },
  };
  // Snapshot: a handler that registers another handler must not run it for the
  // error that was raised before its registration.
  let firstError: unknown;
  let failed = false;
  for (const handler of [...handlers]) {
    try {
      handler(env);
    } catch (handlerError) {
      if (!failed) {
        firstError = handlerError;
        failed = true;
      }
    }
  }
  if (failed) throw firstError;
}

/**
 * A shared already-aborted signal for the one case where a capture point has no
 * live scope to name: a connect-phase failure that happened BEFORE any
 * connection/instance scope existed. A handler that inspects `signal.aborted`
 * then correctly learns "there is no live connection".
 */
const NO_LIVE_SCOPE_CONTROLLER = new AbortController();
NO_LIVE_SCOPE_CONTROLLER.abort();
const NO_LIVE_SCOPE_SIGNAL = NO_LIVE_SCOPE_CONTROLLER.signal;

/**
 * The update-phase error reporter a host record exposes to generated code
 * (`16b-EB`). Generated code passes it as `guardUpdate`'s second argument.
 *
 * The reporter re-reads the LIVE handler list at DISPATCH time, not at
 * subscribe time: a handler registered later in the same setup still owns a
 * refresh subscribed earlier, and a list cleared by teardown cannot leave a
 * stale closure that silently swallows. When the list is empty the original
 * error is rethrown — that is the unchanged pre-`16b-EB` propagating behaviour.
 *
 * The signal is read at dispatch time too, so a reconnect (the instance is
 * retained) and a teardown are both reported against the right lifetime.
 */
function errorReporterFor(element: HTMLElement, state: ElementState): (error: unknown) => void {
  return (error: unknown): void => {
    const handlers = state.errorHandlers;
    if (handlers.length === 0) throw error;
    runErrorHandlers(
      element,
      state,
      state.instance?.signal ?? NO_LIVE_SCOPE_SIGNAL,
      error,
      handlers,
    );
  };
}

function hostFor(
  state: ElementState,
  element: HTMLElement,
): GeneratedElementHost<Record<string, unknown>> {
  return withContextChannel(
    withInternalsStates(
      withErrorReportChannel(
        withErrorHandlerChannel(
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
          state,
        ),
        element,
        state,
      ),
      element,
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
  return withContextChannel(
    withInternalsStates(
      withErrorReportChannel(
        withErrorHandlerChannel(
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
          state,
        ),
        element,
        state,
      ),
      element,
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
  if (form === null || form.mapping.value === null) return '';
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
  // The button shape publishes no form value: a form-associated element that
  // never calls setFormValue contributes no FormData entry.
  if (form === null || form.mapping.value === null) return;
  form.controller.setFormValue(formValueOf(state));
}

function syncFormValidity(state: ElementState): void {
  const form = state.form;
  // The button shape makes no validity claim; its form.checkValidity() is the
  // platform default (valid).
  if (form === null || form.mapping.value === null) return;
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
  if (form.mapping.value !== null && formRequiredOf(state) && formValueOf(state) === '')
    states.add('invalid');
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
  const value = form.mapping.value;
  if (value !== null && property.name === value.name) {
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
  if (form === null || form.mapping.value === null) return;
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
  if (form === null || form.mapping.value === null) return;
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
      // D-18c / M11-3: restore the non-primitive rows the server serialized.
      // This runs BEFORE the recipe so setup reads the same values the server
      // rendered with (a row supplied at SSR time would otherwise fall back to
      // its declared default on the client).
      applyGeneratedPropSeed(this, state);
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
        // `16b-CTX`: the context owner tree joins the connection before the
        // recipe is created, so the mount/claim body's consumers resolve against
        // an already-connected scope. The compiled setup has ALREADY run (above)
        // and registered this element's providers and consumer declarations —
        // `connect()` publishes those intents and bridges the consumers, which is
        // exactly the engine's own "registration then connect" order. A
        // descriptor that never touches the channel never created a scope.
        state.context?.connect();
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
        // `16b-EB` connect/claim capture point. The ROLLBACK below is the
        // pre-existing one and runs identically whether or not a boundary is
        // registered: the failed attempt's listeners, subscriptions and child
        // scopes are released, the instance pass is aborted, and a failed FIRST
        // connect destroys its instance. Only the LAST step changes — with a
        // registered handler the error is reported instead of escaping.
        //
        // The handler list is SNAPSHOT here, before the rollback clears it (a
        // failed first connect destroys its instance, and the list dies with
        // it). The env's signal is the connection scope's own signal, captured
        // before disposal: by the time the handler runs the connection is gone,
        // so `signal.aborted === true` is the honest answer, and a reconnect
        // gets a fresh scope and a fresh signal.
        const capturedHandlers = [...state.errorHandlers];
        const capturedSignal = connection?.signal ?? NO_LIVE_SCOPE_SIGNAL;
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
        const release: Array<() => void> = [
          // `16b-CTX`: a failed attempt leaves no published provider and no
          // consumer bridge behind. Disconnect (not dispose) keeps the scope and
          // its intents, so a retry republishes them on the next connect.
          () => state.context?.disconnect(),
          () => connection?.dispose(false),
        ];
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
          state.errorHandlers.length = 0;
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
        // No handler: the pre-`16b-EB` rethrow, unchanged. With a handler the
        // boundary owns the error. A handler that itself throws REPLACES the
        // original — its error is what escapes, and it is thrown from here after
        // the rollback completed, so the element is still in its defined state.
        if (capturedHandlers.length > 0) {
          runErrorHandlers(this, state, capturedSignal, error, capturedHandlers);
          return;
        }
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
      // `16b-CTX`: disconnect the context scope with the connection. Providers
      // unpublish and consumer bridges unsubscribe exactly once, so a
      // disconnected element neither answers nor observes. The scope and its
      // intents survive for the reconnect.
      captureCleanupFailures([
        () => state.context?.disconnect(),
        () => projection?.dispose(false),
        () => connection?.dispose(false),
      ]);
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
      // `16b-EB`: the boundary dies with its owner. A teardown cleanup that
      // throws after this point is NOT routed to a handler whose element is
      // being destroyed — it surfaces through the existing first-error rule,
      // exactly as before this channel existed.
      state.errorHandlers.length = 0;

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
          // `16b-CTX`: the context scope dies with the instance. Disposing it
          // drops the owner tree, the provider records and the consumer
          // bridges; a later connect creates a NEW scope, which is what
          // "dispose is not disconnect" means for context too.
          () => state.context?.dispose(),
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
        () => state.context?.dispose(),
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

  if (normalized.ssrProducer !== undefined) {
    // The light-root SSR producer rides the class the serializer already
    // resolves (`customElements.get(tag)`), so `renderToString` needs no second
    // lookup table and an unregistered light host still fails closed.
    Object.defineProperty(GeneratedElementShell, '__ssr', {
      configurable: true,
      enumerable: false,
      writable: false,
      // The compiler-emitted producer takes `(props, host)` — a light root's
      // content is a function of its declared rows, exactly like a shadow
      // root's template. The SHADOW lane gets its props from the `<Name>__ssrHost`
      // wrapper, which seeds them from the host attribute pairs. A light root has
      // no wrapper (`ssrHostExport` is null by design), so the caller of the
      // class static is the only place left to seed — and it used to call the
      // producer with NO arguments, which meant EVERY light-root component with
      // a declared row threw on `props.x` while a rowless one worked. Do the
      // seeding HERE, inside the class static, so both light call sites (root and
      // nested) get it without each having to know the mechanism.
      value: lightSsrProducer(normalized, normalized.ssrProducer),
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
