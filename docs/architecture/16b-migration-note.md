---
status: active
topic: Alpha16b migration note (16b-MN)
summary: The tracked carrier for the row-for-row 16b-MN obligations. It records what must migrate and what remains open; it is not the P5 capability inventory and creates no release evidence.
---

# 16b-MN — Alpha16 migration note (tracked carrier)

Date: 2026-11-14. Baseline: `origin/main` =
`fa6e5232dd54520d100108b202a73a1d70341f11` (PR #1790, M09-2d).

## Status and scope

`alpha16-18-execution-plan.md` §13.2 names five Alpha16b obligation slices
(`16b-LC`, `16b-EB`, `16b-CTX`, `16b-REF`, `16b-MN`). Before this change all five
were labels inside the plan only: no in-tree file, ledger row, named owner or
gate. This document is the **tracked carrier of `16b-MN`** — the minimum
migration guide that §13.2:395 requires to ship with Alpha16. It introduces no
new slice and no new milestone (§14.4:525-527).

**This document is not the P5 capability inventory.** §13.5:445-451 requires a
tracked capability inventory, a final-SHA matrix, `16b-MN` and the owner
sign-off; "A draft does not satisfy P5 … until then, P5 is not claimable and
Alpha16 release qualification is not openable". The untracked working draft
`alpha16-migration-capabilities.md` is none of those. **No owner sign-off is
recorded here and no gate was run.** Every row below is OPEN.

## Row-for-row obligations (§14.1 condition 6, §14.2:504)

| Capability | Corrected record | Carried by | Current state | Evidence still owed |
| --- | --- | --- | --- | --- |
| `custom-elements.json` (CEM) generation for generated elements | retained obligation (was: §13.3 exception) | M09 platform surface; M10 P3/P5; M12 packed qualification | **OPEN — no bounded mechanism exists.** `m09-2b-primitive-properties.md`:348-352 "No CEM output"; `packages/ui/tools/generate-cem.ts` class-only; no generated-element CEM PR in history. | generated CEM structure test; packed `@openelement/ui` metadata read back by the CEM scanner; `gate:release` and `gate:packed` green at the same SHA. The alternative owner-approved migration of the packed CEM artifact contract is also unrecorded. |
| array/object/`trustedHtml` property conversion | retained obligation (was: §13.3 exception) | M09 property/attribute conversion; M10 P5 | **OPEN — bounded mechanism only.** #1789 `f69dde8bf` lands property-only channels; the slice document self-describes "bounded implemented — LOCAL review pending", no server→client seed, "not the M09 exit". | property round-trip tests for the in-tree consumers (`notes-live`, `open-article-view`, `open-reading-shell`); packed ui-app/site build; the TSX rows that carry those components. |
| form validity policy (`setValidity` rules) | retained obligation (was: §13.3 exception) | M09 forms; M10 P5; `16b-MN` | **OPEN — bounded mechanism only.** #1790 `fa6e5232d` lands `formAssociated`, value / required / disabled and `required → valueMissing`; the slice document declares an explicit "Host access gap" non-claim, "not full OpenInput migration parity", Chromium LOCAL only. | the existing form e2e contract re-run on the generated CE; form value / reset / restore tests on the generated path. Full constraint mirroring (type/email, minlength, …) may stay a **deferred sub-obligation listed in this row**, never an exception (§14.2:510). |
| Two `/internal/*` artifact-resolution export subpaths | named deviation, no exemption | ADR-0137 §1 remains in force; ADR-0177 owns the written retirement condition | **OPEN — deviation registered 2026-11-14**; `packages/element/package.json`:16-17 unchanged. | `graph:check` zero importers outside `packages/element`; `esm:boundary-check` no external resolution; snapshot zero `publicSymbols`; `gate:release` + `gate:packed` green at one SHA. Byte attribution in the full reachable page closure also remains owed (ADR-0174:42-50, :12-13). |

The five `16b-*` slices have no implementation slices yet. `16b-LC` (lifecycle),
`16b-EB` (error boundary), `16b-CTX` (context, TSX-13) and `16b-REF` (refs) must
be delivered inside Alpha16b and may not be deferred to Alpha17 (§13.2:385-387).
They are not claimed here.

## Two non-exception items, unchanged (§13.3:427-435)

- Client style declaration for generated islands is a **deferred obligation**,
  not an exception (a replacement path exists); M11 re-verifies it on a real build.
- Utility and theme CSS is outside the capability list entirely (build-side, no
  authoring model dependency); M11 re-verifies it.

## Retirement-condition form (P5 / P6 / P8)

Every shim, drift guard and derived pointer must carry a condition of the form:

```
RETIRE <object> WHEN <existing gate reports a recomputable predicate on a standard artifact> ;
VERIFY <gate> WITH gate:release AND gate:packed GREEN AT <one SHA> ;
RECORD <16b-MN row / shim-inventory detail / seams guard / package.json "//"> ;
OWNER <single owner>
```

The condition is an event, never a date or "next review". Its source is a standard
artifact (module graph, type checker, Playwright report, packed tarball,
`public-interface-snapshot.json`) — see `shim-inventory.md`:366-370 and
`tools/repo/check-shims.ts`:416-421. The compliant precedents are
`ADR-0155`:175-205 and `ADR-0166`:134-148. Explicitly forbidden as conditions:
"Re-verify at each audit. No action." (`alpha16-18-progress.md`:442), a
procedural "needs its own PR" (`:440`), or a reference to a removed document
(execution-plan §2:111-116, §12a:351 — see §15.1 of the execution plan for the
later reading).

## What this note does not do

- It creates no P5 evidence, no final-SHA matrix, no capability inventory, no
  milestone exit, no sign-off, no gate result and no release claim.
- It does not rewrite the execution plan, the progress ledger, the semantic test
  matrix, the public-interface snapshot or any `packages/*` source/export map.
- It does not open Alpha16 release qualification. The owner sign-off of §13.5,
  the five §12a proofs, M13 and the publication authorization in
  `CONTRIBUTING.md`:197 remain separate, non-mergeable acts.
