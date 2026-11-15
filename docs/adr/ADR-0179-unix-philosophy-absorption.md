# ADR-0179: Absorb the Unix philosophy by resolving its conflicts, not by citing it

- Status: ACCEPTED
- Date: 2026-11-14
- Owner ruling: 2026-11-14 (merge into the design constitution and eliminate the conflicts; a separate reference layer was rejected)
- Related: ADR-0177, ADR-0163

## Context

The Art of Unix Programming (TAOUP) was proposed for `design-principles.md` in
two shapes: a reference layer that cites it and declares "P1–P8 win", or
absorption into the principles themselves.

A reference layer fails the document's own test. `design-principles.md:11`
says amending it requires an ADR, so the layer would need one anyway; and a
cited rule that must be arbitrated on every use is a second standard wearing a
disclaimer. Two of TAOUP's rules are actively misread against this repository:

- **Rule of Silence** describes program *output*, not program *control flow*.
  Cited loosely, it appears to bless a code path that quietly skips work —
  which is exactly the #1794 defect (a `continue` that dropped a component
  while every gate stayed green).
- **Rule of Extensibility** explicitly refuses to license unneeded features,
  yet is routinely cited to keep extension points alive. P5 already takes the
  opposite side and cites "write code that is easy to delete, not easy to
  extend" as its reference.

Citing cannot fix either. Only rewriting can: the scoped meaning has to be the
constitution's own sentence.

## Decision

**D-1 — P5 absorbs extensibility as a format property.** P5 gains one clause:
formats grow by version number and self-describing clauses; an extension point
for a feature nobody needs yet is surface with no owner. This is the reading
TAOUP's own text supports, stated once, in the principle that already owns
deletion.

**D-2 — A new unnumbered section states output discipline.** *Output
discipline* sits after P8, beside the other unnumbered normative sections
("Accepted direction versus shipped capability", "Platform catch-up review").
It scopes the silence rule to stdout-as-data-channel and states the opposite
obligation in the same breath: a compiler that drops a diagnostic, or a check
that skips a file, has failed the reader; a check reports one line on success
and names path, line and expectation on failure.

**D-3 — TAOUP enters the P7 prior-art register.** The register is the working
list for review question four. TAOUP joins it as *process discipline* — small
parts, text channels, generation over hand-maintenance, fail loud — scoped by
P5 and by Output discipline. It does not join as a source of new principles.

**D-4 — No new principle, no new file, no numbering change.** P1–P8 keep their
identifiers; the front matter still reads "P1–P8"; the only files this decision
touches are design-principles.md, its Chinese twin (via D-1–D-3), and this ADR
— no new principle, no new file, no numbering change.

## Consequences

- "Silence" can no longer be cited to justify a silent skip, and "extensibility"
  can no longer be cited to keep an unused extension point. Both readings now
  contradict the constitution rather than appeal to it.
- Versioned, self-describing formats (CEM 2.1.0, the release-state record) are
  affirmed, not merely tolerated.
- Checks gain a stated output contract: one line when passing, path + line +
  expectation when failing. Existing checks already behave this way
  (`check-release-state-machine.ts` prints one summary line); the section makes
  it required rather than incidental.
- The document stays at eight principles. A ninth would have changed the
  identifier set that 3 ADRs and 11 documents cite.

## Compliance

- P6: one standard, not two. The absorbed clauses are the only statement of
  these rules in the repository; TAOUP is named as prior art, never as an
  authority.
- P5: the extensibility clause is stated inside the principle that owns
  deletion, so it cannot drift into a licence for surface.
- P7: the register entry answers question four with a named, bounded prior art
  rather than an unbounded book.

## Amendment (2026-11-15): authority-text corrections

This amendment records two corrections to text this decision owns. It is the
ADR instrument `docs/architecture/design-principles.md`:4 requires ("amending
it requires an ADR"); it introduces no principle, no file and no numbering
change, and it changes no normative P1–P8 clause.

### A-1 — the P6 example sentence described a mechanism #1470 removed

`docs/architecture/design-principles.md`:190-193 and its Chinese twin
`:159-162` carried the example "one protocol-level forbidden-sink predicate
serves the compiler, the client validator, and the server validator, **with a
drift guard on the serialized `DANGEROUS_KEYS` copy**". #1470 removed that
serialized copy; the predicate is now the single source, so the clause
described a guard over an artifact that no longer exists. The clause is
deleted. The normative P6 sentence and its Litmus question are unchanged.

This is a fact correction, not a relaxation: a second copy that no longer
exists cannot be "held to one owner", and keeping the sentence would have
taught readers to look for a guard that is not there.

### A-2 — D-4's file-scope sentence contradicted D-1–D-3

D-4 said "nothing outside this document and the ADR index changes" while
D-1–D-3 amend `docs/architecture/design-principles.md` and its Chinese twin.
The sentence is rewritten to name the files this decision actually touches
(design-principles.md, its Chinese twin, and this ADR) and keeps its operative
claims: no new principle, no new file, no numbering change.

### A-3 — deviations named here, not waived

`docs/architecture/design-principles.md`:16-19 makes an unnamed deviation a
defect to be reverted. Two deviations from this change set are named in this
record:

- **P6** — the constitution text and the D-4 sentence were edited before this
  amendment existed. This section is the naming; the correction is the record
  itself, in the amend-never-rewrite form of execution-plan §4.2/§4.3.
- **P8** — `html[data-theme]` had two writers (`www/public/theme-init.js` and
  `packages/ui/src/open-theme-toggle.tsx`). They are registered as one seam in
  `docs/architecture/seams.md`:101 and converged in this change set onto the
  single owner `packages/ui/src/theme-contract.ts`, with the pre-paint script
  generated from that module and the toggle delegating its document write to
  it. The retirement condition for the generated artifact lives in
  `docs/architecture/seams.md`; there is no waiver.

- Recorder: PR #1804 (`fix/taoup-remediation`)
- Basis: `#1470` (predicate consolidation), PR #1804 head SHA, and the
  `docs/adr/ADR-0163-seam-single-ownership.md` precedent
- Owner sign-off: ____________________ (date: __________)
