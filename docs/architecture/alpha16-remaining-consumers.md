---
status: historical
topic: Alpha16 remaining consumer surface (2026-11-18 snapshot — CLOSED)
summary: Measured map of the class-lane modules left in the production apps at 87d83d095 and the ONE design decision each needed. Every entry has since migrated or retired; the header banner maps each one to its outcome. Preserved as the 2026-11-18 record, not as current state.
---

# Alpha16 remaining consumer surface — measured map (2026-11-18, @87d83d095)

> ## ⚠️ This map is CLOSED. Read it as history, not as current state.
>
> Every module it lists has since migrated or been retired (measured
> 2026-11-20 at `a112b3481`):
>
> | module | this map said | today |
> | --- | --- | --- |
> | `open-standards-visual` | "inline the computed → migrate NOW" | **migrated** — `extends OpenElement` = 0 |
> | `open-page-rail` | "strings must become declared rows" | **retired** — the file is gone |
> | `open-reading-shell` | "21 `computed`, collapse or inline them" | **migrated** — = 0 |
> | `open-article-view` | "the body must stop being a runtime string" | **retired** — the file is gone; the article routes inline the shell |
> | `open-artifact-panel` | already migrated | = 0 |
>
> Application-wide class-lane surface after that work: **0 authored
> `@element`/`extends OpenElement` across `www/app`, `apps/saas/app`,
> `packages/ui/src` and `packages/create/templates`. What remains in the repo is
> 82 class-lane contract test files, 8 migratable fixtures, and one benchmark
> input — all named with their conditions in
> [`alpha16-closeout-report.md`](./alpha16-closeout-report.md) §5.1.
>
> This banner exists because the map's own topic line ("remaining") is the kind of
> claim that rots silently, and a reader who found it first would plan work that is
> already done. The body below is preserved verbatim as the 2026-11-18 record.

Every remaining class-lane module and the ONE design decision each needs.

## Already migrated (12)
ui: open-theme-toggle, open-code-block, open-dialog, open-dropdown, open-input, open-button
www islands: open-cinematic-scroll, open-dragon-live-gaze, open-hero-polish, open-search
www site-ui: open-artifact-panel
saas islands: notes-live

## www/app/site-ui — 4 modules remaining (5 measured minus open-artifact-panel, migrated)

| module | blocker | decision needed |
| --- | --- | --- |
| open-standards-visual | 3 declared rows, 1 `computed` | inline the computed → migrate NOW |
| open-page-rail | app-local `readingChromeStrings` called in JSX child + attribute (OEC9043) | strings must become declared rows or be inlined |
| open-reading-shell | **21 `computed`, ZERO `trustedHtml`** (measured 2026-11-18); hosts 4 child components | computed support: collapse the 21 rows or inline them. No transport work is useful |
| open-article-view | **6 `computed`, ONE `trustedHtml` sink** (measured 2026-11-18), receives the article `model` | the body must stop being a runtime string (removes the row and its sink) — or it stays class-lane |
| open-artifact-panel | MIGRATED at `0a1aad095` (2026-11-18) | removed from the remaining set |

## www/app/islands — 0 modules
open-search MIGRATED at `37effae9c` (2026-11-18): the compiler-owned view island now
runs on `@openelement/element/lifecycle`; the Zag combobox controller stays a
site-UI collaborator read at event time, which the lane admitted. Kept here as
history of the last measured blocker.

## www/app/components/article-routes — 40 generated modules
All are `generate-site-article-routes.ts` output: one `model` row + `locale`,
rendering `<open-article-view model={...} locale={...}>`. They are MECHANICAL
once `open-article-view` migrates — and they are generated, so the generator is
the one place to change.

## www/app/layout.tsx
Class shell hosting every page; 0 `computed`, no trustedHtml. Its own tag is the
router constant, not an island. Migrating it requires the tag-source decision
already recorded.

## saas
No class islands remain.

## Order this implies
1. open-standards-visual + open-artifact-panel (clean, no design decision)
2. the tag-source decision (unblocks layout + non-island page-local components)
3. the app-local-value decision (unblocks rail + search)
4. computed support for the generated lane (unblocks reading-shell), and a
   non-runtime body shape for article-view — NOT a trustedHtml transport, which
   was ruled out on 2026-11-18 (see 16b-migration-note.md)
5. then M10 P1 flips as a consequence, and P2-P5 record it
