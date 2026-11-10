---
status: historical
topic: Project history and pivot ledger
summary: Record of the stack pivots from the Deno/Lit/Hono composition to the compiler-native path, with the reason and evidence for each turn.
---

# Project history and pivot ledger

Date: 2026-11-10. Status: **historical record** — it explains why the current
architecture looks the way it does. It is not a governing decision document, not
a rollback menu, and not evidence for any milestone.

## Purpose

The repository changed its stack several times. Each turn had a recorded reason,
but the reasons live in separate ADRs, changelog sections and pull requests, so a
reader can mistake the sequence for drift. This page puts the turns on one line:
what the stack was, what replaced it, why, and where the record lives. Read it
before reopening a decision that has already been made.

## Eras and turns

| Era | Stack at the time | Turn | Recorded reason | Evidence |
| --- | --- | --- | --- | --- |
| Origin (HVL → KISS) | Deno-first, minimal dependencies | Renamed to KISS; early "subtraction audit" (tsup → Vite lib mode, 8 → 3 dependencies, pure ESM) | The project's founding instinct was subtraction: fewer dependencies, fewer concepts, standard runtime | early commits `9f7724c7c` (Deno migration), `ecc231af8` (subtraction audit), `89e9b4108` (rename KISS) |
| 0.41–0.43 | Deno, WC static-first fullstack, islands | "WC light fullstack, stable" | The 0.42 line froze the request-time application loop; 0.43 was the stable maintenance line | `CHANGELOG.md` 0.42 / 0.43 |
| **0.44-beta / 1.0.0-alpha.1 (2026-09-20)** | **Deno + first-party Lit renderer + Hono as a Framework Mode hard dependency + TSX→Part Program + class authoring** | New incompatible public baseline | The original "clean/light composition" landed here: Deno 2.9+ toolchain, `renderer: 'lit'` as a first-class mode (2026-09-16 amendment), Hono as the internal composition layer of the generated server entry (2026-09-16 amendment), TSX lowered to a Part Program | `CHANGELOG.md` 1.0.0-alpha.1; ADR-0152 amendments 2026-09-16 |
| **alpha.8 (2026-10-05)** | Deno → **Node/pnpm** | Platform migration | "A consumer requirement to install Deno no longer follows from how anything is built, and the starter … would make the framework the only reason a Node shop keeps a Deno install." Owner ruling 2026-10-03: remove Deno entirely | ADR-0161; `CHANGELOG.md` 1.0.0-alpha.8; #1509 / #1515 |
| **alpha.11 (2026-10)** | Hono hard dependency → **optional adapter** | Generated server entry composes on the internal WinterCG layer; `@openelement/router/hono` becomes opt-in | Remove the hard HTTP-framework dependency while keeping the `(request, next) => Response` authoring shape; Route Mode matching core stays independent of Hono | `CHANGELOG.md` 1.0.0-alpha.11; #1560 / #1571 |
| **2026-11-03 fourth pass** | class authoring + serialized Part Program → **Full TSX function components + explicit Signals + compiler-generated mount/claim/update/dispose** | Authoring model and execution model replaced | The class grammar admitted a single root, no fragments and no value-position JSX — "the wall the owner rejects"; the Part Program required a generic browser interpreter, which P2 prohibits. The independent OhMyLit initiative was terminated in the same focus decision | ADR-0173, ADR-0174; the retired 2026-11-03 architecture audit is recoverable at `826dead73:docs/architecture/alpha16-18-architecture-audit.md` |
| **2026-11-08** | first-party Lit renderer → **zero-compatibility retirement** | Lit renderer removed; only explicit Native Export / Island Boundary sites generate a Custom Element | "The earlier Lit retirement decision assumed a Web Component host could serve as the base of the whole rendering stack. That premise is wrong. A Custom Element cannot carry the scope a full-stack plus front-render model needs." Third-party Lit remains client-only interoperability | ADR-0152, owner ruling 2026-11-08 |
| 2026-11-10 | documentation governance rework | A hand-written `docs/TRUTH.md` was rejected in review and replaced by a generated current view (front matter + `docs/history.json` + `docs-index:check`) | A hand-maintained copy of facts the repository already owns is a second source of truth (P6) and drifted on landing | PR #1751, squash `960e78d5c`; `docs/adr/ADR-0175-…md` |

## What did not change

The same values survived every turn, even when the named technology changed:

- **One path, not two.** One client execution backend, one independent server
  rendering backend, one renderer, one authoring frontend. P5 and the fourth
  pass delete dual paths instead of maintaining them.
- **Minimal runtime, standard platform.** The runtime keeps only what cannot be
  generated; the platform contract (Custom Elements, Declarative Shadow DOM,
  `Request`/`Response`, `URLPattern`) stays the boundary.
- **Subtraction as the default move.** Platform catch-up review requires deleting
  framework code the platform has absorbed; replacements remove the displaced
  implementation.
- **Compile-time first.** A decision that can be made at compile time is not
  deferred to runtime (P1/P2).

## What was falsified

| Premise | Verdict | Recorded by |
| --- | --- | --- |
| Deno is a viable required toolchain for framework consumers | Falsified: the framework would be the only reason a Node shop installs Deno | ADR-0161 |
| Hono must be the framework's HTTP layer | Rejected as a hard dependency; kept as an opt-in adapter over a WinterCG-shaped internal layer | #1560 |
| A Custom Element can host a full-stack plus front-render model | Falsified: CE cannot carry that scope; only explicit export/island sites generate CEs | ADR-0152 (2026-11-08) |
| Class authoring + a serialized Part Program can express the target authoring model | Falsified on both grammar (single root, no fragments, no value-position JSX) and execution (generic interpreter) | ADR-0173, ADR-0174; retired audit at `826dead73` |
| Multiple products/renderers can share one line (e.g. OhMyLit, Lit renderer) | Terminated for product focus | ADR-0152; `README.md` "Accepted direction" |

## What the history implies

- **Rollback is not on the table.** Returning to Deno, first-party Lit, or Hono
  as the base would re-introduce premises this record marks falsified. The
  history is a guard against re-litigating them from memory.
- **The current architecture is the endpoint of the "one path" doctrine**, not a
  detour: Deno's web-standard cleanliness became Node + Web APIs; Lit's
  thinness became compiled output + a minimal runtime; Hono's lightness became
  Router-owned HTTP semantics plus an optional adapter.
- **The open problems are not the old stack choices.** They are (a) the weight
  of the build/evidence apparatus around the compiler, (b) whether the claim/SSR
  chain delivers its promised value, and (c) product positioning. Those are
  answered by evidence and product decisions, not by another stack turn.

## Evidence index

- ADRs: [ADR-0161](../adr/ADR-0161-node-pnpm-consumer-surface.md),
  [ADR-0152](../adr/ADR-0152-product-router-and-alpha-convergence.md),
  [ADR-0173](../adr/ADR-0173-component-execution-and-composition.md),
  [ADR-0174](../adr/ADR-0174-generated-code-runtime-and-compatibility.md),
  [ADR-0175](../adr/ADR-0175-alpha16a-m07-decisions-and-current-view.md);
  the superseded Deno decision is
  [ADR-0108](../legacy/adr/ADR-0108-deno-native-npm-distribution.md).
- Release records: `CHANGELOG.md` sections 1.0.0-alpha.1, 1.0.0-alpha.8,
  1.0.0-alpha.11, and 0.42/0.44.
- Pull requests: #1509/#1515 (platform train), #1557/#1571 (six-package line),
  #1560 (Hono optional), #1751 (documentation governance).
- Retired 2026-11-03 audit: recoverable from Git history with
  `git show 826dead73:docs/architecture/alpha16-18-architecture-audit.md`.
