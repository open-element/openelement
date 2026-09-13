# OpenElement WWW Design Direction

> Version: 5.0.0 · Date: 2026-07-13 · Status: required implementation truth

## Web Standards Lab

`www` is a dark, violet, cinematic product surface. It should make OpenElement
feel beautiful before it asks visitors to understand its architecture, then
prove that feeling with real browser primitives. `<open/>` is the primary mark;
`OpenElement` is the formal wordmark.

The first impression is high-end digital product design (70%) with precise,
inspectable technical instruments (30%). The site speaks in two voices:
JetBrains Mono for everything structural and Instrument Serif italic for one
accent phrase per composition. The site never uses stock imagery,
people, generic device renders, fake screenshots, video demos, Three.js, GSAP,
or a full-screen canvas as its content layer.

## Product truth

- Current product fact is the five-package surface and the published 0.41 line.
- Design language of record: v4 (mockups/v4/). The v2/v3 iterations and the
  legacy generate.mjs indigo pipeline are retired (2026-07-26); do not revive them.
- CJK rule: zh pages do not use the serif accent — Instrument Serif ships latin
  glyphs only, so Chinese display headlines stay in Mono. Adopting a CJK display
  serif (e.g. Noto Serif SC) is a separate, recorded decision if ever wanted.
- Home scenes show actual Custom Elements, DSD, islands and portable output.
- `@openelement/ui` is optional; site-only visuals remain in `www`.
- Blog and changelog are History; their archive copy is not a current design or
  product claim.

## Layout and page roles

| Surface                       | Required behaviour                                                       |
| ----------------------------- | ------------------------------------------------------------------------ |
| Homepage                      | Six-scene product film, real DOM first, native Web APIs as enhancement.  |
| Docs/API/Architecture/Roadmap | A short expressive hero followed by quiet, readable reference content.   |
| Guides/Blog/Changelog         | Reading-first material, shared dark material and restrained motion only. |
| 404                           | A concise `<open/>` recovery moment, never a dead end.                   |

The private page system contract is documented in
[specs/page-system.md](specs/page-system.md); the supporting layout rationale is
kept in [specs/page-architecture.md](specs/page-architecture.md). The page system
owns hero, reading shell, rail, section-frame and artifact geometry and is never
exported from `ui`.

## Motion and rendering

- CSS 3D, Scroll-driven Animations, WAAPI, View Transitions and
  IntersectionObserver are the default toolkit.
- One passive coordinator normalizes progress for browsers without native
  scroll timelines; it never intercepts scrolling.
- WebGL may render only delayed violet atmosphere/particles. It never owns
  text, controls, branding or product structure. CSS is its complete fallback.
- Prefer real components and semantic HTML. The first viewport is complete
  without JavaScript. `prefers-reduced-motion` receives a complete static
  storyboard rather than an empty animation shell.
- Desktop and mobile are separately composed. Do not scale a desktop timeline
  down into a narrow viewport.

## Quality gates

- Dark is the default brand theme; light is a complete violet daylight mode.
- New homepage interaction JS stays near 60 KB gzip. Atmosphere is lazy and
  non-blocking. No visible layout shift may be introduced by motion.
- Validate modern Chromium experience, Firefox/WebKit graceful fallback,
  keyboard navigation, focus, 200% zoom, touch, reduced motion, WebGL failure
  and context loss.
- Generated visual baselines are reviewed for desktop/mobile in both themes.

The detailed homepage storyboard and QA matrix are in `specs/cinematic-motion.md`.

## UI package boundary

The public UI package contains ten primitives: button, card, input, code-block,
badge, theme-toggle, callout, dialog, dropdown and tabs. An audited Open Props
subset feeds semantic tokens, shared recipes and then components. Modal and
step-card are retired; the daisy class sheet is not a public or internal layer.
