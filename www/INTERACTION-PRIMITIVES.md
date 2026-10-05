# Interaction-primitive decisions — the official Site (alpha9 C4, #1507)

One page, four verdicts. The umbrella ruling this site builds under: **native
platform primitives first; Zag owns state-machine semantics only; Floating UI
owns positioning only; static markup ships zero client JS.** Every interactive
surface on the site must name which verdict it falls under, and the verdicts
do not relitigate per feature.

## The four-way split

| Verdict | Owns | Does NOT own | Site instances |
| --- | --- | --- | --- |
| **Native-first** | Semantics the platform already ships: links, buttons, `details`/`summary`, `dialog` semantics via ARIA on the static markup, `:focus-visible`, scroll anchoring, view transitions | Anything needing a state machine beyond the UA's | Skip-link (`.skip-link` → `#main-content`, open-layout), disclosure rail (`<details>` in open-page-rail), heading anchors, theme toggle's `aria-pressed` surface |
| **Zag = state machine** (`@zag-js/combobox` + `@zag-js/vanilla`, pinned 1.43.3) | Keyboard traversal (arrows/Home/End/Enter/Escape), the ARIA graph (`role=combobox` input, `role=listbox` results, `aria-activedescendant`, `aria-expanded`, `aria-autocomplete`), open/close/highlight state, the live-region announcements | DOM ownership (the compiled island keeps rendering its declarative markup), the dialog-level modal state, styling | `open-search` — the one island that was already an island (static components gain no new mandatory client JS) |
| **Floating = positioning** (`@floating-ui/dom`) | Popup geometry only: anchor, placement, same-width, strategy | Visibility, focus, semantics — and on this site it runs *through* Zag's `positioning` channel (`@zag-js/popper` wraps Floating UI), so there is exactly one positioning brain, not two | The search results popup (bottom-start of the control row, fixed strategy, offset 6) |
| **Static = zero JS** | Everything whose behavior is CSS or markup | Any runtime | Cinematic hero, scene reveals (scroll-timeline, CSS only), page cards/tables, all `@openelement/ui` recipe components (DSD shadow, styles compiled at build) |

## Per-primitive decisions

### Search (`open-search`) — Zag + Floating, inside an existing island

- The combobox machine resolves its elements through `getRootNode: () =>
  host.getRootNode()` — the island compiles with the light root (the
  `@element` default), so element ids are document-scoped; the fixed id set
  lives in `open-search-controller.ts` (`IDS`) and in the static markup.
- **The DOM input owns its value.** The machine's `inputValue` lags the
  browser's insertion by one microtask, so the sync never re-applies the
  `value` prop (`delete inputProps.value`) — re-applying it wiped the
  character the user just typed. Every other prop (role, aria, listeners)
  comes from the machine; `closeSearch` clears the field explicitly.
- The dialog (overlay + panel, `role=dialog` `aria-modal`) is the
  controller's modal state, not the machine's; opening the dialog opens the
  combobox so the guidance message shows before the first keystroke.
- Focus trap: the dialog's single tab stop is the input (options are
  `aria-activedescendant` targets, not stops), so the global keydown wraps
  `Tab` with `preventDefault` while the dialog is open.
- Reconnect safety: the compiled runtime re-claims its SSR markup when the
  host re-connects and fails closed on any attribute the program does not
  declare. Teardown therefore strips every machine-written attribute
  (`wiring.touched` snapshots pre-machine attribute names) and
  `spreadProps` cleanups remove the machine's listeners.
- The results are real anchors (`role=option` on `<a href>`): pointer clicks
  navigate natively, and Enter walks the machine's default `navigate`
  (`clickIfLink`) — one navigation path, shared.

### Focus management — native-first

- **Site-wide `:focus-visible` baseline** (site-css.ts): one ring shape —
  `2px solid var(--color-ring)`, offset 2 — for every light-DOM focusable
  (document links, search trigger/input). Shadow components carry the same
  pair in their own sheets (page-styles seats it per page tag; article-body
  for prose links); custom properties inherit across the shadow boundary, so
  the ring role is the single indicator token in both themes. forced-colors
  remaps the ring to `Highlight`.
- **Skip link**: pre-existing (`.skip-link` → `#main-content` with
  `tabindex="-1"` on the main landmark, open-layout) — kept as the native
  anchor it is.
- **Search dialog trap**: one `preventDefault` on `Tab` (above) — no focus
  looping library; the trap is single-stopper by construction.

### Theme, disclosure, cinematic surfaces — static = zero JS

The theme toggle is a ui-package DSD component (recipe styles, no new
runtime); the reading rail's mobile outline is `<details>/<summary>`; the
homepage hero and scene reveals are CSS scroll/time timelines with a
`prefers-reduced-motion` full-disable. None of these may grow a client-side
state machine — a behavior they cannot express in CSS/markup is the threshold
for promoting a surface to an island (search is the only one so far).

## Gates

- `www/e2e/search.spec.ts` — the keyboard/ARIA contract: arrows move
  `aria-activedescendant`, Enter navigates to the highlighted hit, roles and
  names (`combobox` "Search documentation", `listbox` "Search results",
  `dialog` "Search") are pinned.
- `www/e2e/accessibility-gate.spec.ts` — the resident axe scan (WCAG 2.1
  A+AA) over every template-representative route, in the e2e:browsers chain.
- `www/e2e/accessibility-performance.spec.ts` — the settled contrast pairs
  (canvas-based sRGB read; the token table computes to oklch).
