# Web Standards Lab page system

This is the implementation contract for every current, non-history page.

## Page types

| Type      | Shared structure                            | Motion                | Evidence                                         |
| --------- | ------------------------------------------- | --------------------- | ------------------------------------------------ |
| Technical | `open-page-hero` technical + section frames | One restrained reveal | package graph, code, route, or capability matrix |
| Editorial | editorial hero + reading shell              | Reading-first         | date, tags, related material                     |
| Timeline  | timeline hero + reading shell               | Static chronology     | release state and evidence                       |
| Error     | error hero                                  | None required         | requested path and recovery action               |

`open-page-hero` has exactly four variants: `technical`, `editorial`, `timeline`, and `error`.

## Private structural interfaces

All of these are private to `www/site-ui`; no package export may expose them.

- `open-reading-shell` owns article width, metadata, the rail region and deterministic previous/next navigation.
- `open-page-rail` receives serialized, route-declared outline items. It SSR-renders the complete anchor list. IntersectionObserver only adds the current-section state; a `<details>` disclosure is the narrow-screen fallback.
- `open-section-frame` owns section number, title, explanation and evidence slot.
- `open-artifact-panel` is the sole shared technical-evidence panel.

Page routes declare content and outline data. They do not attach global scroll listeners, control navigation, or create one-off hero/rail/panel shells.

## Accessibility and motion

The shell provides headings, landmarks, keyboard-visible focus and 1.7 reading line-height. Motion is limited to low-amplitude entry/reveal and browser View Transitions. The static composition remains complete with reduced motion, absent View Transitions or absent IntersectionObserver.

## Visual regression policy

Chromium PNG baselines are version-controlled for `/en/` and `/zh/`, desktop and mobile, dark and light. They cover the home page, entry pages, architecture, guides, blog, changelog, contributing and 404. A baseline update is an intentional visual change and must accompany the implementation that causes it. Firefox and WebKit remain functional/browser-compatibility gates rather than image-pixel baselines.
