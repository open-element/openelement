---
status: active
topic: CI flake ledger
summary: Record of main-branch CI failures that were classified as infrastructure or engine flake, with the run id, the failed job and the evidence that separates flake from regression.
---

# CI flake ledger

`CONTRIBUTING.md` requires CI flakes to be **recorded, not silently rerun**. This
file is that record for the main-branch heavy lane. It is a log, not a gate: no
checker reads it, and an entry here is not a claim that a suite is green.

Rules for an entry:

- the run id is resolvable (`gh run view <id>`), and the failed job is named;
- the classification is one of `infra` (runner/network/apt), `engine-timeout`
  (browser engine timeout with no assertion failure), `pixel` (visual assertion
  on a rendering difference), `real-regression` (a product failure — it must
  carry the closing fix SHA, otherwise it is not closed);
- first-attempt failures and rerun results are recorded **separately**: a green
  rerun never by itself proves the first run was flake.

## 2026-11 window (Alpha16a closeout)

| Date (UTC) | Run | SHA | Failed job | Classification | Evidence | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-11-11 16:41 | 43060765423 | `91376fa17` | `test`, `e2e`, `e2e-full (fixture-gates)`, `e2e-full (site-e2e)`, `pack`, `packed-consumer-matrix (ubuntu-24.04)` | `infra` | every failure is `playwright install --with-deps` (apt index unreachable); the PR was docs-only (+89/−0); PR-head run on the same tree was green | superseded by the next green main push; no rerun recorded |
| 2026-11-11 19:06 | 43084118932 | `70eb2381c` | `e2e-full (fixture-gates)` | `engine-timeout` | firefox `e2e/live.spec.ts:605` (`page.reload`) and `:644` (`allTextContents`) both hit the 60s test timeout; 316 passed; no assertion-value failure; same tree green on the PR layer and on the next main push (`c4bff6dfc`) | superseded by `c4bff6dfc` green; no rerun recorded |
| 2026-11-12 05:02 | 43158665925 | `ec8827f06`… (merge `b82e63bd`) | `e2e-full (fixture-gates)` | `engine-timeout` | attempt 1: firefox `e2e/live.spec.ts:527` (`island state survives a list prepend`) 60s timeout; 13/13 job instances green on attempt 2 | rerun attempt 2 = success; first-attempt failure kept here |
| 2026-11-12 09:20 | 43187060044 | `ec8827f06` | `e2e-full (site-e2e)` | `pixel` | webkit `e2e/ui-behaviour-matrix.spec.ts:228` "focus-visible rings": `Error: a ring has pixels inside the viewport`, retry #1 failed the same way; change was docs-only (M07 closeout, 4 files) | open — no rerun recorded yet |

## Reading this ledger

A `pixel` or `engine-timeout` row means the suite did not prove the product
behaviour on that run; it does **not** mean the behaviour is correct. A
`real-regression` row stays open until the fixing SHA is recorded.
