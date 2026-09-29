# ADR-0160: Architecture-debt repayment charter (alpha6)

- Status: ACCEPTED — alpha6 lane (2026-09-29)
- Tracking: #1467
- Preserves: ADR-0143, ADR-0148, ADR-0152, ADR-0157, ADR-0158, ADR-0159

## Decision boundary

alpha6 is a debt-repayment train: its stages restructure internal seams —
generated-entry growth, serializer forks, compiler/router coupling,
chunk-name-derived identity, release-name leakage into artifacts — without
moving product semantics. This ADR is the lane's legislation. The six rules
below bind every later stage of the lane, and the oracle suite at the end of
this document is the read-only definition of "no behavior change". This ADR
itself migrates nothing.

## Rules

a) **Generated code is route wiring only.** Codegen templates
(`packages/router/src/vite/internal/ssg/entry-codegen.ts` and siblings)
select routes, bind renderers, and forward requests. Server runtime logic
— actions, streaming pump, header channel, claim, scheduling — lives in
typecheckable TS modules (the `entry-*-runtime.ts` / `island-*.ts` family)
that generated entries import and the bundler inlines. New behavior lands
in those modules and gains a unit test; it must not accrete inside
template strings, where it is invisible to `deno check` and to the test
suite.

b) **One tree-walking serializer.** The compiled Element serializer has
exactly one implementation per walk. The server and runtime-seed
serialization paths already share one escape implementation
(`internal/core/html-escape.ts`); `compiled-escape-parity.test.ts` pins
byte parity between the call sites. A stage may not fork a second walker,
add a concatenation fallback that re-walks, or route special cases into
their own serializer.

c) **The compiler semantic core does not know Router.** The ADR-0148
layering holds: the bundler-neutral semantic core
(`packages/element/src/internal/compiler/semantic-core/`) must not import
Router types, route tables, or SSG admission policy. Where the core needs
an admission decision, the caller injects a generalized admission
descriptor — plain data with a versioned shape — and the core consumes it
without learning the caller's vocabulary. Generalizing an admission input
is repayment; growing a router-typed import in the core is not.

d) **Client asset injection is manifest-driven.** Islands, enhancer scripts,
and critical assets attach to a route through the build manifest
(`island-manifest.ts`, `client-island-entries.ts`,
`critical-assets.ts` in `packages/router/src/vite/internal/ssg/`).
Business identity — route, page, island name — is never derived from
chunk file names. Chunk names may be content hashes, but no generated or
runtime code parses them to decide what to inject.

e) **Runtime artifacts carry protocol/ABI versions, not release names.**
Generated and shipped artifacts may embed protocol identifiers (Part
Program version, registry marker wire values, error-code enums) because
consumers match on them. They must not embed historical release labels
(`1.0.0-alpha.N` and successors) as runtime-carried values: a release name
is not a protocol fact, and carrying it forces later lanes to keep
meaningless bytes stable. Source comments may cite the release that pinned
a value; artifacts do not.

f) **Output invariants.** Stages S1, S5, and S6 keep outputs byte-identical
to the pre-lane baseline: the oracle suite passes with its assertions
intact, and rendered HTML, manifests, and generated entries across the
fixtures and the site build are unchanged. Stages S3 and S4 may change
output bytes, but only for deltas pre-recorded in this ADR under
"Admitted output deltas": each entry names the stage, the artifact, the
expected difference, the reason, and the oracle evidence that protocol
semantics are unchanged. An unrecorded byte difference in S3 or S4 output
is a lane failure, not a tune-up.

The pre-lane baseline evidence (element and router suite results, site build
tree hash, framework fixture build hashes) was recorded by the lane's first
stage under `.artifacts/alpha6-baseline/`. That directory is deliberately
gitignored — it is per-checkout evidence, not a repository artifact — so the
durable enforcement of the invariants is the oracle suite below plus each
stage's recorded evidence, not the local file.

## Read-only oracle suite

During the migration these tests are read-only: their assertions may not be
weakened, skipped, or narrowed; only new cases may be added. A change to an
oracle assertion requires an amendment to this ADR naming the stage and the
reason. One exception is scheduled by design: `registry-marker-drift` is
rewritten in S3, which re-homes the wire values it pins.

| Oracle test                 | Path                                                            | Pins                                                                                                                 |
| --------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| request-time-parity         | `packages/router/__tests__/request-time-parity.test.ts`         | dev (hono) vs build (Nitro) request-time semantic parity: status codes, headers, middleware onion order              |
| compiled-escape-parity      | `packages/element/__tests__/compiled-escape-parity.test.ts`     | one shared escape implementation; server and runtime seed serializers emit byte-identical output                     |
| stream-manifest             | `packages/router/__tests__/stream-manifest.test.ts`             | route → loader field → signal → Part/Region deferral manifest (ADR-0158)                                             |
| renderer-scope-parity       | `packages/router/__tests__/renderer-scope-parity.test.ts`       | codegen-time scope predicate and the generated `__matchingRenderers` re-expression agree on every (scope, path) pair |
| lit-graph-boundary          | `packages/router/__tests__/lit-graph-boundary.test.ts`          | the generated LIT entry's real import graph never reaches the Native runtime kernel, with a negative control         |
| ssg-admission-parity        | `packages/router/__tests__/ssg-admission-parity.test.ts`        | one admission plan shared by the dev/SSR entry and the SSG entry, with matching build evidence                       |
| compiler-open-core-boundary | `packages/router/__tests__/compiler-open-core-boundary.test.ts` | the `open:core` transform carries the compiler's real Source Map v3 and its two-stage admission gate                 |

Exception: `packages/router/__tests__/registry-marker-drift.test.ts` pins the
SSR registry marker wire values and the generated artifacts that carry them;
S3 rewrites that test as part of its design.

## Verification

- The oracle suite is green, unweakened, at every stage boundary.
- S1/S5/S6: outputs byte-identical to the pre-lane baseline recorded by the
  lane's first stage.
- S3/S4: every output byte difference appears under "Admitted output deltas"
  before or with the stage that produces it.
- Rule (c) direction stays enforced by
  `packages/element/__tests__/compiler-semantic-core-boundary.test.ts` and
  the forbidden-import checks behind ADR-0148.

## Admitted output deltas

None recorded at lane start. S3 and S4 append entries here, one per artifact
difference, each with stage, artifact, expected difference, reason, and
oracle evidence.
