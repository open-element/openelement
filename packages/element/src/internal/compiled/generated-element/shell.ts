/**
 * Internal entry for the generated Custom Element class and host SSR helpers.
 *
 * Descriptor normalization and defaults are DOM-free and shared by the class
 * and SSR props resolution. The shell owns the element's retained instance,
 * its per-connect scope, and its mount or claim projection. Disconnect
 * disposes the connection while retaining the region and instance. Explicit
 * teardown releases the instance and detaches only the region it owns when
 * requested. The constructor never reads attributes or children.
 *
 * Generated code reaches the recipe runtime and the canonical property
 * conversions through this entry without pulling in the Part Program executor.
 */
import { camelToKebab } from '@openelement/protocol/forbidden-sinks';
import { frameworkError } from '@openelement/protocol/errors';
import { OpenElementBase } from '../../../open-element-base.ts';
// The class lane's theme broadcaster: it mirrors the document's `data-theme`
// onto every connected host (and keeps it in sync), which is what makes the
// shared token sheet's `:host([data-theme])` overrides apply inside a shadow
// root. A generated host links the same sheet, so it joins the same manager.
// `CompiledStyleScope` is the SAME adoption owner the class lane's kernel uses
// (S-C1.2): the generated shell installs a client-only island's declared sheets
// through it instead of inventing a second style sink.
import { CompiledStyleScope, themeManager } from '../../../open-element-styles.ts';
// The runtime-only host attribute fact (the JSON seed name included) lives in
// ONE DOM-free leaf so the hydration executor can derive its exemption from the
// same source without importing this shell module. See that leaf for the why.
import { GENERATED_PROP_SEED } from './runtime-only-host-attributes.ts';
import { GeneratedElementForm } from './form.ts';
import { convertFromAttribute, convertToAttribute } from '../../core/property-conversion.ts';
import { NESTED_HOST_PROPERTY } from '../runtime/nested-host.ts';
import type { LifetimeScope } from '../lifetime-scope.ts';
import { bindSignalWrites } from '../runtime/bindings.ts';
import { abortInstancePass, releaseRetainedChildren } from '../runtime/instance-ledger.ts';
import type { Projection } from '../runtime/recipe.ts';
import {
  adoptGeneratedClientStyles,
  captureCleanupFailures,
  finishGeneratedConnection,
  observeGeneratedRegion,
  projectGeneratedRegion,
  releaseIgnoringErrors,
  replayFirstGeneratedConnection,
  retainGeneratedInstance,
} from './driver-ownership.ts';
import { createTrackedProps, type TrackedProps } from '../runtime/props.ts';
import { CompiledProgramValidationError, removeNodes } from '../runtime/values.ts';
import { isExpandedLightRootHost } from '../runtime/claim-invariants.ts';
import { createGeneratedElementContext } from './context.ts';
import type { WritableSignal } from '../../signal/types.ts';
import {
  assertGeneratedRootOptions,
  generatedRootKind,
  resolveGeneratedElementRoot,
  SHELL_ROOT_MODE_MISMATCH,
  type ElementInternalsRecord,
  type GeneratedRootKind,
} from './root.ts';
import {
  coercePropertyWrite,
  descriptorError,
  isPrimitivePropertyType,
  materialiseDefault,
  normalizeDescriptor,
  normalizeRowlessDescriptor,
  type GeneratedElementDescriptor,
  type GeneratedElementHost,
  type GeneratedElementInstanceHost,
  type GeneratedElementProperty,
  type NormalizedDescriptor,
  type NormalizedProperty,
} from './descriptor.ts';

export { createGeneratedElementContext, GeneratedElementForm };
export {
  createDirectShadowElementClass,
  createDirectShadowElementClassWithProjection,
} from './direct-shadow.ts';
export const generatedElementLedger = { abortInstancePass, releaseRetainedChildren };

export { resolveGeneratedElementProps } from './descriptor.ts';
export type {
  GeneratedElementDescriptor,
  GeneratedElementHost,
  GeneratedElementProperty,
  GeneratedElementPropertyType,
} from './descriptor.ts';

/**
 * The emitted class and its host-level SSR wrapper share this entry. Light
 * components tree-shake the DSD serializer because they emit no host wrapper.
 */
export { serializeGeneratedElementHtml } from './dsd-ssr.ts';
export type { GeneratedElementSsrInput, GeneratedElementSsrRoot } from './dsd-ssr.ts';

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
 * Non-enumerable record of property names actually written to the JSON seed.
 * Use it when omitting forwarded attribute pairs. A supplied getter can defer a
 * value that the seed never carried, even for a seedable property.
 */
const GENERATED_PROP_SEED_ROWS = '__oePropSeedRows';

// The JSON seed host attribute ({@link GENERATED_PROP_SEED}) is the shell's own
// wire: this seeder writes it, the claim reads and removes it. Its name and the
// runtime-only attribute set it belongs to are single-sourced in the DOM-free
// `runtime-only-host-attributes.ts` leaf (imported above), which the compiled
// hydration executor also reads — so the writer and the claim exemption cannot
// drift again (C-1).

/**
 * The declared NON-PRIMITIVE row types a JSON seed may carry (D-18c). The other
 * family the same seed carries is a property-only PRIMITIVE row
 * (`attribute: null`), which joins the wire under the ADR-0181 A5 amendment;
 * see {@link isJsonPropertySeedRow}, the ONE predicate both halves read.
 */
const JSON_SEEDABLE_PROPERTY_TYPES: ReadonlySet<string> = new Set(['array', 'object']);

/**
 * The claim rejected the non-primitive prop seed. It shares the claim-mismatch
 * FAMILY (the markup and the declared rows disagree) but carries its own
 * identity because the cause is a wire fact, not a DOM-structure fact: a
 * consumer seeing this code should look at the seed payload, not at the tree.
 */
const PROP_SEED_MISMATCH = 'OEIR_SHELL_PROP_SEED_MISMATCH';

/**
 * The SSR wire cannot carry an attribute-backed false against a default of
 * true or an unencodable JSON seed. Reject either before rendering bytes
 * that would disagree with the upgraded property.
 */
const UNSEEDABLE_PROPERTY = 'OEIR_LEAF_UNSEEDABLE_PROPERTY';

/** The canonical primitive fallback for a declared row (same rule as the client). */
function primitiveRowFallback(property: GeneratedElementProperty): unknown {
  return (
    property.default ?? (property.type === 'boolean' ? false : property.type === 'number' ? 0 : '')
  );
}

/**
 * The producer and claim share the JSON seed rule. Arrays, objects and
 * property-only primitives use the seed. Attribute-backed primitives already
 * have a wire and a TrustedHtml brand cannot be reconstructed from JSON.
 */
function isJsonPropertySeedRow(property: GeneratedElementProperty): boolean {
  if (JSON_SEEDABLE_PROPERTY_TYPES.has(property.type)) return true;
  return isPrimitivePropertyType(property.type) && hostPropertyAttribute(property) === null;
}

/**
 * Resolve the SSR host props with the client's attribute conversion and
 * defaults. Supplied data values win over attributes. Unsupplied arrays and
 * objects keep lazy per-instance defaults and supplied getters stay deferred.
 *
 * Explicit JSON-seedable values are carried in the host's
 * {@link GENERATED_PROP_SEED} attribute so claim restores them before setup.
 * Attribute-backed values already use their attributes. Input records are
 * preserved.
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
      const primitiveFallback = isPrimitivePropertyType(property.type)
        ? (property.default ??
          (property.type === 'boolean' ? false : property.type === 'number' ? 0 : ''))
        : undefined;
      Object.defineProperty(seeded, property.name, {
        enumerable: true,
        configurable: false,
        get: () => {
          const value = supplied[property.name];
          if (value === undefined && primitiveFallback !== undefined) return primitiveFallback;
          // The canonical BARE-ATTRIBUTE encoding: a JSX `<host rail>` lowers to
          // `"rail": ""`, and on the wire attribute presence means true. The
          // class-lane server coercion spells this rule once
          // (`public-runtime.ts` `coerceServerProp`), and this fold is the
          // generated lane's version of the same fact — a boolean row given the
          // empty string must read `true`, or the pair below would serialize
          // `false` against a presence-true wire and fail closed as unseedable.
          if (property.type === 'boolean' && value === '') return true;
          return value;
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
  copySuppliedProperties(supplied, seeded);

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
    if (!isPrimitivePropertyType(property.type)) continue;
    const attribute = hostPropertyAttribute(property);
    const record = { converter: property.type, type: property.type, default: property.default };
    const fallback = primitiveRowFallback(property);
    if (attribute === null) {
      // Property-only primitive: no PER-ROW attribute carries the value to the
      // claim. Since the 2026-11-23 ADR-0181 A5 amendment it travels on the ONE
      // JSON seed instead ({@link isJsonPropertySeedRow}); emitting a pair here
      // as well would put one row on two wires. Only the attribute-backed
      // boolean presence case below is still provably divergent and fails
      // closed.
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

  // D-18c / M11-3, extended 2026-11-23 (ADR-0181 A5 amendment): the JSON half of
  // the same seed. A row with NO attribute wire that the caller supplied is
  // serialized onto one host attribute so the claim can restore it; without this
  // the server rendered the supplied/default split while the client value
  // existed only in memory. Two row families qualify ({@link
  // isJsonPropertySeedRow}): an `array`/`object` row (D-18c), and a PROPERTY-ONLY
  // PRIMITIVE row, whose claim used to re-read the declared default and silently
  // wipe the page root's SSR content. An attribute-backed primitive is excluded:
  // its declared attribute pair already carries it. The row is read ONCE here,
  // which matches the attribute rows above — the supplied-getter "read per read"
  // contract is about the fold not running it eagerly and each leaf read
  // reading again, both still true.
  const propSeed: Record<string, unknown> = {};
  for (const property of properties ?? []) {
    if (!isJsonPropertySeedRow(property)) continue;
    if (!Object.prototype.hasOwnProperty.call(supplied, property.name)) continue;
    // NEVER execute an accessor here. The supplied-getter contract is "read per
    // read, and only when a reader asks": a data property is safe to read once
    // for the seed, but a getter must be deferred to the content leaf, exactly
    // as the fold below does. A caller passing a getter therefore gets no seed —
    // the content still renders their value, and the claim keeps the declared
    // default, which is the pre-amendment behaviour rather than a silent
    // double-read (recorded as still-unseeded in the ADR-0181 A5 amendment).
    const own = Object.getOwnPropertyDescriptor(supplied, property.name);
    if (own === undefined || !('value' in own)) continue;
    let value = own.value;
    if (value === undefined) continue;
    // A supplied value EQUAL to the declared default still seeds. This is the
    // D-18c rule for the non-primitive family, and the reason is structural, not
    // convenience: the seed payload and `__oePropSeedRows` are decided together,
    // so a row named "the seed carries it" must actually be in the payload, and
    // the single source of "supplied" is the caller's own record — a default
    // comparison here would be a second, looser rule the claim cannot check.
    // The cost is one redundant row on the wire; the claim writes the declared
    // default it would have re-read anyway.
    // The BARE-BOOLEAN encoding must be normalized to the fact the content fold
    // renders: a supplied `""` (JSX `<host flag>`) reads `true` there (see the
    // fold above), while the claim's `Boolean('')` would restore `false`. One
    // conversion, and the wire carries the content's value.
    if (property.type === 'boolean' && value === '') value = true;
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

function copySuppliedProperties(
  supplied: Record<string, unknown>,
  seeded: Record<string, unknown>,
): void {
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
}

/** Seed a rowless shadow producer with the same lazy pass-through props. */
export function seedGeneratedElementHostPropertiesWithoutRows<
  P extends object = Record<string, unknown>,
>(
  props: P | undefined,
  attributes: readonly (readonly [string, string])[] | undefined,
): Record<string, unknown> {
  const seeded = {};
  copySuppliedProperties((props ?? {}) as Record<string, unknown>, seeded);
  const merged: Array<readonly [string, string]> = [];
  for (const [name, value] of attributes ?? []) {
    if (typeof name === 'string' && typeof value === 'string') merged.push([name, value]);
  }
  Object.defineProperty(seeded, GENERATED_HOST_ATTRIBUTES, {
    value: merged.length === 0 ? undefined : merged,
  });
  Object.defineProperty(seeded, GENERATED_PROP_SEED_ROWS, { value: [] });
  return seeded;
}

function produceLightContent(
  producer: () => unknown,
  props: Record<string, unknown>,
  nestedHost: unknown,
): unknown {
  return (producer as (props: unknown, host: unknown) => unknown).call(
    undefined,
    props,
    nestedHost === undefined ? undefined : { [NESTED_HOST_PROPERTY]: nestedHost },
  );
}

function lightSsrProducerWithoutRows(producer: () => unknown): ReturnType<typeof lightSsrProducer> {
  return (input, attributes, nestedHost) => {
    const supplied =
      input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : undefined;
    const seeded = seedGeneratedElementHostPropertiesWithoutRows(supplied, attributes);
    return {
      content: produceLightContent(producer, Object.create(null), nestedHost),
      hostAttributes: seeded[GENERATED_HOST_ATTRIBUTES],
      seedRows: seeded[GENERATED_PROP_SEED_ROWS],
    };
  };
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
): (
  input?: unknown,
  attributes?: readonly (readonly [string, string])[],
  /**
   * alpha16 nested-expansion: the render's nested-host expander. It is
   * forwarded to the emitted producer on the host record it already receives,
   * so a dash-tag element inside this host's markup can be expanded. Absent
   * means the producer's own literal bytes are the answer — the additive
   * contract.
   */
  nestedHost?: unknown,
) => unknown {
  return (
    input?: unknown,
    attributes?: readonly (readonly [string, string])[],
    nestedHost?: unknown,
  ) => {
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
    const content = produceLightContent(producer, resolved, nestedHost);
    const hostAttributes = (seeded as Record<string, unknown>)[GENERATED_HOST_ATTRIBUTES] as
      | readonly (readonly [string, string])[]
      | undefined;
    // The declared rows whose ONLY host wire is the JSON seed — the seeder's own
    // verdict, read off the record beside the pairs rather than re-derived. A row
    // with no attribute channel (a JSON-seedable non-primitive, or since the
    // 2026-11-23 ADR-0181 A5 amendment a property-only primitive) has exactly ONE
    // host wire (that seed); the descriptor refuses an attribute for it and
    // `observedAttributes` never observes one, so a caller pair naming it is not a
    // second spelling of the row: it is a raw value the light writer's normalizer
    // would `String()`, turning an array into `[object Object],…`. The light host
    // writer drops such a pair on both sides (the seeded list still carries the
    // caller's verbatim pair for these rows); the value reaches the claim on
    // `data-oe-prop-seed` alone. A row the seed does NOT carry stays listed
    // nowhere and keeps its bytes, so this cannot silently discard a value.
    const seedRows = ((seeded as Record<string, unknown>)[GENERATED_PROP_SEED_ROWS] ??
      []) as readonly string[];
    return { content, hostAttributes, seedRows };
  };
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

interface ElementState {
  readonly descriptor: NormalizedDescriptor;
  /**
   * The ONE props record (ADR-0183 D-5): the M04 tracked-props primitive. Its
   * getters read one version signal, so a read inside an effect tracks; the
   * shell keeps only its element-specific write paths and no second record.
   */
  readonly tracked: TrackedProps<Record<string, unknown>>;
  readonly props: Readonly<Record<string, unknown>>;
  /**
   * The props primitive's ONE invalidation channel, exposed under the emitted
   * ABI's existing name so generated modules need no byte change. The
   * hand-written counter that used to back this name is deleted (not aliased).
   */
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
  /** The declared props most recently delivered to the owned DOM. */
  renderedProps: Record<string, unknown> | null;
  /**
   * The retained setup record: `createInstance`'s return value (or the legacy
   * `createInstance` record). Survives disconnect; nulled by teardown/failed
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
   * The ONE element-lifetime style owner for a client-only island's declared
   * sheets (2026-11-20). It is the class lane's `CompiledStyleScope`: adoption,
   * readiness reporting and the shadow-root disconnect removal all live there,
   * so the generated lane has no second style sink. A descriptor with no
   * `styles` never connects it, so the pre-slice elements allocate it and do
   * nothing else.
   */
  readonly styleScope: CompiledStyleScope;
  /**
   * The ONE element-lifetime ElementInternals record: closed-root discovery and
   * form association share it. Null-safe until a lazy attach needs it.
   */
  readonly internalsRecord: ElementInternalsRecord;
  /** Present only for a form-associated descriptor. */
  form: GeneratedElementForm | null;
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
  /** Explicit writes before the first connection win over the server seed. */
  propSeedOverrides: Set<string> | null;
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
  context: ReturnType<typeof createGeneratedElementContext> | null;
  readonly features: GeneratedElementFeatures;
}

const states = new WeakMap<HTMLElement, ElementState>();

/**
 * Internal shell identity for a declared property the page locked with a
 * non-configurable own data property. `OEIR_` stays out of the exported
 * catalogue (M07-5 record): no `OE_` public code, no snapshot change.
 */
const PRE_UPGRADE_PROPERTY_LOCKED = 'OEIR_SHELL_PRE_UPGRADE_PROPERTY_LOCKED';
/**
 * The platform did not provide `attachInternals` (or the one-shot channel was
 * already consumed outside this shell). A form-associated generated element
 * must fail closed with this code instead of silently claiming form support it
 * does not have.
 */
const FORM_INTERNALS_UNAVAILABLE = 'OEIR_SHELL_FORM_INTERNALS_UNAVAILABLE';

function createState(
  descriptor: NormalizedDescriptor,
  features: GeneratedElementFeatures,
  properties: typeof propertyRuntime | undefined,
): ElementState {
  const initial: Record<string, unknown> = Object.create(null);
  const propSeedOverrides = properties?.initialize(descriptor, initial) ?? null;
  const tracked = createTrackedProps(initial);
  return {
    descriptor,
    tracked,
    props: tracked.props,
    propsChanged: tracked.version,
    instance: null,
    connection: null,
    projection: null,
    ownedNodes: null,
    renderedProps: null,
    bindings: null,
    root: null,
    rootKind: null,
    rootCreatedByShell: false,
    styleScope: new CompiledStyleScope(),
    internalsRecord: { internals: null },
    form: null,
    regionState: 'unobserved',
    connecting: false,
    reflecting: false,
    ownPropertiesReconciled: false,
    propSeedOverrides,
    propertyChangeCallbacks: [],
    errorHandlers: [],
    errorReporter: null,
    context: null,
    features,
  };
}

function stateOf(element: HTMLElement): ElementState {
  const state = states.get(element);
  if (state === undefined) {
    descriptorError('element has no shell state (constructed outside this module)');
  }
  return state;
}

/** Write one value through the ONE props primitive, without reflection. */
function writeValue(state: ElementState, property: NormalizedProperty, value: unknown): boolean {
  return state.tracked.set(property.name, value);
}

function rememberPropSeedOverride(state: ElementState, property: NormalizedProperty): void {
  if (isJsonPropertySeedRow(property)) state.propSeedOverrides?.add(property.name);
}

function reflectProperty(
  element: HTMLElement,
  state: ElementState,
  property: NormalizedProperty,
  value: unknown,
): void {
  if (property.attribute === null || property.conversion === undefined) return;
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
  if (reflect && property.reflect) reflectProperty(element, state, property, next);
  state.form?.syncProperty(property);
  notifyPropertyChange(element, state, property.name);
  // `16b-CTX`: a declared-row commit is this runtime's ONE provider-change
  // event. The providers re-read their value thunks and republish only what
  // actually changed, so a subscribed consumer observes the new value exactly
  // once and an unchanged write notifies nobody. No author `computed` and no
  // extra subscription channel is introduced.
  state.context?.scope.refreshProviders();
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
    value: state.tracked.read(name),
    get states(): CustomStateSet {
      return ensureElementInternals(element, state).states;
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
 * A generated class-field initializer restates the declared default; it is not
 * a pre-upgrade assignment (the old facade's `restatesDefault` contract). The
 * shell's property types are primitives, so identity is the whole comparison.
 */
function restatesDefault(property: NormalizedProperty, value: unknown): boolean {
  // Non-primitive defaults are per-owner materialisations; an own pre-upgrade
  // value is a caller write, never a restated default (no deep compare, no
  // shallow clone, identity preserved).
  if (!isPrimitivePropertyType(property.type)) return false;
  return value === property.defaultValue;
}

/**
 * Reconcile properties assigned before custom-element upgrade. A real own
 * data value takes precedence over the replayed attribute. Nullish values and
 * values that restate a primitive attribute-backed default are ignored.
 *
 * Validate all own descriptors before deleting or reflecting anything.
 * The snapshot avoids reading getters and a non-configurable property fails
 * without a partial reconciliation. Record completion after applying writes.
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
    if (value === null || value === undefined) continue;
    if (!isJsonPropertySeedRow(property) && restatesDefault(property, value)) continue;
    const next = coercePropertyWrite(property, value);
    rememberPropSeedOverride(state, property);
    setProperty(element, state, property, next, true);
  }

  // Completion is recorded last: a failed connect retries the whole check
  // instead of skipping it on the next connect.
  state.ownPropertiesReconciled = true;
}

/**
 * Restore the producer's JSON property seed before component setup. The
 * shell consumes and removes the attribute and claim excludes it from static
 * validation. Missing seeds keep defaults. Malformed payloads or rows without
 * a JSON wire fail with the coded seed mismatch.
 */
function applyGeneratedPropSeed(element: HTMLElement, state: ElementState): void {
  const overrides = state.propSeedOverrides;
  if (overrides === null) return;
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
  const writes: Array<readonly [NormalizedProperty, unknown]> = [];
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    const property = byName.get(name);
    if (property === undefined || !isJsonPropertySeedRow(property)) {
      throw frameworkError(
        PROP_SEED_MISMATCH,
        `[generated-element] ${where} the prop seed names "${name}", which is not a ` +
          'JSON-seedable declared row',
        { phase: 'csr' },
      );
    }
    // The SAME canonical write guard a property assignment goes through, so a
    // primitive row lands as its declared type (and an `array`/`object` row
    // keeps the shell's shape refusal). The one difference from a client write
    // is the channel: this write happens before setup and does not reflect
    // (these rows have no attribute to reflect to).
    const next = coercePropertyWrite(property, value);
    if (!overrides.has(name)) writes.push([property, next]);
  }
  for (const [property, value] of writes) writeValue(state, property, value);
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
  const serialized = convertToAttribute(property.conversion, state.tracked.read(property.name));
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
  if (!isPrimitivePropertyType(property.type) || property.conversion === undefined) return;
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
 * Lazy access to the cached update error reporter. A retained child can
 * register its handler after the enclosing host record has been constructed,
 * so the reporter reads the live handler list at dispatch.
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
 * The shared lazy context adapter. The root registers providers on the
 * element anchor. Each retained hostless child uses its own child owner so
 * sibling providers stay isolated while both can resolve the root's context.
 */
const CONTEXT_SCOPE_PROPERTY = '__oe_context';

/** Give both host records the same lazy adapter over the element's anchor. */
function withContextChannel<T extends object>(
  record: T,
  element: HTMLElement,
  state: ElementState,
): T {
  Object.defineProperty(record, CONTEXT_SCOPE_PROPERTY, {
    get: () => {
      const createContext = state.features.context;
      if (createContext === undefined) {
        descriptorError('the generated context channel requires context support');
      }
      return (state.context ??= createContext(element)).channel;
    },
    enumerable: false,
    configurable: false,
  });
  return record;
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
    get: () => ensureElementInternals(element, state).states,
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
 * Dispatch to a stable snapshot. Connect rollback may have already cleared
 * the live handler list. Every handler runs and the first handler error wins.
 * The environment carries the failed phase's signal and attaches internals
 * only if a handler reads states.
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
      return ensureElementInternals(element, state).states;
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
 * Resolve handlers and the instance signal at dispatch. Late registrations
 * own earlier subscriptions and clearing the handlers restores propagation.
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
  props = state.props,
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
                props,
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

function snapshotProps(state: ElementState): Record<string, unknown> {
  return Object.fromEntries(
    state.descriptor.properties.map(({ name }) => [name, state.tracked.read(name)]),
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

function ensureInstance(state: ElementState, element: HTMLElement): LifetimeScope {
  return retainGeneratedInstance(state, (instance) =>
    state.descriptor.createInstance !== undefined
      ? state.descriptor.createInstance(instance, instanceHostFor(state, element))
      : {},
  );
}

/**
 * Attach the one element-lifetime ElementInternals record, failing closed with
 * a coded error when the platform cannot provide the channel. The record is
 * shared with closed-root discovery; a second attach is impossible by
 * construction (the record is checked first and the controller caches its
 * injected result).
 */
function ensureElementInternals(element: HTMLElement, state: ElementState): ElementInternals {
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

/**
 * Retain the root before validating its options. A retry must report the
 * same mismatch and must never attach a second root or clear borrowed DOM.
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

function initializeDeclaredProperties(
  descriptor: NormalizedDescriptor,
  initial: Record<string, unknown>,
): Set<string> | null {
  for (const property of descriptor.properties) {
    initial[property.name] = materialiseDefault(property);
  }
  return descriptor.properties.some(isJsonPropertySeedRow) ? new Set() : null;
}

function installDeclaredAccessors(
  prototype: HTMLElement,
  properties: readonly NormalizedProperty[],
): void {
  for (const property of properties) {
    Object.defineProperty(prototype, property.name, {
      configurable: true,
      enumerable: false,
      get(this: HTMLElement): unknown {
        return stateOf(this).tracked.read(property.name);
      },
      set(this: HTMLElement, value: unknown): void {
        const state = stateOf(this);
        const next = coercePropertyWrite(property, value);
        rememberPropSeedOverride(state, property);
        setProperty(this, state, property, next, true);
      },
    });
  }
}

function applyDeclaredAttribute(
  element: HTMLElement,
  state: ElementState,
  name: string,
  value: string | null,
): void {
  if (state.reflecting) return;
  const property = state.descriptor.byAttribute.get(name.toLowerCase());
  if (property === undefined) return;
  applyAttribute(element, state, property, value);
}

function writeDeclaredFormValue(
  element: HTMLElement,
  state: ElementState,
  property: NormalizedProperty,
  next: string,
): void {
  setProperty(element, state, property, next, false);
  reflectProperty(element, state, property, next);
}

const propertyRuntime = {
  normalize: normalizeDescriptor,
  initialize: initializeDeclaredProperties,
  reconcile: reconcilePreUpgradeProperties,
  applySeed: applyGeneratedPropSeed,
  applyAttribute: applyDeclaredAttribute,
  install: installDeclaredAccessors,
  writeFormValue: writeDeclaredFormValue,
  lightSsr: lightSsrProducer,
};

// The emitted module forwards this token without observing the shell state
// or the adapters behind it.
declare const propertyFeatureBrand: unique symbol;
interface GeneratedElementPropertyFeature {
  readonly [propertyFeatureBrand]: true;
}

/** Runtime feature token for generated elements with declared properties. */
export const generatedElementProperties: GeneratedElementPropertyFeature =
  propertyRuntime as typeof propertyRuntime & GeneratedElementPropertyFeature;

/**
 * Build the element class for one descriptor without registering it. Exposed so
 * the M09-1 emitter can decide its registration point; consumers normally use
 * {@linkcode defineGeneratedElement}.
 */
export function createGeneratedElementClass<P extends object = Record<string, unknown>>(
  descriptor: GeneratedElementDescriptor<P>,
): GeneratedElementConstructor {
  return createGeneratedElementClassWithFeatures(descriptor, {
    form: GeneratedElementForm,
    context: createGeneratedElementContext,
    ledger: generatedElementLedger,
    properties: generatedElementProperties,
  });
}

interface GeneratedElementFeatures {
  readonly form?: typeof GeneratedElementForm;
  readonly context?: typeof createGeneratedElementContext;
  readonly ledger?: typeof generatedElementLedger;
  readonly properties?: GeneratedElementPropertyFeature;
}

/** The compiler supplies the features its emitted module needs. */
export function createGeneratedElementClassWithFeatures<P extends object = Record<string, unknown>>(
  descriptor: GeneratedElementDescriptor<P>,
  features: GeneratedElementFeatures,
): GeneratedElementConstructor {
  const Form = features.form;
  const properties = features.properties as typeof propertyRuntime | undefined;
  const normalize = properties?.normalize ?? normalizeRowlessDescriptor;
  const normalized = normalize(descriptor as GeneratedElementDescriptor);
  const formMapping = normalized.form;
  if (formMapping !== null && Form === undefined) {
    descriptorError('formAssociated requires the form-enabled class factory');
  }
  const observedAttributes = Object.freeze(
    normalized.properties
      .map((property) => property.attribute)
      .filter((attribute): attribute is string => attribute !== null),
  );

  class GeneratedElementShell extends OpenElementBase implements GeneratedElement {
    constructor() {
      super();
      const state = createState(normalized, features, properties);
      states.set(this, state);
      if (formMapping !== null && Form !== undefined) {
        state.form = new Form(this, formMapping, {
          getInternals: () => ensureElementInternals(this, state),
          getValidationRoot: () => (state.rootKind === 'light' ? null : state.root),
          readProperty: (name) => state.tracked.read(name),
          writeValue: (next) => {
            const property = formMapping.value;
            if (property === null) return;
            properties?.writeFormValue(this, state, property, next);
          },
        });
      }
      // No attribute or child inspection here (custom-element conformance).
      // Parser-created markup is seeded by the platform's observed-attribute
      // replay, which runs attributeChangedCallback before connectedCallback.
    }

    connectedCallback(): void {
      const state = stateOf(this);
      if (state.projection !== null || state.connecting) return;
      // The projected-region guard needs no connection resources and runs
      // before the shell or a recipe can observe this cross-owner claim.
      if (typeof this.hasAttribute === 'function') {
        isExpandedLightRootHost(this);
      }
      // Join the document-theme broadcast before any paint decision: the shared
      // component sheet carries `:root, :host` light defaults, and its dark
      // overrides key off `[data-theme]` on the host. Without the mirror a
      // generated shadow root would pin the light tokens in either theme.
      themeManager.connect(this);
      // The one-shot ElementInternals record must exist before closed-root
      // discovery; attach it before any property reconciliation so a form value
      // write during reconciliation can publish immediately. A coded failure
      // leaves no projection/DOM write.
      state.form?.attach();
      // Must precede createRecipe: the recipe reads host.props on creation.
      properties?.reconcile(this, state);
      // D-18c / M11-3 (extended 2026-11-23, ADR-0181 A5 amendment): restore the
      // rows only the server's JSON seed carries — the non-primitive rows, and
      // now the property-only primitives too. This runs BEFORE the recipe so
      // setup reads the same values the server rendered with (a row supplied at
      // SSR time would otherwise fall back to its declared default on the
      // client, silently wiping the server content of a page root).
      //
      // DELIBERATE PLACEMENT (C-10): this call sits OUTSIDE the `16b-EB` try
      // below, so a malformed/unknown seed throws before the boundary and its
      // rollback exist. That is the decision, not an oversight:
      //   - nothing is mounted yet (no recipe, projection or connection scope;
      //     the try's rollback can only release resources created inside it),
      //     so there is no half-applied element to roll back;
      //   - the boundary's handler list is the INSTANCE's, populated when the
      //     compiled setup runs inside the try — a first connect has no author
      //     `onError` to attribute this to, and a seed the descriptor cannot
      //     explain is a defect in the delivered markup/program contract, not
      //     element work a handler could repair or retry;
      //   - the seed is consumed once, so a claim that got past this point does
      //     not re-enter the decision on reconnect.
      // The failure therefore stays fail-closed and loud (an uncaught error
      // carrying `OEIR_SHELL_PROP_SEED_MISMATCH`), the same pre-try input-
      // validation posture as pre-upgrade reconciliation above.
      properties?.applySeed(this, state);
      state.propSeedOverrides = null;
      state.connecting = true;
      // A retained instance is what makes reconnect a re-arm rather than a
      // re-setup. It is resolved inside the try so a root failure allocates no
      // instance; a failed FIRST connect is rolled back below, while a failed
      // RECONNECT keeps the retained instance (a claim failure must not destroy
      // surviving setup state).
      const hadInstance = state.instance !== null;
      let connection: LifetimeScope | null = null;
      let retainedProps = state.renderedProps;
      let refreshProps = false;
      try {
        const parent = rootFor(this, state);
        // 2026-11-20 client style adoption: a client-only island's shadow root
        // comes into existence only now, so this is the first moment its
        // declared sheets have a target. The scope is element-lifetime and
        // idempotent; the catch below releases it on a failed connect and
        // `disconnectedCallback` removes a shadow root's adoption.
        adoptGeneratedClientStyles(
          state.styleScope,
          parent,
          this.constructor,
          state.descriptor.styles,
          state.rootKind === 'light' || state.rootCreatedByShell,
        );
        // Publish the reconciled initial value/validity/state once the root (and
        // the shared internals record used by closed discovery) is resolved.
        state.form?.syncAll();
        // Observe the first-connect DOM once, then keep the fact on the state.
        // A shell-created root starts empty (mount); an adopted root may carry
        // SSR/DSD content (claim); a light host's children are its generated
        // region. A shadow parent's light children are slotted content, so
        // they are never inspected here.
        observeGeneratedRegion(
          state,
          parent,
          state.rootKind === 'light' || !state.rootCreatedByShell,
        );
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
        state.context?.scope.connect();
        // Re-arm against the props that produced the retained DOM. The setup
        // instance and the platform accessors continue to read live props.
        const claimProps = retainedProps === null ? undefined : Object.create(null);
        if (claimProps !== undefined) {
          for (const { name } of normalized.properties) {
            Object.defineProperty(claimProps, name, {
              enumerable: true,
              get: () => (retainedProps === null ? state.props[name] : retainedProps[name]),
            });
          }
        }
        const recipe = normalized.createRecipe(connection, hostFor(state, this, claimProps));
        // Reconnect and dispose(false) retain the region; dispose(true) marks it
        // absent and the next connect mounts even when foreign nodes remain in
        // the root. The decision is never re-derived from current childNodes.
        const projection = projectGeneratedRegion(state, connection, recipe, parent);
        if (normalized.properties.length > 0) {
          // Capture delivered updates after the projection's subscriptions.
          bindSignalWrites(connection, state.propsChanged, 'generated host props', () => {
            if (state.connection === connection) state.renderedProps = snapshotProps(state);
          });
          state.renderedProps = retainedProps ?? snapshotProps(state);
          refreshProps =
            retainedProps !== null &&
            normalized.properties.some(
              ({ name }) => !Object.is(retainedProps?.[name], state.tracked.read(name)),
            );
        }
        state.connection = connection;
        state.projection = projection;
        state.ownedNodes = projection.nodes;
        state.regionState = 'present';
        // On a fresh mount the native email opt-in cannot exist before the
        // projection. Revalidate now, before replay can submit the form.
        state.form?.revalidateAfterProjection();
        // Pre-hydration replay at the SAME point the class facade does it: after
        // the region exists and its handlers are installed. A click that landed
        // before an idle generated island hydrated was captured by the
        // document-level capture the generated entry installs; replaying here is
        // what makes it reach the live tree exactly once. The chained hook IS the
        // registry's own function object, so this is one implementation, not a
        // second one.
        //
        // FIRST activation only (`!hadInstance`), which is the class facade's
        // own `!activation.resumed` rule. A reconnect disproves nothing about
        // timing, so it must not replay: it re-arms listeners over DOM that is
        // already live, and this element's own generated activation may have won
        // the race against the entry's element-runtime load, in which case the
        // reconnect IS the registry's first replay pass — a click already handled
        // by the live handler is then delivered a second time (measured: a 422
        // morph's moved island incremented one extra time). A first connect is
        // the only pass whose capture bucket is still undelivered.
        replayFirstGeneratedConnection(this, hadInstance);
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
        if (state.instance !== null) features.ledger?.abortInstancePass(state.instance);
        // Keep any ownership recorded by an earlier successful mount/claim: a
        // failed re-claim borrowed no new DOM and must not adopt the host's
        // children. The recipe/projection rolled back its own child scope.
        const release: Array<() => void> = [
          // A failed attempt must not leave a client-only island's sheets
          // adopted on a root whose connect never completed: the retry
          // re-adopts through the same element-lifetime scope.
          () => state.styleScope.disconnect(),
          // `16b-CTX`: a failed attempt leaves no published provider and no
          // consumer bridge behind. Disconnect (not dispose) keeps the scope and
          // its intents, so a retry republishes them on the next connect.
          () => state.context?.scope.disconnect(),
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
          release.push(() => features.ledger?.releaseRetainedChildren(instance));
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
        retainedProps = null;
        // Activation decision — success OR failure, the class facade's rule: this
        // element's captured records never outlive its decision. Records owned by
        // still-pending islands stay in the shared pool for their own upgrade.
        finishGeneratedConnection(this, state);
      }
      if (refreshProps && state.connection === connection)
        state.tracked.replace(snapshotProps(state));
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
        // 2026-11-20: a disconnected generated host keeps its DOM (LC-0), and a
        // client-only island's shadow root keeps its sheets the same way — the
        // scope removes them here and the reconnect adopts them again, so no
        // second copy accumulates.
        () => state.styleScope.disconnect(),
        () => state.context?.scope.disconnect(),
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
      properties?.applyAttribute(this, state, name, newValue);
    }

    /** Platform form hook: class parity no-op. */
    formAssociatedCallback(_form: HTMLFormElement | null): void {}

    /** Platform form reset hook: reset the declared value source only. */
    formResetCallback(): void {
      stateOf(this).form?.reset();
    }

    /** Platform form restore hook: only a string state is mapped onto `value`. */
    formStateRestoreCallback(restored: File | string | FormData | null, _mode: string): void {
      stateOf(this).form?.restore(restored);
    }

    /** Platform fieldset-disabled hook: effective state, separate from the author property. */
    formDisabledCallback(disabled: boolean): void {
      stateOf(this).form?.setDisabled(disabled);
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
      state.renderedProps = null;
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
          // The client-only island's style owner dies with the element: a later
          // connect after `dispose` re-runs setup and re-arms adoption from the
          // descriptor's sheets.
          () => state.styleScope.disconnect(),
          () => projection?.dispose(false),
          () => connection?.dispose(false),
          () => {
            if (instance !== null) features.ledger?.releaseRetainedChildren(instance);
          },
          () => instance?.dispose(false),
          // `16b-CTX`: the context scope dies with the instance. Disposing it
          // drops the owner tree, the provider records and the consumer
          // bridges; a later connect creates a NEW scope, which is what
          // "dispose is not disconnect" means for context too.
          () => state.context?.scope.dispose(),
        ]);
        return;
      }

      // Only a teardown that actually released an owned region makes the next
      // connect mount. A dispose(true) before any projection/claim (for example
      // on a not-yet-connected DSD host) removes nothing, so the borrowed SSR
      // content is still there and the next connect must still claim it.
      if (hadOwnedRegion) state.regionState = 'absent';
      captureCleanupFailures([
        () => state.styleScope.disconnect(),
        () => projection?.dispose(true),
        () => state.context?.scope.dispose(),
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
          if (instance !== null) features.ledger?.releaseRetainedChildren(instance);
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
  // `renderToString(constructor)` needs the descriptor's authoritative tag to
  // serialize a generated light root. The class name is compiler-minted and
  // cannot stand in for the registered custom-element name.
  Object.defineProperty(GeneratedElementShell, '__oeTag', {
    configurable: false,
    enumerable: false,
    value: descriptor.tag,
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

  properties?.install(GeneratedElementShell.prototype, normalized.properties);

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
      value:
        properties === undefined
          ? lightSsrProducerWithoutRows(normalized.ssrProducer)
          : properties.lightSsr(normalized, normalized.ssrProducer),
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
