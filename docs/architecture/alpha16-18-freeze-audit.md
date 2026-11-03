# Alpha16–18 freeze audit

Date: 2026-11-03 (third round). Baseline: `4f1f2001b` (main);
branch `docs/alpha16-18-contract-revision`,
HEAD `dc610a55e9bcf5324ccdb95fd16116939864a400` before this round's edits.
Status: **READ + DOCUMENT-ONLY**. No product source was modified.

This is the freeze gate document: it answers whether the Alpha16–18 architecture
may be frozen and whether Alpha16a may start, and it records what was actually
verified versus assumed.

## 1. Executive summary

| Question | Answer |
| --- | --- |
| Is the Alpha16–18 architecture internally consistent? | **Yes, after this round's corrections.** Six P1 contradictions were closed; no P0 was found. |
| Is it engineering-feasible? | **Not yet proven.** Feasibility is exactly what Alpha16a must establish (G1/G2). Nothing here claims otherwise. |
| Does a hidden second execution model exist today? | **No.** There is one authoring path (class/decorator) and one browser execution model (generic Part Program walk). The server function-component lane is string composition, not a second client model. |
| Are there untracked legacy-execution consumers? | **No untracked production consumer was found.** The consumer map (§4) covers direct, indirect, type-only, build-time and lexical consumers. Tests/fixtures are listed separately. |
| Can the old generic browser executor be removed in Alpha16b? | **Conditionally yes.** It requires M10 reachability evidence across every production browser entry, plus behaviour coverage. If that evidence cannot be produced, Alpha16 does not release (gate intact). |
| Which legacy APIs must be kept? | **Unconditionally:** JSX type entry + fail-closed guard, Signals, `LifetimeScope`, SSR/DSD serializer, security sinks, Router Framework Mode, native CE boundary, third-party WC interop. **Under fourth-pass proposal (not decided):** Class authoring API, Part Program v2, validator, `__partProgram`. See §10. |
| Which historical implementations should eventually be deleted? | The generic browser walkers and their dispatch surfaces, runtime-only normalization, and superseded executor installation seams — each only after M10 evidence. See [the retirement roadmap](./alpha16-18-retirement-roadmap.md). |
| What is only history and should leave the current path? | `@lit-labs/ssr` shim + `./lit`/`./lit-ssr` surfaces (ADR-0152 track), and superseded ADR wording already superseded by dated amendments. |
| May Alpha16a start? | **Yes, once this PR is merged.** The blocking corrections are documentation-level and are closed here; implementation gates (G1/G2) remain to be earned. |

**No P0 defect was found in this round.** The most dangerous finding was a
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

Honest depth record for this round. "Full" means the file was read end to end in
this session or the immediately preceding ones; "targeted" means specific
functions/regions were read and cited; "not inspected" means exactly that.

| Area | File | Depth |
| --- | --- | --- |
| Compiler | `semantic-core/compile.ts` | Full (186 lines) |
| Compiler | `semantic-core/parse-module.ts` | Full |
| Compiler | `semantic-core/module-analysis.ts` | Targeted (`:550-576`) |
| Compiler | `semantic-core/analyze-module.ts` | Not inspected this round (teammate report only) |
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

**Not covered at all in this round:** the browser/E2E suites, packed-consumer
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

Verified this round: the earlier claim that **two Router consumers scan source
text** was wrong. `authoring.ts:441-445` is a runtime property check. Exactly two
lexical consumers exist tree-wide, in two different packages.

## 5. Contradiction register

Severity: P0 breaking architecture/security; P1 blocks freeze or Alpha16; P2 must
be fixed before document freeze; P3 follow-up.

| ID | Sev | File:Line | Actual evidence | Impact | Fix applied | Test / milestone |
| --- | --- | --- | --- | --- | --- | --- |
| FR-01 | P1 | `jsx-value-and-children-model.md` §4.1a; canonical §4.5; audit; reality | `lifetime-scope.ts:99-108` iterates children **in insertion order** and only the owner's own cleanups LIFO | would have produced a wrong disposal contract | corrected in all four documents | TSX-27; M04 |
| FR-02 | P1 | `jsx-value-and-children-model.md` §4.1a table | `dispose(true)` runs full disposal **plus** range cleanups (`:104-106`); it is not a DOM-only detach | wrong API naming → wrong implementation | relabelled; removed the "detach only" row and documented it as unsupported | TSX-19/26/27 |
| FR-03 | P1 | `alpha16-18-execution-plan.md` M10a | M10a was listed inside the Alpha16a table | conflated early smoke with the 16a exit condition | M10a explicitly non-gating; Alpha16a exit = M01–M08 | review |
| FR-04 | P1 | `jsx-value-and-children-model.md` §4.7 | "same generated code must serve all three" | contradicts "no runtime host interpreter"; would force a shared executable | replaced with "shared semantics, separate backends" | M05/M07 |
| FR-05 | P1 | canonical §4.6; plan | `server-component.ts:135,173-175` rejects `async` (OEC9032) while the plan implied server async in Alpha16 | undefined capability | added §4.6a full-await definition + milestone M14 | M14 |
| FR-06 | P1 | `shim-inventory.md` #8, #17 | both still described Lit as doctrine/platform edge | contradicts ADR-0152 amendment; misleads contributors | updated to the retirement track | ADR-0152 track |
| FR-07 | P2 | consumer tables | indirect/type-only consumers missing (`protocol/ssg.ts`, `hydrate-seam.ts`, `program-kernel.ts`, `revive.ts`) | incomplete migration map | added rows | M10 |
| FR-08 | P2 | ADR README status lines | did not mention the new amendments | index drift | updated | `adr-index:check` |
| FR-09 | P2 | canonical §4.4 | `jsx-runtime.ts` guard vs new recipe semantics unstated | readers could think recipes revive the factories | added explicit paragraph | review |
| FR-10 | P2 | props wording | "once per insertion" was too strong | misleading | corrected to lazy-getter with per-read evaluation | TSX-28 |
| FR-11 | P3 | coverage claims | earlier docs implied broad source coverage | overclaim risk | coverage ledger above | this doc |
| FR-12 | P3 | file naming | `analyze-module.ts` **and** `module-analysis.ts` both exist; a previous report cited them interchangeably | wrong citations | rule: cite **by function name** (`analyzeCompiledModule` → `analyze-module.ts:844`; `analyzeModuleSemantics` → `module-analysis.ts:550`) | review |

Closed: FR-01…FR-10. Open: FR-11 is a disclosure obligation (this ledger),
FR-12 is a citation rule.

## 6. Milestone and gate validation

| Item | Claim | Verified? |
| --- | --- | --- |
| Alpha16a exit = M01–M08 + G1/G2 | stated in the plan | yes, textually consistent |
| M10a non-gating early smoke | corrected this round | yes |
| M10 on the Alpha16b critical spine | M10 depends on M05–M09 | yes |
| M03 position | function adapter is a practical prerequisite of M05 | yes (corrected earlier) |
| M14 async server | **Alpha16b**; never Alpha16a, never Alpha18 bounded defer; parallelisable | yes |
| Gate wording | old generic **browser** executor unreachable, not all Part Program | yes; ADR-0174 amendment says the same |
| G3 | public API freeze only after consumer evidence | yes |

No duration estimates are stated anywhere; the plan calls the ordering a
dependency spine.

## 7. Test and CI evidence for this round

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

## 8. Remaining OPEN items

Only engineering questions that still need evidence (none are owner decisions):

1. Props tracking granularity — decided by TSX-28 counts plus a cost measurement.
2. Inline-expression memoisation — TSX-28.
3. Claim marker protocol for ordered repeated insertion — TSX-30.
4. Ownership lineage mechanism — TSX-26.
5. Template-cloning optimisation — byte measurement.
6. Cross-module recipe ABI — Alpha17, TSX-21.
7. Context representation — TSX-13.
8. `onConnect`/`onDispose` names — Alpha17 G3.
9. HMR state policy — TSX-22.
10. Iterable admission beyond arrays — TSX-16.
11. Async server component error semantics under full-await — M14.
12. Exact form of the metadata/execution split inside the emitted module — M01/D-O2.

## 9. Freeze statement

- **Architecture may be frozen** for Alpha16a once this PR is reviewed and merged.
- **Alpha16a may start** on M01–M08 after merge; M10a may run opportunistically
  but does not gate it.
- **Alpha16b remains the only release route**, with the ADR-0174 gate intact.
- Nothing in this document is implementation evidence.

## 10. Fourth-pass addendum (2026-11-03)

The owner challenged D-O2 and D-O3. A dedicated reassessment now records the
evidence and proposes: **retire the Class/Decorator authoring API** (P-1) and
**retire Part Program v2 as a serialized browser protocol, removing
`__partProgram` from the target module contract** (P-2/P-3), with the validator
and version retired alongside (P-4) and no authoring compatibility adapter (P-5).

State of those items: **PROPOSED, not approved.** The 2026-11-03 D-O2/D-O3 records
stand as approved history until the owner supersedes them. See
[the reassessment](./alpha16-18-fourth-pass-reassessment.md).

Consequences already applied to the documents (all reversible if the proposals
are rejected):

- canonical architecture marks the protocol and class API as CURRENT FACT +
  PROPOSED retirement rather than permanent KEEP;
- the retirement roadmap moved the class API, `OpenElement` author surface,
  Part Program v2 and the validator into PROPOSE RETIRE rows;
- the execution plan replaced M09 ("class adapter") with the generated Native
  Custom Element boundary, and states both variants;
- ADR-0173 and ADR-0174 carry **PROPOSED** amendments that explicitly do not
  amend the records until accepted;
- M14 is normalized to Alpha16b everywhere.

The freeze statement in §9 is therefore qualified: the architecture is
*internally consistent* about the target, but the target itself has five open
owner proposals. Freezing means "no remaining contradictions", not "the
retirement direction is approved".
