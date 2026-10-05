# ADR-0163: Seam single ownership — constitution amendment P8 and the seams registry

- Status: ACCEPTED (constitution amendment; P8 is normative in
  [design-principles.md](../architecture/design-principles.md))
- Decided: 2026-10-05, after the alpha.9 post-release audit
- Origin: issue #1538

## Context

The alpha.9 post-release audit surfaced eight defects. Their common shape is
the finding: every one of the eight grew at a boundary with ambiguous
ownership — no named writer, so a second writer appeared and the two sides
drifted silently.

1. **Positioner styles, search combobox.** zag-js popper writes the
   positioner's static shell through `getPositionerProps()` while also
   writing `--x` / `--y` / `--reference-width` / `--z-index` imperatively
   into the same `style` attribute. The site layer replaced the attribute
   wholesale and erased the imperative half, invalidating the open-time
   transform (fixed in `c3e186ddf`; geometry locked in
   `www/e2e/search.spec.ts`).
2. **Color truth, two copies.** Site-facing colors could be authored beside
   the `packages/ui` theme role table instead of derived from it.
3. **Preset build-stage artifacts.** A stage outside the inner `vite build`
   re-derived artifacts the build already owned (guard lane: #1535).
4. **Tailwind output grammar.** Templates and runtime consumers assumed a
   class grammar owned by the Tailwind compiler (guard lane: #1536).
5. **Template ↔ repo hygiene knowledge.** The router's head convention
   writes `.openElement/` into consumer projects; the starter's `.gitignore`
   did not know it (fixed in `05ae31687`).
6. **Version task ↔ workspace root.** The stamp surface of the version-bump
   task spans the workspace root and every member manifest; an untested
   edit point drifts silently.
7. **Island host ↔ runtime lifecycle.** The handoff between host element
   and runtime controller across a runtime swap (guard lane: #1531).
8. **Modal declaration ↔ runtime readiness.** The handoff between the
   declarative modal and the controller's open sequence (guard lane: #1533).

P6 already forbids second sources of truth, but it speaks about data at
rest. All eight defects are about writers in motion: the copy was not the
root cause — the unnamed owner was. R1 (one writer per boundary) and R2
(what crosses a boundary is derived) are case-law extensions of P6; R3
(every seam carries a standing consumer-form test) is new institutional
surface. The constitution's preamble requires amendments to travel as an
ADR; this is that ADR.

## Amendment

[design-principles.md](../architecture/design-principles.md) gains **P8 —
Seam single ownership**:

> Every seam — a boundary where one system writes what another system
> reads — names exactly one owner. What crosses a seam is derived from the
> owner's truth, never maintained as a second copy. Every seam carries a
> standing consumer-form test: a test written the way the downstream side
> consumes the boundary, which fails when the two sides drift.
>
> This principle is repo-internal case law, established after the alpha.9
> post-release audit: eight defects, every one rooted at a boundary with
> ambiguous ownership — two style writers on one attribute, two color
> truths, two build stages, template-versus-repository knowledge,
> task-versus-root scope, two lifecycle handoffs. The first two clauses
> extend P6 from sources of truth to writers of truth; the third is new
> institutional surface.
>
> In this repository: the seams registry ([seams.md][seams]) lists each
> live seam with its owner, direction, crossing artifacts, and guard test.
> Where a crossing artifact cannot yet be derived, the emergency form is a
> drift guard over the copy with a written retirement condition (P5); the
> guard is temporary by intent, as in P6.
>
> Litmus: _Does this boundary have exactly one writer, and would its
> consumer-form test catch a second?_

P6 gains one cross-reference sentence; the [zh
mirror](../architecture/design-principles.zh.md) gains the same section in
Chinese. [docs/architecture/seams.md](../architecture/seams.md) is the live
registry; its initial eight rows are the audited seams above. The review
gate in `AGENTS.md` requires a registry row plus a consumer-form test for
any change that touches or adds a seam.

## Mechanization path

Compliance lands in two forms, in order:

1. **Emergency form (now).** Where a crossing artifact cannot yet be
   derived, hold the seam with a drift guard over the copy — the P6 shape —
   plus the standing consumer-form test. The guard is temporary by intent
   and its retirement condition is written down.
2. **Structural form.** Retire the copy by making the crossing artifact
   derived. Written retirement conditions:
   - **Preset artifacts are emitted directly by their single owner** (the
     inner `vite build`); every later stage consumes them and never
     re-derives them. When that holds, the preset seam's guard copy is
     deleted.
   - **The color scope is sealed**: role tokens resolve only from the
     `packages/ui` `theme.css` role table, enforced by
     `@openelement/www#check:theme-tokens`. When authoring outside the
     table is impossible, the parallel color copies are deleted.

## Consequences

A change that touches or adds a cross-system seam passes the gate only with
a registry row and a consumer-form test. An unnamed second writer on a
registered seam is a defect under the comply-or-explain rule and is
reverted like any unnamed deviation.
