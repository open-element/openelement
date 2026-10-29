# DX-02 — Browser automation for timing / morph / preserve / 390px / keyboard

Candidate: `ef5da43e45d887b214841a99c26d3f8d2dac358b` (branch `alpha15`).
Recorded 2026-10-19 from the repository root.

This document is the runbook for the DX-02 suite, and it is explicit about one
boundary: **browser automation is not screen-reader testing.** Everything below
asserts DOM, geometry, computed style and event behaviour in a real engine. It
cannot prove what a screen reader announces, in which browsing mode, with which
speech settings. Screen-reader verification remains a **manual** acceptance step
(see the alpha16 A11Y-01 item; it is not replaced by this suite).

## 1. What was already automated, and what DX-02 added

| checklist area | already automated (not duplicated) | gap DX-02 fills | new automation |
| --- | --- | --- | --- |
| timing (计时) | `cinematic-home.spec.ts` scroll-timeline/marquee timing; `search.spec.ts` lazy island-chunk gating; `performance-budget.spec.ts` load budgets | the static-first timing boundary — island chunks are a load-time concern, never a document dependency — was documentation advice, not an executable assertion | `www/e2e/dx02-browser-contracts.spec.ts` → "the page is complete and its links usable with every island chunk blocked" |
| morph | `app-flow.spec.ts` enhanced 422 re-render + PRG target; `enhance-guards.spec.ts` interception guards; `router-lit-framework/e2e/continuation-regression.spec.ts` morph failure paths | a PRG redirect's in-place morph proven not to reload (window state survives the URL change) | `tests/fixtures/router-native-framework/e2e/dx02-morph-preserve.spec.ts` → "a valid submit morphs into the created note without a full reload" |
| preserve | `hydration-behavior.spec.ts` SSR-node identity across activation/reconnect; router unit `morph-align.test.ts` | the `data-open-preserve` exemption had no e2e proof, and there was no positive control showing the same morph updates the same node when the attribute is absent; node identity/control-state/focus across a 422 morph were untested in a browser | same native spec → "the exempted subtree is untouched while the same morph updates its sibling", "positive control: without the attribute the same morph DOES update the node", "an id-matched control keeps its node, typed value and focus" |
| 390px | `page-structure.spec.ts` long-form routes do not scroll horizontally at 390px; `site-shell-behaviors.spec.ts` mobile disclosure by pointer; `accessibility-performance.spec.ts` 390px contrast | the home page's 390x844 geometry (document scrollWidth, heading inside the viewport, desktop nav replaced by the disclosure) was not pinned | `www/e2e/dx02-browser-contracts.spec.ts` → "home does not scroll horizontally and its heading stays inside 390x844" |
| keyboard-only | `ui-behaviour-matrix.spec.ts` real Tab path + focus rings on `/contributing` components; `search.spec.ts` keyboard search; `accessibility-performance.spec.ts` delegatesFocus capability | site-chrome Tab path (skip link, brand, primary nav, locale switch, search trigger, theme toggle, repository link) and the 390px documentation disclosure were not driven by a real keyboard | `www/e2e/dx02-browser-contracts.spec.ts` → "every chrome stop of the real Tab path paints a visible, unclipped ring", "the skip link moves focus to the main landmark", "opens from the keyboard and its first link is reachable and activatable" |

The morph/preserve half lives in the native fixture because that is where the
enhance client's morph contract is exercised; the site has no enhanced forms.
The timing/390px/keyboard half lives on the built site because those are
properties of the Site's own chrome.

## 2. How to run each project locally

Browsers are installed once per checkout:

```sh
pnpm exec playwright install --with-deps chromium firefox webkit
```

### Site (`www`) — timing, 390px, keyboard

Prerequisite: a **built** site (`www/dist`). The suite runs against the static
server, never `vite dev`.

```sh
# full build (the Lead runs this at consolidation; it also regenerates site data)
pnpm run site:build
# or, when www/dist is already current:
pnpm --dir www run build

# the DX-02 spec, one engine:
cd www && pnpm exec playwright test \
  --config e2e/playwright.config.ts e2e/dx02-browser-contracts.spec.ts \
  --project=chromium --retries=0

# all three engines:
cd www && pnpm exec playwright test \
  --config e2e/playwright.config.ts e2e/dx02-browser-contracts.spec.ts \
  --retries=0

# the whole site suite (this is what CI runs):
pnpm --dir www run e2e:browsers
```

### Native fixture (`tests/fixtures/router-native-framework`) — morph, preserve

Prerequisite: a built fixture (`tests/fixtures/router-native-framework/dist`).

```sh
pnpm --dir tests/fixtures/router-native-framework run build

pnpm --dir tests/fixtures/router-native-framework exec playwright test \
  --config e2e/playwright.config.ts e2e/dx02-morph-preserve.spec.ts \
  --project=chromium

# three engines (the fixture gate's own command):
pnpm --dir tests/fixtures/router-native-framework run e2e:browsers
```

Both suites run with `retries: 0`: a failure is a failure, not a retry to
absorb (the site-e2e CI wrapper owns its own one-retry policy for the full
site proof; these local commands pin the spec's own behaviour).

## 3. Which CI leg covers which file

| file | CI job / leg | command |
| --- | --- | --- |
| `www/e2e/dx02-browser-contracts.spec.ts` | PR push layer: job `e2e` (chromium) | `vp run --no-cache --fail-if-no-match --filter @openelement/www e2e:chromium` |
| `www/e2e/dx02-browser-contracts.spec.ts` | main-push/release layer: job `e2e-full`, leg `site-e2e` (chromium+firefox+webkit) | `vp run --no-cache --fail-if-no-match --filter @openelement/www e2e:browsers` |
| `tests/fixtures/router-native-framework/e2e/dx02-morph-preserve.spec.ts` | main-push/release layer: job `e2e-full`, leg `fixture-gates` (three engines via the fixture gate) | `vp run --no-cache --fail-if-no-match --filter @openelement/fixture-router-native-framework gate` |

The workflow is `.github/workflows/autoflow-ci.yml` (see its `e2e` and
`e2e-full` jobs). The site-e2e leg also writes the candidate sidecar
`.artifacts/site-e2e-result.json`; the new spec runs inside that same
three-engine proof, so no workflow change is needed for it.

## 4. Verification evidence from this lane

Commands were run against the existing build outputs in this worktree
(`www/dist`, `tests/fixtures/router-native-framework/dist`) with `retries=0`.

| command | result |
| --- | --- |
| `www`: DX-02 spec, `--project=chromium --retries=0` | 5/5 passed |
| `www`: DX-02 spec, `--project=firefox --retries=0` | 5/5 passed |
| `www`: DX-02 spec, `--project=webkit --retries=0` | 2/5 asserted + 3 N/A annotations (see below) |
| native fixture: DX-02 spec, `--project=chromium` | 4/4 passed |
| native fixture: DX-02 spec, `--project=firefox --project=webkit` | 8/8 passed |

### The macOS WebKit N/A rows, stated out loud

The local WebKit build is the macOS Playwright WebKit, whose default Tab path
visits `[tabindex]` elements and disclosure summaries but **no authored links**.
On that build the three keyboard rows record an `N/A` annotation plus the
capability assertion (the walk reached no `<a>`), exactly the convention
`ui-behaviour-matrix.spec.ts` already uses for the same engine limitation. They
are not skipped: CI's WebKit engine is the Linux build, where the Tab path
reaches links, so the full ring/skip-link/disclosure assertions run there. The
two 390px/timing rows run and assert on macOS WebKit normally.

Logs from this lane (scratch, not committed): `/tmp/cli-tests/`. The commands
above are the reproducible form; the accepted evidence is the CI run on the
consolidated candidate.

## 5. What this suite does NOT prove (screen-reader boundary)

Automation cannot substitute for manual screen-reader verification. In
particular this suite does **not** prove:

- what NVDA/JAWS/VoiceOver/TalkBack announce for a control, or in which order;
- accessible name/description computation as an assistive technology consumes
  it (Playwright role locators read the accessibility tree, but that is not a
  screen reader utterance);
- live-region announcement timing or interruption behaviour;
- reading order under virtual-buffer navigation, or braille output.

The ARIA/DOM contract is automated here and in the axe gate
(`accessibility-gate.spec.ts`); the spoken result is a manual acceptance item.
