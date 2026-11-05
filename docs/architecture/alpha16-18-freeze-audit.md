# Alpha16–18 freeze audit

Date: 2026-11-03 (third round; 2026-11-05 consistency revision). Baseline:
`4f1f2001b` (main). The 2026-11-03 round's pre-edit HEAD was
`dc610a55e9bcf5324ccdb95fd16116939864a400`; the 2026-11-05 consistency revision
started from `463e6cb07319a3ba131ed1c63c835e58705a6231`.
Status: **READ + DOCUMENT-ONLY**. No product source was modified.

**2026-11-05 revision boundary.** This pass edits documentation only. It does not
run runtime, browser, packed-consumer, generated-code or performance tests, and it
does not renew the 2026-11-03 round's runtime evidence. Validation is limited to
`git diff --check` and `vp run --no-cache check` (format/lint/typecheck/markdown
tooling); results are recorded in §7 and are documentation evidence, not product
evidence.

This is the freeze gate document: it answers whether the Alpha16–18 architecture
may be frozen and whether Alpha16a may start, and it records what was actually
verified versus assumed.

## 1. Executive summary

| Question | Answer |
| --- | --- |
| Is the Alpha16–18 architecture internally consistent? | **Yes, after the corrections recorded here.** Six P1 contradictions were closed in the 2026-11-03 third round; no P0 was found. The 2026-11-05 consistency revision records one further P1 and three P2 corrections separately (FR-13…FR-16), not folded into that round's count; it also annotates FR-03 (G1/G2) as this-round text. |
| Is it engineering-feasible? | **Not yet proven.** Feasibility is exactly what Alpha16a must establish (G1/G2). Nothing here claims otherwise. |
| Does a hidden second execution model exist today? | **No.** There is one authoring path (class/decorator) and one browser execution model (generic Part Program walk). The server function-component lane is string composition, not a second client model. |
| Are there untracked legacy-execution consumers? | **No untracked production consumer was found.** The consumer map (§4) covers direct, indirect, type-only, build-time and lexical consumers. Tests/fixtures are listed separately. |
| Can the old generic browser executor be removed in Alpha16b? | **Conditionally yes.** It requires M10 reachability evidence across every production browser entry, plus behaviour coverage. If that evidence cannot be produced, Alpha16 does not release (gate intact). |
| Which legacy APIs must be kept? | **Unconditionally:** JSX type entry + fail-closed guard, Signals, `LifetimeScope`, SSR/DSD serializer, security sinks, Router Framework Mode, native CE boundary, third-party WC interop. **APPROVED TARGET (P-1…P-5, 2026-11-03):** Class authoring API, Part Program v2, validator, `__partProgram` retire in Alpha16b — policy approved, nothing deleted yet, no ABI frozen. See §10. |
| Which historical implementations should eventually be deleted? | The generic browser walkers and their dispatch surfaces, runtime-only normalization, and superseded executor installation seams — each only after M10 evidence. See [the retirement roadmap](./alpha16-18-retirement-roadmap.md). |
| What is only history and should leave the current path? | `@lit-labs/ssr` shim + `./lit`/`./lit-ssr` surfaces (ADR-0152 track), and superseded ADR wording already superseded by dated amendments. |
| May Alpha16a start? | **Yes, once this PR is merged.** The blocking corrections are documentation-level and are closed here; implementation gates (G1/G2) remain to be earned. |

**No P0 defect was found in the 2026-11-03 round.** The most dangerous finding was a
documentation-level one: three documents described `LifetimeScope` disposal
incorrectly, which would have produced a wrong implementation contract.

## 2. Full chain map

```text
Product model (Element / Router; CE boundary; HTML-first)
   └─ ADR-0143/0152/0173/0174  ─ decisions + amendments
        └─ compiler-native-architecture (canonical P1–P5, five layers)
             └─ Compiler frontend
                  parse-module.ts → module-analysis.ts → compile.ts
                  → lower-program.ts → emit-program.ts → emit-module.ts
                  ├─ Server backend: server-component.ts → element/src/server.ts
                  │                    → compiled/server/index.ts → HTML/DSD
                  └─ Client backend: (TARGET, not built) generated mount/update/claim
                       └─ Runtime today: kernel.ts → fresh-dom.ts / hydrate.ts
                            → parts.ts, blocks.ts, revive.ts, program-kernel.ts
                            ← lifetime-scope.ts (ownership)
             └─ Wire/ABI: part-program.ts (v2) · COMPILED_MODULE_ABI_VERSION v2
                          · stream manifest · claim markers
             └─ Router: authoring.ts, renderer-runtime.ts, route-dispatch.ts,
                        stream-runtime.ts, island-blocks-scan.ts
             └─ Tests: element/router suites · browser matrix · packed consumers
             └─ Release: gate:source / gate:release · exact-SHA evidence
```

## 3. Source coverage ledger

Honest depth record for the 2026-11-03 round. "Full" means the file was read end to end in
this session or the immediately preceding ones; "targeted" means specific
functions/regions were read and cited; "not inspected" means exactly that.

| Area | File | Depth |
| --- | --- | --- |
| Compiler | `semantic-core/compile.ts` | Full (186 lines) |
| Compiler | `semantic-core/parse-module.ts` | Full |
| Compiler | `semantic-core/module-analysis.ts` | Targeted (`:550-576`) |
| Compiler | `semantic-core/analyze-module.ts` | Not inspected in that round (teammate report only) |
| Compiler | `semantic-core/lower-program.ts` | Targeted (`:425-544`, `:818-820`) |
| Compiler | `semantic-core/emit-module.ts` | Targeted (`:1-60`, `:295`, `:354-356`, `:528`) |
| Compiler | `semantic-core/emit-program.ts` | Not inspected |
| Compiler | `semantic-core/server-component.ts` | Targeted (`:1-33`, `:127-215`, `:135,173-175`) |
| Compiler | `compiled-artifact-style-requests.ts` | Targeted (`:42,122-196`) |
| Compiler | `source-map.ts`, `type-check.ts` | Not inspected |
| Runtime | `compiled/lifetime-scope.ts` | Full (110 lines) |
| Runtime | `compiled/runtime/blocks.ts` | Targeted (`:100-250`, `:312`, `:516`, `:599`) |
| Runtime | `compiled/runtime/fresh-dom.ts` | Targeted (`:1-70`) |
| Runtime | `compiled/runtime/hydrate.ts` | Targeted (entry, mismatch, `:76-93`, `:226-248`, `:867`) |
| Runtime | `compiled/runtime/kernel.ts` | Targeted (`:1-80`) |
| Runtime | `compiled/runtime/hydrate-seam.ts` | Targeted (`:1-30`) |
| Runtime | `compiled/runtime/blocks-install.ts` | Targeted (`:1-40`) |
| Runtime | `compiled/runtime.ts` | Targeted (seed serializer `:105-202`) |
| Runtime | `compiled/runtime-program.ts` | Not inspected (header only) |
| Runtime | `open-element-implementation.ts` | Targeted (`:20-79`, `:320-369`) |
| Runtime | `public-runtime.ts` | Targeted (`:500-540`, `:725-790`) |
| Runtime | `facade-host.ts` | Not inspected |
| Runtime | `revive.ts` | Grep only (`:254,284`) |
| Protocol | `part-program.ts` | Targeted (`:1-120`) |
| Protocol | `ssg.ts` | Grep only |
| Router | `authoring.ts` | Targeted (`:435-450`) |
| Router | `island-blocks-scan.ts` | Targeted (`:100-125`) |
| Router | `route-dispatch.ts` | Grep only |
| Router | `stream-runtime.ts` | Grep only |
| Router | `renderer-runtime.ts` | Grep only |
| Router | `server-runtime/types.ts` | Grep only |
| Docs | all architecture docs + ADRs 0143/0148/0152/0173/0174 | Full |

**Not covered at all in the 2026-11-03 round:** the browser/E2E suites, packed-consumer
harnesses, `tools/release/*` internals, `apps/saas`, `packages/ui`, the 1004-line
hydration implementation beyond the cited regions. No claim in this document is
derived from those areas.

Consequence: this is a **freeze-level** audit, not a line-by-line certification.
Where a claim matters for deletion, the retirement roadmap requires a per-object
consumer trace before action.

## 4. Consumer matrix (summary)

Full table: [current reality §C-bis](./alpha16-18-current-reality.md#c-bis-__partprogram-production-consumer-map).
Classification actually used:

| Class | Count | Examples |
| --- | --- | --- |
| Direct static-field access (runtime) | 6 | facade, facade-host, runtime-program, public-runtime, server entry, implementation |
| SSR serializer consumer | 3 | `public-runtime.ts`, `compiled/server/index.ts` |
| Stream consumer | 2 | `stream-runtime.ts`, `route-dispatch.ts` |
| Router runtime/build consumer | 4 | `authoring.ts`, `renderer-runtime.ts`, `types.ts`, generated entries |
| Build-time lexical consumer | 2 | `island-blocks-scan.ts`, `compiled-artifact-style-requests.ts` |
| Type-only consumer | 4 | `protocol/ssg.ts`, `hydrate-seam.ts`, `program-kernel.ts`, `types.ts` |
| Protocol/validator | 2 | `part-program.ts`, public export |
| Test/fixture/benchmark | many | `__wtr__/generated/*`, element/router suites, packed harnesses |
| Documentation | many | ADRs, architecture docs, blog |

Verified in the 2026-11-03 round: the earlier claim that **two Router consumers scan source
text** was wrong. `authoring.ts:441-445` is a runtime property check. Exactly two
lexical consumers exist tree-wide, in two different packages.

## 5. Contradiction register

Severity: P0 breaking architecture/security; P1 blocks freeze or Alpha16; P2 must
be fixed before document freeze; P3 follow-up.

_Round split:_ **FR-01…FR-12 are the 2026-11-03 third-round ledger, with one
2026-11-05 annotation to FR-03 (G1/G2 added; the third-round row stated
M01–M08). FR-13…FR-16 were opened by the 2026-11-05 consistency revision.**
FR-13 is that revision's P1 and is not part of the third round's six-P1 count;
FR-01…FR-10 and FR-13…FR-16 are closed cumulatively, FR-11/FR-12 remain
disclosure/citation obligations.

| ID | Sev | File:Line | Actual evidence | Impact | Fix applied | Test / milestone |
| --- | --- | --- | --- | --- | --- | --- |
| FR-01 | P1 | `jsx-value-and-children-model.md` §4.1a; canonical §4.5; audit; reality | `lifetime-scope.ts:99-108` iterates children **in insertion order** and only the owner's own cleanups LIFO | would have produced a wrong disposal contract | corrected in all four documents | TSX-27; M04 |
| FR-02 | P1 | `jsx-value-and-children-model.md` §4.1a table | `dispose(true)` runs full disposal **plus** range cleanups (`:104-106`); it is not a DOM-only detach | wrong API naming → wrong implementation | relabelled; removed the "detach only" row and documented it as unsupported | TSX-19/26/27 |
| FR-03 | P1 | `alpha16-18-execution-plan.md` M10a | M10a was listed inside the Alpha16a table | conflated early smoke with the 16a exit condition | M10a explicitly non-gating; Alpha16a exit = M01–M08 + G1/G2. **2026-11-05 annotation:** the third-round row stated M01–M08 only; G1/G2 are added by this consistency revision to match §1/§6, not retroactively part of that round's ledger. | review |
| FR-04 | P1 | `jsx-value-and-children-model.md` §4.7 | "same generated code must serve all three" | contradicts "no runtime host interpreter"; would force a shared executable | replaced with "shared semantics, separate backends" | M05/M07 |
| FR-05 | P1 | canonical §4.6; plan | `server-component.ts:135,173-175` rejects `async` (OEC9032) while the plan implied server async in Alpha16 | undefined capability | added §4.6a full-await definition + milestone M14 | M14 |
| FR-06 | P1 | `shim-inventory.md` #8, #17 | both still described Lit as doctrine/platform edge | contradicts ADR-0152 amendment; misleads contributors | updated to the retirement track | ADR-0152 track |
| FR-07 | P2 | consumer tables | indirect/type-only consumers missing (`protocol/ssg.ts`, `hydrate-seam.ts`, `program-kernel.ts`, `revive.ts`) | incomplete migration map | added rows | M10 |
| FR-08 | P2 | ADR README status lines | did not mention the new amendments | index drift | updated | `adr-index:check` |
| FR-09 | P2 | canonical §4.4 | `jsx-runtime.ts` guard vs new recipe semantics unstated | readers could think recipes revive the factories | added explicit paragraph | review |
| FR-10 | P2 | props wording | "once per insertion" was too strong | misleading | corrected to lazy-getter with per-read evaluation | TSX-28 |
| FR-11 | P3 | coverage claims | earlier docs implied broad source coverage | overclaim risk | coverage ledger above | this doc |
| FR-12 | P3 | file naming | `analyze-module.ts` **and** `module-analysis.ts` both exist; a previous report cited them interchangeably | wrong citations | rule: cite **by function name** (`analyzeCompiledModule` → `analyze-module.ts:844`; `analyzeModuleSemantics` → `module-analysis.ts:550`) | review |
| FR-13 | P1 | `alpha16-18-execution-plan.md` §8 vs §1 | §8 required M10a and the M10 executor-reachability answer before Alpha16a "claims success", while §1 sets 16a exit = M01–M08 + G1/G2 and M10 needs M05–M09 (M09 is 16b) | two incompatible definitions of 16a completion | split into §8a (gates 16a: questions 1/2/3/5) and §8b (16b: questions 4/6, tracked as risk); old wording marked SUPERSEDED HISTORY | review |
| FR-14 | P2 | `alpha16-18-retirement-roadmap.md` `COMPILED_MODULE_ABI_VERSION` row | said "KEEP … Alpha17", conflicting with [boundary §7.1](./compiler-ir-and-abi-boundary.md#71-versioning-three-separate-checks) | ABI phase ambiguity (retire vs check vs freeze) | split into three actions: old v2 retires (16b), new version compatibility check (16b), cross-module freeze (Alpha17) | review |
| FR-15 | P2 | this document §8 items 1–2 | presented props getter evaluation (and inline-expression memoisation) as an undecided choice for TSX-28 | contradicts the owner's per-read ruling; invites a wrong implementation contract | marked DECIDED (per-read) + TSX-28 measures counts/cost; memoisation that changes counts called out as a semantics change | TSX-28 |
| FR-16 | P2 | 2026-11-05 diff audit: `m02-semantic-ir-feasibility.md` §3/§8/§9; M01 C04; roadmap `authoring.ts`; reconnect/claim/parity ownership and acceptance limits | condition/children recorded as unexercised after M02.1; C04 still said "server backend renders from IR"; roadmap still said C07 becomes a metadata flag; reconnect said M05–M08 and asserted physical scope identity, a universal subscription count of 1 and focus retention; claim/parity ownership was scattered | stale records could silently reintroduce retired semantics or freeze OPEN resource-scope behaviour as acceptance | M02 record/OPEN-3 corrected; C04/C06/C07 layer note; C07 is build-time classification; reconnect is M05–M09 and now requires logical instance continuity, a fixture-baseline subscription graph and no additional DOM/input loss, with platform focus differences recorded and resource-scope identity left OPEN; claim marker/key/seed/recovery is M07–M08; parity is phase-labelled M06/M08/M13 | M01/M02/M05–M09 |

Closed: FR-01…FR-10 and FR-13…FR-16. Open: FR-11 is a disclosure obligation
(this ledger), FR-12 is a citation rule.

## 6. Milestone and gate validation

| Item | Claim | Verified? |
| --- | --- | --- |
| Alpha16a exit = M01–M08 + G1/G2 | stated in the plan | yes, textually consistent |
| M10a non-gating early smoke | corrected in the 2026-11-03 round | yes |
| M10 on the Alpha16b critical spine | M10 depends on M05–M09 | yes |
| M03 position | function-component frontend is a practical prerequisite of M05 | yes (corrected earlier) |
| §8 readiness split | questions 1/2/3/5 gate Alpha16a; questions 4/6 are 16b answers tracked as risk during 16a | yes — §8a/§8b in the plan; M10a remains non-gating |
| M14 async server | **Alpha16b**; never Alpha16a, never Alpha18 bounded defer; parallelisable | yes |
| Gate wording | old generic **browser** executor unreachable, not all Part Program | yes; ADR-0174 amendment says the same |
| G3 | public API freeze only after consumer evidence | yes |

No duration estimates are stated anywhere; the plan calls the ordering a
dependency spine.

## 7. Test and CI evidence for the 2026-11-03 round

| Check | Command | Result |
| --- | --- | --- |
| Format | `vp run check` (fmt subsystem) | PASS |
| Lint | `vp run check` (oxlint) | PASS |
| Typecheck | `vp run check` | PASS |
| Markdown | `vp run check` (markdownlint) | PASS |
| Public docs (machine paths) | `vp run check` | PASS |
| ADR index | `node tools/repo/check-adr-index.ts` | 34/34 resolved, 12 annotated |
| Agent contract | `node tools/repo/check-agent-contract.ts` | 52 commands resolved |

**NOT RUN and must not be claimed:** browser matrix, packed consumers, bundle
graphs, performance/size budgets, any runtime test of the proposed model. This
round changed no executable code.

Evidence boundary for the 2026-11-05 consistency revision: **documentation only**.
The revision does not run browser, packed-consumer, generated-code or runtime tests
of the proposed model, and it does not renew the 2026-11-03 table above. Its
validation is limited to `git diff --check` and `vp run --no-cache check`
(format/lint/typecheck/markdown tooling); those are document-tooling checks, not
product evidence. Result for this revision: `git diff --check` clean;
`vp run --no-cache check` PASS (5/5 steps, 0 markdown issues, 0 lint/format/type
errors, public-doc machine-path check pass). No browser, packed-consumer,
generated-code or runtime test was run.

## 8. Remaining OPEN items and settled decisions

Engineering questions that still need **evidence**. An owner-decided question is
listed as DECIDED together with the measurement that remains — it is not re-opened
as a choice:

1. **Props getter evaluation — DECIDED (owner ruling): every read evaluates.** Not
   an OPEN semantics question. TSX-28 has not run: it must verify the evaluation
   counts and record the cost on the stateful list. A per-update-tick memoisation
   is **not** the alternative semantics on a menu: it changes observable
   evaluation counts, returned values and side-effect order, so it is not an
   equivalent pure-cost variant. Status: **DECIDED SEMANTICS, not implemented or
   measured**; the count table is
   [the model note §4.2a](./jsx-value-and-children-model.md).
2. **Inline-expression evaluation counts — measurement only (TSX-28).** The
   contract comes from the same §4.2a table (inline expressions run per dependent
   update); TSX-28 asserts those counts and records the cost. Any memoisation that
   changed the counts would be a semantics change, not an implementation detail.
3. Claim marker protocol for ordered repeated insertion — TSX-30, owned by
   M07–M08 (marker/key/seed/recovery are one claim chain).
4. Ownership lineage mechanism — TSX-26.
5. Template-cloning optimisation — byte measurement.
6. Cross-module recipe ABI — Alpha17, TSX-21.
7. Context representation — TSX-13.
8. `onConnect`/`onDispose` names — Alpha17 G3. Names only; reconnect resource
   persistence is item 13 and is not deferred with the names.
9. HMR state policy — TSX-22.
10. Iterable admission beyond arrays — TSX-16.
11. Async server component error semantics under full-await — M14.
12. Exact form of the metadata/execution split inside the emitted module — M01/D-O2.
13. **Reconnect resource persistence — OPEN, owned by M05–M09.** The required
    target semantics are setup-once per logical instance and resumption of the
    same logical instance after disconnect→reconnect; neither is observed today.
    Physical `LifetimeScope`/resource-scope identity is **not** asserted (revive
    creates a fresh root scope today) and remains OPEN. The resource-level
    contract is not yet defined or verified: props getters after disposal,
    listener/binding rebuild idempotence, logical subscription re-creation versus
    re-suspension, the fixture baseline graph, and hostless child-owner connection
    state. M07–M08 exercise the retained-DOM/disposed-owner difference; M09 is the
    generated Native CE boundary where platform reconnect occurs. Acceptance is
    probe-based (setup count 1, the fixture's expected subscriptions reproduced
    with no duplicate or loss, private state preserved, no additional DOM/input
    loss); focus differences are recorded as platform behaviour, not promised. No
    universal subscription count, physical scope identity or focus retention is
    claimed. See [model note §4.1d](./jsx-value-and-children-model.md) and
    [TSX-14](./tsx-author-candidate-contract.md).

## 9. Freeze statement

- **Architecture may be frozen** for Alpha16a once this PR is reviewed and merged.
- **Alpha16a may start** on M01–M08 after merge; M10a may run opportunistically
  but does not gate it. §8a of the plan lists the 16a-gating questions; questions
  4 and 6 (§8b there) are 16b answers tracked as risk, not 16a blockers.
- **Settled owner decisions are not open items:** props getters evaluate per read
  (§8 item 1), and the Class/Part Program retirement is approved policy (§10).
  What remains open is execution feasibility, measurements and counts — not a
  choice between competing semantics.
- **Alpha16b remains the only release route**, with the ADR-0174 gate intact.
- Nothing in this document is implementation evidence.

## 10. Fourth-pass addendum (2026-11-03)

The owner challenged D-O2 and D-O3. A dedicated reassessment recorded the evidence
and proposed: **retire the Class/Decorator authoring API** (P-1) and
**retire Part Program v2 as a serialized browser protocol, removing
`__partProgram` from the target module contract** (P-2/P-3), with the validator
and version retired alongside (P-4) and no authoring compatibility adapter (P-5).

State of those items: **APPROVED 2026-11-03** as one decision package (P-1…P-5).
The 2026-11-03 D-O2/D-O3 records are superseded and retained as history. Approval is
policy-level: no source is deleted and no ABI is frozen. See
[the reassessment](./alpha16-18-fourth-pass-reassessment.md).

Consequences already applied to the documents (approved 2026-11-03):

- canonical architecture marks the protocol and class API as CURRENT FACT +
  APPROVED retirement target rather than permanent KEEP;
- the retirement roadmap moved the class API, `OpenElement` author surface,
  Part Program v2 and the validator into RETIRE rows;
- the execution plan replaced M09 (formerly a shared class adapter) with the
  generated Native Custom Element boundary. **SUPERSEDED HISTORY:** the class
  adapter is not a current acceptance path or fallback; no adapter is built (P-5).
  M09's acceptance is the generated CE boundary with no author-facing class
  requirement; the class→function migration coverage that would have justified an
  adapter is **M10 partition evidence** (public API + browser runtime), with a
  per-file matrix and capability inventory tracked in the roadmap;
- ADR-0173 and ADR-0174 carry superseding amendments recording the retirement;
  the earlier amendments remain readable as history;
- M14 is normalized to Alpha16b everywhere.

The freeze statement in §9 is therefore now unqualified on direction: the target
is approved and internally consistent. What remains open is **execution
feasibility** (M01–M13) and the measurements in §8 — not the direction, and not
the props evaluation semantics, which are per-read by owner ruling. The ABI is
split the same way: the old stamp retires in Alpha16b, the new version is
compatibility-checked in Alpha16b, and only Alpha17 freezes the cross-module
contract ([boundary §7.1](./compiler-ir-and-abi-boundary.md#71-versioning-three-separate-checks)).
Freezing means "no remaining contradictions and an approved direction" — it still
does not mean the work is feasible or the release is ready.
