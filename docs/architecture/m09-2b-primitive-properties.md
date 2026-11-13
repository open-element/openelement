---
status: active
topic: M09-2b generated-element primitive properties
summary: The island sidecar's `properties` table plus the root component's typed props parameter are cross-checked by the compiler lane and emitted as the shell's landed `GeneratedElementProperty` rows; a bounded slice record, not the M09 exit.
---

# M09-2b: primitive property metadata on a generated element

Date: 2026-11-14. Status: **bounded implemented — not the M09 exit.**
Baseline: canonical `main@7632ab36c` (worktree
`.artifacts/canonical-20261113/worktree`).

This slice closes `D-props` for the generated native element lane. Before it,
the lane always emitted `properties: []` and refused any props parameter
(`OEIR_GENERATED_ELEMENT_UNDECLARED_PROPS`): the runtime shell had the whole
attribute channel — observed attributes, string/number/boolean conversion,
reflection, defaults, pre-upgrade reconciliation — but an island author had no
declaration path to it. The class lane had `@property(...)`; the function
island had nothing.

## The decision

**Names and types come from the root component's typed props parameter; the
sidecar `properties` table carries only the platform facts a TS type cannot
express.** Both are in the same authored module, so the compiler lane
cross-checks them and fails closed; neither side is inferred silently from the
other. The emitted rows are exactly the shell's landed
`GeneratedElementProperty`, so the conversion/reflection/default mechanism is
reused, not re-derived.

```tsx
// app/islands/counter-card.tsx
export const openElement = defineIslandConfig({
  root: 'shadow',
  properties: {
    count: { reflect: true, default: 0 },
    label: { default: 'untitled' },
    padding: { attribute: false },
  },
});

function CounterCard(props: { count: number; label: string; padding: number }) {
  return <section><p>{props.count}</p><p>{props.label}</p></section>;
}
export default CounterCard;
```

### Why this table spelling (the exact rationale)

The instruction was to inspect the existing authoring/property declarations
and choose the smallest compatible representation. The existing declarations
are:

- the class lane's `@property({ reflect, attribute, type, converter })`
  decorator options (compile-time erased, default from the field initializer);
- the runtime shell's `GeneratedElementProperty`:
  `{ name, attribute?, type, reflect?, default? }`;
- the compiler's `CompiledPropertyMetadata`/`PropertyValueTypeName` shape the
  conversion leaf reads.

A typed props member already supplies **name** and **type** authoritatively.
The only facts it cannot express are `reflect`, the attribute channel and a
declared initial value. So the chosen entry is:

```ts
{ reflect?: boolean; attribute?: string | false; default?: string | number | boolean }
```

keyed by the typed member name, with these deliberate omissions:

- **no `name` key** — the object key is the name. Adding one would repeat the
  typed member name a third time and make a rename a three-place edit.
- **no `type` key** — the typed member's `string`/`number`/`boolean` keyword is
  the type; a duplicated field could only ever restate it or contradict it,
  and `@property`'s type constructor (`String`/`Number`/`Boolean`) has no
  meaning beside a TS type. The cross-check therefore keys on the member set
  and on the default's literal type, not on a second type spelling.
- **no `converter`** — custom converters are not expressible on this lane
  (array/object/`trustedHtml` conversion is a recorded Alpha17 exception), so a
  converter field would be an unreachable option.
- **`attribute: false` rather than `attribute: null | undefined`** — it is the
  class lane's existing spelling for "property-only" and it keeps the table
  JSON-ish for sidecar scanning.

This is the smallest table that keeps `@property` parity for the three facts a
type cannot carry while leaving the shell's descriptor shape untouched.

## Rules the lane enforces

1. **The member set and the table keys must be equal in both directions.** A
   typed primitive member with no entry refuses (`PROPERTY_MISMATCH`): the
   shell's props record would otherwise silently read `undefined` for it. An
   entry with no typed member refuses too: a stale or typo'd attribute row
   cannot silently produce an attribute nobody reads.
2. **The typed props source must be provable from this module**: an inline
   object type literal, or a same-module non-generic `type`/`interface` alias
   of one. Imported, generic, union, intersection or otherwise computed types
   refuse (`PROPS_TYPE_UNSUPPORTED`). The parameter must be a named identifier
   — the generated record is read as `props.member` — and its annotation must
   not be optional (the runtime record always supplies a declared value, so an
   optional member would understate the contract).
3. **Only `string`, `number` and `boolean` members are admitted.** A
   non-primitive member (`string[]`, `Date`, a function) refuses; the shell's
   `PROPERTY_TYPES` is the final authority for the same set.
4. **Attribute channel**: omitted ⇒ `camelToKebab(name)`; `false` ⇒ no
   attribute; a string is lowercased and screened by the canonical
   `isSafeAttributeName` predicate. Duplicate attribute names (case-insensitive
   after lowercasing) refuse.
5. **`reflect: true` requires an attribute channel** (the class lane and the
   shell apply the same rule).
6. **`default` must be a `string`/`number`/`boolean` literal matching the typed
   member**, else the zero value (`''`/`0`/`false`) is used. A literal of the
   wrong type refuses rather than being coerced.
7. **Reserved lifecycle names** (`constructor`, the four callbacks,
   `observedAttributes`, `dispose`) refuse at the lane so the author gets a
   source-located build error. The shell owns that list and is the runtime
   authority; the compiler keeps a fast-fail subset and a consumer-form test
   asserts every name it refuses is refused by the shell too (an over-refusal
   is the drift that matters; a shell-only addition still fails closed at
   class creation).
8. **No declaration keeps M09-1a behavior**: a props parameter without a table
   still refuses `UNDECLARED_PROPS`, and the emitted descriptor still says
   `properties: []` byte-for-byte. An empty declaration `properties: {}` with a
   matching empty `props: {}` type admits and emits `[]`.

## Emitted descriptor (the landed mechanism, not a copy)

```js
const __oeCounterCardElementDescriptor = {
  tag: 'counter-card',
  root: 'shadow-open',
  properties: [
    { name: 'count', attribute: 'count', type: 'number', reflect: true, default: 0 },
    { name: 'label', attribute: 'label', type: 'string', reflect: false, default: 'untitled' },
    { name: 'padding', attribute: null, type: 'number', reflect: false, default: 0 },
  ],
  createRecipe: createCounterCardRecipe,
};
```

No shell change. The shell builds `observedAttributes` from the non-null
attribute rows (frozen on the constructor), converts attribute → property
(boolean presence, `Number` with `NaN`→`0`, string identity), coerces JS writes,
reflects only for `reflect: true` (boolean `true` → `''`, `false` → removed),
restores the declared default on attribute removal in both channels, reconciles
pre-upgrade own data properties before the first render, and bumps its own
`propsChanged` signal for the generated refresh channel. All of that is
[`shell.ts`](../../packages/element/src/internal/compiled/generated-element/shell.ts)
over the one import-free conversion leaf
[`property-conversion.ts`](../../packages/element/src/internal/core/property-conversion.ts)
(pinned by `generated-element.shell.test.ts`); this slice only feeds it the
declaration.

## What changed

| Path | Role |
| --- | --- |
| [`authoring.ts`](../../packages/router/src/authoring.ts) | `IslandPropertyConfig`, `IslandConfig.properties`, the accepted-field set, runtime shape validation (entry/reflect/attribute/default/safety/duplicates/reflect-without-channel) and the authoring error text. |
| [`island-scanner.ts`](../../packages/router/src/vite/internal/ssg/island-scanner.ts) | Static literal-only parsing of the nested table, resolved `LocalIslandPropertyConfig` on `LocalIslandMeta`, accepted-shape text and the scanned-metadata copy. The scanner stays the build-time authority for the table's accepted shape. |
| [`contract.ts`](../../packages/compiler/src/internal/compiler/semantic-ir/generated-element/contract.ts) | `GeneratedElementPlatformProperty` (the compiler-side mirror of the shell's descriptor row) and the internal `PROPS_TYPE_UNSUPPORTED` / `PROPERTY_MISMATCH` / `PROPERTY_INVALID` codes. None enters the public `RuntimeErrorCode` catalogue or the interface snapshot. |
| [`site.ts`](../../packages/compiler/src/internal/compiler/semantic-ir/generated-element/site.ts) | The sidecar table reader (same one walk as root/delegatesFocus), typed props extraction (`readTypedProps`), the both-direction cross-check and row resolution (`admitGeneratedElementProperties`), the reserved-name fast-fail list, and the admission carrying `properties`/`propertiesDeclared`. The M09-1a props gate yields to a declared table. |
| [`emit.ts`](../../packages/compiler/src/internal/compiler/semantic-ir/generated-element/emit.ts) | `properties` rows in the descriptor tail, every fact explicit (including `attribute: null` / `reflect: false`); `properties: []` bytes unchanged when no table is declared. |
| [`compile.ts`](../../packages/compiler/src/internal/compiler/semantic-ir/generated-element/compile.ts) | Passes the resolved rows to the emitter. |
| [`generated-element.properties.test.ts`](../../packages/compiler/__tests__/semantic-ir/generated-element.properties.test.ts) | The Node contract: spelling, cross-check, refusals, emitted rows, reserved-name subset guard. |
| [`generated-element.properties.browser.test.ts`](../../packages/compiler/__tests__/semantic-ir/generated-element.properties.browser.test.ts) | The Chromium vertical (below). |
| [`island-metadata-drift-guard.test.ts`](../../packages/router/__tests__/island-metadata-drift-guard.test.ts) / [`island-scanner.test.ts`](../../packages/router/__tests__/island-scanner.test.ts) / [`authoring.test.ts`](../../packages/router/__tests__/authoring.test.ts) | The shared drift guard extended to the table, plus the scanner/runtime acceptance and refusal expectations. |

## Public surface (regenerated, never hand-edited)

`IslandConfig` is published on the router root, so this slice's declaration
field is a public API change:

- `IslandConfig` gains `properties?: Readonly<Record<string, IslandPropertyConfig>>`
  (commit 1 added `delegatesFocus?: boolean` to the same type);
- `IslandPropertyConfig` is a new named export from `@openelement/router`
  (`export type { IslandPropertyConfig }`), the table-entry type;
- `defineIslandConfig`'s published signature moves with both fields.

`docs/release/public-interface-snapshot.json` was regenerated by
`interface:snapshot:write`; the delta is exactly those three router `"."`
symbols plus that subpath's `publicShapeSha256`. No other package or subpath
moves, no symbol is removed or renamed, and the emitted API reference
(`www/app/data/_generated-api-reference.ts`, Git-ignored) is regenerated by
`generate:all` — the export count stays 1147 documented exports across the six
packages because these are members of existing exports plus one new named
type. `docs/architecture/README.md` is regenerated by `docs-index:write`.

## Evidence (LOCAL)

Focused (all green):

- `vitest run --project compiler .../generated-element.properties.test.ts` —
  1 file, 14 tests (Node contract + reserved-name subset guard).
- `vitest run --project compiler .../generated-element.properties.browser.test.ts`
  — 1 file, 4 tests, real Chromium (the authored vertical + pre-upgrade +
  CSR mount).
- `vitest run --project router` on the scanner, metadata drift guard and
  authoring suites — 3 files, 51 tests.

Red→green: with the new tests present and only the implementation files
reverted byte-for-byte to the previous commit in the same worktree, the
focused Node/browser suites fail (12 compiler cases incl. the browser suite's
missing admission, 9 router cases across scanner/drift/authoring); with the
implementation restored they are green. The exact commands and failure
summaries are in the slice report.

Full projects (all green): compiler 71 files / 1072 tests; router 146 files /
1661 tests; element 120 files / 899 tests. Static gates (`tsc` compiler +
router, `vp run check`, `interface:snapshot`, `seams:check`,
`docs-index:check`, and the pack/packed-consumer checks if the packaging graph
is touched) are recorded in the slice report.

## Chromium vertical (one engine, LOCAL)

`generated-element.properties.browser.test.ts` compiles the authored island
through the real lane, bundles the emitted module with the real shell, and
proves, on a parser-created DSD host:

- host attributes `count="3" label="hi"` are converted **before** the first
  render (the recipe reads `3` / `'hi'`), and the claim is mutation-free;
- `observedAttributes` is exactly `['count', 'label']` — the
  `attribute: false` property is absent and its attribute is ignored;
- `setAttribute('count','7')` converts and refreshes the claimed text in place;
- `el.count = 9` reflects `count="9"`; `el.label = 'hello'` does not reflect;
- `removeAttribute('count')` restores `0` in both the property and the
  reflected attribute;
- disconnect → reconnect claims the retained root again with the retained
  values and no second `attachShadow`; `dispose(false)` keeps the tree and
  `dispose(true)` removes exactly the owned region;
- the classic pre-upgrade sequence (`el.count = 2` before
  `customElements.define`) wins over the replayed attribute and is reflected;
- CSR mount converts attributes set before connect.

**Stated limitation.** The SSR host tag's attribute population is the M11
host-attribute serializer's job (design §7.5); the generated `<Name>__ssrHost`
still passes no attributes. The vertical therefore builds the host markup with
the canonical `serializeGeneratedElementHtml` producer directly (attributes +
the generated `<Name>__ssr` content) rather than fabricating a string. The
claim/refresh/reflect chain it exercises is the real generated class over the
real shell.

## What this slice does NOT do

- **No array/object/`trustedHtml` conversion and no custom converters.** The
  recorded Alpha17 exception stands; the shell's primitive set is unchanged.
- **No CEM output** for generated elements (recorded exception, Alpha17).
- **No forms, events, styles.** Unchanged by this slice.
- **No class-lane change.** `@property`/`@element` keep their existing path.
- **No production wiring / SSR host attributes.** M11 owns request-time
  DSD/SSR and the host-attribute serializer.
- **No public runtime error code.** The new codes are internal
  `OEIR_GENERATED_ELEMENT_*` values.
- **One Chromium engine, LOCAL.** Not M09 exit, not the M13 matrix.
