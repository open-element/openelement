# M01 consumer migration matrix

Date: 2026-11-03. Companion to
[the IR and ABI boundary](./compiler-ir-and-abi-boundary.md). Base
`11b58f13e73bc7ae539e5de554646b0fc1e4a0a4`.

Method: repository-wide search for `__partProgram`, `PartProgramV2`,
`PartProgram`, `PART_PROGRAM_VERSION`, `COMPILED_MODULE_ABI_VERSION`,
`validatePartProgram`, `normalizePartProgram`, `createFreshDom`,
`hydrateExistingDom`, `addRangeCleanup`, `dispose(true)`, then each hit was read at
the call site. Search hits are **not** treated as call paths: a hit becomes a row
only when the file/function that uses it was opened.

Access types: **R** runtime property, **S** static/type-level, **L** lexical
(source-text), **T** type-only, **P** public API.

| ID | File | Function / symbol | Old field / type | Access | Current purpose | Target layer | Replacement | Milestone | Test evidence | Retirement condition |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C01 | `packages/element/src/open-element-implementation.ts:72-79,327-361` | `failMissingProgram`, `connectedCallback` | `__partProgram` | R | fails closed when the compiled program is missing; drives `kernel.connect()` | ABI | generated entrypoints + `componentMeta` | 16b | compiled facade tests | generated module provides mount/claim without a program |
| C02 | `packages/element/src/internal/compiled/facade-host.ts:6,28` | compiled statics types, handler binding | `__partProgram`, `__compiledProperties` | R+S | binds properties/attributes to signals; handler table | ABI | property metadata + emitted handlers | 16b | facade tests | metadata covers every facade read |
| C03 | `packages/element/src/internal/compiled/runtime-program.ts` | `normalizePartProgram` | `PartProgramV2` | R | validates/normalizes once per connect for the walker | retire | none (walker retires) | 16b | normalization tests | no production caller remains |
| C04 | `packages/element/src/public-runtime.ts:222,378,419,520-540,725-790` | `renderToStringAtDepth`, `createStreamShellExecutor` | tag, `metadata.properties`, program digest | R | tag lookup, registration, SSR serialization, stream shell | Server + ABI | server-private structure + tag/property metadata | 16b | SSR/stream tests | server backend renders from IR; no program read |
| C05 | `packages/element/src/server.ts:108-197` | server rendering helpers | compiled property metadata, root kind | R | HTML composition, root mode | Server | server-private structure | 16b | server HTML tests | server backend owns its structure |
| C06 | `packages/element/src/internal/compiled/server/index.ts:674-681` | serializer entry | `PartProgramV2` | R | serialization entry point | Server | server backend renderer | 16b | compiled-server tests | serializer consumes IR |
| C07 | `packages/router/src/authoring.ts:441-445` | `isElementPageClass` | `component.__partProgram !== undefined` | R | distinguishes element page class from function page (**property check, not lexical**) | ABI | explicit metadata flag | 16b | router authoring tests | page classification reads metadata |
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

| Kind | Rows | Meaning |
| --- | --- | --- |
| **Direct protocol consumers** | C01–C13, C19, C20 (16 rows) | read the emitted program, the schema, the validator or the public export |
| **Type-only consumers** | C11, C14, C15, C17, C18 (5 rows, overlapping C11 with the above) | depend on the *types*; they follow the ABI rather than migrate independently |
| **Supporting evidence** | **C16, C21, C22, C23** (4 rows) | do **not** consume the protocol; they constrain how retirement may be done |

Two rows were previously misclassified and are corrected:

- **C16 (`revive.ts`, `addRangeCleanup`) is supporting runtime-preservation
  evidence**, not a Part Program consumer. It records that the reconnect path
  depends on the non-detach disposal semantics; deleting it would break revive,
  not migration.
- **C23 (`tools/release/npm-manifest.ts`) is release-infrastructure evidence**,
  not a protocol consumer. It records how runtime dependencies are materialised
  into packed artifacts; it is untouched by the ABI change.

## Classification counts (verified this round)

Rows **overlap** by theme — one file can be both a runtime consumer and an SSR
consumer. The counts below count *rows per theme*, so they sum past 23 by design.

| Theme | Rows | Overlaps with |
| --- | --- | --- |
| Runtime property access | C01, C02, C03, C04, C05, C06, C07, C08, C09, C10 | SSR (C04–C06), Router (C07–C10), stream (C09, C10) |
| Type-only | C11, C14, C15, C17, C18 | runtime (C11), protocol (C14–C15, C17–C18) |
| Lexical (source text) | **C12, C13** — exactly two, in two different packages | build only |
| Public API / protocol | C19, C20 | type-only (C14–C18 consume these) |
| Tests / fixtures / harness | C21, C22 | supporting evidence |
| Release infrastructure | C23 | supporting evidence |

Counts that are safe to quote: **2 lexical consumers**, **16 files that read the
protocol/schema/export**, **5 supporting-evidence rows**, **0 unmapped production
consumers**.

## Blocking pairs

Any change to the emitted field shape must migrate these together, or the result is
a silent failure rather than a type error:

- **C12 + C13** — both read the emitted module as text; a rename keeps them
  "passing" while they silently stop detecting anything.
- **C07 + C11** — a runtime property check plus a type declaration; removing one
  without the other loses page classification or type safety.
- **C09 + C10** — stream validation and stream identity read the same two fields.

## What this matrix does not do

It does not authorise deletion. Every row's retirement condition must be met and
evidenced before the code is removed; approval of the policy is not approval of a
specific deletion.
