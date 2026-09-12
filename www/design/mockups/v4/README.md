# Design language v4 — View-Source Editorial, Squared

V4 keeps the v3 philosophy (kinetic two-voice type, outlined indices, one
violet flood per page, standards marquee, spec annotation system) and fixes
its geometry and its honesty. Two review findings drove it:

1. **Elliptical controls are retired.** The pill look came from the token
   layer itself — `open-props-tokens.css` set `--btn-radius` and
   `--badge-radius` to `--radius-round`. Both are now `--radius-1` (6px), so
   every button and badge in every consumer squares up from one edit. Cards
   already used `--radius-1`; terminals and callouts use `--radius-2` and the
   left-bar pattern.
2. **Nothing in these mockups is hand-drawn.** Every element maps to a
   shipped `@openelement/ui` component and open-props tokens (the mapping
   table lives in `v4-14-design-system`). Hero artifacts are real product
   markup, not decorative diagrams; the site must be buildable from its own
   framework — that is the dogfood discipline.

Files (SVG source + rendered PNG, 1440px wide unless noted): the same
fourteen templates as v3 — `v4-01` homepage hero, `v4-02` homepage fullpage,
`v4-03` docs landing, `v4-04` guide page, `v4-05` architecture,
`v4-06` apilist, `v4-07` roadmap, `v4-08` changelog, `v4-09` blog index,
`v4-10` blog post, `v4-11` contributing, `v4-12` 404, `v4-13` mobile home
(900×960), `v4-14` design system (rules + component mapping).

Geometry contract:

- Buttons/badges/stamps: `--radius-1` (6px). No `--radius-round` anywhere.
- Panels/cards: `--radius-1`; code/terminal frames and callouts:
  `--radius-2` (8px) with the top edge-highlight or left bar.
- Diagram nodes (timeline, package graph): squares, not circles. The only
  circles left in the system are terminal traffic lights (OS convention).

`v4-14-design-system` is the rules sheet of record. The v2/v3 iterations and
the legacy generate.mjs indigo pipeline were retired on 2026-07-26; v4 is the
only maintained mockup set.

CJK rule: zh pages render the serif accent only when the accent phrase itself is
latin. Chinese display headlines stay in JetBrains Mono — Instrument Serif ships
latin glyphs only, and falling back to a random system serif is worse than not
using one. If a CJK display serif is ever wanted (e.g. Noto Serif SC), that is a
separate recorded decision with its own token and licensing review.
