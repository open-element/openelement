/**
 * M06b2a — generated leaf/component mount with reusable JSX values and
 * component children projection (compiler-private).
 *
 * Consumes the merged M03 `FunctionModelModule` + `ExpressionRegistry` (never
 * re-derives resolution, lowering or erasure) and emits a real JavaScript
 * module whose `mount(scope)` builds detached DOM using the M04 runtime
 * primitives: one `createRecipe` per leaf component/recipe, `insertRecipe` at
 * every insertion site, `bindSignalWrites` for tracked slots, and the canonical
 * `displayValue`/`attributeValueOf`/`assertSafeUrlAttribute` value semantics.
 * The harness inserts generated root recipes through `insertRecipe` — the one
 * insertion surface.
 *
 * S1/M06a leaf + S2 scope: intrinsic elements, fragments, multi-root, empty
 * output, static text/attributes, dynamic text and `attribute`/`boolean`/
 * `property` channel attributes with signal/computed driven refresh,
 * conditions, lists, default + detach disposal, throwing cleanups, (M06b1a-1)
 * module-level component mounts plus module-local component references
 * (`<Child prop={expr}/>`), and (M06b1a-2) reusable JSX values: one recipe per
 * direct component-local JSX initializer and one `insertRecipe` projection per
 * `{name}` slot, and (M06b2a) component children projection: `<Frame>…</Frame>`
 * passes one children fragment recipe per reference site as `props.children`, and
 * every `{props.children}` in the child mount is its own `insertRecipe`
 * projection (own child owner, instance, cleanup) of that same recipe value.
 * One component body is emitted exactly once per module:
 * `function <Name>__mount(scope, props, host)` builds a detached instance and
 * returns its nodes; the exported `create<Name>Recipe(owner, host)` factory
 * keeps its name/signature and delegates its recipe mount to it, and a
 * component reference calls the child mount directly with a fresh child scope.
 *
 * Props passed to a child are a per-read getter record over the DEFINING
 * (parent) scope (`{ get text() { return <parent read>; } }`, never cached).
 * The child refreshes a prop-dependent slot through `host.propDeps`: the root
 * factory supplies `[host.propsChanged]` (preserving the
 * `OEIR_LEAF_MISSING_VALUE: propsChanged` contract), a component-reference call
 * site supplies the parent bindings its prop expressions depend on. The child
 * instance owns a fresh child scope of the parent; the parent appends the
 * returned nodes in authored order.
 *
 * Still fails closed with a coded diagnostic (M06b2b/M07/M08 boundary): recipes
 * that are not a direct component-local JSX initializer (JSX inside an
 * arbitrary expression lowers to a `__oe_recipe_ref` placeholder that the
 * generated module cannot execute — `OEIR_LEAF_UNSUPPORTED_RECIPE`),
 * component references to unknown/external components,
 * mount cycles through component references or recipe targets
 * (`OEIR_LEAF_COMPONENT_CYCLE` / `OEIR_LEAF_RECIPE_CYCLE`; a cycle would emit
 * self-recursive mounts), component references inside list entry templates (a
 * keyed reuse would keep the first mount's props without the child update hook —
 * M06b1b), child components with no named props parameter (destructured or
 * absent) or with signal/computed resources, `class`/`style`/`innerHTML`/
 * `event`/`ref` channels (on elements and on component props), and `key` as a
 * DOM write. `key` on a component reference is consumed as list identity only
 * and is never a DOM write or a child prop.
 *
 * M06b2a children recipes: the children node list of `<Frame>…</Frame>` is
 * emitted as one `createRecipe` per reference site with the definition owner =
 * the mount scope the reference is emitted in (`source:
 * "<file>#<Parent>:children<N>"`), and the child instance receives it as a plain
 * `children` property on its props record — never a data attribute and never a
 * per-read getter. The child mount reads `__oe_props.children` ONCE, fails
 * closed with `OEIR_LEAF_MISSING_CHILDREN` when it is not a recipe (the
 * host-supplied root instance boundary; a plain value must not render nothing),
 * and projects it at each `{props.children}` site through the M06b1a-2
 * `DocumentFragment` + `insertRecipe` mechanism. The child instance scope is a
 * live descendant of the defining owner, so the M04 projection lineage admits;
 * two sites are two owners/instances/regions. A reference to a
 * children-projecting component without JSX children fails closed statically
 * with the same code; children on a reference inside a reusable recipe body are
 * refused (`OEIR_LEAF_UNSUPPORTED_CHILDREN`: the children recipe's definition
 * owner would be the per-insertion recipe instance scope), as is a
 * `{props.children}` projection inside a recipe body (`OEIR_LEAF_UNSUPPORTED_NODE`);
 * the mount graph adds the conservative projection edge
 * `c:<Child> -> r:<Definer>:<childrenRecipeId>` so a component projecting the
 * children of a reference back to itself is a refused `OEIR_LEAF_RECIPE_CYCLE`.
 *
 * M06b1a-2 reusable JSX values: one `createRecipe` per component-local direct
 * JSX initializer that at least one insertion site references, emitted inline
 * in the component chunk with its own recipe scope so lowered expressions keep
 * the A2 segments/placement ledger and refresh subscriptions bind on the recipe
 * instance. Every `{name}` slot becomes a `DocumentFragment` + `insertRecipe`
 * call on the inserting scope (component mount, condition-branch scope or
 * list-entry scope — all live descendants of the definition owner, the M04
 * lineage rule); the projection's `nodes` are spread into the enclosing sink in
 * authored order. Insertion sites inside recipe bodies are admitted because the
 * recipe scope handed to a mount is always a descendant of the same definition
 * owner; a recipe-target insertion cycle is refused before emission.
 *
 * The emitted module imports from the compiler-private runtime entry
 * `@openelement/element/internal/compiled/runtime`. That entry is not a
 * published subpath yet (the narrow ABI is a later milestone); the browser
 * harness bundles the same M04 modules under the same names, so the artifact
 * under test uses the real primitives, not stubs.
 *
 * M07a leaf claim (this file, optional `claim` on the recipe): a static leaf
 * — elements, fragments, static text, static attributes, dynamic text and
 * `attribute`/`boolean` slots — also emits `<Name>__claim`, which adopts the
 * existing children of a parent in authored order. Structural mismatch throws
 * an `OpenElementError` whose code is the internal identity
 * `OEIR_LEAF_CLAIM_MISMATCH` before any subscription. That identity is not the directory code
 * `OE_RUNTIME_STATIC_RANGE_MISMATCH`. A dynamic slot writes before it
 * subscribes, so a throw after that write is not a DOM byte rollback;
 * `claimRecipe` then `dispose(false)`s the child owner. The claim-period
 * write — the zero-dependency write and the `refresh()` that runs before
 * subscribe — skips the DOM API when the current value already equals the
 * value that would be written. Skipping that write does not skip the
 * subscription. Mount and every non-claim refresh keep the unconditional
 * write. A later signal delivery shares the claim refresh body only as an
 * implementation coupling; that is not an update-period mutation acceptance,
 * not mismatch recovery, and not SSR→claim. `property` channels omit `claim`
 * and keep mount-only output; the M08 list slice below adds the keyed list
 * claim. A condition is claimable by the M08-2
 * condition slice when its selected branches contain shapes that slice already
 * admits (text, dynamic-text pairs and attributes); a nested condition, list,
 * component reference, insertion site, children projection or property channel
 * inside a branch, and a condition under a restricted parser context, stay
 * mount-only. That slice does not widen any earlier rejection.
 *
 * M07-1 composition / repeated-insertion order (leaf scope only): a claimable
 * component reference, reusable JSX insertion or `{props.children}` projection
 * is adopted from the same authored sibling cursor the mount wrote. Each
 * insertion or children projection is its own `claimRecipe` (own owner, region
 * and node list). A claim-time recipe is created on the claim scope because
 * the mount-time definition owner has been disposed before claim; its `mount`
 * throws and is not a second mount path. Nested claims share one module cursor
 * so two sites cannot take each other's nodes. A pure static directory still
 * claims through the M07b consumer. A directory-root component (fragment roots
 * that are themselves the directory) is not claimed from inside another
 * sibling list: the directory contract requires the parent child list to be
 * exactly that directory, and this slice does not change that runtime contract.
 * This is not SSR→claim and it does not fill TSX-18 or TSX-30.
 *
 * M07b generator extension (bounded static directory): when an element's
 * children, or a fragment's children, flatten to two or more fully static
 * elements, and a claim function is emitted for that component, mount emits
 * the private range markers (spelling owned by the runtime `markers.ts`) in
 * author order and
 * `claim` calls `openStaticSiblingDirectory` / `claimStaticSiblingRange`.
 * ADR-0175 D-2: a pure-mount component (no claim function) does not emit those
 * pairs. The expected ordinals are the generator's literals. Mixed text,
 * insertion sites, and table/select/template/svg/math parents or ranges stay
 * on the existing path and do not wrap the parent. A one-child static parent
 * stays on the M07a path. Range interiors are not themselves directories. The
 * generated `activate` is `() => {}` because this directory has no binding to
 * run. A directory that admits a dynamic slot must wire `activate`; the empty
 * function must not stay in place and stand in for that claim. Keys, dynamic
 * seed, an SSR producer, and a permitted seed-state compare stay outside this
 * slice.
 *
 * M07-5 claim protocol (not an M07 exit, not a public ABI freeze): the M07a
 * walk requires the HTML namespace (`http://www.w3.org/1999/xhtml`) on the
 * claim parent, its element ancestors, and each claimed element. Static
 * attribute seed is the ordered exact set of declared static attributes,
 * compared after HTML ASCII case folding (the DOM exposes HTML attribute
 * names lowercased); dynamic slot names are not part of that seed. A directory claim still
 * reports `OE_RUNTIME_STATIC_RANGE_MISMATCH` and its existing case labels.
 *
 * M08-1a static SSR producer: a claimable, fully static component also emits
 * `<Name>__ssr()`, whose string is byte-identical to the mount DOM serialized
 * under the shared escape contract (including the marker comments a static
 * sibling directory carries). Escaping is delegated to the runtime
 * `escapeText`/`escapeAttrValue`; the compiler carries no second table.
 *
 * M08-1b dynamic SSR producer: the same producer also admits the leaf claim's
 * dynamic slot kinds — `dynamic-text`, `attribute` and `boolean` channels.
 * A component with a dynamic slot emits `<Name>__ssr(props, host)` and
 * evaluates the SAME lowering records (`record.lowered`) at request time;
 * `host.bindings[name]` is the same binding record the mount receives, and a
 * missing binding keeps the `OEIR_LEAF_MISSING_VALUE: <name>` identity. The
 * request-time rules are the mount's: `displayValue` + `escapeText` for text,
 * `attributeValueOf` + `assertSafeUrlAttribute` + `escapeAttrValue` for a
 * quoted attribute, `Boolean` for a boolean channel. SSR creates no owner,
 * scope, subscription, DOM, cleanup or `onConnect` invocation; it is one-shot
 * evaluation, not a second execution mode. A fully static component keeps the
 * M08-1a `__ssr()` shape (no parameters), so that interface is unchanged.
 * The M08-2 condition slice extends the producer to a condition whose branches
 * contain already-admitted shapes: it emits the `oe:when` start marker, the
 * selected branch chunk (ordinals restarting at 0) and the `oe:/when` end
 * marker, evaluating the test once per call. The void-element slice below
 * admits the canonical `VOID_TAGS` shape for the producer: the start tag and
 * its attributes, with no close tag and no children (authored void children are
 * the source diagnostic `OEC9013`). Component references, insertion sites,
 * children projections, `property` channels, and any condition branch shape the
 * claim slice does not admit still emit no `__ssr` (no partial producer). The
 * M08 list slice below extends this producer to the list wire.
 * Seed/resource-lifecycle semantics are not defined here.
 *
 * M08 text boundary (M08-2 slice, not an M08 exit): every dynamic text slot in
 * a claimable chunk carries one standard HTML comment pair,
 * `<!--oe:t:<n>-->TEXT?<!--oe:/t:<n>-->`, in BOTH the generated mount and the
 * generated SSR bytes. The pair is the slot identity and is value-independent;
 * an empty value is two adjacent comments. Claim consumes `start, [0..1 Text],
 * end` and performs no write while walking. Its phase-2 refresh creates the one
 * allowed slot Text lazily (empty → non-empty), keeps it on non-empty → empty
 * (`nodeValue = ""`), and registers a claim-scope range cleanup for the lazy
 * node. Equal parsed values make the phase-2 write a no-op, so an equal seed has
 * zero claim-period mutations; NUL/CR parser normalization is a recorded
 * exception, not a 0-mutation claim. Static adjacent text in one claimable
 * child list is normalized to one run (fragment-transparent), so mount/SSR/
 * claim/directory seed all see the parser's node shape; a pure-mount component
 * keeps authored granularity and emits no pair. Ordinals are chunk-local,
 * pre-order, and computed by the same pure helper for mount/claim/SSR. Text
 * that cannot be claimed in its parser context is refused with a source-located
 * `OEIR_LEAF_UNSUPPORTED_TEXT_CONTEXT` diagnostic — RCDATA/rawtext comments
 * become literal text, template content lives in `.content`, noscript depends
 * on the scripting flag, table foster-parenting moves text out of the table,
 * SVG/MathML are outside the HTML-namespace claim contract, and the select
 * family is a stated conservative slice boundary. `td`/`th` and table-level
 * `caption` reset to normal flow. This is never silently downgraded to
 * mount-only. A failed claim is also not a byte transaction: the existing
 * `dispose(false)` path releases resources but keeps borrowed DOM and any
 * phase-2 write that already happened. The marker spelling/parser lives in
 * the runtime `markers.ts`; the one-position check lives in
 * `claim-invariants.ts`; the generator contains no raw marker literal. The claim
 * cursor is `{ node }` (next node object), so a lazy insert before an already
 * consumed close marker cannot desynchronize it; no index compensation is
 * emitted.
 *
 * M08 keyed list (list slice, not an M08 exit): a list is claimable when it is
 * not inside a template, its parser context is flow, and every entry-template
 * child is a previously admitted shape (text, dynamic-text pair, element or
 * fragment); nested condition/list/composition inside an entry stays
 * mount-only. The wire is the existing `oe:each` anchor, exactly one
 * `oe:k:<token>` per entry (token from `encodeListKey`: `s:` UTF-8 lowercase
 * hex, `n:` canonical finite number, `b:0/1`), and one list-level `oe:/each`
 * end; there is no per-entry end marker. Mount writes the mount-only `oe:k:u`
 * for an unsupported runtime key; SSR throws `OEIR_LEAF_UNSUPPORTED_KEY`, and
 * claim rejects `u`. An unkeyed list keeps mount's positional identity (the
 * index is the key, encoded as `n:<index>`). Duplicate keys keep mount's
 * existing rule in every producer: the first occurrence reuses a previous entry
 * and later occurrences insert, so the wire legitimately carries the same token
 * more than once. SSR evaluates items once and each key once and emits one entry
 * per item; it never returns a half string. Claim verify walks the entries
 * read-only, asserts the end, evaluates items/keys once and applies
 * `entrySeedMismatch` before any activation: S1 unsupported client key, S2 a
 * wire token occurs more often than the client list (multiplicity exceeds),
 * S3 wire key with no client item (borrowed DOM is never deleted). The seed
 * assignment consumes the Nth occurrence of a token for the Nth wire entry of
 * that token, so duplicate entries keep distinct identities and a cross-key
 * reorder keeps each token's occurrence order stable. Activation activates
 * every seeded entry (compare-write + subscriptions), binds the list/key outer
 * reads, then runs one strict sync: matched entries rebind `item` and refresh
 * in place, missing keys insert, reorder only moves before `oe:/each`. Client
 * duplicate keys keep mount's used-set rule (first occurrence adopts, later
 * ones insert). A claimed list that is later updated to an unsupported key
 * preflights every key before any DOM write and throws the internal
 * `OEIR_LEAF_UNSUPPORTED_KEY`; no `u` marker is written into claimed DOM, the
 * previous DOM/owners/entries stay in place, and the list refresh recovers on
 * the next legal signal value. The claim is non-transactional after activation
 * starts, as the existing `dispose(false)` boundary says.
 *
 * The claim checks the PARSED tree, not the original bytes: a marker removed or
 * altered in a way the parser preserves fails closed at its checked position,
 * but an EOF truncation the HTML parser repairs into the same legal node (for
 * example `<!--oe:/each` at EOF) is indistinguishable from the producer's DOM
 * and is not detectable here. Raw-byte/transport completeness belongs to the
 * HTTP/build boundary; this slice adds no document/root sentinel and makes no
 * claim about truncation of the original bytes. The M08 target stays the
 * authored S2 Board with the condition as a sibling of the list; an
 * entry-internal condition is not required and remains mount-only.
 *
 * NOT claimed here: production wiring, a public ABI, SSR→claim parity
 * (M08-2), per-phase equivalence, claim negatives, TSX-18/TSX-30 as filled
 * matrix rows, an update-period zero-mutation acceptance, mismatch recovery,
 * signed-off focus/input preservation, and packed-consumer qualification.
 */

import ts from 'typescript';
import { unsafeStreamFrameAttribute } from '@openelement/protocol/stream-frame-policy';
import { VOID_TAGS } from '@openelement/protocol/part-program';
import type {
  FunctionExpressionRef,
  FunctionModelAttribute,
  FunctionModelChildrenProjection,
  FunctionModelComponent,
  FunctionModelComponentRef,
  FunctionModelCondition,
  FunctionModelInsertionSite,
  FunctionModelList,
  FunctionModelModule,
  FunctionModelNode,
  FunctionModelRecipe,
} from '../../semantic-core/function-frontend.ts';
import type { LoweredExpressionRecord } from '../../semantic-core/expression-registry.ts';
import type { BindingId } from '../../semantic-core/scope-resolution.ts';
import type { IrDiagnostic, IrSpan } from '../types.ts';
import {
  SourceMapSegmentBuilder,
  type CompiledElementSourceMap,
  type EmissionSegment,
} from '../../semantic-core/source-map.ts';

/** Compiler-private runtime entry the emitted module imports from. */
export const GENERATED_LEAF_RUNTIME_SPECIFIER = '@openelement/element/internal/compiled/runtime';

const RUNTIME_IMPORTS = [
  'assertSafeUrlAttribute',
  'attributeValueOf',
  'bindSignalWrites',
  'createRecipe',
  'displayValue',
  'insertRecipe',
  'removeNodes',
] as const;

/**
 * Runtime symbols a generated module imports only when it uses them. The
 * predicate reads the emitted body, so a new emission site cannot forget to
 * register its import (the symbol is named in the call it emits).
 */
const OPTIONAL_RUNTIME_IMPORTS: readonly {
  readonly symbol: string;
  readonly predicate: (body: string, usesClaimRecipe: boolean, usesDirectory: boolean) => boolean;
}[] = [
  { symbol: 'claimRecipe', predicate: (_body, usesClaimRecipe) => usesClaimRecipe },
  { symbol: 'leafClaimMismatch', predicate: (body) => body.includes('leafClaimMismatch(') },
  {
    symbol: 'assertElementInHtmlNamespace',
    predicate: (body) => body.includes('assertElementInHtmlNamespace('),
  },
  {
    symbol: 'assertStaticAttributeSeed',
    predicate: (body) => body.includes('assertStaticAttributeSeed('),
  },
  { symbol: 'emitComment', predicate: (body) => body.includes('emitComment(') },
  { symbol: 'escapeAttrValue', predicate: (body) => body.includes('escapeAttrValue(') },
  { symbol: 'escapeText', predicate: (body) => body.includes('escapeText(') },
  { symbol: 'rangeMarker', predicate: (body) => body.includes('rangeMarker(') },
  { symbol: 'MARKERS', predicate: (body) => body.includes('MARKERS.') },
  { symbol: 'markerText', predicate: (body) => body.includes('markerText(') },
  {
    symbol: 'assertTextSlotMarker',
    predicate: (body) => body.includes('assertTextSlotMarker('),
  },
  {
    symbol: 'textSlotMarker',
    predicate: (body) => body.includes('textSlotMarker('),
  },
  {
    symbol: 'assertWhenAnchor',
    predicate: (body) => body.includes('assertWhenAnchor('),
  },
  {
    symbol: 'assertWhenEndMarker',
    predicate: (body) => body.includes('assertWhenEndMarker('),
  },
  {
    symbol: 'isWhenEndMarker',
    predicate: (body) => body.includes('isWhenEndMarker('),
  },
  {
    symbol: 'assertEachAnchor',
    predicate: (body) => body.includes('assertEachAnchor('),
  },
  {
    symbol: 'assertEachEndMarker',
    predicate: (body) => body.includes('assertEachEndMarker('),
  },
  {
    symbol: 'parseEntryKeyMarker',
    predicate: (body) => body.includes('parseEntryKeyMarker('),
  },
  {
    symbol: 'readEntryKeyMarker',
    predicate: (body) => body.includes('readEntryKeyMarker('),
  },
  {
    symbol: 'entrySeedMismatch',
    predicate: (body) => body.includes('entrySeedMismatch('),
  },
  {
    symbol: 'entryKeyMarker',
    predicate: (body) => body.includes('entryKeyMarker('),
  },
  {
    symbol: 'encodeListKey',
    predicate: (body) => body.includes('encodeListKey('),
  },
  {
    symbol: 'tryEncodeListKey',
    predicate: (body) => body.includes('tryEncodeListKey('),
  },
  {
    symbol: 'runUntracked',
    predicate: (body) => body.includes('runUntracked('),
  },
  {
    symbol: 'claimStaticSiblingRange',
    predicate: (_body, _usesClaimRecipe, usesDirectory) => usesDirectory,
  },
  {
    symbol: 'openStaticSiblingDirectory',
    predicate: (_body, _usesClaimRecipe, usesDirectory) => usesDirectory,
  },
];

const INTERNAL_PREFIX = '__oe_';
/**
 * The M02 marked-printer placeholder for a JSX value lowered inside an
 * expression (`__oe_recipe_ref("id")`). The function model keeps the recipe
 * identity for the M02 §recipe model, but the generated leaf module can only
 * execute recipes created by a direct component-local JSX initializer, so any
 * lowered record carrying this placeholder fails closed.
 */
const RECIPE_REFERENCE_CALLEE = '__oe_recipe_ref';
/**
 * Module-level component mount (M06b1a-1): `<Name>__mount(scope, props, host)`.
 * The mount builds one detached instance and returns its top-level nodes; both
 * the exported root factory and every component-reference call site delegate to
 * it, so one component body is emitted exactly once per module.
 */
const MOUNT_SUFFIX = '__mount';
/** Fixed module-level mount parameters; they define the emitted host record shape. */
const MOUNT_SCOPE = `${INTERNAL_PREFIX}scope`;
const MOUNT_PROPS = `${INTERNAL_PREFIX}props`;
const MOUNT_HOST = `${INTERNAL_PREFIX}host`;
/**
 * Module-level claim (M07a): `<Name>__claim(scope, props, host, parent)` adopts
 * the existing children of `parent`. Emitted only for the static leaf shape.
 */
const CLAIM_SUFFIX = '__claim';
/** Static SSR producer (M08-1a): `<Name>__ssr()` returns the mount HTML. */
const SSR_SUFFIX = '__ssr';
/**
 * M08 composition SSR: the third parameter of the module-local
 * `__oe_ssrComponent_<Component>` helper. It renders the children recipe a
 * `<Frame>…</Frame>` reference passed, once per `{props.children}` projection.
 * The exported `<Name>__ssr(props, host)` wrapper passes null, so a root
 * instance of a children-projecting component still fails closed.
 */
const SSR_CHILDREN_RENDER = `${INTERNAL_PREFIX}renderChildren`;
/** Module-local helper name prefix for a composition component (`__oe_ssrComponent_<Name>`). */
const SSR_HELPER_PREFIX = `${INTERNAL_PREFIX}ssrComponent_`;
const CLAIM_PARENT = `${INTERNAL_PREFIX}parent`;
/**
 * Module-level activation queue for the shared-cursor claim path (M08-2 B2).
 * The cursor owner initializes it, nested component/recipe claims append to it,
 * and the owner captures it in `try`, clears it in `finally`, then drains the
 * captured local after the whole enclosing structure validated. A verify throw
 * therefore leaves no module-level queue behind.
 */
const CLAIM_ACTIVATION = `${INTERNAL_PREFIX}claimPhase2`;
/**
 * The module-level mount's host record: the parent-provided host bindings plus
 * the defining-scope signals a child instance refreshes props reads through.
 * The root factory supplies `[host.propsChanged]`; a component-reference call
 * site supplies the parent bindings its prop expressions depend on.
 */
const MOUNT_DEP_LOOP = `${INTERNAL_PREFIX}propDep`;
const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const TAG_PATTERN = /^[a-z][a-z0-9-]*$/;
const ATTRIBUTE_PATTERN = /^[A-Za-z_:][A-Za-z0-9_:.-]*$/;
const ADMITTED_ATTRIBUTE_CHANNELS: ReadonlySet<string> = new Set([
  'attribute',
  'boolean',
  'property',
]);
/** Attributes the compiler consumes as identity (never a DOM write). */
const CONSUMED_ATTRIBUTE_CHANNELS: ReadonlySet<string> = new Set(['key']);
/**
 * Table, select, template, svg, and math parsing contexts. A directory is not
 * emitted under or around these tags. ASCII lowercase, matching intrinsic tags
 * the generator already admits. This is not a new content model.
 */
const DIRECTORY_EXCLUDED_TAGS: ReadonlySet<string> = new Set([
  'table',
  'caption',
  'colgroup',
  'col',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'select',
  'optgroup',
  'option',
  'template',
  'svg',
  'math',
]);

/**
 * Parser contexts that cannot carry the generated text boundary. The split is
 * by actual parser behavior, not by a sticky ancestor:
 *
 * - RCDATA (`textarea`, `title`) and rawtext turn `<!--...-->` into literal
 *   text.
 * - `<template>` puts its children in `.content`, not `childNodes`.
 * - `<noscript>` parsing depends on the scripting flag, so the claim cannot
 *   assume the comment is a stable Comment node.
 * - The table family keeps comments in the table, but foster-parents
 *   non-whitespace text. `td`/`th` (and `caption`) are normal flow content and
 *   reset the context.
 * - Foreign content (SVG/MathML) exposes comments as nodes, but the existing
 *   generated claim is HTML-namespace-only, so it cannot claim those elements.
 * - The select family is kept as a conservative slice boundary; its insertion
 *   mode is not part of this slice's qualified contract.
 *
 * A dynamic-text slot under one of these cannot carry the boundary pair; the
 * generator refuses the component with a source-located diagnostic instead of
 * silently falling back to mount-only output. Static non-whitespace text in a
 * foster-parenting context is refused for the same reason.
 */
const TEXT_RCDATA_TAGS: ReadonlySet<string> = new Set(['textarea', 'title']);

const TEXT_RAWTEXT_TAGS: ReadonlySet<string> = new Set([
  'script',
  'style',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
  'plaintext',
]);

const TEXT_FOREIGN_TAGS: ReadonlySet<string> = new Set(['svg', 'math']);

/** Table-family tags whose non-whitespace text is foster-parented. */
const TEXT_FOSTER_TAGS: ReadonlySet<string> = new Set([
  'table',
  'colgroup',
  'col',
  'thead',
  'tbody',
  'tfoot',
  'tr',
]);

/** Cell/caption boundaries are normal flow content. */
const TEXT_TABLE_FLOW_TAGS: ReadonlySet<string> = new Set(['td', 'th', 'caption']);

const TEXT_SELECT_TAGS: ReadonlySet<string> = new Set(['select', 'optgroup', 'option']);

/** HTML "space characters": tab, LF, FF, CR, space (not JS `trim` whitespace). */
const HTML_WHITESPACE_ONLY = /^[\t\n\f\r ]*$/;

/** One lowered-expression placement in the emitted module (compiler-private). */
export interface ExpressionPlacement {
  readonly exprId: string;
  /** 1-based generated line where the lowered text starts. */
  readonly generatedLine: number;
  /** 0-based generated column where the lowered text starts. */
  readonly generatedColumn: number;
  /** 1-based authored line of the expression. */
  readonly authoredLine: number;
  /** 0-based authored column of the expression start. */
  readonly authoredColumn: number;
}

export interface GeneratedLeafModule {
  /** Emitted ESM module; `null` when any diagnostic was emitted (fail closed). */
  readonly module: string | null;
  /**
   * End-to-end Source Map v3 for the emitted module (M05b). `null` unless the
   * caller supplies the authored source text (required for `sourcesContent`).
   */
  readonly sourceMap: CompiledElementSourceMap | null;
  /** Placement ledger for every lowered expression in the emitted module. */
  readonly placements: readonly ExpressionPlacement[];
  /** Host `bindings` names the module reads (signals/computeds/functions). */
  readonly requiredBindings: readonly string[];
  /** Host `props` names the module reads. */
  readonly requiredProps: readonly string[];
  /** True when the module subscribes to `host.propsChanged` (tracked props). */
  readonly requiresPropsChanged: boolean;
  readonly diagnostics: readonly IrDiagnostic[];
}

interface EmitState {
  readonly component: FunctionModelComponent;
  readonly lines: string[];
  /**
   * Physical generated lines emitted so far in this chunk. `lines` holds one
   * array element per statement, but a multi-line lowered expression is ONE
   * element containing real newlines; line numbers must count those, or every
   * placement after it drifts by the embedded-newline count.
   */
  physicalLine: number;
  indent: number;
  readonly diagnostics: IrDiagnostic[];
  readonly requiredBindings: Set<string>;
  readonly requiredProps: Set<string>;
  readonly hostBindings: Set<string>;
  readonly localResources: Set<string>;
  counter: { value: number };
  readonly propsName: string | null;
  requiresPropsChanged: boolean;
  /** Source Map v3 segments for this component, in module-local line numbers. */
  readonly segments: EmissionSegment[];
  readonly placements: ExpressionPlacement[];
  /** Dedupe generated positions (a consumer must not see ambiguous duplicates). */
  readonly segmentKeys: Set<string>;
  /** The scope variable in the current generated closure (`__oe_scope` by default). */
  scopeVar: string;
  /** The host-record parameter of the module-level mount (`__oe_host`). */
  readonly hostVar: string;
  /** Module component table: component references resolve against it. */
  readonly componentByName: ReadonlyMap<string, FunctionModelComponent>;
  /**
   * Recipe ids declared by a direct component-local JSX initializer (the model
   * `resource.recipeId` link). An insertion site may only target one of these;
   * a recipe created inside an arbitrary expression is never an insertion site.
   */
  readonly declaredRecipeIds: ReadonlySet<string>;
  /**
   * Component-local names bound to a reusable JSX value. Such a name is not a
   * readable value: it may only appear as a `{name}` JSX child (insertion
   * site), never inside an expression.
   */
  readonly recipeNames: ReadonlySet<string>;
  /** Recipe id → generated recipe variable for the component being emitted. */
  readonly recipeVars: Map<string, string>;
  /** Entry-mapper names bound in the current generated builder (not host bindings). */
  readonly entryNames: Set<string>;
  /** Refresh-function collectors for the enclosing list-entry builder (if any). */
  readonly refreshStack: string[][];
  /**
   * Number of enclosing list-entry templates. A component reference inside one
   * is refused: a keyed reuse re-assigns the mapper parameter but the child
   * instance has no update hook to re-read its props (M06b1b).
   */
  listDepth: number;
  /**
   * Number of enclosing reusable-recipe mount bodies being emitted (M06b2a). A
   * children recipe or a children projection inside one is refused: the recipe
   * instance scope exists per insertion, so the child/children recipe's
   * definition-owner story is not established by this slice.
   */
  recipeDepth: number;
  /**
   * The component mount's one `__oe_props.children` read (M06b2a), or `null` when
   * the component projects no children. Emitted before the roots so the nested
   * branch/entry builders emitted inside the mount close over one value; every
   * projection site inserts through this same recipe.
   */
  childrenRecipeVar: string | null;
  /**
   * M08 composition SSR: recipe id → the module-local render function emitted
   * inside this component's SSR body. One function per referenced recipe, so
   * the same recipe inserted twice calls one function twice. Empty outside
   * composition SSR.
   */
  readonly ssrRecipeVars: Map<string, string>;
  /**
   * M08 composition SSR: the `props.children` renderer parameter of a
   * children-projecting component, or null when this component projects no
   * children. The exported `<Name>__ssr` wrapper supplies null; a component
   * reference supplies the render function of the children recipe it passes.
   */
  ssrChildrenRenderVar: string | null;
  /** `file#Component` label passed to a static sibling directory. */
  directorySource: string;
  /**
   * True once this emitted chunk calls `openStaticSiblingDirectory` (the
   * generated claim). The module header imports the directory consumer only
   * when at least one component chunk needs it; mount emission alone does not.
   */
  usesStaticSiblingDirectoryConsumer: boolean;
  /**
   * M07-1: claim walks `__oe_claimCursor` so a nested recipe or component claim
   * continues the parent sibling list instead of restarting at `parent.childNodes`.
   * Static-only claims leave this false and keep the M07a local cursor.
   */
  claimCursorShared: boolean;
  /** Runtime array that collects adopted root nodes, or null for the M07a static return. */
  claimAdoptedVar: string | null;
  /**
   * M08-2 B2: the generated activation-queue variable for the claim being
   * emitted, or null when phase-2 work is emitted inline. Only the shared
   * cursor path queues: its per-element blocks cannot be flushed until the
   * enclosing cursor owner has validated its final structure.
   */
  claimActivationVar: string | null;
  /** True once this claim chunk calls `claimRecipe`. */
  usesClaimRecipe: boolean;
  /**
   * ADR-0175 D-2. Mount emits range markers only when this component emits a
   * claim function. A pure-mount tree leaves the flag false.
   */
  emitDirectoryMarkers: boolean;
  /**
   * M08 text boundary gate. True for a claimable component/chunk: mount emits
   * the same `oe:t` pair the claim consumes, and static adjacent text is
   * normalized to one run. A pure-mount tree leaves the flag false (authored
   * granularity, no inert comments).
   */
  emitTextBoundaries: boolean;
  /**
   * Chunk-local pre-order ordinal for every `dynamic-text` node in the current
   * emitted chunk (component roots or one recipe target). The map is built by
   * the pure `textSlotOrdinals` helper; a missing entry is an internal
   * diagnostic, never a guessed ordinal.
   */
  textOrdinals: ReadonlyMap<FunctionModelNode, number>;
  /**
   * M08 list entry-claim scratch, or null outside an entry claim chunk. The
   * refreshes are function-scoped slot writes the entry's `update(next)` can
   * force; the activate emitters are emitted inside the returned `activate`
   * closure only, so verify performs no write and opens no subscription.
   */
  claimEntry: {
    readonly refreshes: string[];
    readonly activate: Array<() => void>;
  } | null;
  /** True once this chunk throws the leaf-claim mismatch. */
  usesLeafClaimMismatch: boolean;
}

function diag(state: EmitState, code: string, message: string, span: IrSpan): void {
  state.diagnostics.push({
    severity: 'error',
    code,
    message,
    span,
    origin: 'ir-object',
  });
}

interface SpanLike {
  readonly file: string;
  /** 1-based authored line. */
  readonly line: number;
  /** 1-based authored column. */
  readonly column: number;
}

type LinePart = string | { readonly record: LoweredExpressionRecord };

function currentColumn(state: EmitState): number {
  return state.indent * 2;
}

/** Real newlines in one emitted line element (a multi-line lowered expression). */
function countLineBreaks(line: string): number {
  let count = 0;
  for (const character of line) if (character === '\n') count += 1;
  return count;
}

/** Physical lines a generated fragment occupies (elements may contain newlines). */
function fragmentLineCount(lines: readonly string[]): number {
  let count = 0;
  for (const line of lines) count += 1 + countLineBreaks(line);
  return count;
}

function addSegment(
  state: EmitState,
  generatedLine: number,
  generatedColumn: number,
  sourceLine: number,
  sourceColumn: number,
  name?: string,
): void {
  const key = `${generatedLine}:${generatedColumn}`;
  if (state.segmentKeys.has(key)) return;
  state.segmentKeys.add(key);
  state.segments.push({
    generatedLine,
    generatedColumn,
    sourceLine,
    sourceColumn,
    ...(name === undefined ? {} : { name }),
  });
}

/** Append one generated line; an authored anchor maps its start position. */
function push(state: EmitState, text: string, anchor?: SpanLike): void {
  const lineNumber = state.physicalLine + 1;
  if (anchor !== undefined) {
    // Structural anchors map from the generated line start (statement position).
    addSegment(state, lineNumber, 0, anchor.line, anchor.column - 1);
  }
  const line = `${'  '.repeat(state.indent)}${text}`;
  state.lines.push(line);
  state.physicalLine += 1 + countLineBreaks(line);
}

/**
 * Append one generated line containing lowered expression text: the placement
 * is recorded and the A2 expression segments are rebased into module
 * coordinates (multi-line lowering keeps later lines at their own columns).
 */
function pushParts(state: EmitState, parts: readonly LinePart[], anchor?: SpanLike): void {
  const lineNumber = state.physicalLine + 1;
  let column = currentColumn(state);
  let text = '  '.repeat(state.indent);
  if (anchor !== undefined) addSegment(state, lineNumber, column, anchor.line, anchor.column - 1);
  for (const part of parts) {
    if (typeof part === 'string') {
      text += part;
      column += part.length;
      continue;
    }
    const record = part.record;
    const lowered = record.lowered.trim();
    const startLine = lineNumber;
    const startColumn = column;
    // The placement start maps to the authored expression start; the A2
    // segments (which may start after trimmed markers) provide finer anchors.
    addSegment(
      state,
      startLine,
      startColumn,
      record.authoredSpan.line,
      record.authoredSpan.column - 1,
    );
    state.placements.push({
      exprId: record.id,
      generatedLine: startLine,
      generatedColumn: startColumn,
      authoredLine: record.authoredSpan.line,
      authoredColumn: record.authoredSpan.column - 1,
    });
    for (const segment of record.segments) {
      addSegment(
        state,
        startLine + segment.generatedLine - 1,
        segment.generatedLine === 1
          ? startColumn + segment.generatedColumn
          : segment.generatedColumn,
        segment.sourceLine,
        segment.sourceColumn,
        segment.name,
      );
    }
    text += lowered;
    const lines = lowered.split('\n');
    column = lines.length === 1 ? startColumn + lowered.length : lines[lines.length - 1]!.length;
  }
  state.lines.push(text);
  state.physicalLine += 1 + countLineBreaks(text);
}

type SinkEntry =
  | { readonly kind: 'node'; readonly name: string }
  | { readonly kind: 'spread'; readonly name: string }
  /** One M04 projection (M06b1a-2): spread `projection.nodes` into the sink. */
  | { readonly kind: 'projection'; readonly name: string };

/** Register one generated refresh function with the enclosing entry builder. */
function registerRefresh(state: EmitState, name: string): void {
  const collector = state.refreshStack[state.refreshStack.length - 1];
  if (collector !== undefined) collector.push(name);
}

/**
 * True when the record reads a name bound by an enclosing list-entry builder
 * (the mapper parameter). Such a read has no reactive dependency: a keyed reuse
 * or an unkeyed positional reuse re-binds the parameter through
 * `update(next)`. A zero-dependency slot that reads an entry-local name must
 * therefore still register a refresh closure, otherwise it keeps the first
 * snapshot (the M06b2c defect).
 */
function readsEntryLocal(state: EmitState, record: LoweredExpressionRecord): boolean {
  // Outside an entry builder there is nothing to re-run against (a component
  // mount has no `update` hook); keep today's static write byte-identical.
  if (state.refreshStack.length === 0) return false;
  return record.reads.some(
    (read) => state.entryNames.has(read.name) || state.entryNames.has(read.binding.name),
  );
}

/**
 * Emit `function <refresh>() { <write> } <refresh>();` and return the refresh
 * name. The caller decides whether it registers with the enclosing entry builder
 * and whether dependency subscriptions are added (zero-dependency vs tracked).
 */
function emitLocalRefresh(state: EmitState, anchor: SpanLike, write: () => void): string {
  const refresh = nextName(state, 'refresh');
  push(state, `function ${refresh}() {`, anchor);
  state.indent += 1;
  write();
  state.indent -= 1;
  push(state, `}`);
  push(state, `${refresh}();`);
  return refresh;
}

/** Append the sink entries to an element variable (authored child order). */
function appendSinkToElement(
  state: EmitState,
  sink: readonly SinkEntry[],
  targetVar: string,
): void {
  for (const entry of sink) {
    if (entry.kind === 'node') push(state, `${targetVar}.appendChild(${entry.name});`);
    else if (entry.kind === 'projection')
      push(
        state,
        `for (const ${INTERNAL_PREFIX}child of ${entry.name}.nodes) ${targetVar}.appendChild(${INTERNAL_PREFIX}child);`,
      );
    else
      push(
        state,
        `for (const ${INTERNAL_PREFIX}child of ${entry.name}) ${targetVar}.appendChild(${INTERNAL_PREFIX}child);`,
      );
  }
}

/** Append the sink entries to a generated node-array variable. */
function appendSinkToArray(state: EmitState, sink: readonly SinkEntry[], targetVar: string): void {
  for (const entry of sink) {
    if (entry.kind === 'node') push(state, `${targetVar}.push(${entry.name});`);
    else if (entry.kind === 'projection')
      push(
        state,
        `for (const ${INTERNAL_PREFIX}child of ${entry.name}.nodes) ${targetVar}.push(${INTERNAL_PREFIX}child);`,
      );
    else
      push(
        state,
        `for (const ${INTERNAL_PREFIX}child of ${entry.name}) ${targetVar}.push(${INTERNAL_PREFIX}child);`,
      );
  }
}

/**
 * Emit one nested generated builder function that returns a node array. The
 * builder gets its own scope variable so its resources register on the branch /
 * entry owner, and lowered expressions inside keep the M03 placement ledger.
 */
function emitNodesBuilder(
  state: EmitState,
  functionName: string,
  scopeParam: string,
  nodes: readonly FunctionModelNode[],
  records: ReadonlyMap<string, LoweredExpressionRecord>,
  anchor: SpanLike,
): void {
  push(state, `function ${functionName}(${scopeParam}) {`, anchor);
  state.indent += 1;
  const outerScope = state.scopeVar;
  const outerOrdinals = state.textOrdinals;
  const prepared = emissionNodes(state, nodes);
  state.scopeVar = scopeParam;
  // Every generated builder is its own chunk: text-slot ordinals restart at 0
  // and top-level static runs use the same normalized view the claim/SSR walk
  // will consume. The save/restore is per builder, matching the recipe path.
  state.textOrdinals = textSlotOrdinals(prepared);
  push(state, `const ${INTERNAL_PREFIX}nodes = [];`);
  // B3: a branch builder is its own function scope. Refresh functions emitted
  // inside it are not visible to an enclosing list entry's `update(next)` hook,
  // so they must not join that collector. The condition's own refresh (which is
  // registered with the entry) force-rebuilds the branch when the entry updates,
  // which re-runs these branch-internal writes against the re-bound parameter.
  const outerCollector = state.refreshStack.length;
  state.refreshStack.push([]);
  try {
    for (const node of prepared) {
      const sink: SinkEntry[] = [];
      emitNode(state, node, sink, records);
      appendSinkToArray(state, sink, `${INTERNAL_PREFIX}nodes`);
    }
  } finally {
    state.refreshStack.length = outerCollector;
  }
  push(state, `return ${INTERNAL_PREFIX}nodes;`);
  state.textOrdinals = outerOrdinals;
  state.scopeVar = outerScope;
  state.indent -= 1;
  push(state, '}');
}

/**
 * Emit the per-entry list builder: binds the authored mapper parameter, builds
 * the entry's detached nodes on the entry owner scope and returns an `update`
 * hook so a keyed reuse re-evaluates the entry's refresh closures in place
 * (DOM identity is preserved; per-read props replacement stays M06b/M07).
 */
function emitEntryBuilder(
  state: EmitState,
  functionName: string,
  scopeParam: string,
  itemParam: string,
  itemName: string,
  nodes: readonly FunctionModelNode[],
  records: ReadonlyMap<string, LoweredExpressionRecord>,
  anchor: SpanLike,
): void {
  push(state, `function ${functionName}(${scopeParam}, ${itemParam}) {`, anchor);
  state.indent += 1;
  const outerScope = state.scopeVar;
  const outerOrdinals = state.textOrdinals;
  state.scopeVar = scopeParam;
  // Save/restore rather than add/delete: a nested list entry may shadow the same
  // mapper name, and deleting it on the way out would hide the outer entry-local
  // reads (refresh registration and `declareReads` both consult this set).
  const outerEntryNames = state.entryNames.has(itemName);
  state.entryNames.add(itemName);
  // Every generated builder is its own text chunk: entry-local ordinals restart
  // at 0 and top-level static runs use the normalized view the claim/SSR walk
  // consumes. Mount, claim-create and SSR all go through this same chunk view.
  const prepared = emissionNodes(state, nodes);
  state.textOrdinals = textSlotOrdinals(prepared);
  push(state, `const ${INTERNAL_PREFIX}nodes = [];`);
  push(state, `let ${itemName} = ${itemParam};`);
  const collector: string[] = [];
  state.refreshStack.push(collector);
  for (const node of prepared) {
    const sink: SinkEntry[] = [];
    emitNode(state, node, sink, records);
    appendSinkToArray(state, sink, `${INTERNAL_PREFIX}nodes`);
  }
  state.refreshStack.pop();
  if (!outerEntryNames) state.entryNames.delete(itemName);
  const updateBody = [`${itemName} = next;`, ...collector.map((name) => `${name}(true);`)].join(
    ' ',
  );
  push(state, `return { nodes: ${INTERNAL_PREFIX}nodes, update(next) { ${updateBody} } };`);
  state.textOrdinals = outerOrdinals;
  state.scopeVar = outerScope;
  state.indent -= 1;
  push(state, '}');
}

/** Emit `when`/branch replacement through the M04 disposal mapping. */
function emitCondition(
  state: EmitState,
  node: FunctionModelCondition,
  sink: SinkEntry[],
  records: ReadonlyMap<string, LoweredExpressionRecord>,
): void {
  const record = recordFor(state, node.test, records);
  if (record === null || !declareReads(state, record)) return;
  const dependencies = dependencyNames(state, record);
  if (dependencies === null) return;
  const id = state.counter.value++;
  const anchorVar = `${INTERNAL_PREFIX}whenAnchor${id}`;
  const endVar = `${INTERNAL_PREFIX}whenEnd${id}`;
  const activeVar = `${INTERNAL_PREFIX}whenActive${id}`;
  const ownerVar = `${INTERNAL_PREFIX}whenOwner${id}`;
  const refreshVar = `${INTERNAL_PREFIX}whenRefresh${id}`;
  const consequentFn = node.consequent.length > 0 ? `${INTERNAL_PREFIX}whenThen${id}` : null;
  const alternateFn =
    node.alternate !== null && node.alternate.length > 0 ? `${INTERNAL_PREFIX}whenElse${id}` : null;

  push(state, `const ${anchorVar} = emitComment(MARKERS.when);`, node.span);
  sink.push({ kind: 'node', name: anchorVar });
  if (consequentFn !== null) {
    emitNodesBuilder(
      state,
      consequentFn,
      `${INTERNAL_PREFIX}whenThenScope${id}`,
      node.consequent,
      records,
      node.span,
    );
  }
  if (alternateFn !== null) {
    emitNodesBuilder(
      state,
      alternateFn,
      `${INTERNAL_PREFIX}whenElseScope${id}`,
      node.alternate!,
      records,
      node.span,
    );
  }

  push(state, `let ${activeVar} = -1;`);
  push(state, `let ${ownerVar} = null;`);
  push(state, `function ${refreshVar}(force) {`, node.span);
  state.indent += 1;
  const select = alternateFn === null ? `? 1 : 0` : `? 1 : 2`;
  pushParts(state, [`const ${INTERNAL_PREFIX}next = (`, { record }, `) ${select};`]);
  push(state, `if (!force && ${INTERNAL_PREFIX}next === ${activeVar}) return;`);
  push(state, `if (${ownerVar} !== null) ${ownerVar}.dispose(true);`);
  push(state, `${ownerVar} = null;`);
  push(state, `const ${INTERNAL_PREFIX}branchOwner = ${state.scopeVar}.child();`);
  push(state, `let ${INTERNAL_PREFIX}branchNodes;`);
  push(state, `try {`);
  state.indent += 1;
  const thenCall = consequentFn === null ? '[]' : `${consequentFn}(${INTERNAL_PREFIX}branchOwner)`;
  const elseCall = alternateFn === null ? '[]' : `${alternateFn}(${INTERNAL_PREFIX}branchOwner)`;
  push(
    state,
    `${INTERNAL_PREFIX}branchNodes = runUntracked(() => ${INTERNAL_PREFIX}next === 1 ? ${thenCall} : ${elseCall});`,
  );
  state.indent -= 1;
  push(state, `} catch (error) { ${INTERNAL_PREFIX}branchOwner.dispose(true); throw error; }`);
  push(
    state,
    `${INTERNAL_PREFIX}branchOwner.addRangeCleanup(() => removeNodes(${INTERNAL_PREFIX}branchNodes));`,
  );
  push(state, `const ${INTERNAL_PREFIX}parent = ${anchorVar}.parentNode;`);
  push(
    state,
    `if (${INTERNAL_PREFIX}parent !== null) { for (const ${INTERNAL_PREFIX}child of ${INTERNAL_PREFIX}branchNodes) ${INTERNAL_PREFIX}parent.insertBefore(${INTERNAL_PREFIX}child, ${endVar}); }`,
  );
  push(
    state,
    `${activeVar} = ${INTERNAL_PREFIX}next; ${ownerVar} = ${INTERNAL_PREFIX}branchOwner;`,
  );
  state.indent -= 1;
  push(state, '}');

  // Initial branch: build detached, then hand the nodes to the enclosing sink so
  // they land at the anchor position when the mount's node list is inserted.
  const initialOwnerVar = `${INTERNAL_PREFIX}initialOwner${id}`;
  const initialTestVar = `${INTERNAL_PREFIX}initialTest${id}`;
  const initialNodesVar = `${INTERNAL_PREFIX}initialNodes${id}`;
  push(state, `const ${initialOwnerVar} = ${state.scopeVar}.child();`);
  pushParts(state, [`const ${initialTestVar} = (`, { record }, ');']);
  push(state, `let ${initialNodesVar};`);
  push(state, `try {`);
  state.indent += 1;
  const initialThen = consequentFn === null ? '[]' : `${consequentFn}(${initialOwnerVar})`;
  const initialElse = alternateFn === null ? '[]' : `${alternateFn}(${initialOwnerVar})`;
  push(state, `${initialNodesVar} = ${initialTestVar} ? ${initialThen} : ${initialElse};`);
  state.indent -= 1;
  push(state, `} catch (error) { ${initialOwnerVar}.dispose(true); throw error; }`);
  push(state, `${initialOwnerVar}.addRangeCleanup(() => removeNodes(${initialNodesVar}));`);
  push(
    state,
    `${activeVar} = ${initialTestVar} ? 1 : ${alternateFn === null ? 0 : 2}; ${ownerVar} = ${initialOwnerVar};`,
  );
  push(state, `const ${endVar} = emitComment(MARKERS.whenEnd);`, node.span);
  sink.push({ kind: 'spread', name: initialNodesVar });
  sink.push({ kind: 'node', name: endVar });
  emitDependencySubscriptions(state, dependencies, refreshVar, node.span);
  registerRefresh(state, refreshVar);
}

/**
 * Emit one list key thunk. Unkeyed lists keep the mount contract: the key is
 * the item index, a finite number, so claim/SSR encode the same positional
 * identity rather than inventing a second unkeyed rule. The mapper parameter is
 * entry-local while the key record is validated; outer reads remain tracked.
 */
function emitListKeyFunction(
  state: EmitState,
  keyFn: string,
  node: FunctionModelList,
  records: ReadonlyMap<string, LoweredExpressionRecord>,
): { readonly dependencies: readonly Dependency[] } | null {
  if (node.key !== null) {
    const keyRecord = recordFor(state, node.key, records);
    if (keyRecord === null) return null;
    const outerKeyEntryName = state.entryNames.has(node.parameter);
    state.entryNames.add(node.parameter);
    const declared = declareReads(state, keyRecord);
    if (!outerKeyEntryName) state.entryNames.delete(node.parameter);
    if (!declared) return null;
    const keyDeps = dependencyNames(state, keyRecord);
    if (keyDeps === null) return null;
    pushParts(
      state,
      [
        `function ${keyFn}(${INTERNAL_PREFIX}eachItem, ${INTERNAL_PREFIX}eachIndex) { const ${node.parameter} = ${INTERNAL_PREFIX}eachItem; return (`,
        { record: keyRecord },
        '); }',
      ],
      node.key.span,
    );
    return { dependencies: keyDeps };
  }
  push(
    state,
    `function ${keyFn}(${INTERNAL_PREFIX}eachItem, ${INTERNAL_PREFIX}eachIndex) { return ${INTERNAL_PREFIX}eachIndex; }`,
    node.span,
  );
  return { dependencies: [] };
}

/** Emit `each`/map reconciliation with per-entry owners, keys and in-place updates. */
function emitList(
  state: EmitState,
  node: FunctionModelList,
  sink: SinkEntry[],
  records: ReadonlyMap<string, LoweredExpressionRecord>,
): void {
  const itemsRecord = recordFor(state, node.items, records);
  if (itemsRecord === null || !declareReads(state, itemsRecord)) return;
  const dependencies = dependencyNames(state, itemsRecord);
  if (dependencies === null) return;
  if (!IDENTIFIER_PATTERN.test(node.parameter) || node.parameter.startsWith(INTERNAL_PREFIX)) {
    diag(
      state,
      'OEIR_LEAF_INVALID_BINDING',
      `list mapper parameter '${node.parameter}' is not usable`,
      node.span,
    );
    return;
  }
  const id = state.counter.value++;
  const anchorVar = `${INTERNAL_PREFIX}eachAnchor${id}`;
  const entriesVar = `${INTERNAL_PREFIX}eachEntries${id}`;
  const entryFn = `${INTERNAL_PREFIX}eachEntry${id}`;
  const keyFn = `${INTERNAL_PREFIX}eachKey${id}`;
  const refreshVar = `${INTERNAL_PREFIX}eachRefresh${id}`;

  push(state, `const ${anchorVar} = emitComment(MARKERS.each);`, node.span);
  sink.push({ kind: 'node', name: anchorVar });
  // The list wire (end marker + per-entry key marker) exists only when this
  // component emits a claim/SSR. A mount-only component keeps its historical
  // shape: no inert comments and no second marker vocabulary to maintain.
  const wire = state.emitTextBoundaries;
  const endVar = `${INTERNAL_PREFIX}eachEnd${id}`;
  if (wire) push(state, `const ${endVar} = emitComment(MARKERS.eachEnd);`, node.span);
  push(state, `let ${entriesVar} = [];`);
  state.listDepth += 1;
  try {
    emitEntryBuilder(
      state,
      entryFn,
      `${INTERNAL_PREFIX}eachScope${id}`,
      `${INTERNAL_PREFIX}eachItem${id}`,
      node.parameter,
      node.template,
      records,
      node.span,
    );
  } finally {
    state.listDepth -= 1;
  }

  const keyInfo = emitListKeyFunction(state, keyFn, node, records);
  if (keyInfo === null) return;
  const keyDependencies: readonly Dependency[] = keyInfo.dependencies;

  push(state, `function ${refreshVar}() {`, node.span);
  state.indent += 1;
  pushParts(state, [`const ${INTERNAL_PREFIX}items = (`, { record: itemsRecord }, ');']);
  push(state, `const ${INTERNAL_PREFIX}previous = ${entriesVar};`);
  push(state, `const ${INTERNAL_PREFIX}next = [];`);
  push(state, `const ${INTERNAL_PREFIX}used = new Set();`);
  push(
    state,
    `for (let ${INTERNAL_PREFIX}index = 0; ${INTERNAL_PREFIX}index < ${INTERNAL_PREFIX}items.length; ${INTERNAL_PREFIX}index++) {`,
  );
  state.indent += 1;
  push(state, `const ${INTERNAL_PREFIX}item = ${INTERNAL_PREFIX}items[${INTERNAL_PREFIX}index];`);
  push(
    state,
    `const ${INTERNAL_PREFIX}key = ${keyFn}(${INTERNAL_PREFIX}item, ${INTERNAL_PREFIX}index);`,
  );
  push(state, `let ${INTERNAL_PREFIX}found = null;`);
  push(
    state,
    `for (const ${INTERNAL_PREFIX}entry of ${INTERNAL_PREFIX}previous) { if (${INTERNAL_PREFIX}entry.key === ${INTERNAL_PREFIX}key && !${INTERNAL_PREFIX}used.has(${INTERNAL_PREFIX}entry)) { ${INTERNAL_PREFIX}found = ${INTERNAL_PREFIX}entry; break; } }`,
  );
  push(state, `if (${INTERNAL_PREFIX}found !== null) {`);
  state.indent += 1;
  push(
    state,
    `${INTERNAL_PREFIX}used.add(${INTERNAL_PREFIX}found); ${INTERNAL_PREFIX}found.item = ${INTERNAL_PREFIX}item; ${INTERNAL_PREFIX}found.update(${INTERNAL_PREFIX}item); ${INTERNAL_PREFIX}next.push(${INTERNAL_PREFIX}found);`,
  );
  state.indent -= 1;
  push(state, `} else {`);
  state.indent += 1;
  push(state, `const ${INTERNAL_PREFIX}owner = ${state.scopeVar}.child();`);
  push(state, `let ${INTERNAL_PREFIX}built;`);
  push(state, `try {`);
  state.indent += 1;
  push(
    state,
    `${INTERNAL_PREFIX}built = ${entryFn}(${INTERNAL_PREFIX}owner, ${INTERNAL_PREFIX}item);`,
  );
  state.indent -= 1;
  push(state, `} catch (error) { ${INTERNAL_PREFIX}owner.dispose(true); throw error; }`);
  if (wire) {
    // One marker per entry, created exactly when the entry is created and
    // unshifted into its node list so it moves/disposes with it. The token is a
    // string comparison input, never decoded; an unsupported runtime key keeps
    // mount tolerant with the mount-only `u` payload.
    const tokenVar = nextName(state, 'token');
    push(state, `const ${tokenVar} = tryEncodeListKey(${INTERNAL_PREFIX}key);`);
    push(state, `${INTERNAL_PREFIX}built.nodes.unshift(emitComment(entryKeyMarker(${tokenVar})));`);
  }
  push(
    state,
    `${INTERNAL_PREFIX}owner.addRangeCleanup(() => removeNodes(${INTERNAL_PREFIX}built.nodes));`,
  );
  push(
    state,
    `const ${INTERNAL_PREFIX}entry = { key: ${INTERNAL_PREFIX}key, item: ${INTERNAL_PREFIX}item, owner: ${INTERNAL_PREFIX}owner, nodes: ${INTERNAL_PREFIX}built.nodes, update: ${INTERNAL_PREFIX}built.update };`,
  );
  push(
    state,
    `${INTERNAL_PREFIX}used.add(${INTERNAL_PREFIX}entry); ${INTERNAL_PREFIX}next.push(${INTERNAL_PREFIX}entry);`,
  );
  state.indent -= 1;
  push(state, `}`);
  state.indent -= 1;
  push(state, `}`);
  push(
    state,
    `for (const ${INTERNAL_PREFIX}entry of ${INTERNAL_PREFIX}previous) if (!${INTERNAL_PREFIX}used.has(${INTERNAL_PREFIX}entry)) ${INTERNAL_PREFIX}entry.owner.dispose(true);`,
  );
  push(state, `const ${INTERNAL_PREFIX}parent = ${anchorVar}.parentNode;`);
  push(state, `if (${INTERNAL_PREFIX}parent !== null) {`);
  state.indent += 1;
  // Keyed placement: the list owns the siblings AFTER the anchor. Find the tail
  // reference (first following sibling that is not a current entry node), then
  // place the next entries in reverse and move only nodes not already in place.
  // Unchanged nodes (and a focused element in them) are never re-inserted.
  push(state, `const ${INTERNAL_PREFIX}previousNodes = new Set();`);
  push(
    state,
    `for (const ${INTERNAL_PREFIX}entry of ${INTERNAL_PREFIX}previous) for (const ${INTERNAL_PREFIX}node of ${INTERNAL_PREFIX}entry.nodes) ${INTERNAL_PREFIX}previousNodes.add(${INTERNAL_PREFIX}node);`,
  );
  if (wire) {
    // The list end is the fixed tail: every entry node belongs before it and a
    // following sibling can never be mistaken for a list node.
    push(state, `let ${INTERNAL_PREFIX}reference = ${endVar};`);
  } else {
    push(state, `let ${INTERNAL_PREFIX}reference = ${anchorVar}.nextSibling;`);
    push(
      state,
      `while (${INTERNAL_PREFIX}reference !== null && ${INTERNAL_PREFIX}previousNodes.has(${INTERNAL_PREFIX}reference)) ${INTERNAL_PREFIX}reference = ${INTERNAL_PREFIX}reference.nextSibling;`,
    );
  }
  push(
    state,
    `for (let ${INTERNAL_PREFIX}entryIndex = ${INTERNAL_PREFIX}next.length - 1; ${INTERNAL_PREFIX}entryIndex >= 0; ${INTERNAL_PREFIX}entryIndex--) {`,
  );
  state.indent += 1;
  push(
    state,
    `const ${INTERNAL_PREFIX}entryNodes = ${INTERNAL_PREFIX}next[${INTERNAL_PREFIX}entryIndex].nodes;`,
  );
  push(
    state,
    `for (let ${INTERNAL_PREFIX}nodeIndex = ${INTERNAL_PREFIX}entryNodes.length - 1; ${INTERNAL_PREFIX}nodeIndex >= 0; ${INTERNAL_PREFIX}nodeIndex--) {`,
  );
  state.indent += 1;
  push(
    state,
    `const ${INTERNAL_PREFIX}node = ${INTERNAL_PREFIX}entryNodes[${INTERNAL_PREFIX}nodeIndex];`,
  );
  push(
    state,
    `if (${INTERNAL_PREFIX}node.parentNode !== ${INTERNAL_PREFIX}parent || ${INTERNAL_PREFIX}node.nextSibling !== ${INTERNAL_PREFIX}reference) ${INTERNAL_PREFIX}parent.insertBefore(${INTERNAL_PREFIX}node, ${INTERNAL_PREFIX}reference);`,
  );
  push(state, `${INTERNAL_PREFIX}reference = ${INTERNAL_PREFIX}node;`);
  state.indent -= 1;
  push(state, `}`);
  state.indent -= 1;
  push(state, `}`);
  state.indent -= 1;
  push(state, `}`);
  push(state, `${entriesVar} = ${INTERNAL_PREFIX}next;`);
  state.indent -= 1;
  push(state, '}');

  push(state, `${refreshVar}();`);
  const initialNodesVar = `${INTERNAL_PREFIX}eachInitialNodes${id}`;
  push(state, `const ${initialNodesVar} = [];`);
  push(
    state,
    `for (const ${INTERNAL_PREFIX}entry of ${entriesVar}) for (const ${INTERNAL_PREFIX}node of ${INTERNAL_PREFIX}entry.nodes) ${initialNodesVar}.push(${INTERNAL_PREFIX}node);`,
  );
  sink.push({ kind: 'spread', name: initialNodesVar });
  if (wire) sink.push({ kind: 'node', name: endVar });
  const subscribed = new Set<string>();
  const uniqueDependencies: Dependency[] = [];
  for (const dependency of [...dependencies, ...keyDependencies]) {
    if (subscribed.has(dependency.name)) continue;
    subscribed.add(dependency.name);
    uniqueDependencies.push(dependency);
  }
  emitDependencySubscriptions(state, uniqueDependencies, refreshVar, node.span);
  registerRefresh(state, refreshVar);
}

function nextName(state: EmitState, prefix: string): string {
  return `${INTERNAL_PREFIX}${prefix}${state.counter.value++}`;
}

function toIrSpan(ref: FunctionExpressionRef): IrSpan {
  return ref.span;
}

function bindingKey(id: BindingId): string {
  return `${id.scope.path}#${id.name}#${id.declarationOrder}`;
}

function recordFor(
  state: EmitState,
  ref: FunctionExpressionRef,
  records: ReadonlyMap<string, LoweredExpressionRecord>,
): LoweredExpressionRecord | null {
  const record = records.get(ref.id);
  if (record === undefined) {
    diag(state, 'OEIR_LEAF_MISSING_EXPRESSION', `expression ${ref.id} is not in the registry`, {
      file: '',
      start: 0,
      end: 0,
      line: 1,
      column: 1,
    });
    return null;
  }
  // M06b1a-2 boundary: only a direct component-local JSX initializer becomes a
  // reusable recipe. A JSX value lowered inside an arbitrary expression keeps
  // its `__oe_recipe_ref(...)` placeholder, which has no generated definition
  // and no insertion site; emitting it would produce a module that cannot run.
  if (record.lowered.includes(RECIPE_REFERENCE_CALLEE)) {
    diag(
      state,
      'OEIR_LEAF_UNSUPPORTED_RECIPE',
      'a JSX value inside an expression lowers to a recipe reference, but this slice only ' +
        'admits direct component-local JSX initializers (`const x = <div/>;` + `{x}`); ' +
        'move the JSX to a direct initializer or keep it as a JSX child',
      toIrSpan(ref),
    );
    return null;
  }
  return record;
}

/** Declare the host bindings an expression reads (prologue) and validate names. */
function declareReads(state: EmitState, record: LoweredExpressionRecord): boolean {
  for (const read of record.reads) {
    // The enclosing list-entry mapper shadows every same-named outer binding,
    // including `props`. Check the entry binding before the component-props
    // branch: a legal `items.map((props) => …)` read is entry-local, never a
    // component props read.
    if (state.entryNames.has(read.name) || state.entryNames.has(read.binding.name)) {
      continue;
    }
    if (read.name === 'props' || read.binding.name === 'props') {
      if (state.propsName === null) {
        diag(
          state,
          'OEIR_LEAF_UNSUPPORTED_PROPS',
          'the leaf slice needs a named props parameter',
          toIrSpan({
            id: record.id,
            mode: record.mode,
            span: record.authoredSpan,
          }),
        );
        return false;
      }
      state.requiredProps.add(state.propsName);
      continue;
    }
    if (state.localResources.has(read.name) || state.hostBindings.has(read.name)) {
      continue;
    }
    // A reusable JSX value is a recipe, not a readable value: it only appears
    // as a `{name}` JSX child (an insertion site), never inside an expression.
    // The enclosing-builder check above wins first, so a list mapper parameter
    // shadowing the component-local name stays an entry read.
    if (state.recipeNames.has(read.name)) {
      diag(
        state,
        'OEIR_LEAF_UNSUPPORTED_RECIPE',
        `'${read.name}' is a reusable JSX value; it can only be projected with {${read.name}} in JSX child position, not read as an expression value`,
        toIrSpan({
          id: record.id,
          mode: record.mode,
          span: record.authoredSpan,
        }),
      );
      return false;
    }
    if (!IDENTIFIER_PATTERN.test(read.name) || read.name.startsWith(INTERNAL_PREFIX)) {
      diag(
        state,
        'OEIR_LEAF_INVALID_BINDING',
        `binding '${read.name}' is not a usable identifier`,
        toIrSpan({
          id: record.id,
          mode: record.mode,
          span: record.authoredSpan,
        }),
      );
      return false;
    }
    const resource = state.component.resources.find((candidate) => candidate.name === read.name);
    if (resource !== undefined && resource.kind !== 'local') {
      state.hostBindings.add(read.name);
      state.requiredBindings.add(read.name);
      continue;
    }
    if (resource !== undefined && resource.kind === 'local') {
      state.localResources.add(read.name);
      continue;
    }
    // Builtin/global reads (undefined, Math, ...) are referenced directly; every
    // other name must come from the host binding record.
    if (
      read.value === 'plain' &&
      read.binding.name === read.name &&
      read.binding.scope.path === 'global'
    ) {
      continue;
    }
    state.hostBindings.add(read.name);
    state.requiredBindings.add(read.name);
  }
  return true;
}

interface Dependency {
  readonly name: string;
  /** Props reads refresh through the host `propsChanged` signal (see contract). */
  readonly fromProps: boolean;
}

function dependencyNames(
  state: EmitState,
  record: LoweredExpressionRecord,
): readonly Dependency[] | null {
  const byKey = new Map(record.reads.map((read) => [bindingKey(read.binding), read]));
  const names: Dependency[] = [];
  for (const id of record.dependencies) {
    const read = byKey.get(bindingKey(id));
    if (read === undefined) {
      diag(
        state,
        'OEIR_LEAF_UNSUPPORTED_BINDING',
        `tracked expression ${record.id} has a dependency outside its reads`,
        toIrSpan({
          id: record.id,
          mode: record.mode,
          span: record.authoredSpan,
        }),
      );
      return null;
    }
    // A read bound by the enclosing mapper parameter is entry-local: the entry
    // `update(next)` re-binds the parameter, so it is not a host/props
    // subscription (B2: `props` as a mapper name must not become fromProps).
    if (state.entryNames.has(read.name) || state.entryNames.has(read.binding.name)) {
      continue;
    }
    const fromProps = read.name === 'props' || read.binding.name === 'props';
    if (fromProps) {
      // Per-read props refresh: the leaf contract supplies a `propsChanged`
      // signal (the M04 tracked-props record's version channel analogue). The
      // per-read getter semantics are M06's contract; the leaf slice only
      // proves the refresh plumbing.
      state.requiresPropsChanged = true;
    } else if (!state.hostBindings.has(read.name)) {
      state.hostBindings.add(read.name);
      state.requiredBindings.add(read.name);
    }
    if (!names.some((entry) => entry.name === read.name))
      names.push({ name: read.name, fromProps });
  }
  return names;
}

/**
 * Subscribe one generated refresh closure to the signals a slot's expression
 * reads. Props reads refresh through the mount host's `propDeps` (the defining
 * scope's signals: `host.propsChanged` for a root instance, the parent bindings
 * behind the passed prop expressions for a component-reference instance); every
 * other read binds its named host binding directly.
 */
function emitDependencySubscriptions(
  state: EmitState,
  dependencies: readonly Dependency[],
  refreshVar: string,
  anchor: SpanLike,
): void {
  for (const dependency of dependencies) {
    if (dependency.fromProps) {
      push(
        state,
        `for (const ${MOUNT_DEP_LOOP} of ${state.hostVar}.propDeps) bindSignalWrites(${state.scopeVar}, ${MOUNT_DEP_LOOP}, ${JSON.stringify(dependency.name)}, ${refreshVar});`,
        anchor,
      );
      continue;
    }
    push(
      state,
      `bindSignalWrites(${state.scopeVar}, ${dependency.name}, ${JSON.stringify(dependency.name)}, ${refreshVar});`,
      anchor,
    );
  }
}

function emitTextWrite(state: EmitState, targetVar: string, record: LoweredExpressionRecord): void {
  pushParts(state, [`${targetVar}.nodeValue = displayValue((`, { record }, '));']);
}

/**
 * Claim-period dynamic-text slot write. The slot is a boundary pair plus an
 * optional Text node: `null` means the server wire carried no text (an empty
 * value), so an equal client value is a no-op and a non-empty one lazily
 * inserts the slot's single Text before the closing marker. An existing Text
 * is value-compared; it is never split, merged, normalized or removed.
 *
 * The lazy node is not part of the projected `nodes` array, so it is owned by a
 * claim-scope range cleanup. The node cursor already points past the consumed
 * close marker, so no index compensation is needed.
 */
function emitClaimTextSlotWrite(
  state: EmitState,
  slotVar: string,
  endVar: string,
  record: LoweredExpressionRecord,
): void {
  const valueVar = nextName(state, 'value');
  pushParts(state, [`const ${valueVar} = displayValue((`, { record }, '));']);
  push(state, `if (${slotVar} === null) {`);
  push(state, `  if (${valueVar} !== "") {`);
  const lazyVar = nextName(state, 'text');
  push(state, `    const ${lazyVar} = document.createTextNode(${valueVar});`);
  push(state, `    ${endVar}.parentNode.insertBefore(${lazyVar}, ${endVar});`);
  push(state, `    ${state.scopeVar}.addRangeCleanup(() => ${lazyVar}.remove());`);
  push(state, `    ${slotVar} = ${lazyVar};`);
  push(state, `  }`);
  push(state, `} else if (${slotVar}.nodeValue !== ${valueVar}) {`);
  push(state, `  ${slotVar}.nodeValue = ${valueVar};`);
  push(state, `}`);
}

function emitAttributeWrite(
  state: EmitState,
  elementVar: string,
  name: string,
  channel: string,
  record: LoweredExpressionRecord,
  anchor: SpanLike,
): void {
  const literal = JSON.stringify(name);
  if (channel === 'boolean') {
    pushParts(
      state,
      [`${elementVar}.toggleAttribute(${literal}, Boolean((`, { record }, ')));'],
      anchor,
    );
    return;
  }
  if (channel === 'property') {
    if (!IDENTIFIER_PATTERN.test(name)) {
      diag(
        state,
        'OEIR_LEAF_UNSUPPORTED_ATTRIBUTE',
        `property '${name}' is not a valid identifier`,
        { file: '', start: 0, end: 0, line: 1, column: 1 },
      );
      return;
    }
    pushParts(state, [`${elementVar}[${literal}] = (`, { record }, ');'], anchor);
    return;
  }
  const valueVar = nextName(state, 'value');
  pushParts(state, [`const ${valueVar} = attributeValueOf((`, { record }, '));'], anchor);
  push(state, `if (${valueVar} === null) ${elementVar}.removeAttribute(${literal});`, anchor);
  push(state, `else {`, anchor);
  push(state, `  assertSafeUrlAttribute(${literal}, ${valueVar});`, anchor);
  push(state, `  ${elementVar}.setAttribute(${literal}, ${valueVar});`, anchor);
  push(state, `}`, anchor);
}

/**
 * Claim-period attribute write. Mount and update keep {@link emitAttributeWrite}.
 * Each channel compares the current DOM to the same value the unconditional
 * write would store. `assertSafeUrlAttribute` runs only when a string
 * attribute will actually be set. Property channels stay mount-only today;
 * the branch is here so a claim write cannot assign an equal property.
 */
function emitClaimAttributeWrite(
  state: EmitState,
  elementVar: string,
  name: string,
  channel: string,
  record: LoweredExpressionRecord,
  anchor: SpanLike,
): void {
  const literal = JSON.stringify(name);
  if (channel === 'boolean') {
    const valueVar = nextName(state, 'value');
    pushParts(state, [`const ${valueVar} = Boolean((`, { record }, '));'], anchor);
    push(
      state,
      `if (${elementVar}.hasAttribute(${literal}) !== ${valueVar}) ${elementVar}.toggleAttribute(${literal}, ${valueVar});`,
      anchor,
    );
    return;
  }
  if (channel === 'property') {
    if (!IDENTIFIER_PATTERN.test(name)) {
      diag(
        state,
        'OEIR_LEAF_UNSUPPORTED_ATTRIBUTE',
        `property '${name}' is not a valid identifier`,
        { file: '', start: 0, end: 0, line: 1, column: 1 },
      );
      return;
    }
    const valueVar = nextName(state, 'value');
    pushParts(state, [`const ${valueVar} = (`, { record }, ');'], anchor);
    push(
      state,
      `if (${elementVar}[${literal}] !== ${valueVar}) ${elementVar}[${literal}] = ${valueVar};`,
      anchor,
    );
    return;
  }
  const valueVar = nextName(state, 'value');
  pushParts(state, [`const ${valueVar} = attributeValueOf((`, { record }, '));'], anchor);
  push(state, `if (${valueVar} === null) {`, anchor);
  push(
    state,
    `  if (${elementVar}.hasAttribute(${literal})) ${elementVar}.removeAttribute(${literal});`,
    anchor,
  );
  push(state, `} else if (${elementVar}.getAttribute(${literal}) !== ${valueVar}) {`, anchor);
  push(state, `  assertSafeUrlAttribute(${literal}, ${valueVar});`, anchor);
  push(state, `  ${elementVar}.setAttribute(${literal}, ${valueVar});`, anchor);
  push(state, `}`, anchor);
}

function attributeAdmitted(
  state: EmitState,
  attribute: FunctionModelAttribute,
  span: IrSpan,
): boolean {
  if (attribute.kind === 'static') {
    if (!ATTRIBUTE_PATTERN.test(attribute.name)) {
      diag(
        state,
        'OEIR_LEAF_UNSUPPORTED_ATTRIBUTE',
        `attribute name '${attribute.name}' is invalid`,
        span,
      );
      return false;
    }
    return true;
  }
  if (!ADMITTED_ATTRIBUTE_CHANNELS.has(attribute.channel)) {
    diag(
      state,
      'OEIR_LEAF_UNSUPPORTED_ATTRIBUTE',
      `attribute channel '${attribute.channel}' is outside the leaf slice (M05b/M06 owns it)`,
      span,
    );
    return false;
  }
  return true;
}

/** Validate one prop of a component reference; `key` is consumed before this. */
function componentPropAdmitted(
  state: EmitState,
  attribute: FunctionModelAttribute,
  componentName: string,
  span: IrSpan,
): boolean {
  if (attribute.kind === 'static') {
    if (!ATTRIBUTE_PATTERN.test(attribute.name)) {
      diag(
        state,
        'OEIR_LEAF_UNSUPPORTED_ATTRIBUTE',
        `prop name '${attribute.name}' on component '<${componentName}>' is invalid`,
        span,
      );
      return false;
    }
    return true;
  }
  if (!ADMITTED_ATTRIBUTE_CHANNELS.has(attribute.channel)) {
    diag(
      state,
      'OEIR_LEAF_UNSUPPORTED_ATTRIBUTE',
      `prop channel '${attribute.channel}' on component '<${componentName}>' is outside the M06b1 slice (class/style/innerHTML/event/ref stay refused)`,
      span,
    );
    return false;
  }
  return true;
}

/**
 * Emit one module-local component-reference instance (M06b1a-1).
 *
 * The child body is the module-level `<Child>__mount`, so one component body is
 * emitted once per module however often it is referenced. Each reference owns a
 * fresh child scope (M04 ownership: disposal, rollback and range cleanup are the
 * parent's), the parent appends the returned nodes to the enclosing sink in
 * authored order, and props are a per-read getter record over the DEFINING
 * (parent) scope — `{ get text() { return <parent read>; } }` — never cached.
 * The child refreshes a prop-dependent slot through the defining-scope signals
 * in `host.propDeps`: the parent bindings the passed prop expressions depend on,
 * plus the parent's own props channel when a getter passes a parent prop.
 */
function emitComponentRef(
  state: EmitState,
  node: FunctionModelComponentRef,
  sink: SinkEntry[],
  records: ReadonlyMap<string, LoweredExpressionRecord>,
): void {
  const span: IrSpan = node.span;
  if (state.listDepth > 0) {
    diag(
      state,
      'OEIR_LEAF_UNSUPPORTED_COMPONENT',
      `component '<${node.name}>' inside a list entry template needs the child update hook (M06b1b); a keyed reuse would keep the first mount's props`,
      span,
    );
    return;
  }
  const target = state.componentByName.get(node.name);
  if (target === undefined) {
    diag(
      state,
      'OEIR_LEAF_UNKNOWN_COMPONENT',
      `component '<${node.name}>' is not declared in this module (external components are M06b2)`,
      span,
    );
    return;
  }
  if (target.propsParam === null) {
    diag(
      state,
      'OEIR_LEAF_UNSUPPORTED_COMPONENT',
      `component '<${node.name}>' has no named props parameter (destructured or absent); component references need a named props parameter (M06b2 owns destructuring)`,
      span,
    );
    return;
  }
  const ownedBindings = target.resources.filter(
    (resource) => resource.kind === 'signal' || resource.kind === 'computed',
  );
  if (ownedBindings.length > 0) {
    diag(
      state,
      'OEIR_LEAF_UNSUPPORTED_COMPONENT',
      `component '<${node.name}>' owns signal/computed resources; a child instance cannot resolve host bindings without sharing the parent instance (M06b2/M07 own it)`,
      span,
    );
    return;
  }
  // Children recipe (M06b2a). The definition site is the mount scope the ref is
  // emitted in: a ref inside a reusable recipe body would need the children
  // recipe to be created per insertion (its definition owner is the recipe
  // instance scope), so that nesting stays refused with a stated reason.
  if (node.childrenRecipeId !== null && state.recipeDepth > 0) {
    diag(
      state,
      'OEIR_LEAF_UNSUPPORTED_CHILDREN',
      `children on '<${node.name}>' inside a reusable JSX value body are outside the M06b2a slice: the children recipe would be created once per component mount, but its definition owner is the recipe instance scope (created per insertion)`,
      span,
    );
    return;
  }
  // A component that projects `props.children` statically needs a recipe: a
  // reference without JSX children would mount with an absent recipe (the
  // runtime check below documents the host/root case). Fail closed at compile
  // time where the absence is known.
  if (node.childrenRecipeId === null && componentProjectsChildren(target)) {
    diag(
      state,
      'OEIR_LEAF_MISSING_CHILDREN',
      `component '<${node.name}>' projects props.children but this reference passes no JSX children; every projection needs a children recipe`,
      span,
    );
    return;
  }
  const childrenRecipeVar =
    node.childrenRecipeId === null ? null : (state.recipeVars.get(node.childrenRecipeId) ?? null);
  if (node.childrenRecipeId !== null && childrenRecipeVar === null) {
    diag(
      state,
      'OEIR_LEAF_MISSING_RECIPE',
      `children recipe '${node.childrenRecipeId}' of '<${node.name}>' has no emitted recipe (it is not reachable from any admitted root)`,
      span,
    );
    return;
  }
  // Pass 1: admit the prop DOM channels. `key` is list identity, consumed by the
  // enclosing list emitter and never a DOM write or a child prop.
  let refused = false;
  const admitted: Array<
    | { readonly kind: 'static'; readonly name: string; readonly value: string }
    | {
        readonly kind: 'dynamic';
        readonly name: string;
        readonly expression: FunctionExpressionRef;
        readonly span: SpanLike;
      }
  > = [];
  for (const attribute of node.props) {
    if (attribute.name === 'key') continue;
    if (attribute.name === 'children') {
      diag(
        state,
        'OEIR_LEAF_UNSUPPORTED_COMPONENT',
        `'children' on component '<${node.name}>' must be authored as JSX children, not a prop value: it is the recipe projection channel (JSX value model §4.4)`,
        span,
      );
      refused = true;
      continue;
    }
    if (!componentPropAdmitted(state, attribute, node.name, span)) {
      refused = true;
      continue;
    }
    admitted.push(attribute);
  }
  if (refused) return;

  const id = state.counter.value++;
  const propsVar = `${INTERNAL_PREFIX}childProps${id}`;
  const hostVar = `${INTERNAL_PREFIX}childHost${id}`;
  const scopeVar = `${INTERNAL_PREFIX}childScope${id}`;
  const nodesVar = `${INTERNAL_PREFIX}childNodes${id}`;

  // Pass 2: resolve the dynamic prop expressions (prologue reads + the defining
  // scope dependencies the child refreshes through) before emitting the record,
  // so the block below is one authored-order sequence.
  const propDeps = new Set<string>();
  let needsParentProps = false;
  type ResolvedProp =
    | { readonly kind: 'static'; readonly name: string; readonly value: string }
    | {
        readonly kind: 'dynamic';
        readonly name: string;
        readonly record: LoweredExpressionRecord;
        readonly span: SpanLike;
      };
  const resolved: ResolvedProp[] = [];
  let failed = false;
  for (const prop of admitted) {
    if (prop.kind === 'static') {
      resolved.push(prop);
      continue;
    }
    const record = recordFor(state, prop.expression, records);
    if (record === null || !declareReads(state, record)) {
      failed = true;
      continue;
    }
    const dependencies = dependencyNames(state, record);
    if (dependencies === null) {
      failed = true;
      continue;
    }
    for (const dependency of dependencies) {
      if (dependency.fromProps) needsParentProps = true;
      else propDeps.add(dependency.name);
    }
    resolved.push({
      kind: 'dynamic',
      name: prop.name,
      record,
      span: prop.span,
    });
  }
  if (failed) return;
  if (resolved.length > 0 || childrenRecipeVar !== null) {
    push(state, `const ${propsVar} = {`, span);
    state.indent += 1;
    // The children channel is a plain property holding the recipe object, not a
    // per-read getter: inserting it (and refreshing its dynamic content) is the
    // children recipe body's own subscription work (M06b2a).
    if (childrenRecipeVar !== null) push(state, `children: ${childrenRecipeVar},`, span);
    for (const prop of resolved) {
      if (prop.kind === 'static') {
        const key = IDENTIFIER_PATTERN.test(prop.name) ? prop.name : JSON.stringify(prop.name);
        push(state, `${key}: ${JSON.stringify(prop.value)},`);
        continue;
      }
      const key = IDENTIFIER_PATTERN.test(prop.name) ? prop.name : JSON.stringify(prop.name);
      pushParts(state, [`get ${key}() { return (`, { record: prop.record }, '); },'], prop.span);
    }
    state.indent -= 1;
    push(state, '};');
  }

  // The child instance's host record: the parent host bindings (so the child
  // resolves its own host reads from the same module-level record) plus the
  // defining-scope signals behind the passed prop expressions.
  const depParts = [...propDeps];
  if (needsParentProps) depParts.push(`...${state.hostVar}.propDeps`);
  push(
    state,
    `const ${hostVar} = { bindings: ${state.hostVar}.bindings, propDeps: [${depParts.join(', ')}] };`,
    span,
  );

  // Fresh child scope, exception-safe mount, range cleanup before the parent can
  // append: the same ownership mapping the M04 mount contract uses.
  push(state, `const ${scopeVar} = ${state.scopeVar}.child();`, span);
  push(state, `let ${nodesVar};`);
  push(state, `try {`);
  state.indent += 1;
  push(
    state,
    `${nodesVar} = ${node.name}${MOUNT_SUFFIX}(${scopeVar}, ${resolved.length > 0 || childrenRecipeVar !== null ? propsVar : '{}'}, ${hostVar});`,
    span,
  );
  state.indent -= 1;
  push(state, `} catch (error) { ${scopeVar}.dispose(true); throw error; }`);
  push(state, `${scopeVar}.addRangeCleanup(() => removeNodes(${nodesVar}));`);
  sink.push({ kind: 'spread', name: nodesVar });
}

/**
 * Collect the recipe ids referenced by at least one insertion site reachable
 * from the component roots (M06b1a-2). Delivery is transitive: a site inside a
 * recipe body keeps the referenced recipe alive, while a direct declaration no
 * admitted site reaches is not emitted at all.
 */
function referencedRecipeIds(component: FunctionModelComponent): Set<string> {
  const byId = new Map(component.recipes.map((recipe) => [recipe.id, recipe] as const));
  const referenced = new Set<string>();
  const pending: string[] = [];
  const collect = (nodes: readonly FunctionModelNode[]): void => {
    for (const node of nodes) {
      switch (node.kind) {
        case 'insertion-site':
          if (!referenced.has(node.recipeId)) {
            referenced.add(node.recipeId);
            pending.push(node.recipeId);
          }
          break;
        case 'component-ref':
          // A component reference with JSX children passes its children recipe
          // as `props.children` (M06b2a): it must be emitted wherever the ref is.
          if (node.childrenRecipeId !== null && !referenced.has(node.childrenRecipeId)) {
            referenced.add(node.childrenRecipeId);
            pending.push(node.childrenRecipeId);
          }
          break;
        case 'element':
        case 'fragment':
          collect(node.children);
          break;
        case 'condition':
          collect(node.consequent);
          if (node.alternate !== null) collect(node.alternate);
          break;
        case 'list':
          collect(node.template);
          break;
        default:
          break;
      }
    }
  };
  collect(component.roots);
  while (pending.length > 0) {
    const recipe = byId.get(pending.pop()!);
    if (recipe !== undefined) collect([recipe.target]);
  }
  return referenced;
}

/**
 * Does this component's mount project `props.children`? Only roots (and their
 * condition/list builders) count: a projection inside a reusable recipe body is
 * refused (`recipeDepth`), so the mount-level read is needed exactly when a
 * projection is reachable from the roots (M06b2a).
 */
function componentProjectsChildren(component: FunctionModelComponent): boolean {
  const walk = (nodes: readonly FunctionModelNode[]): boolean => {
    for (const node of nodes) {
      switch (node.kind) {
        case 'children-projection':
          return true;
        case 'element':
        case 'fragment':
          if (walk(node.children)) return true;
          break;
        case 'condition':
          if (walk(node.consequent)) return true;
          if (node.alternate !== null && walk(node.alternate)) return true;
          break;
        case 'list':
          if (walk(node.template)) return true;
          break;
        default:
          break;
      }
    }
    return false;
  };
  return walk(component.roots);
}

/** One `childrenRecipeId` projection edge (M06b2a mount-graph input). */
interface ChildrenProjectionEdge {
  /** The component whose mount projects the children recipe (the child). */
  readonly projectingComponent: string;
  /** The defining component whose recipe it is, and the recipe id. */
  readonly definingComponent: string;
  readonly recipeId: string;
  readonly span: IrSpan;
}

/**
 * Collect every `<Child>…</Child>` reference site in one component's roots: the
 * child mount will project that children recipe whenever `<Child>` itself
 * projects `props.children` (M06b2a). Used by `findMountCycle` to add the
 * conservative projection edge `c:<Child> -> r:<defining>:<childrenRecipeId>`,
 * so a component that projects the children of a reference back to itself is
 * refused instead of emitting an unbounded mount.
 */
function collectChildrenProjectionEdges(
  component: FunctionModelComponent,
  out: ChildrenProjectionEdge[],
): void {
  const walk = (nodes: readonly FunctionModelNode[]): void => {
    for (const node of nodes) {
      switch (node.kind) {
        case 'component-ref':
          if (node.childrenRecipeId !== null) {
            out.push({
              projectingComponent: node.name,
              definingComponent: component.name,
              recipeId: node.childrenRecipeId,
              span: node.span,
            });
          }
          break;
        case 'element':
        case 'fragment':
          walk(node.children);
          break;
        case 'condition':
          walk(node.consequent);
          if (node.alternate !== null) walk(node.alternate);
          break;
        case 'list':
          walk(node.template);
          break;
        default:
          break;
      }
    }
  };
  walk(component.roots);
}

/** One recipe's generated names plus its model entry. */
interface PlannedRecipe {
  readonly recipe: FunctionModelRecipe;
  readonly recipeVar: string;
  readonly scopeVar: string;
  readonly nodesVar: string;
}

/**
 * Emit one `createRecipe` per referenced reusable JSX value (M06b1a-2).
 *
 * The mount body stays inline in the component chunk with its own recipe scope:
 * lowered expressions keep their A2 segments/placements (the per-chunk line
 * rebase is unchanged) and refresh subscriptions bind on the recipe instance.
 * Recipe variables are published before any body is emitted so an insertion
 * site inside another recipe body can reference any referenced recipe; the
 * recipe graph is acyclic (`findMountCycle` refuses cycles before emission).
 */
function emitRecipes(
  state: EmitState,
  file: string,
  records: ReadonlyMap<string, LoweredExpressionRecord>,
): void {
  const referenced = referencedRecipeIds(state.component);
  if (referenced.size === 0) return;
  const plans: PlannedRecipe[] = [];
  for (const recipe of state.component.recipes) {
    if (!referenced.has(recipe.id)) continue;
    const plan: PlannedRecipe = {
      recipe,
      recipeVar: nextName(state, 'recipe'),
      scopeVar: nextName(state, 'recipeScope'),
      nodesVar: nextName(state, 'recipeNodes'),
    };
    state.recipeVars.set(recipe.id, plan.recipeVar);
    plans.push(plan);
  }
  // One createRecipe per value, in model (authored declaration) order.
  for (const plan of plans) {
    const { recipe } = plan;
    const outerOrdinals = state.textOrdinals;
    const preparedTarget = normalizeTextRuns([recipe.target]);
    state.textOrdinals = textSlotOrdinals(preparedTarget);
    if (state.emitTextBoundaries && !assertTextBoundaryContext(state, preparedTarget)) {
      state.textOrdinals = outerOrdinals;
      return;
    }
    push(state, `const ${plan.recipeVar} = createRecipe({`, recipe.span);
    state.indent += 1;
    push(state, `definitionOwner: ${MOUNT_SCOPE},`);
    push(
      state,
      `source: ${JSON.stringify(`${file}#${state.component.name}:${recipe.id.replace(/^#/, '')}`)},`,
    );
    push(state, `mount(${plan.scopeVar}) {`, recipe.span);
    state.indent += 1;
    push(state, `const ${plan.nodesVar} = [];`);
    const outerScope = state.scopeVar;
    state.scopeVar = plan.scopeVar;
    state.recipeDepth += 1;
    const sink: SinkEntry[] = [];
    emitNode(state, recipe.target, sink, records);
    appendSinkToArray(state, sink, plan.nodesVar);
    state.recipeDepth -= 1;
    state.scopeVar = outerScope;
    push(state, `return ${plan.nodesVar};`);
    state.indent -= 1;
    push(state, '},');
    state.indent -= 1;
    push(state, '});');
    state.textOrdinals = outerOrdinals;
  }
}

/**
 * Emit one insertion site (M06b1a-2): a temporary `DocumentFragment` target,
 * one M04 `insertRecipe` projection on the current builder scope, and a sink
 * entry spreading the projection's `nodes` into the enclosing sink in authored
 * order. The fragment is only the insertion target: M04 registers a
 * parentNode-based `removeNodes(nodes)` range cleanup, so moving the nodes into
 * their final parent keeps the default-dispose-keeps-DOM / `dispose(true)`
 * region contract.
 */
function emitInsertionSite(
  state: EmitState,
  node: FunctionModelInsertionSite,
  sink: SinkEntry[],
): void {
  if (!state.declaredRecipeIds.has(node.recipeId)) {
    diag(
      state,
      'OEIR_LEAF_UNSUPPORTED_RECIPE',
      `insertion site '${node.recipeId}' does not target a direct component-local JSX initializer; only those values are reusable recipes in this slice`,
      node.span,
    );
    return;
  }
  const recipeVar = state.recipeVars.get(node.recipeId);
  if (recipeVar === undefined) {
    diag(
      state,
      'OEIR_LEAF_MISSING_RECIPE',
      `insertion site '${node.recipeId}' has no emitted recipe (the value is not reachable from any admitted root)`,
      node.span,
    );
    return;
  }
  const fragmentVar = nextName(state, 'insertTarget');
  const projectionVar = nextName(state, 'projection');
  push(state, `const ${fragmentVar} = document.createDocumentFragment();`, node.span);
  push(
    state,
    `const ${projectionVar} = insertRecipe(${state.scopeVar}, ${recipeVar}, ${fragmentVar});`,
    node.span,
  );
  sink.push({ kind: 'projection', name: projectionVar });
}

/**
 * Emit one `{props.children}` projection (M06b2a, JSX value model §4.4): the
 * mount's single `__oe_props.children` recipe inserted through the SAME
 * `DocumentFragment` + `insertRecipe` mechanism as an insertion site, on the
 * current builder scope (a live descendant of the defining owner, so the M04
 * projection lineage admits). Every site is an independent projection — two
 * sites against one recipe variable are two owners, two instances, two
 * cleanups. Refresh of dynamic children content belongs to the children
 * recipe body's own subscriptions; nothing here re-reads the child props.
 */
function emitChildrenProjection(
  state: EmitState,
  node: FunctionModelChildrenProjection,
  sink: SinkEntry[],
): void {
  if (state.recipeDepth > 0) {
    diag(
      state,
      'OEIR_LEAF_UNSUPPORTED_NODE',
      `children projection inside a reusable JSX value body is outside the M06b2a slice: the projection would need the recipe instance scope, which exists only at insertion time`,
      node.span,
    );
    return;
  }
  const recipeVar = state.childrenRecipeVar;
  if (recipeVar === null) {
    diag(
      state,
      'OEIR_LEAF_MISSING_CHILDREN',
      'children projection has no mount-level `props.children` recipe read (internal model mismatch)',
      node.span,
    );
    return;
  }
  const fragmentVar = nextName(state, 'childrenTarget');
  const projectionVar = nextName(state, 'childrenProjection');
  push(state, `const ${fragmentVar} = document.createDocumentFragment();`, node.span);
  push(
    state,
    `const ${projectionVar} = insertRecipe(${state.scopeVar}, ${recipeVar}, ${fragmentVar});`,
    node.span,
  );
  sink.push({ kind: 'projection', name: projectionVar });
}

function flattenFragments(nodes: readonly FunctionModelNode[]): FunctionModelNode[] {
  const flat: FunctionModelNode[] = [];
  for (const node of nodes) {
    if (node.kind === 'fragment') flat.push(...flattenFragments(node.children));
    else flat.push(node);
  }
  return flat;
}

/**
 * M08 static text-run normalization. Fragments have no DOM identity, so they
 * are flattened first; then each maximal run of adjacent `text` nodes becomes
 * one shallow copy with the concatenated value and the first node's span. Only
 * static text is merged: dynamic text is a slot identity and a pair boundary,
 * never part of a run.
 *
 * The rule is a view, not an IR mutation: callers receive a new list and the
 * model stays authored. It is idempotent, so a surface may normalize again
 * without changing the result.
 */
function normalizeTextRuns(nodes: readonly FunctionModelNode[]): FunctionModelNode[] {
  const flat: FunctionModelNode[] = [];
  const append = (list: readonly FunctionModelNode[]): void => {
    for (const node of list) {
      if (node.kind === 'fragment') {
        append(node.children);
        continue;
      }
      if (node.kind === 'text') {
        const previous = flat[flat.length - 1];
        if (previous !== undefined && previous.kind === 'text') {
          flat[flat.length - 1] = {
            kind: 'text',
            value: previous.value + node.value,
            span: previous.span,
          };
          continue;
        }
      }
      flat.push(node);
    }
  };
  append(nodes);
  return flat;
}

/** The child-list view a claimable chunk uses; pure-mount chunks stay authored. */
function emissionNodes(
  state: EmitState,
  nodes: readonly FunctionModelNode[],
): readonly FunctionModelNode[] {
  return state.emitTextBoundaries ? normalizeTextRuns(nodes) : nodes;
}

/**
 * Chunk-local pre-order ordinals for dynamic text slots. The walk descends
 * through elements and fragments only: a component reference, insertion site,
 * children projection, condition or list starts/owns another chunk and does not
 * consume an ordinal in this one. Mount, claim and SSR call the same helper, so
 * they agree on the sequence without sharing emission-order state.
 */
function textSlotOrdinals(
  nodes: readonly FunctionModelNode[],
): ReadonlyMap<FunctionModelNode, number> {
  const ordinals = new Map<FunctionModelNode, number>();
  let next = 0;
  const visit = (list: readonly FunctionModelNode[]): void => {
    for (const node of list) {
      if (node.kind === 'dynamic-text') {
        ordinals.set(node, next);
        next += 1;
        continue;
      }
      if (node.kind === 'element' || node.kind === 'fragment') visit(node.children);
    }
  };
  visit(nodes);
  return ordinals;
}

/** The slot ordinal for one node, or an internal diagnostic when unmapped. */
function textOrdinal(state: EmitState, node: FunctionModelNode): number | null {
  const ordinal = state.textOrdinals.get(node);
  if (ordinal === undefined) {
    diag(
      state,
      'OEIR_LEAF_TEXT_BOUNDARY_UNMAPPED',
      'internal: dynamic text has no chunk-local ordinal; refusing to guess a marker',
      node.span,
    );
    return null;
  }
  return ordinal;
}

type TextParserContext =
  | { readonly kind: 'flow' }
  | {
      readonly kind:
        | 'rcdata'
        | 'rawtext'
        | 'template'
        | 'noscript'
        | 'foreign'
        | 'foster'
        | 'select';
      readonly tag: string;
    };

type RestrictedTextParserContext = Exclude<TextParserContext, { readonly kind: 'flow' }>;

interface TextContextViolation {
  readonly node: FunctionModelNode;
  readonly context: RestrictedTextParserContext;
  readonly detail: 'dynamic text' | 'static text' | 'a props.children projection';
}

interface TextContextWalker {
  readonly component: (name: string) => FunctionModelComponent | undefined;
  /** Recipes of the component whose nodes are currently being walked. */
  readonly recipes: readonly FunctionModelRecipe[];
  /** Active component/recipe path, not a global visited set: context matters. */
  readonly stack: Set<string>;
}

function textContextWalker(state: EmitState): TextContextWalker {
  return {
    component: (name) => state.componentByName.get(name),
    recipes: state.component.recipes,
    stack: new Set(),
  };
}

/**
 * The parser context a child element establishes. RCDATA/rawtext/template/
 * noscript/foreign content are sticky: every authored descendant is still
 * parsed in that mode, so an `oe:t` pair cannot be placed there. Foster
 * parenting is different: `td`, `th` and a table-level `caption` are normal
 * flow content and reset it. This is what keeps legal `<td><p>{x}</p>` out of
 * the refusal without accepting `<table>{x}</table>` or `<tr>{x}</tr>`.
 */
function textContextForChild(context: TextParserContext, tag: string): TextParserContext {
  if (context.kind !== 'flow' && context.kind !== 'foster') return context;
  if (context.kind === 'foster') {
    if (TEXT_TABLE_FLOW_TAGS.has(tag)) {
      return tag === 'caption' && context.tag !== 'table' ? context : { kind: 'flow' };
    }
    // A template is inserted inside the table; its children live in
    // `.content`, so the template reason is more accurate than foster parenting.
    if (tag === 'template') return { kind: 'template', tag };
    if (TEXT_FOSTER_TAGS.has(tag)) return { kind: 'foster', tag };
    return context;
  }
  if (TEXT_RCDATA_TAGS.has(tag)) return { kind: 'rcdata', tag };
  if (TEXT_RAWTEXT_TAGS.has(tag)) return { kind: 'rawtext', tag };
  if (tag === 'template') return { kind: 'template', tag };
  if (tag === 'noscript') return { kind: 'noscript', tag };
  if (TEXT_FOREIGN_TAGS.has(tag)) return { kind: 'foreign', tag };
  if (TEXT_FOSTER_TAGS.has(tag)) return { kind: 'foster', tag };
  if (TEXT_TABLE_FLOW_TAGS.has(tag)) return { kind: 'flow' };
  if (TEXT_SELECT_TAGS.has(tag)) return { kind: 'select', tag };
  return context;
}

function textContextReason(context: TextParserContext): string {
  switch (context.kind) {
    case 'rcdata':
      return 'RCDATA parses comments as literal text';
    case 'rawtext':
      return 'rawtext parses comments as literal text';
    case 'template':
      return 'template content lives in .content, not childNodes';
    case 'noscript':
      return 'noscript parsing depends on the scripting flag, so comments are not stable Comment nodes';
    case 'foreign':
      return 'the generated claim is HTML-namespace-only; foreign content (SVG/MathML) is outside that contract';
    case 'foster':
      return `the HTML parser foster-parents non-whitespace text out of the table (current <${context.tag}>); the generated claim cannot find it in place`;
    case 'select':
      return 'the select family is a conservative boundary of this text-boundary slice; its insertion mode is not part of the qualified contract';
    case 'flow':
      return 'this context exposes comments as Comment nodes';
  }
}

/**
 * The first text that would land in a restricted parser context, or `null`.
 * The walk crosses component references and insertion-site recipes only while
 * the current context is restricted, because the parent's parser context
 * applies to the child's emitted nodes too. A `props.children` projection under
 * such a context cannot be proven safe at the producer, so it is refused at the
 * projection source.
 *
 * `td`/`th` and table-level `caption` reset the context; table sections/rows
 * and `colgroup` keep it because their text is foster-parented. Cycles are
 * already refused by `findMountCycle`; the path stack keeps this scan finite.
 */
function findTextContextViolation(
  nodes: readonly FunctionModelNode[],
  context: TextParserContext,
  walker: TextContextWalker,
): TextContextViolation | null {
  for (const node of nodes) {
    if (node.kind === 'dynamic-text') {
      if (context.kind !== 'flow') return { node, context, detail: 'dynamic text' };
      continue;
    }
    if (node.kind === 'text') {
      // Comments and whitespace-only text survive table parsing; non-whitespace
      // static text is foster-parented just like a dynamic value would be.
      if (context.kind === 'foster' && !HTML_WHITESPACE_ONLY.test(node.value)) {
        return { node, context, detail: 'static text' };
      }
      continue;
    }
    if (node.kind === 'fragment') {
      const found = findTextContextViolation(node.children, context, walker);
      if (found !== null) return found;
      continue;
    }
    if (node.kind === 'condition') {
      // A condition branch is still emitted inside the parent's parser context
      // (the branch comments/nodes do not establish a new parsing mode), so the
      // scan must descend into both branches. Without this, a claimable
      // condition branch could put an `oe:t` pair under `<textarea>`.
      const thenFound = findTextContextViolation(node.consequent, context, walker);
      if (thenFound !== null) return thenFound;
      if (node.alternate !== null) {
        const elseFound = findTextContextViolation(node.alternate, context, walker);
        if (elseFound !== null) return elseFound;
      }
      continue;
    }
    if (node.kind === 'list') {
      // Entry bytes are still emitted inside the parent's parser context; a
      // claimable list template must not hide a text slot under textarea.
      const entries = findTextContextViolation(node.template, context, walker);
      if (entries !== null) return entries;
      continue;
    }
    if (node.kind === 'component-ref' && context.kind !== 'flow') {
      const key = `c:${node.name}`;
      if (walker.stack.has(key)) continue;
      walker.stack.add(key);
      const target = walker.component(node.name);
      const found =
        target === undefined
          ? null
          : findTextContextViolation(target.roots, context, {
              ...walker,
              recipes: target.recipes,
            });
      walker.stack.delete(key);
      if (found !== null) return found;
      continue;
    }
    if (node.kind === 'insertion-site' && context.kind !== 'flow') {
      const key = `r:${node.recipeId}`;
      if (walker.stack.has(key)) continue;
      walker.stack.add(key);
      const recipe = walker.recipes.find((entry) => entry.id === node.recipeId);
      const found =
        recipe === undefined ? null : findTextContextViolation([recipe.target], context, walker);
      walker.stack.delete(key);
      if (found !== null) return found;
      continue;
    }
    if (node.kind === 'children-projection' && context.kind !== 'flow') {
      return { node, context, detail: 'a props.children projection' };
    }
    if (node.kind !== 'element') continue;
    const found = findTextContextViolation(
      node.children,
      textContextForChild(context, node.tag),
      walker,
    );
    if (found !== null) return found;
  }
  return null;
}

/**
 * Refuse a chunk whose text cannot be claimed in the target parser context.
 * This is a source-located compile failure, not a silent mount-only fallback:
 * the same authored component must not quietly change execution mode. The scan
 * crosses component/insertion chunks because the parent's parser context
 * applies to the child's emitted comments too.
 */
function assertTextBoundaryContext(state: EmitState, nodes: readonly FunctionModelNode[]): boolean {
  const violation = findTextContextViolation(nodes, { kind: 'flow' }, textContextWalker(state));
  if (violation === null) return true;
  diag(
    state,
    'OEIR_LEAF_UNSUPPORTED_TEXT_CONTEXT',
    `${violation.detail} under <${violation.context.tag}> cannot be claimed: ${textContextReason(violation.context)}`,
    violation.node.span,
  );
  return false;
}

function directoryParentAllowed(tag: string): boolean {
  return TAG_PATTERN.test(tag) && !DIRECTORY_EXCLUDED_TAGS.has(tag);
}

/** A fully static element tree: no dynamic slots, sites, or excluded tags. */
function isStaticDirectoryElement(node: FunctionModelNode): boolean {
  if (node.kind !== 'element') return false;
  if (!directoryParentAllowed(node.tag)) return false;
  for (const attribute of node.attributes) {
    if (attribute.kind !== 'static' || !ATTRIBUTE_PATTERN.test(attribute.name)) return false;
  }
  for (const child of flattenFragments(node.children)) {
    if (child.kind === 'text') continue;
    if (!isStaticDirectoryElement(child)) return false;
  }
  return true;
}

/**
 * Two or more static element siblings, fragments flattened. One child stays on
 * the M07a path. Text, dynamic slots, and insertion sites make this `null`,
 * so the parent is not wrapped and text is left where it is.
 */
function staticElementDirectory(nodes: readonly FunctionModelNode[]): FunctionModelNode[] | null {
  const flat = normalizeTextRuns(nodes);
  if (flat.length < 2) return null;
  if (!flat.every((node) => isStaticDirectoryElement(node))) return null;
  return flat;
}

function declaredStaticLiteral(node: FunctionModelNode): string {
  if (node.kind === 'text') return `{ kind: "text", nodeValue: ${JSON.stringify(node.value)} }`;
  if (node.kind !== 'element') return '{ kind: "text", nodeValue: "" }';
  const attributes = node.attributes
    .filter((attribute) => attribute.kind === 'static')
    .map(
      (attribute) =>
        `{ name: ${JSON.stringify(attribute.name)}, value: ${JSON.stringify(attribute.value)} }`,
    )
    .join(', ');
  const children = normalizeTextRuns(node.children)
    .map((child) => declaredStaticLiteral(child))
    .join(', ');
  return `{ kind: "element", localName: ${JSON.stringify(node.tag)}, attributes: [${attributes}], children: [${children}] }`;
}

function appendGeneratedNode(
  state: EmitState,
  target: { readonly kind: 'element' | 'array'; readonly name: string },
  nodeName: string,
): void {
  if (target.kind === 'element') push(state, `${target.name}.appendChild(${nodeName});`);
  else push(state, `${target.name}.push(${nodeName});`);
}

/**
 * Mount one pure static directory. Interiors are emitted with directories
 * suppressed, so a range does not contain another range. Called only when
 * this component emits a claim function (ADR-0175 D-2).
 */
function emitMountedDirectory(
  state: EmitState,
  ranges: readonly FunctionModelNode[],
  records: ReadonlyMap<string, LoweredExpressionRecord>,
  target: { readonly kind: 'element' | 'array'; readonly name: string },
): void {
  ranges.forEach((range, ordinal) => {
    const span = range.span;
    const start = nextName(state, 'mark');
    push(state, `const ${start} = emitComment(rangeMarker(${ordinal}));`, span);
    appendGeneratedNode(state, target, start);
    const sink: SinkEntry[] = [];
    emitNode(state, range, sink, records, false);
    for (const entry of sink) {
      if (entry.kind === 'node') appendGeneratedNode(state, target, entry.name);
    }
    const end = nextName(state, 'mark');
    push(state, `const ${end} = emitComment(rangeMarker(${ordinal}, true));`, span);
    appendGeneratedNode(state, target, end);
  });
}

/**
 * Claim one pure static directory through the M07b consumer. Ordinals are the
 * generator's own literals, not a scan of the live child list.
 *
 * `activate` is `() => {}` on purpose: this path has no dynamic binding. A
 * directory that admits a dynamic slot must pass a real `activate`. Keeping
 * the empty function there would present an incomplete claim as complete.
 */
function emitClaimedDirectory(
  state: EmitState,
  parentVar: string,
  ranges: readonly FunctionModelNode[],
): string[] {
  // Recorded from the emitted call site, not inferred from the text later.
  state.usesStaticSiblingDirectoryConsumer = true;
  const directory = nextName(state, 'directory');
  const declaration = ranges.map((range) => `[${declaredStaticLiteral(range)}]`).join(', ');
  push(
    state,
    `const ${directory} = openStaticSiblingDirectory(${parentVar}, [${declaration}], ${JSON.stringify(state.directorySource)});`,
  );
  const adopted: string[] = [];
  ranges.forEach((range, ordinal) => {
    const claim = nextName(state, 'range');
    push(
      state,
      `const ${claim} = claimStaticSiblingRange(${directory}, ${ordinal}, ${state.scopeVar}, () => {});`,
      range.span,
    );
    const interior = nextName(state, 'el');
    push(state, `const ${interior} = ${claim}.interior[0];`);
    adopted.push(interior);
  });
  return adopted;
}

function emitNode(
  state: EmitState,
  node: FunctionModelNode,
  sink: SinkEntry[],
  records: ReadonlyMap<string, LoweredExpressionRecord>,
  allowDirectory = true,
): void {
  const span: IrSpan = node.span;
  if (node.kind === 'text') {
    const varName = nextName(state, 'text');
    push(
      state,
      `const ${varName} = document.createTextNode(${JSON.stringify(node.value)});`,
      node.span,
    );
    sink.push({ kind: 'node', name: varName });
    return;
  }
  if (node.kind === 'fragment') {
    // A fragment is not a directory parent, but it is still inside the caller's
    // range. Dropping `allowDirectory` restores the default and lets that
    // interior emit its own `oe:r` pair. The child list is normalized on the
    // same gate as every other claimable surface.
    for (const child of emissionNodes(state, node.children))
      emitNode(state, child, sink, records, allowDirectory);
    return;
  }
  if (node.kind === 'condition') {
    emitCondition(state, node, sink, records);
    return;
  }
  if (node.kind === 'list') {
    emitList(state, node, sink, records);
    return;
  }
  if (node.kind === 'element') {
    if (!TAG_PATTERN.test(node.tag)) {
      diag(
        state,
        'OEIR_LEAF_UNSUPPORTED_TAG',
        `tag '${node.tag}' is not a plain intrinsic element name`,
        span,
      );
      return;
    }
    const varName = nextName(state, 'el');
    push(
      state,
      `const ${varName} = document.createElement(${JSON.stringify(node.tag)});`,
      node.span,
    );
    for (const attribute of node.attributes) {
      if (attribute.kind === 'dynamic' && CONSUMED_ATTRIBUTE_CHANNELS.has(attribute.channel)) {
        // `key` is list identity, consumed by the enclosing list emitter; it is
        // never written to the DOM as an attribute.
        continue;
      }
      if (!attributeAdmitted(state, attribute, span)) continue;
      if (attribute.kind === 'static') {
        if (unsafeStreamFrameAttribute(attribute.name, attribute.value)) {
          diag(
            state,
            'OEIR_LEAF_UNSAFE_ATTRIBUTE',
            `static URL attribute '${attribute.name}' carries a script-bearing scheme`,
            span,
          );
          continue;
        }
        push(
          state,
          `${varName}.setAttribute(${JSON.stringify(attribute.name)}, ${JSON.stringify(attribute.value)});`,
          attribute.span,
        );
        continue;
      }
      const record = recordFor(state, attribute.expression, records);
      if (record === null || !declareReads(state, record)) continue;
      const dependencies = dependencyNames(state, record);
      if (dependencies === null) continue;
      if (dependencies.length === 0) {
        if (!readsEntryLocal(state, record)) {
          emitAttributeWrite(
            state,
            varName,
            attribute.name,
            attribute.channel,
            record,
            attribute.span,
          );
          continue;
        }
        // Entry-local read without a reactive dependency: the enclosing entry
        // builder's `update(next)` re-binds the mapper parameter, so the write
        // must re-run from a registered refresh closure (M06b2c).
        registerRefresh(
          state,
          emitLocalRefresh(state, attribute.span, () =>
            emitAttributeWrite(
              state,
              varName,
              attribute.name,
              attribute.channel,
              record,
              attribute.span,
            ),
          ),
        );
        continue;
      }
      const refresh = nextName(state, 'refresh');
      push(state, `function ${refresh}() {`, attribute.span);
      state.indent += 1;
      emitAttributeWrite(state, varName, attribute.name, attribute.channel, record, attribute.span);
      state.indent -= 1;
      push(state, `}`);
      push(state, `${refresh}();`);
      emitDependencySubscriptions(state, dependencies, refresh, attribute.span);
      registerRefresh(state, refresh);
    }
    const ranges =
      allowDirectory && state.emitDirectoryMarkers && directoryParentAllowed(node.tag)
        ? staticElementDirectory(node.children)
        : null;
    if (ranges !== null)
      emitMountedDirectory(state, ranges, records, { kind: 'element', name: varName });
    else {
      for (const child of emissionNodes(state, node.children)) {
        const childSink: SinkEntry[] = [];
        emitNode(state, child, childSink, records, allowDirectory);
        appendSinkToElement(state, childSink, varName);
      }
    }
    sink.push({ kind: 'node', name: varName });
    return;
  }
  if (node.kind === 'dynamic-text') {
    const record = recordFor(state, node.expression, records);
    if (record === null || !declareReads(state, record)) return;
    const dependencies = dependencyNames(state, record);
    if (dependencies === null) return;
    let boundaryEnd: string | null = null;
    if (state.emitTextBoundaries) {
      const ordinal = textOrdinal(state, node);
      if (ordinal === null) return;
      const boundaryStart = nextName(state, 'textStart');
      push(state, `const ${boundaryStart} = emitComment(textSlotMarker(${ordinal}));`, node.span);
      sink.push({ kind: 'node', name: boundaryStart });
      boundaryEnd = nextName(state, 'textEnd');
      const textVar = nextName(state, 'text');
      push(state, `const ${textVar} = document.createTextNode("");`, node.span);
      sink.push({ kind: 'node', name: textVar });
      push(
        state,
        `const ${boundaryEnd} = emitComment(textSlotMarker(${ordinal}, true));`,
        node.span,
      );
      sink.push({ kind: 'node', name: boundaryEnd });
      if (dependencies.length === 0) {
        if (!readsEntryLocal(state, record)) {
          emitTextWrite(state, textVar, record);
          return;
        }
        // Entry-local read without a reactive dependency: the entry update hook
        // re-binds the mapper parameter, so the text write must re-run from a
        // registered refresh closure (M06b2c — unkeyed/same-key reuse).
        registerRefresh(
          state,
          emitLocalRefresh(state, node.span, () => emitTextWrite(state, textVar, record)),
        );
        return;
      }
      const refresh = nextName(state, 'refresh');
      push(state, `function ${refresh}() {`, node.span);
      state.indent += 1;
      emitTextWrite(state, textVar, record);
      state.indent -= 1;
      push(state, `}`);
      push(state, `${refresh}();`);
      emitDependencySubscriptions(state, dependencies, refresh, node.span);
      registerRefresh(state, refresh);
      return;
    }
    const textVar = nextName(state, 'text');
    push(state, `const ${textVar} = document.createTextNode("");`, node.span);
    sink.push({ kind: 'node', name: textVar });
    if (dependencies.length === 0) {
      if (!readsEntryLocal(state, record)) {
        emitTextWrite(state, textVar, record);
        return;
      }
      // Entry-local read without a reactive dependency: the entry update hook
      // re-binds the mapper parameter, so the text write must re-run from a
      // registered refresh closure (M06b2c — unkeyed/same-key reuse).
      registerRefresh(
        state,
        emitLocalRefresh(state, node.span, () => emitTextWrite(state, textVar, record)),
      );
      return;
    }
    const refresh = nextName(state, 'refresh');
    push(state, `function ${refresh}() {`, node.span);
    state.indent += 1;
    emitTextWrite(state, textVar, record);
    state.indent -= 1;
    push(state, `}`);
    push(state, `${refresh}();`);
    emitDependencySubscriptions(state, dependencies, refresh, node.span);
    registerRefresh(state, refresh);
    return;
  }
  if (node.kind === 'component-ref') {
    emitComponentRef(state, node, sink, records);
    return;
  }
  if (node.kind === 'insertion-site') {
    emitInsertionSite(state, node, sink);
    return;
  }
  if (node.kind === 'children-projection') {
    emitChildrenProjection(state, node, sink);
    return;
  }
  // Defensive: a model node kind without a generator branch must fail closed,
  // never be dropped silently.
  diag(
    state,
    'OEIR_LEAF_UNSUPPORTED_NODE',
    `node '${(node as { readonly kind: string }).kind}' is outside the generated-leaf slice`,
    span,
  );
}

interface EmittedComponent {
  readonly lines: string[];
  readonly diagnostics: readonly IrDiagnostic[];
  readonly requiredBindings: readonly string[];
  readonly requiredProps: readonly string[];
  readonly requiresPropsChanged: boolean;
  readonly segments: readonly EmissionSegment[];
  readonly placements: readonly ExpressionPlacement[];
  /** True when this component's generated claim calls the directory consumer. */
  readonly usesStaticSiblingDirectoryConsumer?: boolean;
  /** True when this component's generated claim calls `claimRecipe`. */
  readonly usesClaimRecipe?: boolean;
  /** True when the emitted claim throws the leaf mismatch. */
  readonly usesLeafClaimMismatch?: boolean;
}

interface ClaimEmission {
  readonly lines: string[];
  readonly diagnostics: readonly IrDiagnostic[];
  readonly segments: readonly EmissionSegment[];
  readonly placements: readonly ExpressionPlacement[];
  /** True when the emitted claim calls the directory consumer. */
  readonly usesStaticSiblingDirectoryConsumer?: boolean;
  /** True when the emitted claim calls `claimRecipe`. */
  readonly usesClaimRecipe?: boolean;
  /** True when the emitted claim throws the leaf mismatch. */
  readonly usesLeafClaimMismatch?: boolean;
}

interface ClaimContext {
  readonly componentByName: ReadonlyMap<string, FunctionModelComponent>;
  /** Components currently being tested, so a reference cycle fails closed. */
  readonly stack: Set<string>;
}

function recipeMap(component: FunctionModelComponent): Map<string, FunctionModelRecipe> {
  return new Map(component.recipes.map((recipe) => [recipe.id, recipe] as const));
}

function declaredRecipeIdSet(component: FunctionModelComponent): Set<string> {
  const ids = new Set<string>();
  for (const resource of component.resources) {
    if (resource.recipeId !== null) ids.add(resource.recipeId);
  }
  return ids;
}

function componentOwnsReactiveResources(component: FunctionModelComponent): boolean {
  return component.resources.some(
    (resource) => resource.kind === 'signal' || resource.kind === 'computed',
  );
}

/** Fragment roots that mount as one directory on their claim parent. */
function isDirectoryRootComponent(component: FunctionModelComponent): boolean {
  return staticElementDirectory(component.roots) !== null;
}

function attributesClaimable(attributes: readonly FunctionModelAttribute[]): boolean {
  for (const attribute of attributes) {
    if (attribute.kind === 'static') {
      if (!ATTRIBUTE_PATTERN.test(attribute.name)) return false;
      continue;
    }
    if (CONSUMED_ATTRIBUTE_CHANNELS.has(attribute.channel)) continue;
    // Property writes (`el.value = …`) can clobber pre-claim user input.
    // That preservation is a later M07 slice, so the shape stays mount-only.
    if (attribute.channel === 'property') return false;
    if (!ADMITTED_ATTRIBUTE_CHANNELS.has(attribute.channel)) return false;
  }
  return true;
}

/**
 * M07a static leaf, plus M07-1 composition that can adopt an existing sibling
 * list in author order, plus M08-2 condition branches whose nodes were already
 * claimable before the condition itself (text, dynamic-text pairs, attributes).
 *
 * The extra `insideTemplate` flag is the composition boundary: a component
 * reference, insertion site or children projection inside a condition branch is
 * refused (mount-only) because the branch chunk would have to align three
 * ownership layers at once. Elements do not change "inside a template"; a
 * condition is a new chunk for ordinals but not a second claim mechanism.
 *
 * The `context` parameter is the parser context the emitted nodes land in.
 * Conditions write two comments, so a condition under RCDATA/rawtext/template/
 * noscript/foreign/foster/select ancestry is not claimable; the same rule
 * crosses a component reference. This is a claimability decision, never a
 * silent marker emitted inside a context that would not parse it.
 */
function nodeClaimable(
  node: FunctionModelNode,
  component: FunctionModelComponent,
  ctx: ClaimContext,
  insideTemplate = false,
  context: TextParserContext = { kind: 'flow' },
): boolean {
  switch (node.kind) {
    case 'text':
    case 'dynamic-text':
      return true;
    case 'fragment':
      return node.children.every((child) =>
        nodeClaimable(child, component, ctx, insideTemplate, context),
      );
    case 'element': {
      if (!TAG_PATTERN.test(node.tag)) return false;
      if (!attributesClaimable(node.attributes)) return false;
      const childContext = textContextForChild(context, node.tag);
      return node.children.every((child) =>
        nodeClaimable(child, component, ctx, insideTemplate, childContext),
      );
    }
    case 'condition': {
      // This slice admits the branch shapes that were already claimable (text,
      // dynamic-text pairs and attributes). A nested condition/list inside a
      // branch stays mount-only; the branch claim chunk is intentionally not a
      // second condition/list mechanism.
      if (insideTemplate) return false;
      // The condition markers are comments. A restricted parser context turns
      // them into literal text (or moves them outside `.childNodes`), so the
      // shape stays mount-only rather than emitting an unreadable wire.
      if (context.kind !== 'flow') return false;
      const branches = [node.consequent, ...(node.alternate === null ? [] : [node.alternate])];
      return branches.every((branch) =>
        branch.every((child) => nodeClaimable(child, component, ctx, true, context)),
      );
    }
    case 'list': {
      // The list claim is a chunk of its own: its entry template must be
      // claimable with composition refused (`insideTemplate` true). Nested
      // condition/list inside an entry stays mount-only in this slice. The
      // list markers are comments, so a restricted parser context keeps the
      // whole component mount-only (no unreadable wire; no module diagnostic).
      if (insideTemplate) return false;
      if (context.kind !== 'flow') return false;
      return node.template.every((child) => nodeClaimable(child, component, ctx, true, context));
    }
    case 'insertion-site': {
      if (insideTemplate) return false;
      if (!declaredRecipeIdSet(component).has(node.recipeId)) return false;
      const recipe = recipeMap(component).get(node.recipeId);
      if (recipe === undefined) return false;
      // No real browser/consumer proof and no SSR producer for a reusable-JSX
      // body yet, so a list inside that body stays mount-only rather than
      // widening the claim surface on paper. Lift this once the consumer test
      // exists.
      if (treeHasList([recipe.target])) return false;
      return nodeClaimable(recipe.target, component, ctx, false, context);
    }
    case 'children-projection':
      return !insideTemplate;
    case 'component-ref': {
      if (insideTemplate) return false;
      if (node.props.some((prop) => prop.name === 'children')) return false;
      const props = node.props.filter((prop) => prop.name !== 'key');
      if (!attributesClaimable(props)) return false;
      const target = ctx.componentByName.get(node.name);
      if (target === undefined || target.propsParam === null) return false;
      if (componentOwnsReactiveResources(target)) return false;
      // The directory parent would be the shared sibling list, which the
      // consumer rejects unless it is exactly one directory. Not this slice.
      if (isDirectoryRootComponent(target)) return false;
      if (!componentClaimable(target, ctx, context)) return false;
      if (node.childrenRecipeId !== null) {
        const recipe = recipeMap(component).get(node.childrenRecipeId);
        if (recipe === undefined) return false;
        return nodeClaimable(recipe.target, component, ctx, false, context);
      }
      if (componentProjectsChildren(target)) return false;
      return true;
    }
    default:
      return false;
  }
}

function componentClaimable(
  component: FunctionModelComponent,
  ctx: ClaimContext,
  context: TextParserContext = { kind: 'flow' },
): boolean {
  if (ctx.stack.has(component.name)) return false;
  ctx.stack.add(component.name);
  try {
    return component.roots.every((node) => nodeClaimable(node, component, ctx, false, context));
  } finally {
    ctx.stack.delete(component.name);
  }
}

function treeHasComposition(nodes: readonly FunctionModelNode[]): boolean {
  for (const node of nodes) {
    switch (node.kind) {
      case 'insertion-site':
      case 'children-projection':
      case 'component-ref':
        return true;
      case 'element':
      case 'fragment':
        if (treeHasComposition(node.children)) return true;
        break;
      case 'condition':
        if (treeHasComposition(node.consequent)) return true;
        if (node.alternate !== null && treeHasComposition(node.alternate)) return true;
        break;
      case 'list':
        if (treeHasComposition(node.template)) return true;
        break;
      default:
        break;
    }
  }
  return false;
}

/**
 * `true` when the node tree contains a list at any depth. Used to keep a list
 * inside a reusable-JSX recipe body out of the claim/SSR surface until that
 * composition has a real consumer test of its own.
 */
function treeHasList(nodes: readonly FunctionModelNode[]): boolean {
  for (const node of nodes) {
    switch (node.kind) {
      case 'list':
        return true;
      case 'element':
      case 'fragment':
        if (treeHasList(node.children)) return true;
        break;
      case 'condition':
        if (treeHasList(node.consequent)) return true;
        if (node.alternate !== null && treeHasList(node.alternate)) return true;
        break;
      default:
        break;
    }
  }
  return false;
}

function moduleUsesSharedClaimCursor(
  module: FunctionModelModule,
  componentByName: ReadonlyMap<string, FunctionModelComponent>,
): boolean {
  const ctx: ClaimContext = { componentByName, stack: new Set() };
  return module.components.some(
    (component) => componentClaimable(component, ctx) && treeHasComposition(component.roots),
  );
}

/**
 * The emitted mismatch expression. The message prefix, the code and the error
 * options live in the runtime (`claim-invariants.ts`); the compiler names the
 * helper and passes the detail, so no contract string is restated here.
 */
function claimError(detail: string): string {
  return `leafClaimMismatch(${JSON.stringify(detail)})`;
}

/** Throw the leaf mismatch. Sets the runtime import flag. */
function emitClaimMismatch(state: EmitState, condition: string, detail: string): void {
  state.usesLeafClaimMismatch = true;
  push(state, `if (${condition}) throw ${claimError(detail)};`);
}

/**
 * M07a claim parent, its element ancestors, and one claimed element must be
 * in the HTML namespace. Text and comment ancestors are not element checks.
 * A failure here is before any claim write.
 */
function emitClaimHtmlNamespace(state: EmitState, nodeExpr: string, where: string): void {
  state.usesLeafClaimMismatch = true;
  push(state, `assertElementInHtmlNamespace(${nodeExpr}, ${JSON.stringify(where)});`);
}

/**
 * Static attribute seed: the live attributes, with dynamic slot names removed,
 * must equal the declared static attributes in value and order. Names are
 * compared after HTML ASCII case folding: the claim path requires the HTML
 * namespace and the DOM exposes HTML attribute names lowercased, so both the
 * live and the declared names are folded before the name comparison. On a
 * fully static element the skip set is empty, which is the directory rule.
 * Dynamic slot values are claim writes after this check, not part of the seed.
 */
/**
 * Static attribute seed: emit one call into the runtime predicate. The rule
 * itself (ordered exact set, HTML case-folded names, exact values) lives in
 * `claim-invariants.ts` and is shared with the directory consumer; the
 * generator only names the declared set and the dynamic names the claim writes
 * itself. Nothing about the rule is restated here.
 */
function emitClaimStaticAttributeSeed(
  state: EmitState,
  elementVar: string,
  attributes: readonly FunctionModelAttribute[],
  where: string,
): void {
  const staticAttrs = attributes.filter((attribute) => attribute.kind === 'static');
  const dynamicNames = attributes
    .filter(
      (attribute) =>
        attribute.kind === 'dynamic' && !CONSUMED_ATTRIBUTE_CHANNELS.has(attribute.channel),
    )
    .map((attribute) => attribute.name);
  const declared = staticAttrs
    .map(
      (attribute) =>
        `{ name: ${JSON.stringify(attribute.name)}, value: ${JSON.stringify(attribute.value)} }`,
    )
    .join(', ');
  const skip = `[${dynamicNames.map((name) => JSON.stringify(name)).join(', ')}]`;
  state.usesLeafClaimMismatch = true;
  push(
    state,
    `assertStaticAttributeSeed(${elementVar}, [${declared}], ${JSON.stringify(where)}, ${skip});`,
  );
}

function emitClaimTake(state: EmitState, cursor: string, name: string, where: string): void {
  push(state, `const ${name} = ${cursor}.node;`);
  emitClaimMismatch(state, `${name} == null`, `missing node at ${where}`);
  push(state, `${cursor}.node = ${name}.nextSibling;`);
}

function emitClaimCursorEnd(state: EmitState, cursor: string, where: string): void {
  emitClaimMismatch(state, `${cursor}.node !== null`, `extra node at ${where}`);
}

interface PreparedSlot {
  readonly record: LoweredExpressionRecord;
  readonly dependencies: readonly Dependency[];
}

function prepareClaimSlot(
  state: EmitState,
  expression: FunctionExpressionRef,
  records: ReadonlyMap<string, LoweredExpressionRecord>,
): PreparedSlot | null {
  const record = recordFor(state, expression, records);
  if (record === null || !declareReads(state, record)) return null;
  const dependencies = dependencyNames(state, record);
  if (dependencies === null) return null;
  return { record, dependencies };
}

/**
 * M08-2 B2: emit pending phase-2 steps at their current lexical position.
 *
 * The shared-cursor path wraps each emission in a closure pushed onto the
 * module-level activation queue, so block-scoped node bindings stay visible
 * while no subscription/write runs before the cursor owner has validated the
 * whole enclosing structure. That owner captures the queue in `try`, clears the
 * module global in `finally`, and drains the captured local afterwards. The
 * non-shared path keeps inline emission: its root structure check already runs
 * first (and its bindings are function scoped, so deferring would add no
 * safety).
 */
function emitPhase2Steps(state: EmitState, steps: readonly (() => void)[]): void {
  if (steps.length === 0) return;
  const activation = state.claimActivationVar;
  if (activation === null) {
    for (const step of steps) step();
    return;
  }
  for (const step of steps) {
    push(state, `${activation}.push(() => {`);
    state.indent += 1;
    step();
    state.indent -= 1;
    push(state, '});');
  }
}

/**
 * Emit the shared-cursor owner check plus queue initialization. A nested claim
 * finds the module cursor non-null, appends to the owner's queue and never
 * initializes, captures, clears or drains it. The returned local is the
 * owner-only handoff slot: the success-path capture lands here and the
 * `finally` clears the module global on both exits.
 */
function emitClaimQueueInit(state: EmitState, parentExpr: string): string {
  const stepsVar = nextName(state, 'phase2Steps');
  push(state, `let ${stepsVar} = null;`);
  push(state, `const ${INTERNAL_PREFIX}cursorOwned = ${INTERNAL_PREFIX}claimCursor === null;`);
  push(
    state,
    `if (${INTERNAL_PREFIX}cursorOwned) { ${INTERNAL_PREFIX}claimCursor = { node: ${parentExpr}.firstChild }; ${CLAIM_ACTIVATION} = []; }`,
  );
  return stepsVar;
}

/**
 * Success-only handoff. Emitted after the final structure check and every
 * owner-level phase-2 push, immediately before the `finally`: a verify throw
 * therefore never reaches it, while a successful owner detaches the queue from
 * the module global before the first step runs.
 */
function emitClaimActivationCapture(state: EmitState, stepsVar: string): void {
  if (state.claimActivationVar !== CLAIM_ACTIVATION) return;
  push(state, `if (${INTERNAL_PREFIX}cursorOwned) ${stepsVar} = ${CLAIM_ACTIVATION};`);
}

/**
 * Owner-only release. Runs on success and on every pre-drain throw: cursor and
 * module queue both become null. A nested claim (`cursorOwned` false) is a
 * no-op, so it never detaches the enclosing owner's queue.
 */
function emitClaimOwnerFinally(state: EmitState): void {
  push(
    state,
    `} finally { if (${INTERNAL_PREFIX}cursorOwned) { ${INTERNAL_PREFIX}claimCursor = null; ${CLAIM_ACTIVATION} = null; } }`,
  );
}

/**
 * Drain the queue the owner captured in its `try`. Owner-only and success-only
 * by construction: the local array is already detached from the module global,
 * so an activation reentry started by a step owns a different queue and cannot
 * overwrite or extend this drain.
 */
function emitClaimActivationDrain(state: EmitState, stepsVar: string): void {
  if (state.claimActivationVar !== CLAIM_ACTIVATION) return;
  const stepVar = nextName(state, 'phase2Step');
  push(state, `if (${INTERNAL_PREFIX}cursorOwned) {`);
  state.indent += 1;
  push(state, `for (const ${stepVar} of ${stepsVar}) ${stepVar}();`);
  state.indent -= 1;
  push(state, '}');
}

/**
 * Emit the initial write plus its refresh subscription. A zero-dependency slot
 * writes once and registers nothing. The write callback is the claim-period
 * helper: an equal value skips the DOM API, and a dependency still subscribes.
 */
function emitClaimSlot(
  state: EmitState,
  dependencies: readonly Dependency[],
  anchor: SpanLike,
  write: () => void,
): void {
  const entry = state.claimEntry;
  // Outside a list-entry claim a zero-dependency slot is one write. Inside one
  // the slot must stay re-runnable: a keyed reuse rebinds the mapper parameter
  // and `update(next)` forces the same named refresh (the M06b2c rule).
  if (dependencies.length === 0 && entry === null) {
    write();
    return;
  }
  const refresh = nextName(state, 'refresh');
  push(state, `function ${refresh}() {`, anchor);
  state.indent += 1;
  write();
  state.indent -= 1;
  push(state, `}`);
  if (entry !== null) {
    entry.refreshes.push(refresh);
    entry.activate.push(() => {
      push(state, `${refresh}();`);
      if (dependencies.length > 0) {
        emitDependencySubscriptions(state, dependencies, refresh, anchor);
      }
    });
    return;
  }
  push(state, `${refresh}();`);
  emitDependencySubscriptions(state, dependencies, refresh, anchor);
}

/**
 * One condition-branch claim chunk. The emitted function is the read-only half
 * of the condition claim: it walks the client branch template against the
 * shared `{node}` cursor, adopts its nodes, and returns an `activate` closure
 * whose body is emitted only from the caller's phase-2 steps. Calling the
 * function therefore performs no subscription and no DOM write; the claim walk
 * for the enclosing tree stays read-only until the root flush.
 *
 * The function is a chunk: its text-slot ordinals restart at 0 and its static
 * top-level runs use the same normalized view as mount/SSR. Its internal cursor
 * is the explicit parameter, so the shared-cursor mode is disabled while its
 * body is emitted; the caller passes either a local cursor object or the
 * module-level shared cursor object.
 */
function emitClaimConditionBranchBuilder(
  state: EmitState,
  functionName: string,
  scopeParam: string,
  cursorParam: string,
  nodes: readonly FunctionModelNode[],
  records: ReadonlyMap<string, LoweredExpressionRecord>,
  path: string,
  anchor: SpanLike,
): void {
  push(state, `function ${functionName}(${scopeParam}, ${cursorParam}) {`, anchor);
  state.indent += 1;
  const outerScope = state.scopeVar;
  const outerOrdinals = state.textOrdinals;
  const outerShared = state.claimCursorShared;
  const outerActivation = state.claimActivationVar;
  state.scopeVar = scopeParam;
  state.claimCursorShared = false;
  // This chunk's own phase 2 belongs to the returned `activate` closure: it is
  // called by the enclosing condition step after branch structure was adopted,
  // so it must not append to the module activation queue.
  state.claimActivationVar = null;
  const prepared = emissionNodes(state, nodes);
  state.textOrdinals = textSlotOrdinals(prepared);
  const nodesVar = nextName(state, 'branchNodes');
  push(state, `const ${nodesVar} = [];`);
  const phase2: Array<() => void> = [];
  emitClaimInto(
    state,
    prepared,
    cursorParam,
    path,
    records,
    phase2,
    (name) => {
      push(state, `${nodesVar}.push(${name});`);
    },
    (name, condition) => {
      push(state, `if (${condition}) ${nodesVar}.push(${name});`);
    },
    'null',
    false,
  );
  push(state, 'function activate() {');
  state.indent += 1;
  emitPhase2Steps(state, phase2);
  state.indent -= 1;
  push(state, '}');
  push(state, `return { nodes: ${nodesVar}, activate };`);
  state.textOrdinals = outerOrdinals;
  state.claimCursorShared = outerShared;
  state.claimActivationVar = outerActivation;
  state.scopeVar = outerScope;
  state.indent -= 1;
  push(state, '}');
}

/**
 * Claim one condition. Verify is read-only: the anchor/end are asserted, the
 * test is evaluated once, the selected client branch is adopted through its
 * read-only claim chunk (or a server-empty branch is marked for insert), and
 * the owner/nodes are registered. Subscription and writes are queued on
 * `phase2`; the caller flushes them only after the whole claim walk succeeded.
 *
 * There is no branch id. A branch is identified by the client template's own
 * structure, static attribute seed, text values and slot ordinals, which the
 * ordinary claim walk already checks. A server branch that does not match the
 * client branch is a mismatch; a server-empty branch is the only insertion
 * path, and it is explicitly non-transactional activation work.
 */
function emitConditionClaim(
  state: EmitState,
  node: FunctionModelCondition,
  cursor: string,
  path: string,
  records: ReadonlyMap<string, LoweredExpressionRecord>,
  phase2: Array<() => void>,
  adopt: (name: string) => void,
): void {
  const slot = prepareClaimSlot(state, node.test, records);
  if (slot === null) return;
  const here = path;
  const anchorVar = nextName(state, 'whenAnchor');
  push(state, `const ${anchorVar} = ${cursor}.node;`, node.span);
  push(state, `assertWhenAnchor(${anchorVar}, ${JSON.stringify(`${here}/anchor`)});`, node.span);
  push(state, `${cursor}.node = ${anchorVar}.nextSibling;`);

  // Mount-style create builders for later toggles and for the server-empty
  // insert path. They are emitted once per condition into the same chunk the
  // claim lives in; their scope parameter is the branch owner, so subscriptions
  // and writes they create are owned by that branch.
  const thenCreate = node.consequent.length > 0 ? nextName(state, 'whenThen') : null;
  if (thenCreate !== null) {
    emitNodesBuilder(
      state,
      thenCreate,
      nextName(state, 'whenThenScope'),
      node.consequent,
      records,
      node.span,
    );
  }
  const elseCreate =
    node.alternate !== null && node.alternate.length > 0 ? nextName(state, 'whenElse') : null;
  if (elseCreate !== null) {
    emitNodesBuilder(
      state,
      elseCreate,
      nextName(state, 'whenElseScope'),
      node.alternate!,
      records,
      node.span,
    );
  }

  // Read-only adoption chunks for the client branches. A branch with no nodes
  // has no builder: its whole verify is the end-marker check below.
  const thenClaim = node.consequent.length > 0 ? nextName(state, 'whenThenClaim') : null;
  if (thenClaim !== null) {
    emitClaimConditionBranchBuilder(
      state,
      thenClaim,
      nextName(state, 'whenThenClaimScope'),
      cursor,
      node.consequent,
      records,
      `${here}/then`,
      node.span,
    );
  }
  const elseClaim =
    node.alternate !== null && node.alternate.length > 0 ? nextName(state, 'whenElseClaim') : null;
  if (elseClaim !== null) {
    emitClaimConditionBranchBuilder(
      state,
      elseClaim,
      nextName(state, 'whenElseClaimScope'),
      cursor,
      node.alternate!,
      records,
      `${here}/else`,
      node.span,
    );
  }

  const testVar = nextName(state, 'whenTest');
  pushParts(state, [`const ${testVar} = (`, { record: slot.record }, ');'], node.span);
  const activeVar = nextName(state, 'whenActive');
  const emptyActive = elseCreate === null ? 0 : 2;
  push(state, `let ${activeVar} = ${testVar} ? 1 : ${emptyActive};`);
  const ownerVar = nextName(state, 'whenOwner');
  const nodesVar = nextName(state, 'whenNodes');
  const adoptedVar = nextName(state, 'whenAdopted');
  const insertVar = nextName(state, 'whenInsert');
  push(state, `let ${ownerVar} = null;`);
  push(state, `let ${nodesVar} = [];`);
  push(state, `let ${adoptedVar} = null;`);
  push(state, `let ${insertVar} = false;`);

  const verifyBranch = (activeValue: number, claimFn: string | null): void => {
    push(state, `if (${activeVar} === ${activeValue}) {`);
    state.indent += 1;
    if (claimFn !== null) {
      push(state, `if (isWhenEndMarker(${cursor}.node)) {`);
      state.indent += 1;
      push(state, `${insertVar} = true;`);
      state.indent -= 1;
      push(state, `} else {`);
      state.indent += 1;
      push(state, `${ownerVar} = ${state.scopeVar}.child();`);
      push(state, 'try {');
      state.indent += 1;
      push(state, `${adoptedVar} = ${claimFn}(${ownerVar}, ${cursor});`, node.span);
      state.indent -= 1;
      push(state, `} catch (error) { ${ownerVar}.dispose(false); throw error; }`);
      push(state, `${nodesVar} = ${adoptedVar}.nodes;`);
      state.indent -= 1;
      push(state, '}');
    }
    state.indent -= 1;
    push(state, '}');
  };
  verifyBranch(1, thenClaim);
  verifyBranch(2, elseClaim);

  push(state, `assertWhenEndMarker(${cursor}.node, ${JSON.stringify(`${here}/end`)});`, node.span);
  const endVar = nextName(state, 'whenEnd');
  push(state, `const ${endVar} = ${cursor}.node;`);
  push(state, `${cursor}.node = ${endVar}.nextSibling;`);
  push(state, `if (${ownerVar} === null) ${ownerVar} = ${state.scopeVar}.child();`);
  push(state, `${ownerVar}.addRangeCleanup(() => removeNodes(${nodesVar}));`, node.span);

  // Adopt the markers and any existing branch nodes. Server-empty insertion
  // happens in phase 2, so its created nodes are intentionally not part of this
  // adopted list; the two markers are the stable root-level nodes.
  adopt(anchorVar);
  const childVar = nextName(state, 'whenChild');
  push(state, `for (const ${childVar} of ${nodesVar}) {`);
  adopt(childVar);
  push(state, '}');
  adopt(endVar);

  // The update path mirrors mount: dispose the old branch owner (range cleanup
  // removes only that branch's adopted/created nodes), create the next branch on
  // a fresh child scope and insert it before the end marker. The end marker
  // itself belongs to the enclosing claim owner.
  const refreshVar = nextName(state, 'whenRefresh');
  const nextVar = nextName(state, 'whenNext');
  const branchOwnerVar = nextName(state, 'whenBranchOwner');
  const branchNodesVar = nextName(state, 'whenBranchNodes');
  const refreshParentVar = nextName(state, 'whenParent');
  push(state, `function ${refreshVar}(force) {`, node.span);
  state.indent += 1;
  pushParts(
    state,
    [`const ${nextVar} = (`, { record: slot.record }, `) ? 1 : ${emptyActive};`],
    node.span,
  );
  push(state, `if (!force && ${nextVar} === ${activeVar}) return;`);
  push(state, `if (${ownerVar} !== null) ${ownerVar}.dispose(true);`);
  push(state, `${ownerVar} = null;`);
  push(state, `const ${branchOwnerVar} = ${state.scopeVar}.child();`);
  push(state, `let ${branchNodesVar};`);
  push(state, 'try {');
  state.indent += 1;
  const thenCall = thenCreate === null ? '[]' : `${thenCreate}(${branchOwnerVar})`;
  const elseCall = elseCreate === null ? '[]' : `${elseCreate}(${branchOwnerVar})`;
  push(
    state,
    `${branchNodesVar} = runUntracked(() => ${nextVar} === 1 ? ${thenCall} : ${elseCall});`,
  );
  state.indent -= 1;
  push(state, `} catch (error) { ${branchOwnerVar}.dispose(true); throw error; }`);
  push(state, `${branchOwnerVar}.addRangeCleanup(() => removeNodes(${branchNodesVar}));`);
  push(state, `const ${refreshParentVar} = ${endVar}.parentNode;`);
  push(
    state,
    `if (${refreshParentVar} !== null) { for (const ${childVar} of ${branchNodesVar}) ${refreshParentVar}.insertBefore(${childVar}, ${endVar}); }`,
  );
  push(
    state,
    `${nodesVar} = ${branchNodesVar}; ${ownerVar} = ${branchOwnerVar}; ${activeVar} = ${nextVar};`,
  );
  state.indent -= 1;
  push(state, '}');

  phase2.push(() => {
    push(state, `if (${adoptedVar} !== null) ${adoptedVar}.activate();`);
  });
  if (slot.dependencies.length > 0) {
    phase2.push(() => {
      emitDependencySubscriptions(state, slot.dependencies, refreshVar, node.span);
    });
  }
  if (thenCreate !== null || elseCreate !== null) {
    phase2.push(() => {
      push(state, `if (${insertVar}) {`);
      state.indent += 1;
      const insertNodesVar = nextName(state, 'whenInsertNodes');
      const insertParentVar = nextName(state, 'whenInsertParent');
      push(state, `let ${insertNodesVar};`);
      push(state, 'try {');
      state.indent += 1;
      const insertThen = thenCreate === null ? '[]' : `${thenCreate}(${ownerVar})`;
      const insertElse = elseCreate === null ? '[]' : `${elseCreate}(${ownerVar})`;
      push(state, `${insertNodesVar} = ${activeVar} === 1 ? ${insertThen} : ${insertElse};`);
      state.indent -= 1;
      push(state, `} catch (error) { ${ownerVar}.dispose(true); throw error; }`);
      push(state, `const ${insertParentVar} = ${endVar}.parentNode;`);
      push(
        state,
        `if (${insertParentVar} !== null) { for (const ${childVar} of ${insertNodesVar}) ${insertParentVar}.insertBefore(${childVar}, ${endVar}); }`,
      );
      push(state, `${nodesVar} = ${insertNodesVar};`);
      state.indent -= 1;
      push(state, '}');
    });
  }
}

/**
 * One list-entry claim chunk. The walk is read-only: it adopts the entry's
 * existing marker/content through the shared cursor and creates no DOM node,
 * opens no subscription and writes no value. Every dynamic slot becomes a
 * named refresh at this function's scope (zero-dependency slots included), so
 * `update(next)` can rebind the mapper parameter and re-render the same nodes
 * (the M06b2c entry-local rule). `activate(next)` rebinds the item, runs the
 * compare-write refresh once and opens the entry-local subscriptions; the
 * enclosing claim calls it only from the activation phase.
 */
function emitClaimEntryBuilder(
  state: EmitState,
  functionName: string,
  scopeParam: string,
  cursorParam: string,
  itemParam: string,
  itemName: string,
  nodes: readonly FunctionModelNode[],
  records: ReadonlyMap<string, LoweredExpressionRecord>,
  path: string,
  anchor: SpanLike,
): void {
  push(state, `function ${functionName}(${scopeParam}, ${cursorParam}, ${itemParam}) {`, anchor);
  state.indent += 1;
  const outerScope = state.scopeVar;
  const outerOrdinals = state.textOrdinals;
  const outerShared = state.claimCursorShared;
  const outerActivation = state.claimActivationVar;
  const outerEntry = state.claimEntry;
  state.scopeVar = scopeParam;
  state.claimCursorShared = false;
  state.claimActivationVar = null;
  const entry = { refreshes: [] as string[], activate: [] as Array<() => void> };
  state.claimEntry = entry;
  const outerEntryName = state.entryNames.has(itemName);
  state.entryNames.add(itemName);
  const prepared = emissionNodes(state, nodes);
  state.textOrdinals = textSlotOrdinals(prepared);
  const nodesVar = nextName(state, 'entryNodes');
  push(state, `const ${nodesVar} = [];`);
  push(state, `let ${itemName} = ${itemParam};`);
  const phase2: Array<() => void> = [];
  emitClaimInto(
    state,
    prepared,
    cursorParam,
    path,
    records,
    phase2,
    (name) => push(state, `${nodesVar}.push(${name});`),
    (name, condition) => push(state, `if (${condition}) ${nodesVar}.push(${name});`),
    'null',
    false,
  );
  // The slot refreshes are emitted at the builder scope, not inside `activate`;
  // `update(next)` must be able to call the same closures after rebinding item.
  emitPhase2Steps(state, phase2);
  push(state, 'function activate(next) {');
  state.indent += 1;
  push(state, `${itemName} = next;`);
  for (const step of entry.activate) step();
  state.indent -= 1;
  push(state, '}');
  const update = [`${itemName} = next;`, ...entry.refreshes.map((name) => `${name}(true);`)].join(
    ' ',
  );
  push(state, `return { nodes: ${nodesVar}, activate, update(next) { ${update} } };`);
  if (!outerEntryName) state.entryNames.delete(itemName);
  state.textOrdinals = outerOrdinals;
  state.claimCursorShared = outerShared;
  state.claimActivationVar = outerActivation;
  state.claimEntry = outerEntry;
  state.scopeVar = outerScope;
  state.indent -= 1;
  push(state, '}');
}

/**
 * One claim-time keyed sync. `previous` is the seeded list on the strict first
 * call and the live entry list afterwards. Matching keeps mount's
 * `entry.key === key` identity plus the mount used-set rule, so duplicate
 * client keys adopt the wire entry once per occurrence and insert the
 * remainder. The strict call is the seed assignment's defense: an unmatched
 * seeded entry is a mismatch, never a delete. The non-strict refresh disposes
 * removed entries exactly like mount.
 *
 * Every key is preflighted with `encodeListKey` before any mutation, and an
 * inserted entry writes its marker from `encodeListKey`, never the mount-only
 * `u` payload. An unsupported update therefore fails closed with the old DOM,
 * owners and entries intact; the caller's refresh assignment keeps the previous
 * entry list, so a later legal signal value recovers.
 */
function emitClaimListSync(
  state: EmitState,
  functionName: string,
  entryCreateFn: string,
  endVar: string,
  path: string,
  anchor: SpanLike,
): void {
  push(state, `function ${functionName}(items, keys, previous, strict) {`, anchor);
  state.indent += 1;
  // A supported key is a precondition of every write below. The preflight runs
  // before matching, updates, inserts and placement, so a claimed list that is
  // updated to an unsupported key throws the internal unsupported identity with
  // the claimed DOM, owners and entries untouched. The refresh assignment keeps
  // the previous entry list, so the next legal signal value can recover.
  push(state, 'for (const key of keys) encodeListKey(key);');
  push(state, 'const next = [];');
  push(state, 'const used = new Set();');
  push(state, 'for (let index = 0; index < items.length; index++) {');
  state.indent += 1;
  push(state, 'const item = items[index];');
  push(state, 'const key = keys[index];');
  push(state, 'let found = null;');
  push(
    state,
    'for (const entry of previous) { if (entry.key === key && !used.has(entry)) { found = entry; break; } }',
  );
  push(state, 'if (found !== null) {');
  state.indent += 1;
  push(state, 'used.add(found); found.item = item; found.update(item); next.push(found);');
  state.indent -= 1;
  push(state, '} else {');
  state.indent += 1;
  push(state, `const owner = ${state.scopeVar}.child();`);
  push(state, 'let built;');
  push(state, 'try {');
  state.indent += 1;
  push(state, `built = ${entryCreateFn}(owner, item);`);
  state.indent -= 1;
  push(state, '} catch (error) { owner.dispose(true); throw error; }');
  push(state, 'const token = encodeListKey(key);');
  push(state, 'built.nodes.unshift(emitComment(entryKeyMarker(token)));');
  push(state, 'owner.addRangeCleanup(() => removeNodes(built.nodes));');
  push(state, 'next.push({ key, item, owner, nodes: built.nodes, update: built.update });');
  state.indent -= 1;
  push(state, '}');
  state.indent -= 1;
  push(state, '}');
  push(state, 'for (const entry of previous) if (!used.has(entry)) {');
  state.indent += 1;
  push(
    state,
    `if (strict) throw leafClaimMismatch(${JSON.stringify(`server entry key has no client item at ${path}/each`)});`,
  );
  push(state, 'entry.owner.dispose(true);');
  state.indent -= 1;
  push(state, '}');
  push(state, `const parent = ${endVar}.parentNode;`);
  push(state, 'if (parent !== null) {');
  state.indent += 1;
  push(state, `let reference = ${endVar};`);
  push(state, 'for (let entryIndex = next.length - 1; entryIndex >= 0; entryIndex--) {');
  state.indent += 1;
  push(state, 'const nodes = next[entryIndex].nodes;');
  push(state, 'for (let nodeIndex = nodes.length - 1; nodeIndex >= 0; nodeIndex--) {');
  state.indent += 1;
  push(state, 'const node = nodes[nodeIndex];');
  push(
    state,
    'if (node.parentNode !== parent || node.nextSibling !== reference) parent.insertBefore(node, reference);',
  );
  push(state, 'reference = node;');
  state.indent -= 1;
  push(state, '}');
  state.indent -= 1;
  push(state, '}');
  state.indent -= 1;
  push(state, '}');
  push(state, 'return next;');
  state.indent -= 1;
  push(state, '}');
}

/**
 * Claim one keyed (or unkeyed positional) list.
 *
 * Verify order is deliberate: anchor, every `oe:k:` entry and its read-only
 * template adoption, the `oe:/each` end, then one items evaluation and one key
 * evaluation per item. The seed predicate runs before any assignment write or
 * activation; a wire token with more occurrences than the client list, an extra
 * wire token or an unsupported wire key leaves the borrowed DOM untouched and
 * opens no subscription. The seed predicate's client-key failure is also the
 * only place an unsupported client key can stop the claim. Each wire occurrence
 * is assigned the next client occurrence of the same token, so duplicates are
 * distinct identities and reorder is grouped per token.
 *
 * Activation is queued on the shared phase-2 path: every seeded entry activates
 * (compare-write refresh + subscriptions), then the list/key outer
 * subscriptions, then one strict sync. A client-more seed inserts after that;
 * reorder only moves existing nodes. No seeded node is ever deleted. The strict
 * sync preflights every key with `encodeListKey`, so an unsupported key throws
 * before any DOM write (the claimed `u`-free contract).
 */
function emitClaimList(
  state: EmitState,
  node: FunctionModelList,
  cursor: string,
  path: string,
  records: ReadonlyMap<string, LoweredExpressionRecord>,
  phase2: Array<() => void>,
  adopt: (name: string) => void,
): void {
  const slot = prepareClaimSlot(state, node.items, records);
  if (slot === null) return;
  const here = path;
  const anchorVar = nextName(state, 'eachAnchor');
  push(state, `const ${anchorVar} = ${cursor}.node;`, node.span);
  push(
    state,
    `assertEachAnchor(${anchorVar}, ${JSON.stringify(`${here}/each/anchor`)});`,
    node.span,
  );
  push(state, `${cursor}.node = ${anchorVar}.nextSibling;`);
  adopt(anchorVar);

  const entryClaimFn = nextName(state, 'eachEntryClaim');
  emitClaimEntryBuilder(
    state,
    entryClaimFn,
    nextName(state, 'eachEntryClaimScope'),
    cursor,
    nextName(state, 'eachEntryItem'),
    node.parameter,
    node.template,
    records,
    `${here}/each/entry`,
    node.span,
  );
  const entryCreateFn = nextName(state, 'eachEntryCreate');
  state.listDepth += 1;
  try {
    emitEntryBuilder(
      state,
      entryCreateFn,
      nextName(state, 'eachCreateScope'),
      nextName(state, 'eachCreateItem'),
      node.parameter,
      node.template,
      records,
      node.span,
    );
  } finally {
    state.listDepth -= 1;
  }
  const keyFn = nextName(state, 'eachKey');
  const keyInfo = emitListKeyFunction(state, keyFn, node, records);
  if (keyInfo === null) return;
  const keyDependencies = keyInfo.dependencies;

  const wireTokensVar = nextName(state, 'eachWireTokens');
  const seededVar = nextName(state, 'eachSeeded');
  push(state, `const ${wireTokensVar} = [];`);
  push(state, `const ${seededVar} = [];`);
  push(state, 'for (;;) {');
  state.indent += 1;
  const markerVar = nextName(state, 'entryMarker');
  push(state, `const ${markerVar} = ${cursor}.node;`);
  const parsedVar = nextName(state, 'entryParsed');
  push(
    state,
    `const ${parsedVar} = ${markerVar} !== null && ${markerVar}.nodeType === 8 ? parseEntryKeyMarker(${markerVar}.nodeValue) : null;`,
  );
  push(state, `if (${parsedVar} === null) break;`);
  const tokenVar = nextName(state, 'entryToken');
  push(
    state,
    `const ${tokenVar} = readEntryKeyMarker(${markerVar}, ${JSON.stringify(`${here}/each/entry`)});`,
  );
  push(state, `${cursor}.node = ${markerVar}.nextSibling;`);
  const ownerVar = nextName(state, 'entryOwner');
  push(state, `const ${ownerVar} = ${state.scopeVar}.child();`);
  const builtVar = nextName(state, 'entryBuilt');
  push(state, `let ${builtVar};`);
  push(state, 'try {');
  state.indent += 1;
  push(state, `${builtVar} = ${entryClaimFn}(${ownerVar}, ${cursor}, null);`);
  state.indent -= 1;
  push(state, `} catch (error) { ${ownerVar}.dispose(false); throw error; }`);
  push(
    state,
    `${ownerVar}.addRangeCleanup(() => removeNodes([${markerVar}, ...${builtVar}.nodes]));`,
  );
  const seededEntryVar = nextName(state, 'entry');
  push(
    state,
    `const ${seededEntryVar} = { token: ${tokenVar}, key: null, item: null, assigned: false, owner: ${ownerVar}, nodes: [${markerVar}, ...${builtVar}.nodes], activate: ${builtVar}.activate, update: ${builtVar}.update };`,
  );
  push(state, `${seededVar}.push(${seededEntryVar}); ${wireTokensVar}.push(${tokenVar});`);
  adopt(markerVar);
  const adoptedChildVar = nextName(state, 'entryChild');
  push(state, `for (const ${adoptedChildVar} of ${builtVar}.nodes) {`);
  adopt(adoptedChildVar);
  push(state, '}');
  state.indent -= 1;
  push(state, '}');
  push(
    state,
    `assertEachEndMarker(${cursor}.node, ${JSON.stringify(`${here}/each/end`)});`,
    node.span,
  );
  const endVar = nextName(state, 'eachEnd');
  push(state, `const ${endVar} = ${cursor}.node;`);
  push(state, `${cursor}.node = ${endVar}.nextSibling;`);
  adopt(endVar);

  const itemsVar = nextName(state, 'eachItems');
  pushParts(state, [`const ${itemsVar} = (`, { record: slot.record }, ');'], node.span);
  const keysVar = nextName(state, 'eachKeys');
  const tokensVar = nextName(state, 'eachTokens');
  push(state, `const ${keysVar} = [];`);
  push(state, `const ${tokensVar} = [];`);
  push(state, `for (let index = 0; index < ${itemsVar}.length; index++) {`);
  state.indent += 1;
  push(state, `const key = ${keyFn}(${itemsVar}[index], index);`);
  push(state, `${keysVar}.push(key); ${tokensVar}.push(tryEncodeListKey(key));`);
  state.indent -= 1;
  push(state, '}');
  const mismatchVar = nextName(state, 'seedMismatch');
  push(state, `const ${mismatchVar} = entrySeedMismatch(${wireTokensVar}, ${tokensVar});`);
  push(
    state,
    `if (${mismatchVar} !== null) throw leafClaimMismatch(${mismatchVar} + ${JSON.stringify(` at ${here}/each`)});`,
  );
  push(state, `for (let index = 0; index < ${itemsVar}.length; index++) {`);
  state.indent += 1;
  push(state, `const token = ${tokensVar}[index];`);
  push(state, 'if (token === null) continue;');
  push(state, `for (const entry of ${seededVar}) {`);
  state.indent += 1;
  push(
    state,
    'if (!entry.assigned && entry.token === token) { entry.assigned = true; entry.key = ' +
      `${keysVar}[index]; entry.item = ${itemsVar}[index]; break; }`,
  );
  state.indent -= 1;
  push(state, '}');
  state.indent -= 1;
  push(state, '}');
  push(
    state,
    `for (const entry of ${seededVar}) if (!entry.assigned) throw leafClaimMismatch(${JSON.stringify(`server entry key has no client item at ${here}/each`)});`,
  );

  const entriesVar = nextName(state, 'eachEntries');
  push(state, `let ${entriesVar} = [];`);
  const syncFn = nextName(state, 'eachSync');
  emitClaimListSync(state, syncFn, entryCreateFn, endVar, here, node.span);
  const refreshVar = nextName(state, 'eachRefresh');
  push(state, `function ${refreshVar}() {`, node.span);
  state.indent += 1;
  const refreshItemsVar = nextName(state, 'eachItems');
  pushParts(state, [`const ${refreshItemsVar} = (`, { record: slot.record }, ');'], node.span);
  const refreshKeysVar = nextName(state, 'eachKeys');
  push(state, `const ${refreshKeysVar} = [];`);
  push(state, `for (let index = 0; index < ${refreshItemsVar}.length; index++) {`);
  state.indent += 1;
  push(state, `${refreshKeysVar}.push(${keyFn}(${refreshItemsVar}[index], index));`);
  state.indent -= 1;
  push(state, '}');
  push(
    state,
    `${entriesVar} = ${syncFn}(${refreshItemsVar}, ${refreshKeysVar}, ${entriesVar}, false);`,
  );
  state.indent -= 1;
  push(state, '}');

  phase2.push(() => {
    push(state, `for (const entry of ${seededVar}) entry.activate(entry.item);`);
  });
  const subscribed = new Set<string>();
  const uniqueDependencies: Dependency[] = [];
  for (const dependency of [...slot.dependencies, ...keyDependencies]) {
    if (subscribed.has(dependency.name)) continue;
    subscribed.add(dependency.name);
    uniqueDependencies.push(dependency);
  }
  if (uniqueDependencies.length > 0) {
    phase2.push(() => {
      emitDependencySubscriptions(state, uniqueDependencies, refreshVar, node.span);
    });
  }
  phase2.push(() => {
    push(state, `${entriesVar} = ${syncFn}(${itemsVar}, ${keysVar}, ${seededVar}, true);`);
  });
  registerRefresh(state, refreshVar);
}

function emitClaimInto(
  state: EmitState,
  nodes: readonly FunctionModelNode[],
  cursor: string,
  path: string,
  records: ReadonlyMap<string, LoweredExpressionRecord>,
  phase2: Array<() => void>,
  adopt: (name: string) => void,
  adoptIf: (name: string, condition: string) => void,
  parentExpr: string,
  collect: boolean,
): void {
  const list = state.emitTextBoundaries ? normalizeTextRuns(nodes) : nodes;
  list.forEach((node, index) => {
    if (state.diagnostics.length > 0) return;
    const here = `${path}/${index}`;
    if (node.kind === 'condition') {
      emitConditionClaim(state, node, cursor, here, records, phase2, adopt);
      return;
    }
    if (node.kind === 'list') {
      emitClaimList(state, node, cursor, here, records, phase2, adopt);
      return;
    }
    if (node.kind === 'fragment') {
      emitClaimInto(
        state,
        node.children,
        cursor,
        here,
        records,
        phase2,
        adopt,
        adoptIf,
        parentExpr,
        collect,
      );
      return;
    }
    if (node.kind === 'insertion-site') {
      emitClaimInsertion(state, node, parentExpr, collect);
      return;
    }
    if (node.kind === 'children-projection') {
      emitClaimChildrenProjection(state, node, parentExpr, collect);
      return;
    }
    if (node.kind === 'component-ref') {
      emitClaimComponentRef(state, node, records, parentExpr, collect);
      return;
    }
    if (node.kind === 'text') {
      const name = nextName(state, 'text');
      emitClaimTake(state, cursor, name, here);
      emitClaimMismatch(
        state,
        `${name}.nodeType !== 3 || ${name}.nodeValue !== ${JSON.stringify(node.value)}`,
        `static text at ${here}`,
      );
      adopt(name);
      return;
    }
    if (node.kind === 'dynamic-text') {
      const slot = prepareClaimSlot(state, node.expression, records);
      if (slot === null) return;
      const ordinal = textOrdinal(state, node);
      if (ordinal === null) return;
      const start = nextName(state, 'textStart');
      emitClaimTake(state, cursor, start, `${here}/text-start`);
      push(
        state,
        `assertTextSlotMarker(${start}, ${ordinal}, false, ${JSON.stringify(`${here}/text-start`)});`,
        node.span,
      );
      const slotText = nextName(state, 'slotText');
      push(state, `let ${slotText} = null;`);
      const maybeText = nextName(state, 'maybeText');
      push(state, `const ${maybeText} = ${cursor}.node;`);
      push(state, `if (${maybeText} !== null && ${maybeText}.nodeType === 3) {`);
      push(state, `  ${slotText} = ${maybeText};`);
      push(state, `  ${cursor}.node = ${maybeText}.nextSibling;`);
      push(state, `}`);
      const end = nextName(state, 'textEnd');
      emitClaimTake(state, cursor, end, `${here}/text-end`);
      push(
        state,
        `assertTextSlotMarker(${end}, ${ordinal}, true, ${JSON.stringify(`${here}/text-end`)});`,
        node.span,
      );
      adopt(start);
      adoptIf(slotText, `${slotText} !== null`);
      adopt(end);
      phase2.push(() =>
        emitClaimSlot(state, slot.dependencies, node.span, () =>
          emitClaimTextSlotWrite(state, slotText, end, slot.record),
        ),
      );
      return;
    }
    if (node.kind === 'element') {
      const name = nextName(state, 'el');
      emitClaimTake(state, cursor, name, here);
      emitClaimMismatch(
        state,
        `${name}.nodeType !== 1 || String(${name}.localName || ${name}.tagName || "").toLowerCase() !== ${JSON.stringify(node.tag)}`,
        `expected element '${node.tag}' at ${here}`,
      );
      emitClaimHtmlNamespace(state, name, here);
      emitClaimStaticAttributeSeed(state, name, node.attributes, here);
      for (const attribute of node.attributes) {
        if (attribute.kind === 'static') continue;
        if (attribute.kind === 'dynamic' && CONSUMED_ATTRIBUTE_CHANNELS.has(attribute.channel)) {
          continue;
        }
        const slot = prepareClaimSlot(state, attribute.expression, records);
        if (slot === null) return;
        const attributeName = attribute.name;
        const channel = attribute.channel;
        const span = attribute.span;
        phase2.push(() =>
          emitClaimSlot(state, slot.dependencies, span, () =>
            emitClaimAttributeWrite(state, name, attributeName, channel, slot.record, span),
          ),
        );
      }
      const ranges = directoryParentAllowed(node.tag)
        ? staticElementDirectory(node.children)
        : null;
      if (ranges !== null) emitClaimedDirectory(state, name, ranges);
      else {
        const childCursor = nextName(state, 'cursor');
        push(state, `const ${childCursor} = { node: ${name}.firstChild };`);
        const saved = state.claimCursorShared ? nextName(state, 'savedCursor') : null;
        // Shared-cursor interiors are a `try` block. Child node bindings are
        // block-scoped, so their refresh closures must be emitted in that
        // same block; flushing them on the parent phase2 would name a binding
        // the refresh cannot see.
        const childPhase2: Array<() => void> = [];
        if (saved !== null) {
          push(state, `const ${saved} = __oe_claimCursor;`);
          push(state, `__oe_claimCursor = ${childCursor};`);
          push(state, 'try {');
          state.indent += 1;
        }
        emitClaimInto(
          state,
          node.children,
          childCursor,
          here,
          records,
          saved !== null ? childPhase2 : phase2,
          () => {},
          () => {},
          name,
          false,
        );
        emitClaimCursorEnd(state, childCursor, here);
        if (saved !== null) {
          emitPhase2Steps(state, childPhase2);
          state.indent -= 1;
          push(state, `} finally { __oe_claimCursor = ${saved}; }`);
        }
      }
      adopt(name);
    }
  });
}

function emitClaimCollectedList(state: EmitState, listExpr: string, collect: boolean): void {
  if (!collect || state.claimAdoptedVar === null) return;
  const child = nextName(state, 'child');
  push(state, `for (const ${child} of ${listExpr}) ${state.claimAdoptedVar}.push(${child});`);
}

/**
 * One reusable-JSX insertion during claim. The recipe claim adopts its own
 * nodes from the active cursor; this call only opens an independent projection.
 */
function emitClaimInsertion(
  state: EmitState,
  node: FunctionModelInsertionSite,
  parentExpr: string,
  collect: boolean,
): void {
  const recipeVar = state.recipeVars.get(node.recipeId);
  if (recipeVar === undefined) {
    diag(
      state,
      'OEIR_LEAF_MISSING_RECIPE',
      `insertion site '${node.recipeId}' has no claim-time recipe`,
      node.span,
    );
    return;
  }
  state.usesClaimRecipe = true;
  const projection = nextName(state, 'projection');
  push(
    state,
    `const ${projection} = claimRecipe(${state.scopeVar}, ${recipeVar}, ${parentExpr});`,
    node.span,
  );
  emitClaimCollectedList(state, `${projection}.nodes`, collect);
}

/** One `{props.children}` site. The caller-supplied recipe owns the node shape. */
function emitClaimChildrenProjection(
  state: EmitState,
  node: FunctionModelChildrenProjection,
  parentExpr: string,
  collect: boolean,
): void {
  const recipeVar = state.childrenRecipeVar;
  if (recipeVar === null) {
    diag(
      state,
      'OEIR_LEAF_MISSING_CHILDREN',
      'children projection has no claim-level `props.children` recipe read',
      node.span,
    );
    return;
  }
  state.usesClaimRecipe = true;
  const projection = nextName(state, 'childrenProjection');
  push(
    state,
    `const ${projection} = claimRecipe(${state.scopeVar}, ${recipeVar}, ${parentExpr});`,
    node.span,
  );
  emitClaimCollectedList(state, `${projection}.nodes`, collect);
}

/**
 * Claim one component reference in authored position. Mirrors the mount's
 * child scope and per-read props, but adopts existing nodes and rolls a
 * throwing claim back with `dispose(false)` so borrowed DOM stays.
 */
function emitClaimComponentRef(
  state: EmitState,
  node: FunctionModelComponentRef,
  records: ReadonlyMap<string, LoweredExpressionRecord>,
  parentExpr: string,
  collect: boolean,
): void {
  const span: IrSpan = node.span;
  const childrenRecipeVar =
    node.childrenRecipeId === null ? null : (state.recipeVars.get(node.childrenRecipeId) ?? null);
  if (node.childrenRecipeId !== null && childrenRecipeVar === null) {
    diag(
      state,
      'OEIR_LEAF_MISSING_RECIPE',
      `children recipe '${node.childrenRecipeId}' of '<${node.name}>' has no claim-time recipe`,
      span,
    );
    return;
  }
  const admitted: Array<
    | { readonly kind: 'static'; readonly name: string; readonly value: string }
    | {
        readonly kind: 'dynamic';
        readonly name: string;
        readonly expression: FunctionExpressionRef;
        readonly span: SpanLike;
      }
  > = [];
  for (const attribute of node.props) {
    if (attribute.name === 'key' || attribute.name === 'children') continue;
    admitted.push(attribute);
  }
  const id = state.counter.value++;
  const propsVar = `${INTERNAL_PREFIX}childProps${id}`;
  const hostVar = `${INTERNAL_PREFIX}childHost${id}`;
  const scopeVar = `${INTERNAL_PREFIX}childScope${id}`;
  const nodesVar = `${INTERNAL_PREFIX}childNodes${id}`;
  const propDeps = new Set<string>();
  let needsParentProps = false;
  type ResolvedProp =
    | { readonly kind: 'static'; readonly name: string; readonly value: string }
    | {
        readonly kind: 'dynamic';
        readonly name: string;
        readonly record: LoweredExpressionRecord;
        readonly span: SpanLike;
      };
  const resolved: ResolvedProp[] = [];
  for (const prop of admitted) {
    if (prop.kind === 'static') {
      resolved.push(prop);
      continue;
    }
    const record = recordFor(state, prop.expression, records);
    if (record === null || !declareReads(state, record)) return;
    const dependencies = dependencyNames(state, record);
    if (dependencies === null) return;
    for (const dependency of dependencies) {
      if (dependency.fromProps) needsParentProps = true;
      else propDeps.add(dependency.name);
    }
    resolved.push({ kind: 'dynamic', name: prop.name, record, span: prop.span });
  }
  if (resolved.length > 0 || childrenRecipeVar !== null) {
    push(state, `const ${propsVar} = {`, span);
    state.indent += 1;
    if (childrenRecipeVar !== null) push(state, `children: ${childrenRecipeVar},`, span);
    for (const prop of resolved) {
      if (prop.kind === 'static') {
        const key = IDENTIFIER_PATTERN.test(prop.name) ? prop.name : JSON.stringify(prop.name);
        push(state, `${key}: ${JSON.stringify(prop.value)},`);
        continue;
      }
      const key = IDENTIFIER_PATTERN.test(prop.name) ? prop.name : JSON.stringify(prop.name);
      pushParts(state, [`get ${key}() { return (`, { record: prop.record }, '); },'], prop.span);
    }
    state.indent -= 1;
    push(state, '};');
  }
  const depParts = [...propDeps];
  if (needsParentProps) depParts.push(`...${state.hostVar}.propDeps`);
  const propsExpr = resolved.length > 0 || childrenRecipeVar !== null ? propsVar : '{}';
  push(
    state,
    `const ${hostVar} = { bindings: ${state.hostVar}.bindings, propDeps: [${depParts.join(', ')}] };`,
    span,
  );
  push(state, `const ${scopeVar} = ${state.scopeVar}.child();`, span);
  push(state, `let ${nodesVar};`);
  push(state, 'try {');
  state.indent += 1;
  push(
    state,
    `${nodesVar} = ${node.name}${CLAIM_SUFFIX}(${scopeVar}, ${propsExpr}, ${hostVar}, ${parentExpr});`,
    span,
  );
  state.indent -= 1;
  push(state, `} catch (error) { ${scopeVar}.dispose(false); throw error; }`);
  push(state, `${scopeVar}.addRangeCleanup(() => removeNodes(${nodesVar}));`);
  emitClaimCollectedList(state, nodesVar, collect);
}

/**
 * Claim-time recipes. The mount-time recipe's definition owner is the mount
 * scope, which claim disposes before adoption, so lineage would reject it.
 * These objects exist only so `claimRecipe` can open an independent projection;
 * calling `mount` on them is a coded mismatch, not a second mount.
 */
function emitClaimTimeRecipes(
  state: EmitState,
  file: string,
  records: ReadonlyMap<string, LoweredExpressionRecord>,
): void {
  const referenced = referencedRecipeIds(state.component);
  if (referenced.size === 0) return;
  const ctx: ClaimContext = { componentByName: state.componentByName, stack: new Set() };
  for (const recipe of state.component.recipes) {
    if (state.diagnostics.length > 0) return;
    if (!referenced.has(recipe.id)) continue;
    if (!nodeClaimable(recipe.target, state.component, ctx)) {
      diag(
        state,
        'OEIR_LEAF_UNSUPPORTED_NODE',
        `recipe '${recipe.id}' is outside the M07-1 claim slice`,
        recipe.span,
      );
      return;
    }
    const outerOrdinals = state.textOrdinals;
    const preparedTarget = normalizeTextRuns([recipe.target]);
    state.textOrdinals = textSlotOrdinals(preparedTarget);
    if (!assertTextBoundaryContext(state, preparedTarget)) {
      state.textOrdinals = outerOrdinals;
      return;
    }
    const recipeVar = nextName(state, 'claimRecipe');
    state.recipeVars.set(recipe.id, recipeVar);
    const scopeParam = nextName(state, 'recipeScope');
    const propsParam = nextName(state, 'recipeProps');
    const parentParam = nextName(state, 'recipeParent');
    const adoptedVar = nextName(state, 'adopted');
    push(state, `const ${recipeVar} = createRecipe({`, recipe.span);
    state.indent += 1;
    push(state, `definitionOwner: ${MOUNT_SCOPE},`);
    push(
      state,
      `source: ${JSON.stringify(`${file}#${state.component.name}:${recipe.id.replace(/^#/, '')}`)},`,
    );
    state.usesLeafClaimMismatch = true;
    push(state, `mount() { throw ${claimError('claim-time recipe has no mount')}; },`);
    push(state, `claim(${scopeParam}, ${propsParam}, ${parentParam}) {`, recipe.span);
    state.indent += 1;
    const outerScope = state.scopeVar;
    const outerAdopted = state.claimAdoptedVar;
    const outerActivation = state.claimActivationVar;
    state.scopeVar = scopeParam;
    state.claimAdoptedVar = adoptedVar;
    // This claim is either a top-level claim (it owns and drains the queue) or
    // part of an enclosing verify walk (it appends to that owner's queue). It
    // must never flush before the enclosing root structure check.
    state.claimActivationVar = CLAIM_ACTIVATION;
    const phase2: Array<() => void> = [];
    const activationSteps = emitClaimQueueInit(state, parentParam);
    push(state, `const ${adoptedVar} = [];`);
    push(state, 'try {');
    state.indent += 1;
    emitClaimHtmlNamespace(state, parentParam, '/');
    emitClaimInto(
      state,
      [recipe.target],
      '__oe_claimCursor',
      '',
      records,
      phase2,
      (name) => {
        push(state, `${adoptedVar}.push(${name});`);
      },
      (name, condition) => {
        push(state, `if (${condition}) ${adoptedVar}.push(${name});`);
      },
      parentParam,
      true,
    );
    state.usesLeafClaimMismatch = true;
    push(
      state,
      `if (__oe_cursorOwned && __oe_claimCursor.node !== null) throw ${claimError('extra node at /')};`,
    );
    emitPhase2Steps(state, phase2);
    emitClaimActivationCapture(state, activationSteps);
    state.indent -= 1;
    emitClaimOwnerFinally(state);
    emitClaimActivationDrain(state, activationSteps);
    push(state, `return ${adoptedVar};`);
    state.scopeVar = outerScope;
    state.claimAdoptedVar = outerAdopted;
    state.claimActivationVar = outerActivation;
    state.indent -= 1;
    push(state, '},');
    state.indent -= 1;
    push(state, '});');
    state.textOrdinals = outerOrdinals;
  }
}

/**
 * Emit `<Name>__claim` for a claimable component. Returns null when the shape
 * is outside the admitted claim slice; the caller then leaves the recipe mount-only.
 */
function emitClaimFunction(
  file: string,
  component: FunctionModelComponent,
  records: ReadonlyMap<string, LoweredExpressionRecord>,
  componentByName: ReadonlyMap<string, FunctionModelComponent>,
  sharedClaimCursor: boolean,
): ClaimEmission | null {
  const ctx: ClaimContext = { componentByName, stack: new Set() };
  if (!componentClaimable(component, ctx)) return null;
  const useShared = sharedClaimCursor && !isDirectoryRootComponent(component);
  const projectsChildren = componentProjectsChildren(component);
  const propsName = component.propsParam;
  const state: EmitState = {
    component,
    lines: [],
    physicalLine: 0,
    indent: 1,
    diagnostics: [],
    requiredBindings: new Set(),
    requiredProps: new Set(),
    hostBindings: new Set(),
    localResources: new Set(),
    counter: { value: 0 },
    propsName,
    requiresPropsChanged: false,
    segments: [],
    placements: [],
    segmentKeys: new Set(),
    scopeVar: MOUNT_SCOPE,
    hostVar: MOUNT_HOST,
    componentByName,
    declaredRecipeIds: declaredRecipeIdSet(component),
    recipeNames: new Set(),
    recipeVars: new Map(),
    entryNames: new Set(),
    refreshStack: [],
    listDepth: 0,
    recipeDepth: 0,
    childrenRecipeVar: projectsChildren ? `${INTERNAL_PREFIX}childrenRecipe` : null,
    ssrRecipeVars: new Map(),
    ssrChildrenRenderVar: null,
    directorySource: `${file}#${component.name}`,
    usesStaticSiblingDirectoryConsumer: false,
    claimCursorShared: useShared,
    claimAdoptedVar: null,
    claimActivationVar: null,
    usesClaimRecipe: false,
    emitDirectoryMarkers: false,
    emitTextBoundaries: true,
    textOrdinals: textSlotOrdinals(component.roots),
    claimEntry: null,
    usesLeafClaimMismatch: false,
  };
  if (!assertTextBoundaryContext(state, component.roots)) {
    return {
      lines: [],
      diagnostics: state.diagnostics,
      segments: [],
      placements: [],
    };
  }
  const localLines: Array<{
    name: string;
    record: LoweredExpressionRecord;
    span: SpanLike;
  }> = [];
  for (const resource of component.resources) {
    if (!IDENTIFIER_PATTERN.test(resource.name) || resource.name.startsWith(INTERNAL_PREFIX)) {
      continue;
    }
    if (resource.kind === 'local') {
      if (resource.recipeId !== null || resource.expression === null) continue;
      const record = recordFor(state, resource.expression, records);
      if (record === null || !declareReads(state, record)) continue;
      state.localResources.add(resource.name);
      localLines.push({ name: resource.name, record, span: resource.span });
      continue;
    }
    state.hostBindings.add(resource.name);
    state.requiredBindings.add(resource.name);
  }
  const phase2: Array<() => void> = [];
  // M08-2 B2: only the shared-cursor claim queues activation. Its per-element
  // blocks are flushed before the enclosing cursor owner's final structure
  // check, so they must append closures and let the owner drain after that
  // check. The non-shared path already validates its root before phase 2.
  state.claimActivationVar = useShared ? CLAIM_ACTIVATION : null;
  const rootAdoptedVar = useShared ? null : nextName(state, 'adopted');
  if (!useShared) {
    // Local snapshots are setup work: evaluate them once, before the claim walk
    // reads them (B1). This matches the shared path and mount setup order; a
    // local initializer's authored side effects therefore run during claim.
    for (const line of localLines) {
      pushParts(state, [`const ${line.name} = (`, { record: line.record }, ');'], line.span);
    }
    push(state, `const ${rootAdoptedVar} = [];`);
  }
  const rootDirectory = staticElementDirectory(component.roots);
  if (!useShared && rootDirectory !== null) {
    for (const interior of emitClaimedDirectory(state, CLAIM_PARENT, rootDirectory)) {
      push(state, `${rootAdoptedVar}.push(${interior});`);
    }
  } else if (!useShared) {
    emitClaimHtmlNamespace(state, CLAIM_PARENT, '/');
    const rootCursor = nextName(state, 'cursor');
    push(state, `const ${rootCursor} = { node: ${CLAIM_PARENT}.firstChild };`);
    emitClaimInto(
      state,
      component.roots,
      rootCursor,
      '',
      records,
      phase2,
      (name) => {
        push(state, `${rootAdoptedVar}.push(${name});`);
      },
      (name, condition) => {
        push(state, `if (${condition}) ${rootAdoptedVar}.push(${name});`);
      },
      CLAIM_PARENT,
      true,
    );
    emitClaimCursorEnd(state, rootCursor, '/');
  } else {
    for (const line of localLines) {
      pushParts(state, [`const ${line.name} = (`, { record: line.record }, ');'], line.span);
    }
    if (state.childrenRecipeVar !== null) {
      push(state, `const ${state.childrenRecipeVar} = ${MOUNT_PROPS}.children;`);
      push(
        state,
        `if (${state.childrenRecipeVar} == null || typeof ${state.childrenRecipeVar} !== "object" || typeof ${state.childrenRecipeVar}.mount !== "function" || ${state.childrenRecipeVar}.definitionOwner == null) throw new Error("OEIR_LEAF_MISSING_CHILDREN: component '<${component.name}>' projects props.children but the mounted instance was given no children recipe");`,
      );
    }
    emitClaimHtmlNamespace(state, CLAIM_PARENT, '/');
    emitClaimTimeRecipes(state, file, records);
    const adoptedVar = nextName(state, 'adopted');
    state.claimAdoptedVar = adoptedVar;
    push(state, `const ${adoptedVar} = [];`);
    const activationSteps = emitClaimQueueInit(state, CLAIM_PARENT);
    push(state, 'try {');
    state.indent += 1;
    emitClaimInto(
      state,
      component.roots,
      '__oe_claimCursor',
      '',
      records,
      phase2,
      (name) => {
        push(state, `${adoptedVar}.push(${name});`);
      },
      (name, condition) => {
        push(state, `if (${condition}) ${adoptedVar}.push(${name});`);
      },
      CLAIM_PARENT,
      true,
    );
    state.usesLeafClaimMismatch = true;
    push(
      state,
      `if (__oe_cursorOwned && __oe_claimCursor.node !== null) throw ${claimError('extra node at /')};`,
    );
    emitPhase2Steps(state, phase2);
    emitClaimActivationCapture(state, activationSteps);
    state.indent -= 1;
    emitClaimOwnerFinally(state);
    emitClaimActivationDrain(state, activationSteps);
    push(state, `return ${adoptedVar};`);
  }
  if (state.diagnostics.length > 0) {
    return {
      lines: [],
      diagnostics: state.diagnostics,
      segments: [],
      placements: [],
    };
  }
  if (!useShared) {
    emitPhase2Steps(state, phase2);
    push(state, `return ${rootAdoptedVar};`);
  }

  const prologue: string[] = [
    `function ${component.name}${CLAIM_SUFFIX}(${MOUNT_SCOPE}, ${MOUNT_PROPS}, ${MOUNT_HOST}, ${CLAIM_PARENT}) {`,
  ];
  if (
    propsName !== null &&
    IDENTIFIER_PATTERN.test(propsName) &&
    !propsName.startsWith(INTERNAL_PREFIX)
  ) {
    prologue.push(`  const ${propsName} = ${MOUNT_PROPS};`);
  }
  if (state.requiredBindings.size > 0) {
    prologue.push(
      `  const ${INTERNAL_PREFIX}requireBinding = (name) => { const value = ${MOUNT_HOST}.bindings[name]; if (value === undefined) throw new Error("OEIR_LEAF_MISSING_VALUE: " + name); return value; };`,
    );
    for (const binding of [...state.requiredBindings].sort()) {
      prologue.push(
        `  const ${binding} = ${INTERNAL_PREFIX}requireBinding(${JSON.stringify(binding)});`,
      );
    }
  }
  const shift = fragmentLineCount(prologue);
  return {
    lines: [...prologue, ...state.lines, '}', ''],
    diagnostics: [],
    usesStaticSiblingDirectoryConsumer: state.usesStaticSiblingDirectoryConsumer,
    usesClaimRecipe: state.usesClaimRecipe,
    usesLeafClaimMismatch: state.usesLeafClaimMismatch,
    segments: state.segments.map((segment) => ({
      ...segment,
      generatedLine: segment.generatedLine + shift,
    })),
    placements: state.placements.map((placement) => ({
      ...placement,
      generatedLine: placement.generatedLine + shift,
    })),
  };
}

/**
 * SSR producer, static slice (M08-1a).
 *
 * A claimable component whose roots are fully static also emits `<Name>__ssr()`,
 * which returns the HTML the mount would build — at compile time, because a
 * static subtree's bytes are known then. The point is the pairing: a generated
 * module that can claim existing DOM can now also produce that DOM, which is
 * the precondition for the M08 SSR→claim parity proof.
 *
 * Boundary of this slice: dynamic text/attribute/property slots, conditions,
 * lists, component references and insertion sites return `null`, so no `__ssr`
 * is emitted for them. Slice M08-1b adds the admitted dynamic slots; the
 * void-element slice admits canonical `VOID_TAGS` as a start tag + attributes
 * with no close tag. For every other shape the absence of `__ssr` is the honest
 * shape of "this component is not SSR-producible yet".
 *
 * Escaping is NOT re-implemented here: the emitted code calls the runtime's
 * `escapeText` / `escapeAttrValue`, which are the same contract the serializers
 * use. A second escape table in the compiler would be exactly the drift P6
 * forbids.
 */
function staticSsrDirectory(ranges: readonly FunctionModelNode[]): string | null {
  const parts: string[] = [];
  for (const [ordinal, range] of ranges.entries()) {
    // The mount suppresses directories inside a range (`allowDirectory` false
    // in emitMountedDirectory), so a range interior never carries its own
    // `oe:r` pair. The SSR form is the same tree: markers stop at this range
    // layer. Emitting markers into the interior would put nested comments
    // there and the directory parser would refuse its own SSR output.
    const inner = staticSsrNode(range, false);
    if (inner === null) return null;
    parts.push(
      `"<!--" + markerText(rangeMarker(${ordinal})) + "-->"`,
      inner,
      `"<!--" + markerText(rangeMarker(${ordinal}, true)) + "-->"`,
    );
  }
  return parts.length === 0 ? '""' : parts.join(' + ');
}

function staticSsrExpression(nodes: readonly FunctionModelNode[], markers: boolean): string | null {
  const parts: string[] = [];
  for (const node of normalizeTextRuns(nodes)) {
    const part = staticSsrNode(node, markers);
    if (part === null) return null;
    parts.push(part);
  }
  return parts.length === 0 ? '""' : parts.join(' + ');
}

function literalText(value: string): string {
  return JSON.stringify(value);
}

function staticSsrNode(node: FunctionModelNode, markers: boolean): string | null {
  if (node.kind === 'text') return `escapeText(${literalText(node.value)})`;
  if (node.kind === 'fragment') return staticSsrExpression(node.children, markers);
  if (node.kind !== 'element') return null;
  if (!TAG_PATTERN.test(node.tag)) return null;
  const isVoid = VOID_TAGS.has(node.tag);
  // A void element has no content model. The frontend refuses authored
  // children with `OEC9013`; this null is the generator's fail-closed guard for
  // a model that bypassed the source diagnostic (never a child drop).
  if (isVoid && node.children.length > 0) return null;
  const attributes: string[] = [];
  for (const attribute of node.attributes) {
    // Slice 1a: static attributes only. A dynamic slot means the value is not
    // known at compile time, so this component has no static SSR form yet.
    if (attribute.kind !== 'static') return null;
    if (unsafeStreamFrameAttribute(attribute.name, attribute.value)) return null;
    attributes.push(
      [
        '" "',
        literalText(`${attribute.name}="`),
        `escapeAttrValue(${literalText(attribute.value)})`,
        literalText('"'),
      ].join(' + '),
    );
  }
  const open = `"<${node.tag}"`;
  // HTML void elements: the start tag and its attributes, no close tag. A
  // `</input>` would be parsed as a stray end tag by the HTML parser and the
  // claim's fixed cursor never expects it.
  if (isVoid) return [open, ...attributes, '">"'].join(' + ');
  // The mount wraps a static sibling directory in its marker comments; the SSR
  // form must carry the same comments or the claim cannot find its ranges.
  const directory = markers ? staticElementDirectory(node.children) : null;
  const children =
    directory === null
      ? staticSsrExpression(node.children, markers)
      : staticSsrDirectory(directory);
  if (children === null) return null;
  const close = `"</${node.tag}>"`;
  return [open, ...attributes, '">"', children, close].join(' + ');
}

/**
 * M08-1b dynamic SSR producer. This is the emitted form for a component whose
 * claimable tree contains a dynamic text/attribute/boolean slot. It walks the
 * same `FunctionModelNode` and `LoweredExpressionRecord` inputs as mount and
 * claim; nothing is re-resolved or stored as a program.
 *
 * The emitted body evaluates the lowered text once per call (request-time
 * snapshot), through the runtime's one coercion/escape/security contract. It
 * creates no owner, no DOM, no subscription and no cleanup; a missing host
 * binding keeps the mount's `OEIR_LEAF_MISSING_VALUE: <name>` identity.
 */
interface SsrEmission {
  readonly lines: readonly string[];
  readonly diagnostics: readonly IrDiagnostic[];
  readonly segments: readonly EmissionSegment[];
  readonly placements: readonly ExpressionPlacement[];
}

/**
 * A fresh `EmitState` for SSR. SSR uses only the expression placement/segment
 * machinery and the binding declaration; the mount-only fields stay inert.
 */
function ssrEmitState(
  component: FunctionModelComponent,
  file: string,
  propsName: string | null,
  componentByName: ReadonlyMap<string, FunctionModelComponent>,
  projectsChildren: boolean,
): EmitState {
  return {
    component,
    lines: [],
    physicalLine: 0,
    indent: 1,
    diagnostics: [],
    requiredBindings: new Set(),
    requiredProps: new Set(),
    hostBindings: new Set(),
    localResources: new Set(),
    counter: { value: 0 },
    propsName,
    requiresPropsChanged: false,
    segments: [],
    placements: [],
    segmentKeys: new Set(),
    scopeVar: MOUNT_SCOPE,
    hostVar: MOUNT_HOST,
    // Composition SSR consumes the SAME model links the mount/claim use: the
    // component map for a component reference and the declared recipe ids for
    // an insertion site. It never re-derives them.
    componentByName,
    declaredRecipeIds: declaredRecipeIdSet(component),
    recipeNames: new Set(),
    recipeVars: new Map(),
    entryNames: new Set(),
    refreshStack: [],
    listDepth: 0,
    recipeDepth: 0,
    childrenRecipeVar: null,
    ssrRecipeVars: new Map(),
    ssrChildrenRenderVar: projectsChildren ? SSR_CHILDREN_RENDER : null,
    directorySource: `${file}#${component.name}`,
    usesStaticSiblingDirectoryConsumer: false,
    claimCursorShared: false,
    claimAdoptedVar: null,
    claimActivationVar: null,
    usesClaimRecipe: false,
    emitDirectoryMarkers: false,
    emitTextBoundaries: true,
    textOrdinals: textSlotOrdinals(component.roots),
    claimEntry: null,
    usesLeafClaimMismatch: false,
  };
}

function failedSsr(state: EmitState): SsrEmission {
  return {
    lines: [],
    diagnostics: state.diagnostics,
    segments: [],
    placements: [],
  };
}

/**
 * One request-time attribute fragment. `channel` is admitted by the leaf claim
 * boundary, so `attribute`/`boolean` are the only dynamic non-static channels
 * that can reach this emitter.
 */
function emitSsrDynamicAttribute(
  state: EmitState,
  attribute: Extract<FunctionModelAttribute, { readonly kind: 'dynamic' }>,
  outVar: string,
  records: ReadonlyMap<string, LoweredExpressionRecord>,
): boolean {
  if (!ADMITTED_ATTRIBUTE_CHANNELS.has(attribute.channel)) return false;
  const record = recordFor(state, attribute.expression, records);
  if (record === null || !declareReads(state, record)) return false;
  const literal = JSON.stringify(attribute.name);
  if (attribute.channel === 'boolean') {
    pushParts(
      state,
      [
        `if (Boolean((`,
        { record },
        `))) ${outVar}.push(${JSON.stringify(` ${attribute.name}=""`)});`,
      ],
      attribute.span,
    );
    return true;
  }
  if (attribute.channel !== 'attribute') return false;
  const valueVar = nextName(state, 'value');
  pushParts(state, [`const ${valueVar} = attributeValueOf((`, { record }, '));'], attribute.span);
  push(state, `if (${valueVar} !== null) {`, attribute.span);
  push(state, `  assertSafeUrlAttribute(${literal}, ${valueVar});`, attribute.span);
  push(
    state,
    `  ${outVar}.push(${JSON.stringify(` ${attribute.name}="`)}, escapeAttrValue(${valueVar}), ${JSON.stringify('"')});`,
    attribute.span,
  );
  push(state, `}`, attribute.span);
  return true;
}

/**
 * M08 composition SSR — one component reference. The emitted call uses the
 * SAME model component map and the SAME per-read props record the mount builds:
 * a fresh `{ get name() { return <lowered record>; } }` object at this call
 * site, never a cached value. The child body is emitted once per module
 * (`<Child>__ssr`), so two references with different props call one function
 * twice and each call evaluates its own record.
 *
 * A children-projecting target is called through its module-local
 * `__oe_ssrComponent_<Child>` helper with the children recipe's render function as the
 * third argument; that function is the one referenced-recipe helper, so a
 * child projecting twice calls it twice. A reference with JSX children to a
 * child that ignores them passes no renderer, exactly like mount's unused
 * children channel.
 */
function emitSsrComponentRef(
  state: EmitState,
  node: FunctionModelComponentRef,
  outVar: string,
  records: ReadonlyMap<string, LoweredExpressionRecord>,
): boolean {
  const span: IrSpan = node.span;
  if (state.listDepth > 0) {
    diag(
      state,
      'OEIR_LEAF_UNSUPPORTED_COMPONENT',
      `component '<${node.name}>' inside a list entry template needs the child update hook (M06b1b); a keyed reuse would keep the first mount's props`,
      span,
    );
    return false;
  }
  const target = state.componentByName.get(node.name);
  if (target === undefined) {
    diag(
      state,
      'OEIR_LEAF_UNKNOWN_COMPONENT',
      `component '<${node.name}>' is not declared in this module (external components are M06b2)`,
      span,
    );
    return false;
  }
  if (target.propsParam === null) {
    diag(
      state,
      'OEIR_LEAF_UNSUPPORTED_COMPONENT',
      `component '<${node.name}>' has no named props parameter (destructured or absent); component references need a named props parameter (M06b2 owns destructuring)`,
      span,
    );
    return false;
  }
  const ownedBindings = target.resources.filter(
    (resource) => resource.kind === 'signal' || resource.kind === 'computed',
  );
  if (ownedBindings.length > 0) {
    diag(
      state,
      'OEIR_LEAF_UNSUPPORTED_COMPONENT',
      `component '<${node.name}>' owns signal/computed resources; a child instance cannot resolve host bindings without sharing the parent instance (M06b2/M07 own it)`,
      span,
    );
    return false;
  }
  if (node.childrenRecipeId !== null && state.recipeDepth > 0) {
    diag(
      state,
      'OEIR_LEAF_UNSUPPORTED_CHILDREN',
      `children on '<${node.name}>' inside a reusable JSX value body are outside the M06b2a slice: the children recipe would be created once per component mount, but its definition owner is the recipe instance scope (created per insertion)`,
      span,
    );
    return false;
  }
  if (node.childrenRecipeId === null && componentProjectsChildren(target)) {
    diag(
      state,
      'OEIR_LEAF_MISSING_CHILDREN',
      `component '<${node.name}>' projects props.children but this reference passes no JSX children; every projection needs a children recipe`,
      span,
    );
    return false;
  }
  const childrenRenderVar =
    node.childrenRecipeId === null
      ? null
      : (state.ssrRecipeVars.get(node.childrenRecipeId) ?? null);
  if (node.childrenRecipeId !== null && childrenRenderVar === null) {
    diag(
      state,
      'OEIR_LEAF_MISSING_RECIPE',
      `children recipe '${node.childrenRecipeId}' of '<${node.name}>' has no emitted SSR render function (it is not reachable from any admitted root)`,
      span,
    );
    return false;
  }
  const admitted: Array<
    | { readonly kind: 'static'; readonly name: string; readonly value: string }
    | {
        readonly kind: 'dynamic';
        readonly name: string;
        readonly expression: FunctionExpressionRef;
        readonly span: SpanLike;
      }
  > = [];
  let refused = false;
  for (const attribute of node.props) {
    if (attribute.name === 'key') continue;
    if (attribute.name === 'children') {
      diag(
        state,
        'OEIR_LEAF_UNSUPPORTED_COMPONENT',
        `'children' on component '<${node.name}>' must be authored as JSX children, not a prop value: it is the recipe projection channel (JSX value model §4.4)`,
        span,
      );
      refused = true;
      continue;
    }
    if (!componentPropAdmitted(state, attribute, node.name, span)) {
      refused = true;
      continue;
    }
    admitted.push(attribute);
  }
  if (refused) return false;
  type ResolvedProp =
    | { readonly kind: 'static'; readonly name: string; readonly value: string }
    | {
        readonly kind: 'dynamic';
        readonly name: string;
        readonly record: LoweredExpressionRecord;
        readonly span: SpanLike;
      };
  const resolved: ResolvedProp[] = [];
  for (const prop of admitted) {
    if (prop.kind === 'static') {
      resolved.push(prop);
      continue;
    }
    const record = recordFor(state, prop.expression, records);
    if (record === null || !declareReads(state, record)) return false;
    resolved.push({ kind: 'dynamic', name: prop.name, record, span: prop.span });
  }
  let propsExpr = '{}';
  if (resolved.length > 0) {
    const id = state.counter.value++;
    const propsVar = `${INTERNAL_PREFIX}childProps${id}`;
    push(state, `const ${propsVar} = {`, span);
    state.indent += 1;
    for (const prop of resolved) {
      const key = IDENTIFIER_PATTERN.test(prop.name) ? prop.name : JSON.stringify(prop.name);
      if (prop.kind === 'static') {
        push(state, `${key}: ${JSON.stringify(prop.value)},`);
        continue;
      }
      pushParts(state, [`get ${key}() { return (`, { record: prop.record }, '); },'], prop.span);
    }
    state.indent -= 1;
    push(state, '};');
    propsExpr = propsVar;
  }
  if (componentProjectsChildren(target)) {
    if (childrenRenderVar === null) return false;
    push(
      state,
      `${outVar}.push(${SSR_HELPER_PREFIX}${target.name}(${propsExpr}, ${state.hostVar}, ${childrenRenderVar}));`,
      span,
    );
  } else {
    // A fully static child keeps the parameterless M08-1a function; extra
    // arguments are harmless and the static body reads no prop by definition.
    push(state, `${outVar}.push(${node.name}${SSR_SUFFIX}(${propsExpr}, ${state.hostVar}));`, span);
  }
  return true;
}

/**
 * M08 composition SSR — one module-local render function per referenced
 * reusable-JSX/children recipe. All function names are published before any
 * body is emitted so a site inside another recipe body can reference any
 * recipe (the mount graph is acyclic, so this cannot recurse unboundedly).
 * Each helper is its own text/ordinal chunk, matching the mount recipe body and
 * the claim-time recipe chunk.
 */
function emitSsrRecipeHelpers(
  state: EmitState,
  records: ReadonlyMap<string, LoweredExpressionRecord>,
): boolean {
  const referenced = referencedRecipeIds(state.component);
  if (referenced.size === 0) return true;
  const plans: Array<{ readonly recipe: FunctionModelRecipe; readonly name: string }> = [];
  for (const recipe of state.component.recipes) {
    if (!referenced.has(recipe.id)) continue;
    const name = nextName(state, 'ssrRecipe');
    state.ssrRecipeVars.set(recipe.id, name);
    plans.push({ recipe, name });
  }
  for (const plan of plans) {
    const outerOrdinals = state.textOrdinals;
    const prepared = normalizeTextRuns([plan.recipe.target]);
    state.textOrdinals = textSlotOrdinals(prepared);
    if (!assertTextBoundaryContext(state, prepared)) {
      state.textOrdinals = outerOrdinals;
      return false;
    }
    push(state, `function ${plan.name}() {`, plan.recipe.span);
    state.indent += 1;
    const outVar = nextName(state, 'ssrOut');
    push(state, `const ${outVar} = [];`);
    const outerDepth = state.recipeDepth;
    state.recipeDepth = outerDepth + 1;
    const emitted = emitDynamicSsrNodes(state, prepared, outVar, true, records);
    state.recipeDepth = outerDepth;
    state.textOrdinals = outerOrdinals;
    if (!emitted) return false;
    push(state, `return ${outVar}.join("");`);
    state.indent -= 1;
    push(state, '}');
  }
  return true;
}

/**
 * Walk the admitted M08-1b tree into `outVar`. Returns false for any shape
 * outside the dynamic leaf slice; the caller then emits no `__ssr` rather than
 * a partial producer. The marker rule mirrors `staticSsrNode`: a range
 * interior recurses with markers suppressed, so the SSR output is what the
 * M07b directory parser accepts.
 */
function emitDynamicSsrNodes(
  state: EmitState,
  nodes: readonly FunctionModelNode[],
  outVar: string,
  markers: boolean,
  records: ReadonlyMap<string, LoweredExpressionRecord>,
): boolean {
  const list = state.emitTextBoundaries ? normalizeTextRuns(nodes) : nodes;
  for (const node of list) {
    if (node.kind === 'text') {
      push(state, `${outVar}.push(escapeText(${literalText(node.value)}));`, node.span);
      continue;
    }
    if (node.kind === 'fragment') {
      if (!emitDynamicSsrNodes(state, node.children, outVar, markers, records)) return false;
      continue;
    }
    if (node.kind === 'dynamic-text') {
      const record = recordFor(state, node.expression, records);
      if (record === null || !declareReads(state, record)) return false;
      const ordinal = textOrdinal(state, node);
      if (ordinal === null) return false;
      push(
        state,
        `${outVar}.push("<!--", markerText(textSlotMarker(${ordinal})), "-->");`,
        node.span,
      );
      pushParts(
        state,
        [`${outVar}.push(escapeText(displayValue((`, { record }, '))));'], // displayValue((expr))
        node.span,
      );
      push(
        state,
        `${outVar}.push("<!--", markerText(textSlotMarker(${ordinal}, true)), "-->");`,
        node.span,
      );
      continue;
    }
    if (node.kind === 'condition') {
      const record = recordFor(state, node.test, records);
      if (record === null || !declareReads(state, record)) return false;
      // Evaluate the test once per __ssr call. The branch selection is a
      // request-time fact, so a static branch body still needs this producer.
      const testVar = nextName(state, 'whenTest');
      pushParts(state, [`const ${testVar} = (`, { record }, ');'], node.span);
      push(state, `${outVar}.push("<!--", markerText(MARKERS.when), "-->");`, node.span);
      push(state, `if (${testVar}) {`, node.span);
      state.indent += 1;
      const thenOrdinals = state.textOrdinals;
      const preparedThen = emissionNodes(state, node.consequent);
      state.textOrdinals = textSlotOrdinals(preparedThen);
      if (!emitDynamicSsrNodes(state, preparedThen, outVar, markers, records)) {
        state.textOrdinals = thenOrdinals;
        return false;
      }
      state.textOrdinals = thenOrdinals;
      state.indent -= 1;
      push(state, '} else {', node.span);
      state.indent += 1;
      if (node.alternate !== null && node.alternate.length > 0) {
        const elseOrdinals = state.textOrdinals;
        const preparedElse = emissionNodes(state, node.alternate);
        state.textOrdinals = textSlotOrdinals(preparedElse);
        if (!emitDynamicSsrNodes(state, preparedElse, outVar, markers, records)) {
          state.textOrdinals = elseOrdinals;
          return false;
        }
        state.textOrdinals = elseOrdinals;
      }
      state.indent -= 1;
      push(state, '}', node.span);
      push(state, `${outVar}.push("<!--", markerText(MARKERS.whenEnd), "-->");`, node.span);
      continue;
    }
    if (node.kind === 'list') {
      const itemsRecord = recordFor(state, node.items, records);
      if (itemsRecord === null || !declareReads(state, itemsRecord)) return false;
      if (!IDENTIFIER_PATTERN.test(node.parameter) || node.parameter.startsWith(INTERNAL_PREFIX)) {
        return false;
      }
      const itemsVar = nextName(state, 'eachItems');
      pushParts(state, [`const ${itemsVar} = (`, { record: itemsRecord }, ');'], node.span);
      push(state, `${outVar}.push("<!--", markerText(MARKERS.each), "-->");`, node.span);
      const indexVar = nextName(state, 'eachIndex');
      push(state, `for (let ${indexVar} = 0; ${indexVar} < ${itemsVar}.length; ${indexVar}++) {`);
      state.indent += 1;
      const itemVar = node.parameter;
      push(state, `const ${itemVar} = ${itemsVar}[${indexVar}];`);
      const outerEntryName = state.entryNames.has(node.parameter);
      state.entryNames.add(node.parameter);
      const tokenVar = nextName(state, 'eachToken');
      if (node.key !== null) {
        const keyRecord = recordFor(state, node.key, records);
        if (keyRecord === null || !declareReads(state, keyRecord)) {
          if (!outerEntryName) state.entryNames.delete(node.parameter);
          return false;
        }
        pushParts(
          state,
          [`const ${tokenVar} = encodeListKey((`, { record: keyRecord }, '));'],
          node.key.span,
        );
      } else {
        // Unkeyed lists keep mount's positional key contract (index is the key).
        push(state, `const ${tokenVar} = encodeListKey(${indexVar});`, node.span);
      }
      push(
        state,
        `${outVar}.push("<!--", markerText(entryKeyMarker(${tokenVar})), "-->");`,
        node.span,
      );
      const outerOrdinals = state.textOrdinals;
      const prepared = emissionNodes(state, node.template);
      state.textOrdinals = textSlotOrdinals(prepared);
      // A component reference inside an entry cannot re-read props on a keyed
      // reuse (M06b1b), so the SSR walk keeps mount's refusal.
      state.listDepth += 1;
      const entriesEmitted = emitDynamicSsrNodes(state, prepared, outVar, markers, records);
      state.listDepth -= 1;
      state.textOrdinals = outerOrdinals;
      if (!outerEntryName) state.entryNames.delete(node.parameter);
      if (!entriesEmitted) return false;
      state.indent -= 1;
      push(state, '}');
      push(state, `${outVar}.push("<!--", markerText(MARKERS.eachEnd), "-->");`, node.span);
      continue;
    }
    if (node.kind === 'component-ref') {
      if (!emitSsrComponentRef(state, node, outVar, records)) return false;
      continue;
    }
    if (node.kind === 'insertion-site') {
      if (!state.declaredRecipeIds.has(node.recipeId)) {
        diag(
          state,
          'OEIR_LEAF_UNSUPPORTED_RECIPE',
          `insertion site '${node.recipeId}' does not target a direct component-local JSX initializer; only those values are reusable recipes in this slice`,
          node.span,
        );
        return false;
      }
      const renderRecipe = state.ssrRecipeVars.get(node.recipeId);
      if (renderRecipe === undefined) {
        diag(
          state,
          'OEIR_LEAF_MISSING_RECIPE',
          `insertion site '${node.recipeId}' has no emitted SSR render function (the value is not reachable from any admitted root)`,
          node.span,
        );
        return false;
      }
      push(state, `${outVar}.push(${renderRecipe}());`, node.span);
      continue;
    }
    if (node.kind === 'children-projection') {
      if (state.recipeDepth > 0) {
        diag(
          state,
          'OEIR_LEAF_UNSUPPORTED_NODE',
          `children projection inside a reusable JSX value body is outside the M06b2a slice: the projection would need the recipe instance scope, which exists only at insertion time`,
          node.span,
        );
        return false;
      }
      if (state.ssrChildrenRenderVar === null) {
        diag(
          state,
          'OEIR_LEAF_MISSING_CHILDREN',
          'children projection has no server children renderer (internal model mismatch)',
          node.span,
        );
        return false;
      }
      push(state, `${outVar}.push(${state.ssrChildrenRenderVar}());`, node.span);
      continue;
    }
    if (node.kind !== 'element') return false;
    if (!TAG_PATTERN.test(node.tag)) return false;
    const isVoid = VOID_TAGS.has(node.tag);
    if (isVoid && node.children.length > 0) {
      // Source admission refuses this with `OEC9013`; a model that bypassed
      // the source check still must not emit a start tag that silently omits
      // its children. Fail the producer instead.
      diag(
        state,
        'OEIR_LEAF_UNSUPPORTED_VOID_CHILDREN',
        `void element <${node.tag}> may not have children`,
        node.span,
      );
      return false;
    }
    push(state, `${outVar}.push(${literalText(`<${node.tag}`)});`, node.span);
    for (const attribute of node.attributes) {
      if (attribute.kind === 'dynamic' && CONSUMED_ATTRIBUTE_CHANNELS.has(attribute.channel)) {
        // `key` is list identity, never a DOM write (same rule as mount).
        continue;
      }
      if (attribute.kind === 'static') {
        if (!ATTRIBUTE_PATTERN.test(attribute.name)) return false;
        if (unsafeStreamFrameAttribute(attribute.name, attribute.value)) return false;
        push(
          state,
          `${outVar}.push(${JSON.stringify(` ${attribute.name}="`)}, escapeAttrValue(${literalText(attribute.value)}), ${JSON.stringify('"')});`,
          attribute.span,
        );
        continue;
      }
      if (!emitSsrDynamicAttribute(state, attribute, outVar, records)) return false;
    }
    push(state, `${outVar}.push(">");`, node.span);
    if (isVoid) continue;
    const directory =
      markers && directoryParentAllowed(node.tag) ? staticElementDirectory(node.children) : null;
    if (directory !== null) {
      for (const [ordinal, range] of directory.entries()) {
        push(
          state,
          `${outVar}.push("<!--", markerText(rangeMarker(${ordinal})), "-->");`,
          range.span,
        );
        if (!emitDynamicSsrNodes(state, [range], outVar, false, records)) return false;
        push(
          state,
          `${outVar}.push("<!--", markerText(rangeMarker(${ordinal}, true)), "-->");`,
          range.span,
        );
      }
    } else if (!emitDynamicSsrNodes(state, node.children, outVar, markers, records)) {
      return false;
    }
    push(state, `${outVar}.push(${literalText(`</${node.tag}>`)});`, node.span);
  }
  return true;
}

/**
 * Emit `<Name>__ssr(props, host)` for a component with at least one admitted
 * dynamic slot. Returns null when the shape is outside the slice (for example
 * a condition, list, component reference, insertion site or property channel);
 * diagnostics are returned as a failed emission so the module fails closed the
 * same way mount/claim failures do. Void elements are admitted: they emit the
 * start tag and attributes only.
 */
function emitDynamicSsrFunction(
  file: string,
  component: FunctionModelComponent,
  records: ReadonlyMap<string, LoweredExpressionRecord>,
  componentByName: ReadonlyMap<string, FunctionModelComponent>,
): SsrEmission | null {
  const propsName = component.propsParam;
  const projectsChildren = componentProjectsChildren(component);
  const composition = treeHasComposition(component.roots);
  const state = ssrEmitState(component, file, propsName, componentByName, projectsChildren);
  if (!assertTextBoundaryContext(state, component.roots)) return failedSsr(state);
  for (const resource of component.resources) {
    if (!IDENTIFIER_PATTERN.test(resource.name) || resource.name.startsWith(INTERNAL_PREFIX)) {
      continue;
    }
    if (resource.kind === 'local') {
      if (resource.recipeId !== null || resource.expression === null) continue;
      const record = recordFor(state, resource.expression, records);
      if (record === null || !declareReads(state, record)) return failedSsr(state);
      state.localResources.add(resource.name);
      pushParts(state, [`const ${resource.name} = (`, { record }, ');'], resource.span);
      continue;
    }
    state.hostBindings.add(resource.name);
    state.requiredBindings.add(resource.name);
  }
  if (state.diagnostics.length > 0) return failedSsr(state);
  // Mount reads `props.children` once before the roots and fails closed when
  // the host supplied no recipe (M06b2a). The server root instance has the
  // same boundary: it has no children renderer, so a children projection must
  // not render nothing. A component reference supplies the renderer instead.
  if (projectsChildren) {
    push(
      state,
      `if (${SSR_CHILDREN_RENDER} === null) throw new Error("OEIR_LEAF_MISSING_CHILDREN: component '<${component.name}>' projects props.children but the server instance was given no children renderer");`,
      component.span,
    );
  }
  if (composition) {
    // One local render function per referenced recipe (reusable JSX value or
    // children recipe), then calls at every projection. Same recipe twice =
    // one function, two calls; this is not a second AST and not serialized JSON.
    if (!emitSsrRecipeHelpers(state, records)) {
      return state.diagnostics.length > 0 ? failedSsr(state) : null;
    }
  }
  const outVar = nextName(state, 'out');
  push(state, `const ${outVar} = [];`);
  if (!emitDynamicSsrNodes(state, component.roots, outVar, true, records)) {
    return state.diagnostics.length > 0 ? failedSsr(state) : null;
  }
  push(state, `return ${outVar}.join("");`);
  if (state.diagnostics.length > 0) return failedSsr(state);

  // A composition body is reachable from two call sites (the exported wrapper
  // and a component reference that must pass a children renderer), so it
  // lives in one module-local helper. The exported interface keeps its
  // existing M08-1b `(props, host)` shape; the helper name never leaves the
  // generated module (no cross-module/A17 ABI).
  const prologue: string[] = composition
    ? [
        `function ${SSR_HELPER_PREFIX}${component.name}(${MOUNT_PROPS}, ${MOUNT_HOST}, ${SSR_CHILDREN_RENDER}) {`,
      ]
    : [`export function ${component.name}${SSR_SUFFIX}(${MOUNT_PROPS}, ${MOUNT_HOST}) {`];
  if (propsName !== null) {
    prologue.push(`  const ${propsName} = ${MOUNT_PROPS};`);
    state.requiredProps.add(propsName);
  }
  if (state.requiredBindings.size > 0) {
    prologue.push(
      `  const ${INTERNAL_PREFIX}requireBinding = (name) => { const value = ${MOUNT_HOST}.bindings[name]; if (value === undefined) throw new Error("OEIR_LEAF_MISSING_VALUE: " + name); return value; };`,
    );
    for (const binding of [...state.requiredBindings].sort()) {
      prologue.push(
        `  const ${binding} = ${INTERNAL_PREFIX}requireBinding(${JSON.stringify(binding)});`,
      );
    }
  }
  const wrapper: string[] = composition
    ? [
        `export function ${component.name}${SSR_SUFFIX}(${MOUNT_PROPS}, ${MOUNT_HOST}) {`,
        `  return ${SSR_HELPER_PREFIX}${component.name}(${MOUNT_PROPS}, ${MOUNT_HOST}, null);`,
        '}',
        '',
      ]
    : [];
  const shift = fragmentLineCount(prologue);
  return {
    lines: [...prologue, ...state.lines, '}', ...wrapper],
    diagnostics: [],
    segments: state.segments.map((segment) => ({
      ...segment,
      generatedLine: segment.generatedLine + shift,
    })),
    placements: state.placements.map((placement) => ({
      ...placement,
      generatedLine: placement.generatedLine + shift,
    })),
  };
}

/**
 * Emit the SSR function for a claimable component. A fully static component
 * keeps the M08-1a `__ssr()` form (no parameters, byte-identical output); a
 * component with an admitted dynamic slot gets the M08-1b
 * `__ssr(props, host)` form. Returns `null` when the tree is outside the
 * producer slice.
 */
function emitSsrFunction(
  file: string,
  component: FunctionModelComponent,
  rootDirectory: readonly FunctionModelNode[] | null,
  records: ReadonlyMap<string, LoweredExpressionRecord>,
  componentByName: ReadonlyMap<string, FunctionModelComponent>,
): SsrEmission | null {
  let expression: string | null;
  if (rootDirectory !== null) {
    expression = staticSsrDirectory(rootDirectory);
  } else {
    expression = staticSsrExpression(component.roots, true);
  }
  if (expression !== null) {
    return {
      lines: [
        `export function ${component.name}${SSR_SUFFIX}() {`,
        `  return ${expression};`,
        '}',
        '',
      ],
      diagnostics: [],
      segments: [],
      placements: [],
    };
  }
  return emitDynamicSsrFunction(file, component, records, componentByName);
}

function emitComponent(
  file: string,
  component: FunctionModelComponent,
  records: ReadonlyMap<string, LoweredExpressionRecord>,
  componentByName: ReadonlyMap<string, FunctionModelComponent>,
  sharedClaimCursor: boolean,
): EmittedComponent {
  const propsName = component.propsParam;
  const projectsChildren = componentProjectsChildren(component);
  const declaredRecipeIds = new Set<string>();
  const recipeNames = new Set<string>();
  for (const resource of component.resources) {
    if (resource.recipeId === null) continue;
    declaredRecipeIds.add(resource.recipeId);
    recipeNames.add(resource.name);
  }
  const claimable = componentClaimable(component, {
    componentByName,
    stack: new Set(),
  });
  const state: EmitState = {
    component,
    lines: [],
    physicalLine: 0,
    indent: 1,
    diagnostics: [],
    requiredBindings: new Set(),
    requiredProps: new Set(),
    hostBindings: new Set(),
    localResources: new Set(),
    counter: { value: 0 },
    propsName,
    requiresPropsChanged: false,
    segments: [],
    placements: [],
    segmentKeys: new Set(),
    scopeVar: MOUNT_SCOPE,
    hostVar: MOUNT_HOST,
    componentByName,
    declaredRecipeIds,
    recipeNames,
    recipeVars: new Map(),
    entryNames: new Set(),
    refreshStack: [],
    listDepth: 0,
    recipeDepth: 0,
    childrenRecipeVar: projectsChildren ? `${INTERNAL_PREFIX}childrenRecipe` : null,
    ssrRecipeVars: new Map(),
    ssrChildrenRenderVar: null,
    directorySource: `${file}#${component.name}`,
    usesStaticSiblingDirectoryConsumer: false,
    claimCursorShared: false,
    claimAdoptedVar: null,
    claimActivationVar: null,
    usesClaimRecipe: false,
    emitDirectoryMarkers: claimable,
    emitTextBoundaries: claimable,
    textOrdinals: textSlotOrdinals(component.roots),
    claimEntry: null,
    usesLeafClaimMismatch: false,
  };
  if (claimable && !assertTextBoundaryContext(state, component.roots)) {
    return {
      lines: [],
      diagnostics: state.diagnostics,
      requiredBindings: [],
      requiredProps: [],
      requiresPropsChanged: false,
      segments: [],
      placements: [],
    };
  }
  if (
    propsName !== null &&
    (!IDENTIFIER_PATTERN.test(propsName) || propsName.startsWith(INTERNAL_PREFIX))
  ) {
    diag(state, 'OEIR_LEAF_INVALID_BINDING', `props parameter '${propsName}' is not usable`, {
      file,
      start: 0,
      end: 0,
      line: 1,
      column: 1,
    });
  }
  // Resources: signal/computed names are host bindings; local snapshots are
  // evaluated inside the mount (setup mode), preserving M03 semantics.
  const localLines: Array<{
    name: string;
    record: LoweredExpressionRecord;
    span: SpanLike;
  }> = [];
  for (const resource of component.resources) {
    if (!IDENTIFIER_PATTERN.test(resource.name) || resource.name.startsWith(INTERNAL_PREFIX)) {
      diag(
        state,
        'OEIR_LEAF_INVALID_BINDING',
        `resource '${resource.name}' is not usable`,
        resource.span,
      );
      continue;
    }
    if (resource.kind === 'local') {
      // A reusable JSX value has no lowered initializer: its recipe is emitted
      // by `emitRecipes` only when at least one insertion site references it.
      if (resource.recipeId !== null || resource.expression === null) continue;
      const record = recordFor(state, resource.expression, records);
      if (record === null) continue;
      if (!declareReads(state, record)) continue;
      state.localResources.add(resource.name);
      localLines.push({ name: resource.name, record, span: resource.span });
      continue;
    }
    state.hostBindings.add(resource.name);
    state.requiredBindings.add(resource.name);
  }
  if (state.diagnostics.length > 0) {
    return {
      lines: [],
      diagnostics: state.diagnostics,
      requiredBindings: [],
      requiredProps: [],
      requiresPropsChanged: false,
      segments: [],
      placements: [],
    };
  }
  if (!IDENTIFIER_PATTERN.test(component.name) || component.name.startsWith(INTERNAL_PREFIX)) {
    diag(
      state,
      'OEIR_LEAF_INVALID_COMPONENT',
      `component '${component.name}' is not usable`,
      component.span,
    );
    return {
      lines: [],
      diagnostics: state.diagnostics,
      requiredBindings: [],
      requiredProps: [],
      requiresPropsChanged: false,
      segments: [],
      placements: [],
    };
  }

  push(state, `const ${INTERNAL_PREFIX}nodes = [];`);
  for (const line of localLines) {
    pushParts(state, [`const ${line.name} = (`, { record: line.record }, ');'], line.span);
  }
  // One read of the children recipe per mount (M06b2a): every projection site
  // inserts this same recipe value, and dynamic children content refreshes
  // through the recipe body's own subscriptions (never a props re-read here).
  // The check is the documented runtime boundary for a host-supplied root
  // instance: `props.children` may only be a real recipe built with
  // `createRecipe`; a plain value fails coded instead of rendering nothing.
  if (state.childrenRecipeVar !== null) {
    push(state, `const ${state.childrenRecipeVar} = ${MOUNT_PROPS}.children;`);
    push(
      state,
      `if (${state.childrenRecipeVar} == null || typeof ${state.childrenRecipeVar} !== "object" || typeof ${state.childrenRecipeVar}.mount !== "function" || ${state.childrenRecipeVar}.definitionOwner == null) throw new Error("OEIR_LEAF_MISSING_CHILDREN: component '<${component.name}>' projects props.children but the mounted instance was given no children recipe");`,
    );
  }
  // Reusable JSX values (M06b1a-2): recipes are declared before the roots so
  // every insertion site — including one inside another recipe body — can
  // reference them.
  emitRecipes(state, file, records);
  if (state.diagnostics.length > 0) {
    return {
      lines: [],
      diagnostics: state.diagnostics,
      requiredBindings: [],
      requiredProps: [],
      requiresPropsChanged: false,
      segments: [],
      placements: [],
    };
  }
  const rootDirectory = state.emitDirectoryMarkers ? staticElementDirectory(component.roots) : null;
  if (rootDirectory !== null) {
    emitMountedDirectory(state, rootDirectory, records, {
      kind: 'array',
      name: `${INTERNAL_PREFIX}nodes`,
    });
  } else {
    for (const root of emissionNodes(state, component.roots)) {
      const sink: SinkEntry[] = [];
      emitNode(state, root, sink, records);
      appendSinkToArray(state, sink, `${INTERNAL_PREFIX}nodes`);
    }
  }
  push(state, `return ${INTERNAL_PREFIX}nodes;`);

  // The component body lives in one module-level mount so a component reference
  // and the exported root factory share exactly one emitted body per module.
  const mountPrologue: string[] = [
    `function ${component.name}${MOUNT_SUFFIX}(${MOUNT_SCOPE}, ${MOUNT_PROPS}, ${MOUNT_HOST}) {`,
  ];
  if (propsName !== null) {
    mountPrologue.push(`  const ${propsName} = ${MOUNT_PROPS};`);
    state.requiredProps.add(propsName);
  }
  if (state.requiredBindings.size > 0) {
    mountPrologue.push(
      `  const ${INTERNAL_PREFIX}requireBinding = (name) => { const value = ${MOUNT_HOST}.bindings[name]; if (value === undefined) throw new Error("OEIR_LEAF_MISSING_VALUE: " + name); return value; };`,
    );
    for (const binding of [...state.requiredBindings].sort()) {
      mountPrologue.push(
        `  const ${binding} = ${INTERNAL_PREFIX}requireBinding(${JSON.stringify(binding)});`,
      );
    }
  }
  const mountHostVar = `${INTERNAL_PREFIX}mountHost`;
  const factoryLines: string[] = [
    `export function create${component.name}Recipe(${INTERNAL_PREFIX}owner, ${INTERNAL_PREFIX}host) {`,
  ];
  if (state.requiresPropsChanged) {
    // The root instance's defining scope is the host props channel: the
    // original OEIR_LEAF_MISSING_VALUE contract stays at factory creation.
    factoryLines.push(
      `  const ${INTERNAL_PREFIX}propsChanged = ${INTERNAL_PREFIX}host.propsChanged; if (${INTERNAL_PREFIX}propsChanged === undefined) throw new Error("OEIR_LEAF_MISSING_VALUE: propsChanged");`,
    );
    factoryLines.push(
      `  const ${mountHostVar} = { bindings: ${INTERNAL_PREFIX}host.bindings, propDeps: [${INTERNAL_PREFIX}propsChanged] };`,
    );
  } else {
    factoryLines.push(
      `  const ${mountHostVar} = { bindings: ${INTERNAL_PREFIX}host.bindings, propDeps: [] };`,
    );
  }
  const claim =
    state.diagnostics.length === 0
      ? emitClaimFunction(file, component, records, componentByName, sharedClaimCursor)
      : null;
  if (claim !== null && claim.diagnostics.length > 0) {
    return {
      lines: [],
      diagnostics: [...state.diagnostics, ...claim.diagnostics],
      requiredBindings: [...state.requiredBindings].sort(),
      requiredProps: [...state.requiredProps].sort(),
      requiresPropsChanged: state.requiresPropsChanged,
      segments: [],
      placements: [],
    };
  }
  const recipeFields = [
    '  return createRecipe({',
    `    definitionOwner: ${INTERNAL_PREFIX}owner,`,
    `    source: ${JSON.stringify(`${file}#${component.name}`)},`,
    '    mount(__oe_scope) {',
    `      return ${component.name}${MOUNT_SUFFIX}(${MOUNT_SCOPE}, ${INTERNAL_PREFIX}host.props, ${mountHostVar});`,
    '    },',
  ];
  if (claim !== null) {
    recipeFields.push(
      '    claim(__oe_scope, __oe_props, __oe_parent) {',
      `      return ${component.name}${CLAIM_SUFFIX}(${MOUNT_SCOPE}, ${INTERNAL_PREFIX}host.props, ${mountHostVar}, __oe_parent);`,
      '    },',
    );
  }
  recipeFields.push('  });', '}', '');
  factoryLines.push(...recipeFields);
  const mountLines = [...mountPrologue, ...state.lines, '}', ''];
  const claimLines = claim?.lines ?? [];
  // M08-1a/M08-1b: a component that can claim existing DOM also emits the HTML
  // it would have produced, so the same proof surface exists on both sides. It
  // is appended after the claim chunk, which keeps every already-recorded
  // segment/placement line offset untouched.
  const ssr =
    claim === null
      ? null
      : emitSsrFunction(file, component, rootDirectory, records, componentByName);
  if (ssr !== null && ssr.diagnostics.length > 0) {
    return {
      lines: [],
      diagnostics: [...state.diagnostics, ...ssr.diagnostics],
      requiredBindings: [...state.requiredBindings].sort(),
      requiredProps: [...state.requiredProps].sort(),
      requiresPropsChanged: state.requiresPropsChanged,
      segments: [],
      placements: [],
    };
  }
  const ssrLines = ssr?.lines ?? [];
  // Chunk offsets are physical lines: a multi-line lowered expression inside an
  // earlier chunk occupies more generated lines than one array element.
  const claimShift = fragmentLineCount(mountLines) + fragmentLineCount(factoryLines);
  const ssrShift = claimShift + fragmentLineCount(claimLines);
  const shift = fragmentLineCount(mountPrologue);
  return {
    lines: [...mountLines, ...factoryLines, ...claimLines, ...ssrLines],
    diagnostics: state.diagnostics,
    requiredBindings: [...state.requiredBindings].sort(),
    requiredProps: [...state.requiredProps].sort(),
    requiresPropsChanged: state.requiresPropsChanged,
    usesStaticSiblingDirectoryConsumer: claim?.usesStaticSiblingDirectoryConsumer === true,
    usesClaimRecipe: claim?.usesClaimRecipe === true,
    usesLeafClaimMismatch: claim?.usesLeafClaimMismatch === true,
    segments: [
      ...state.segments.map((segment) => ({
        ...segment,
        generatedLine: segment.generatedLine + shift,
      })),
      ...(claim?.segments ?? []).map((segment) => ({
        ...segment,
        generatedLine: segment.generatedLine + claimShift,
      })),
      ...(ssr?.segments ?? []).map((segment) => ({
        ...segment,
        generatedLine: segment.generatedLine + ssrShift,
      })),
    ],
    placements: [
      ...state.placements.map((placement) => ({
        ...placement,
        generatedLine: placement.generatedLine + shift,
      })),
      ...(claim?.placements ?? []).map((placement) => ({
        ...placement,
        generatedLine: placement.generatedLine + claimShift,
      })),
      ...(ssr?.placements ?? []).map((placement) => ({
        ...placement,
        generatedLine: placement.generatedLine + ssrShift,
      })),
    ],
  };
}

/**
 * One directed mount edge in the module's mount graph: a component instance or
 * a reusable-JSX recipe instance can call another mount at instance time. Nodes
 * are addressed by keys: `c:<Component>` for a component chunk and
 * `r:<Component>:<recipeId>` for a recipe of that component.
 */
interface MountEdge {
  readonly to: string;
  readonly span: IrSpan;
}

/** Collect every mount edge under one node tree, in authored order. */
function collectMountEdges(
  component: FunctionModelComponent,
  nodes: readonly FunctionModelNode[],
  edges: MountEdge[],
): void {
  for (const node of nodes) {
    switch (node.kind) {
      case 'component-ref':
        edges.push({ to: `c:${node.name}`, span: node.span });
        break;
      case 'insertion-site':
        edges.push({ to: `r:${component.name}:${node.recipeId}`, span: node.span });
        break;
      case 'element':
      case 'fragment':
        collectMountEdges(component, node.children, edges);
        break;
      case 'condition':
        collectMountEdges(component, node.consequent, edges);
        if (node.alternate !== null) collectMountEdges(component, node.alternate, edges);
        break;
      case 'list':
        collectMountEdges(component, node.template, edges);
        break;
      default:
        // text / dynamic-text carry no mount edges. A children projection is
        // also not an edge here: the child mount does not know statically which
        // reference site supplied its recipe, so `findMountCycle` adds that
        // (conservative) projection edge separately (M06b2a).
        break;
    }
  }
}

/**
 * Fail closed on mount cycles (M06b1a-2 extends the M06b1a-1 component-cycle
 * DFS): a component reference and a reusable-JSX recipe both mount another
 * mount at instance time, so a cycle would emit self-recursive mounts (unbounded
 * recursion). Recipe targets are walked because a recipe can mount a component,
 * and recipe bodies can insert another recipe. Children recipes (M06b2a) are
 * component recipes too, so their target edges are already in the graph; the
 * projection edge from the child component to the recipe is added conservatively
 * (see the children-projection pass below) because only the runtime instance
 * knows which reference site supplied its `props.children`. The first cycle in
 * authored order is reported with its path and the closing edge's span; a cycle
 * that passes through a recipe node gets `OEIR_LEAF_RECIPE_CYCLE`, a pure
 * component-reference cycle keeps `OEIR_LEAF_COMPONENT_CYCLE`.
 */
function findMountCycle(module: FunctionModelModule): IrDiagnostic | null {
  const edges = new Map<string, MountEdge[]>();
  const labels = new Map<string, string>();
  const addNode = (key: string, label: string, collected: MountEdge[]): void => {
    labels.set(key, label);
    edges.set(key, collected);
  };
  for (const component of module.components) {
    const componentEdges: MountEdge[] = [];
    collectMountEdges(component, component.roots, componentEdges);
    addNode(`c:${component.name}`, component.name, componentEdges);
    for (const recipe of component.recipes) {
      const recipeEdges: MountEdge[] = [];
      collectMountEdges(component, [recipe.target], recipeEdges);
      addNode(`r:${component.name}:${recipe.id}`, `${component.name}${recipe.id}`, recipeEdges);
    }
  }
  // Children-projection edges (M06b2a): a component that projects
  // `props.children` mounts the recipe supplied by whichever reference site
  // created its instance; the instance cannot know that statically, so every
  // `<Child>…</Child>` site whose `<Child>` projects children contributes the
  // conservative edge `c:<Child> -> r:<Definer>:<childrenRecipeId>`. This is what
  // refuses a component that projects the children of a reference back into
  // itself (an unbounded mount, not just a static recursion).
  const projectsChildrenByName = new Map(
    module.components.map(
      (component) => [component.name, componentProjectsChildren(component)] as const,
    ),
  );
  for (const component of module.components) {
    const projectionEdges: ChildrenProjectionEdge[] = [];
    collectChildrenProjectionEdges(component, projectionEdges);
    for (const edge of projectionEdges) {
      if (projectsChildrenByName.get(edge.projectingComponent) !== true) continue;
      const fromEdges = edges.get(`c:${edge.projectingComponent}`);
      const toKey = `r:${edge.definingComponent}:${edge.recipeId}`;
      if (fromEdges === undefined || !edges.has(toKey)) continue;
      fromEdges.push({ to: toKey, span: edge.span });
    }
  }
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const path: string[] = [];
  const visit = (key: string): IrDiagnostic | null => {
    color.set(key, GRAY);
    path.push(key);
    for (const edge of edges.get(key) ?? []) {
      // Unknown/external component targets have no node here and fail closed on
      // their own during emission.
      if (!edges.has(edge.to)) continue;
      const targetColor = color.get(edge.to) ?? WHITE;
      if (targetColor === GRAY) {
        const cycleKeys = path.slice(path.indexOf(edge.to));
        const recipeCycle =
          cycleKeys.some((entry) => entry.startsWith('r:')) || edge.to.startsWith('r:');
        const cycle = [...cycleKeys, edge.to]
          .map((entry) => labels.get(entry) ?? entry)
          .join(' -> ');
        return {
          severity: 'error',
          code: recipeCycle ? 'OEIR_LEAF_RECIPE_CYCLE' : 'OEIR_LEAF_COMPONENT_CYCLE',
          message: recipeCycle
            ? `recipe insertion cycle: ${cycle}`
            : `component reference cycle: ${cycle}`,
          span: edge.span,
          origin: 'ir-object',
        };
      }
      if (targetColor === WHITE) {
        const found = visit(edge.to);
        if (found !== null) return found;
      }
    }
    path.pop();
    color.set(key, BLACK);
    return null;
  };
  for (const component of module.components) {
    const key = `c:${component.name}`;
    if ((color.get(key) ?? WHITE) !== WHITE) continue;
    const found = visit(key);
    if (found !== null) return found;
  }
  return null;
}

/** Fail-closed parse check of the emitted module text (no execution). */
function parsesAsModule(text: string): boolean {
  const source = ts.createSourceFile(
    'generated-leaf.js',
    text,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.JS,
  );
  const parseDiagnostics = (source as unknown as { parseDiagnostics?: readonly unknown[] })
    .parseDiagnostics;
  return (parseDiagnostics ?? []).length === 0;
}

/**
 * Emit the generated leaf module for one M03 `FunctionModelModule`.
 * Deterministic for the same model/registry; unsupported shapes fail closed.
 */
export function generateLeafModule(
  module: FunctionModelModule,
  options: { readonly authoredSource?: string } = {},
): GeneratedLeafModule {
  const records = new Map(module.expressions.expressions.map((record) => [record.id, record]));
  if (module.components.length === 0) {
    return {
      module: null,
      sourceMap: null,
      placements: [],
      requiredBindings: [],
      requiredProps: [],
      requiresPropsChanged: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'OEIR_LEAF_MISSING_COMPONENT',
          message: 'the module has no function component to generate',
          span: { file: module.file, start: 0, end: 0, line: 1, column: 1 },
          origin: 'module',
        },
      ],
    };
  }
  const componentByName = new Map(
    module.components.map((component) => [component.name, component] as const),
  );
  const cycle = findMountCycle(module);
  if (cycle !== null) {
    return {
      module: null,
      sourceMap: null,
      placements: [],
      requiredBindings: [],
      requiredProps: [],
      requiresPropsChanged: false,
      diagnostics: [cycle],
    };
  }
  const chunks: string[] = [];
  const diagnostics: IrDiagnostic[] = [];
  const requiredBindings = new Set<string>();
  const requiredProps = new Set<string>();
  const segments: EmissionSegment[] = [];
  const placements: ExpressionPlacement[] = [];
  let requiresPropsChanged = false;
  let usesStaticSiblingDirectoryConsumer = false;
  let usesClaimRecipe = false;
  let usesLeafClaimMismatch = false;
  const sharedClaimCursor = moduleUsesSharedClaimCursor(module, componentByName);
  for (const component of module.components) {
    const emitted = emitComponent(
      module.file,
      component,
      records,
      componentByName,
      sharedClaimCursor,
    );
    diagnostics.push(...emitted.diagnostics);
    if (emitted.diagnostics.length > 0) continue;
    for (const name of emitted.requiredBindings) requiredBindings.add(name);
    for (const name of emitted.requiredProps) requiredProps.add(name);
    requiresPropsChanged ||= emitted.requiresPropsChanged;
    usesStaticSiblingDirectoryConsumer ||= emitted.usesStaticSiblingDirectoryConsumer === true;
    usesClaimRecipe ||= emitted.usesClaimRecipe === true;
    usesLeafClaimMismatch ||= emitted.usesLeafClaimMismatch === true;
    // Component chunks are concatenated in module order: rebase this component's
    // segment/placement lines onto the lines already emitted before it.
    const lineOffset = fragmentLineCount(chunks);
    segments.push(
      ...emitted.segments.map((segment) => ({
        ...segment,
        generatedLine: segment.generatedLine + lineOffset,
      })),
    );
    placements.push(
      ...emitted.placements.map((placement) => ({
        ...placement,
        generatedLine: placement.generatedLine + lineOffset,
      })),
    );
    chunks.push(...emitted.lines);
  }
  if (diagnostics.length > 0) {
    return {
      module: null,
      sourceMap: null,
      placements: [...placements],
      requiredBindings: [...requiredBindings].sort(),
      requiredProps: [...requiredProps].sort(),
      requiresPropsChanged,
      diagnostics,
    };
  }
  const body = chunks.join('\n');
  const runtimeImports: string[] = [...RUNTIME_IMPORTS];
  for (const optional of OPTIONAL_RUNTIME_IMPORTS) {
    if (optional.predicate(body, usesClaimRecipe, usesStaticSiblingDirectoryConsumer)) {
      runtimeImports.push(optional.symbol);
    }
  }
  if (runtimeImports.length !== RUNTIME_IMPORTS.length) runtimeImports.sort();
  const headerLines = [
    '// <generated by openelement M07a leaf-claim (mount M06b2a); do not edit>',
    `import { ${runtimeImports.join(', ')} } from ${JSON.stringify(GENERATED_LEAF_RUNTIME_SPECIFIER)};`,
    '',
  ];
  if (sharedClaimCursor) {
    headerLines.push('let __oe_claimCursor = null;', `let ${CLAIM_ACTIVATION} = null;`, '');
  }
  const text = [...headerLines, ...chunks].join('\n');
  if (!parsesAsModule(text)) {
    return {
      module: null,
      sourceMap: null,
      placements: [...placements],
      requiredBindings: [...requiredBindings].sort(),
      requiredProps: [...requiredProps].sort(),
      requiresPropsChanged,
      diagnostics: [
        {
          severity: 'error',
          code: 'OEIR_LEAF_INVALID_ARTIFACT',
          message: 'the emitted module does not parse as JavaScript',
          span: { file: module.file, start: 0, end: 0, line: 1, column: 1 },
          origin: 'module',
        },
      ],
    };
  }
  const headerShift = headerLines.length;
  const moduleSegments = segments.map((segment) => ({
    ...segment,
    generatedLine: segment.generatedLine + headerShift,
  }));
  const modulePlacements = placements.map((placement) => ({
    ...placement,
    generatedLine: placement.generatedLine + headerShift,
  }));
  let sourceMap: CompiledElementSourceMap | null = null;
  if (options.authoredSource !== undefined) {
    const builder = new SourceMapSegmentBuilder();
    for (const segment of moduleSegments) builder.add(segment);
    sourceMap = builder.build(module.file, options.authoredSource);
  }
  return {
    module: text,
    sourceMap,
    placements: modulePlacements,
    requiredBindings: [...requiredBindings].sort(),
    requiredProps: [...requiredProps].sort(),
    requiresPropsChanged,
    diagnostics: [],
  };
}
