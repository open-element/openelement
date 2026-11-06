# M01 consumer migration matrix

Date: 2026-11-03. Companion to
[the IR and ABI boundary](./compiler-ir-and-abi-boundary.md). Base
`11b58f13e73bc7ae539e5de554646b0fc1e4a0a4`.

Revision 2026-11-05: the C04, C06 and C07 layer claims contradicted §5.1 and §7 of
the boundary document. They are corrected in the table and the old wordings are
kept, labelled, in [Layer corrections](#layer-corrections-c04-c06-c07). In
particular, no request-time consumer — C04 or C06 — consumes the Semantic IR.

Re-verified 2026-11-05 against the actual checkout SHA
`463e6cb07319a3ba131ed1c63c835e58705a6231`: every source file cited by the rows
is unchanged since the design base (zero diff for the row files), so the anchors
and CURRENT FACT readings below still hold. The counts are re-checked **row**
counts, not a new source scan; no implementation was changed in this pass.

Method: repository-wide search for `__partProgram`, `PartProgramV2`,
`PartProgram`, `PART_PROGRAM_VERSION`, `COMPILED_MODULE_ABI_VERSION`,
`validatePartProgram`, `normalizePartProgram`, `createFreshDom`,
`hydrateExistingDom`, `addRangeCleanup`, `dispose(true)`, then each hit was read at
the call site. Search hits are **not** treated as call paths: a hit becomes a row
only when the file/function that uses it was opened.

Access types: **R** runtime property, **S** static/type-level, **L** lexical
(source-text), **T** type-only, **P** public API.

Status labels used below: **CURRENT FACT** — read at the named site in the base
commit; **APPROVED TARGET** — owner-approved direction (2026-11-03) recorded in
[the IR and ABI boundary](./compiler-ir-and-abi-boundary.md), with the target
field structure explicitly *not* frozen there; **PROPOSED** — this document's
suggestion, not decided; **SUPERSEDED HISTORY** — replaced wording, kept only so
the old reading is not mistaken for current guidance.

| ID | File | Function / symbol | Old field / type | Access | Current purpose | Target layer | Replacement | Milestone | Test evidence | Retirement condition |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C01 | `packages/element/src/open-element-implementation.ts:72-79,327-361` | `failMissingProgram`, `connectedCallback` | `__partProgram` | R | fails closed when the compiled program is missing; drives `kernel.connect()` | ABI | generated entrypoints + `componentMeta` | 16b | compiled facade tests | generated module provides mount/claim without a program |
| C02 | `packages/element/src/internal/compiled/facade-host.ts:6,28` | compiled statics types, handler binding | `__partProgram`, `__compiledProperties` | R+S | binds properties/attributes to signals; handler table | ABI | property metadata + emitted handlers | 16b | facade tests | metadata covers every facade read |
| C03 | `packages/element/src/internal/compiled/runtime-program.ts` | `normalizePartProgram` | `PartProgramV2` | R | validates/normalizes once per connect for the walker | retire | none (walker retires) | 16b | normalization tests | no production caller remains |
| C04 | `packages/element/src/public-runtime.ts:222,378,419,520-540,725-790` | `renderToStringAtDepth`, `createStreamShellExecutor` | tag, `metadata.properties`, program digest | R | tag lookup, registration, SSR serialization, stream shell | Server + ABI | request-time generated server structure (server-private) + tag/property metadata | 16b | SSR/stream tests | the request-time path runs the generated server entrypoint and reads no Semantic IR; the server-private structure is neither the IR nor a serialized copy of it |
| C05 | `packages/element/src/server.ts:108-197` | server rendering helpers | compiled property metadata, root kind | R | HTML composition, root mode | Server | server-private structure | 16b | server HTML tests | server backend owns its structure |
| C06 | `packages/element/src/internal/compiled/server/index.ts:674-681` | serializer entry | `PartProgramV2` | R | serialization entry point | Server | request-time generated server entrypoint over a server-private structure — not the Semantic IR, and not a serialized copy of it | 16b | compiled-server tests | serializer consumes the generated server render structure (a server-private artifact); the Semantic IR never crosses a process boundary |
| C07 | `packages/router/src/authoring.ts:441-445` | `isElementPageClass` | `component.__partProgram !== undefined` | R | distinguishes element page class from function page (**property check, not lexical**) | Build metadata (build-time classification) | Router-plugin page-classification fact derived at build time — **not an ABI field, and not C08's component identity metadata** | 16b | router authoring tests | page classification is derived at build time, not by reading a runtime property on the module |
| C08 | `packages/router/src/vite/internal/server-runtime/renderer-runtime.ts:167-175` | tag resolution | `__partProgram.tag` | R | resolves the compiled page tag | ABI | component identity metadata | 16b | renderer tests | tag comes from metadata |
| C09 | `packages/router/src/vite/internal/server-runtime/route-dispatch.ts:47-83` | `readPartProgram` | `{version, tag}` | R | stream route validation against manifest | ABI + wire | ABI version + component identity | 16b | stream route tests | mismatch checks read new fields |
| C10 | `packages/router/src/vite/internal/server-runtime/stream-runtime.ts:516-525` | identity guard | tag + version | R | rejects build skew on streamed hosts | ABI + wire | ABI version + build identity | 16b | stream identity tests | skew rejection preserved |
| C11 | `packages/router/src/vite/internal/server-runtime/types.ts:46` | `PageRouteModule` | `__partProgram?: {version,tag}` | T | generated module shape typing | ABI | ABI module type | 16b | typecheck | types follow the new ABI |
| C12 | `packages/router/src/vite/internal/ssg/island-blocks-scan.ts:117-120` | `compiledArtifactMightUseBlocks` | `source.includes('__partProgram')` + `"blocks":[` shape | **L** | detects compiled packages whose blocks cannot be re-derived from source | Build metadata | emitted feature flag | 16b | SSG blocks tests | flag replaces the text scan |
| C13 | `packages/compiler/src/internal/compiler/compiled-artifact-style-requests.ts:42,122-196` | `COMPILED_ARTIFACT_MARKER`, `PART_PROGRAM_BINDING` | `__partProgram` literal parse | **L** | recovers style requests and scope facts from an emitted module | Build metadata | emitted style/scope facts | 16b | CSS recovery tests | facts emitted, not re-parsed |
| C14 | `packages/element/src/internal/compiled/runtime/program-kernel.ts:13,38,44` | kernel part types | `PartProgramV2['parts'][n]` | T | types for part/branch handling | retire | client-generated types | 16b | kernel tests | kernel types gone with walker |
| C15 | `packages/element/src/internal/compiled/runtime/hydrate-seam.ts:22,35` | seam signature | `PartProgramV2` | T | installs the claim executor | retire→ABI | generated claim entry | 16b | claim tests | claim is generated |
| C16 | `packages/element/src/internal/compiled/runtime/revive.ts:254,284` | range cleanups | `addRangeCleanup` | R | reconnect/revive path keeps DOM | Runtime (supporting evidence) | retained owner/range helpers | 16b | revive tests | KEEP — depends on non-detach semantics |
| C17 | `packages/protocol/src/ssg.ts:10,24-25` | source record projection | `PartProgramV2['sourceMap']['records']` | T | type-only projection for SSG | Build metadata | IR source spans → build records | 16b | typecheck | build records typed independently |
| C18 | `packages/element/src/public-runtime.ts` compiled-constructor types | serializer entry types | program shape | T | typing only | ABI | ABI module type | 16b | typecheck | types follow new ABI |
| C19 | `packages/protocol/src/part-program.ts:22-47` | schema, `validatePartProgram`, versions | whole schema | P | validator + version constants | retire | new ABI has its own version | 16b | protocol tests | no production consumer validates the old schema |
| C20 | `packages/protocol/src/part-program.ts` via `protocol/src/index.ts:13`, `protocol/package.json:29` | public subpath `./part-program` | public export | P | published surface | retire (policy) | new ABI subpath (Alpha17) | 16b/17 | packed consumer | deprecation decision + release note |
| C21 | `packages/element/__wtr__/generated/*.ts` | generated fixtures | `__partProgram` literals | test | browser-mode fixtures | test | regenerate from new backend | 16b | browser gate | fixtures generated by the compiler |
| C22 | `tools/release/*` packed harnesses | consumer qualification | generated artifact shape | test/build | packed consumer proofs | test | re-qualify on new ABI | 16b | packed consumer | harness updated with ABI |
| C23 | `tools/release/npm-manifest.ts:493-501` etc. | release manifest | dependency materialisation | build | ensures runtime deps ship | Release infrastructure (supporting evidence) | unchanged for IR work | — | release gates | not affected by M01 |

## What the 23 rows actually are

The table is an **audit ledger**, not a list of 23 direct Part Program consumers.
It contains three kinds of entry, and reading them as one class is what produces
false "23 consumers to migrate" statements:

| Kind | Rows | Count | Meaning |
| --- | --- | --- | --- |
| **Direct protocol/schema/export audit rows** | C01–C13, C19, C20 | **15** | read the emitted program, the schema, the validator or the public export |
| **Type-only rows** | C14, C15, C17, C18 (+ C11, already counted above) | **5** (1 overlaps the previous row) | depend on the *types*; they follow the ABI rather than migrate independently |
| **Supporting evidence** | C16, C21, C22, C23 | **4** | do **not** consume the protocol; they constrain how retirement may be done |

Arithmetic that must hold: 15 + 4 + (type-only rows not already counted: C14, C15, C17, C18 = 4) = **23**. The single type-only row that overlaps the direct group is **C11**, which appears in both lists by design.

Two rows were previously misclassified and are corrected:

- **C16 (`revive.ts`, `addRangeCleanup`) is supporting runtime-preservation
  evidence**, not a Part Program consumer. It records that the reconnect path
  depends on the non-detach disposal semantics; deleting it would break revive,
  not migration.
- **C23 (`tools/release/npm-manifest.ts`) is release-infrastructure evidence**,
  not a protocol consumer. It records how runtime dependencies are materialised
  into packed artifacts; it is untouched by the ABI change.

## Layer corrections (C04, C06, C07)

Three rows carried layer claims that contradicted
[the IR and ABI boundary](./compiler-ir-and-abi-boundary.md). They are corrected
in the table above; the earlier text is retained here only as SUPERSEDED HISTORY,
not as an alternative reading.

- **C04 — "server backend renders from IR" is SUPERSEDED HISTORY.** C04 is a
  request-time SSR/stream consumer, not the compiler-time server backend. The
  boundary gives the IR consumer explicitly (§5.1): the compiler-time server
  backend is a *code generator* that consumes the Semantic IR and emits a
  server-private structure; §5.2 runs that generated entrypoint per request.
  CURRENT FACT for this row: the request-time path reads the emitted
  `__partProgram`-shaped program today. APPROVED TARGET: it reads the generated
  server render structure plus tag/property metadata. The Semantic IR is not a
  request-time input and never crosses a process boundary.
- **C06 — "serializer consumes IR" is SUPERSEDED HISTORY.** The boundary keeps two
  server-side things apart: the compiler-time server backend is a *code
  generator* that consumes the Semantic IR and emits a server-private structure
  (§5.1), and the request-time server path runs that generated entrypoint (§5.2).
  No request-time serializer consumes the IR, and the IR does not cross a process
  boundary in any form. CURRENT FACT for this row: the serializer entry reads the
  emitted `__partProgram`-shaped program today. APPROVED TARGET: it consumes the
  generated server render structure, a server-private artifact produced by the
  compiler — not the IR serialized for the server.
- **C07 — target layer "ABI", replacement "explicit metadata flag" is SUPERSEDED
  HISTORY.** Boundary §7 separates component identity metadata (ABI, runtime
  consumer: registration, SSR seed, claim) from build-time route classification
  (derived by the Router plugin at build time) as *different facts with different
  consumers*, and states that the old C07 property check becomes a build-time
  classification fact, not an ABI field. CURRENT FACT: `isElementPageClass` reads
  a runtime property to answer a build-time question. APPROVED TARGET: a Router
  build-time page-classification fact — it is not a field on the 16b component
  metadata record and must not be conflated with C08's tag/identity metadata.

## Classification counts (row counts; re-checked 2026-11-05)

Rows **overlap** by theme — one file can be both a runtime consumer and an SSR
consumer. The counts below count *rows per theme*, so they sum past 23 by design.
They are not a fresh repository search and do not re-certify the 2026-11-03
migration estimate elsewhere: this table's 23 rows are the audit ledger.

| Theme | Rows | Overlaps with |
| --- | --- | --- |
| Runtime property access | C01, C02, C03, C04, C05, C06, C07, C08, C09, C10 | SSR (C04–C06), Router (C07–C10), stream (C09, C10) |
| Type-only | C11, C14, C15, C17, C18 | runtime (C11), protocol (C14–C15, C17–C18) |
| Lexical (source text) | **C12, C13** — exactly two, in two different packages | build only |
| Public API / protocol | C19, C20 | type-only (C14–C18 consume these) |
| Tests / fixtures / harness | C21, C22 | supporting evidence |
| Release infrastructure | C23 | supporting evidence |

Counts that are safe to quote: **2 lexical consumers**, **15 direct protocol/schema/export
audit rows**, **5 type-only rows (1 overlapping)**, **4 supporting-evidence rows**,
**23 ledger rows**, **0 unmapped production consumers**.

Scope of these counts: they classify how each row reads *today* (the theme table),
not which target layer the row migrates to. The C04/C06/C07 layer corrections
above change no number here, and there is deliberately **no "ABI consumer" tally**
to decrement:

- C04 and C06 stay in the SSR theme; only the name of what the request-time
  serialization/stream path consumes changes (server-private generated structure,
  not the IR).
- C07 is counted as a direct field-audit row because it reads the emitted field
  today, while its target channel is build-time classification. Its `R` access is a
  current fact, not a claim that 16b ships an ABI field for it.

## Blocking pairs

Any change to the emitted field shape must migrate these together, or the result is
a silent failure rather than a type error:

- **C12 + C13** — both read the emitted module as text; a rename keeps them
  "passing" while they silently stop detecting anything.
- **C07 + C11** — a blocking pair in *sequencing*, not in target channel. C11's
  `PageRouteModule` type follows the new ABI; C07's replacement is the Router
  plugin's build-time classification, **not** an ABI field (boundary §7). Removing
  `__partProgram` from the module shape while C07 still tests
  `component.__partProgram !== undefined` makes every page classify as a function
  page — silently, with no type error. So the classification fact must land in the
  same change as the field removal, even though the two rows then live in
  different layers.
- **C09 + C10** — stream validation and stream identity read the same two fields.

## What this matrix does not do

It does not authorise deletion. Every row's retirement condition must be met and
evidenced before the code is removed; approval of the policy is not approval of a
specific deletion.
