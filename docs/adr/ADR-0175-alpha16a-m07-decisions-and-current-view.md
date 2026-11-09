# ADR-0175: Alpha16a M07 claim behavior decisions and the document current view

- Status: ACCEPTED
- Date: 2026-11-10
- Owner ruling: 2026-11-10 (physical separation of active and retired documents; M07 claim-failure retry; mount-only marker suppression)
- Related: ADR-0173, ADR-0174

## Context

The main line carried several superseded readings of the same Alpha16a decisions
beside their successors, so every session had to re-adjudicate which text was in
force. The owner ruled physical separation on 2026-11-10. A first revision
proposed a hand-written `docs/TRUTH.md` current-read entry; review rejected that
shape, because a hand-maintained copy of facts the repository already owns is a
second source of truth and violates P6, and it drifted on the day it landed (an
independent audit found 24 active documents missing from its table and three of
its own statements false at its head).

## Decision

**D-1 — M07 claim failure allows bounded retry (behavior).** A failed claim must
release the reservation, roll back committed range tombstones and the success
cursor, and release owners/cleanups, so the same parent can be claimed again.
Borrowed SSR nodes are never deleted; whole-claim byte restoration remains out of
scope.

**D-2 — Suppress mount-only markers (behavior).** The generator must emit
`oe:r:` / `oe:/r:` marker pairs only when a claim function is emitted for that
tree, so a pure-mount tree carries no inert comment nodes. The marker/seed
private contract stays OPEN until M08 introduces a real SSR producer. The
current bounded M07b extension still emits mount-only markers (recorded in
`alpha16-18-progress.md` M07); closing that gap is this decision's
implementation.

**D-3 — One current view by physical separation (governance).** The authority is
the record, the view is generated:

- every governing document in `docs/architecture/` (and `docs/agent-contract.md`)
  carries its own front matter — `status: active | historical`, `topic:`,
  `summary:`; the zh twin carries `translation_of:`;
- ADRs keep their own `- Status:` banner and the `docs/adr/README.md` registry,
  enforced by `adr-index:check`;
- documents that leave the tree are registered in the append-only
  `docs/history.json` (path, date, what it carried, where that responsibility
  lives now, and the pre-change recovery path);
- the current view is generated: `docs/architecture/README.md` (the in-force and
  historical index) and `docs/legacy/README.md` (the archive and removal
  register) are rendered from those authorities by
  `@openelement/tools-repo#docs-index:write` and byte-checked by
  `docs-index:check`, which rides `gate:source`, the CI lint governance step and
  the pre-push hook;
- there is no hand-written current-truth document. A second active statement of
  a topic is a gate failure, not a second opinion.

## Consequences

- The Alpha16a current-read entry is `docs/architecture/README.md` (generated
  view) plus the ADR registry and the archive register; the repository has no
  `docs/TRUTH.md`.
- D-1 and D-2 are approved targets: their implementation and fixed-SHA evidence
  land with the M07 bounded-recovery slice (M07-4) and the M07 protocol record
  (M07-5), not in the change that recorded this ADR.
- A document deletion or archive move that is not registered in
  `docs/history.json` fails a gate; a hand edit of a generated index fails a
  gate; a governing document without front matter fails a gate.
- No product source, ABI, release state, version, tag or publication is affected
  by this ADR. Alpha16a creates no version, tag or publication claim.
