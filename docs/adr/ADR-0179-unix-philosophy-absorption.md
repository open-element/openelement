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
identifiers; the front matter still reads "P1–P8"; nothing outside this
document and the ADR index changes.

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
