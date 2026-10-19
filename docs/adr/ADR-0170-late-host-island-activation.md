# ADR-0170: Bounded late-host island activation and its give-up announcement

- Status: ACCEPTED (implemented: `packages/router/src/vite/internal/ssg/island-scheduler.ts`)
- Decided: 2026-10-18 (alpha15 T8 lane; the decision record with the owner's
  G1 approval is `docs/release/late-host-island-activation-design.md`)
- Preserves: ADR-0163 (P8 — this ADR registers the one new public seam and
  names its single writer). Does not modify ADR-0143/ADR-0148 (Part Program
  compilation) or ADR-0158/ADR-0159 (streaming claims): this is a scheduler
  activation probe, not a streaming or claim path.
- Related: KR-17 (retired by this work), #1544/B2 follow-up, `open:ready`
  semantics (unchanged).

## Context

The B2 page-scope gate decides, at module evaluation, which declared islands
have a host on this page and which chunks to activate. That single read is
correct for hosts that exist when the module runs. It is wrong for a host that a
third party creates later — inside its own OPEN shadow root, or appended to the
light DOM after its async chunk lands — and on a page that has neither enhanced
forms nor a `client:visible` island there is no post-morph rescan to provide a
second look at all. The island then never registers: the factory stays in the
map and the page silently loses the behavior.

The third-party interop fixture pinned exactly that (`missing=wc-open-child` on
the pre-fix tree and on a published alpha.14 scaffold). The defect is generic:
any application whose third-party component creates an openElement island host
inside its own open shadow root is affected, and nothing about the fix may be
specific to one component library.

The design record (`docs/release/late-host-island-activation-design.md`) carries
the alternatives (unbounded MutationObserver, per-library adapters,
fixture-only workarounds), the G1 decision points, and the confirmed deviations
D-1…D-4. This ADR records the decision itself and the governance facts a future
maintainer needs: why the cost is runtime, why its budget is bounded, what
proves "no host ⇒ no fetch", how it is deleted, and who owns the seam.

## Decision

1. **A bounded late-host probe owned by the island scheduler.** While this page
   still carries a declared island factory that nobody has consumed, the
   scheduler re-asks the composed tree for those tags and hands any hit to the
   EXISTING visibility rescan. One fused traversal covers the whole pending set
   (one tag-selector query plus one `*` query per visited root, descending
   through `shadowRoot`), so one probe costs about one ready-time gate call
   rather than one per pending tag.
2. **The budget is a contract, not a tuning knob.** At most six attempts per
   window with delays `[0, 25, 100, 250, 750, 1500] ms`, a 3000 ms window, at
   most three windows renewed only by island-load activity, and a 9000 ms
   absolute cap (at most 18 fused walks per page). At most one timer is ever
   outstanding; a page with nothing pending schedules no timer at all. Zero
   observers are installed.
3. **The probe adds no activation authority.** It only answers "is a host
   present now" and calls the same rescan; `load()`'s host gate remains the one
   and only activation decision. A page with no host therefore fetches nothing
   **by construction**, not by a second check that could drift.
4. **A give-up announcement, not a drop.** When the budget is spent with
   factories still unconsumed the scheduler dispatches one informational
   `CustomEvent('open:island-host-timeout')` on `document` with
   `detail: { pending, attempts, elapsedMs }`. It fires at most once per
   document evaluation. The factories stay in the map, so a later media change
   or post-morph rescan still activates them. The event is never an error by
   itself: an application may legitimately declare islands a page never hosts.
5. **Closed shadow roots remain unsupported and documented.** The platform
   exposes no enumeration of closed roots and OpenElement does not patch
   `attachShadow`. The probe's descent stops silently at a closed root, the
   unconsumed factory stays in the map, and the give-up event names the tag. No
   error is raised; the missing capability is stated in the integration guide.

## Four-question review (P7)

1. **Platform capability (P1).** The probe is a plain composed-tree read
   (`querySelectorAll` + `shadowRoot`), `setTimeout`, and a `CustomEvent` — all
   platform primitives. No observer polyfill and no `MutationObserver` is
   introduced: a `MutationObserver` cannot solve this problem (an
   `attachShadow()` call produces no mutation record, and closed roots are not
   observable), and an unbounded document-wide observer would add global wakeup
   cost and permanent references.
2. **Compile time (P2).** The build already prunes delivery to the page's
   declared island manifest, but the existence of a host created later by a
   foreign runtime is not a build-time fact. Any compile-time emission would
   still have to answer the runtime question "did someone create this tag
   after the module ran", so the cost is genuinely runtime. It is bounded and
   only paid while a declared factory is unconsumed.
3. **Runtime shape and the server contract (P3).** Client-only; no server
   surface, no WinterTC contract and no HTTP behavior is touched. The event is
   the same document-level `CustomEvent` shape as `open:ready`.
4. **Nearest prior art, and the deliberate difference (P7.4).** The nearest
   mature prior art is (a) custom-elements polyfill / native "upgrade when
   defined" behavior, which upgrades a host nothing needs to discover, and
   (b) lazy-hydration libraries that install a document-wide
   `MutationObserver` to find late hosts. Our difference is deliberate: the
   scheduler owns a fixed-budget probe of the composed tree instead of a global
   observer, the probe reuses the existing activation path instead of adding a
   second one, and a spent budget produces an observable informational event
   instead of a silent drop. The OBSERVED behavior is identical on pages that
   host everything; the difference is in who pays for the search and when.

## Deletability (P5)

Delete the probe, its arm wrapper and the `open:island-host-timeout` event as
one unit when the platform can observe a composed-tree host arrival across
shadow boundaries — for example a standard "element connected" signal that
reaches the scheduler across an open shadow root, or a framework-level host
registration that the scheduler can subscribe to. The mechanism is one file,
zero new dependencies, zero new exports and zero protocol/build changes; the
event is informational, so no published consumer contract outlives its
mechanism. The explicit debt of a second composed-tree walker
(`collectHosts` vs the pre-existing `queryAllDeep`) is recorded in the design
record and is retired by sharing one helper the next time either is touched.

## Single writer and seam (P8)

The seam is registered in `docs/architecture/seams.md` under "Late-host
activation give-up announcement": **writer** = `createIslandScheduler` in
`packages/router/src/vite/internal/ssg/island-scheduler.ts` (`giveUp`); the
crossing artifact is the document-level `CustomEvent`; the consumer-form guard
is `tests/fixtures/third-party-web-components/qualify.ts` (listener armed
before load, wait for the event, assert it names the closed-root tag) plus the
unit forms T-6/T-9/T-9b/T-14 in
`packages/router/__tests__/island-scheduler.test.ts`; all guard paths are
Git-tracked (`check-seams` asserts this). No other emitter exists.

## Cost evidence

The design record's §7.4 required measurements before the budget could be
trusted. The measurements taken for this decision (2026-10-19):

- **Fused-walk benchmark** (Chromium 147 headless, Playwright): synthetic
  composed tree of 10,100 elements (100 open shadow roots × 50 nodes plus 5,000
  light nodes), one pending tag, no host. Replica of the production fused walk
  (same selector-list + `shadowRoot` descent; the production function is not
  exported for instrumentation, so this measures the algorithm, not an
  instrumented build): single walk p50 **0.40 ms**, p95 **0.60–0.70 ms** across
  two runs, worst observed 1.5–1.7 ms. Scaled to the 18-walk absolute cap:
  p50-based total ≈7.2 ms, p95-based bound **10.8–12.6 ms** spread over separate
  macrotasks. The design record's target was "single walk < 2 ms, 18 walks <
  10 ms": the single-walk target holds; the p50 total holds; the p95-based total
  is 0.8–2.6 ms above the 10 ms target and is recorded here rather than rounded
  away. It is spread across macrotasks and only occurs on a page that keeps
  declaring an unhosted island for the whole 9 s window.
- **Timer count** (the design record's "no added `setTimeout` on pages that do
  not need the probe"): pinned by the DOM-free scheduler tests — T-1 asserts
  zero `setTimeout` calls on a page that declares no island, and T-6/T-6b pin
  the exact attempt schedule and the single give-up event when the budget is
  spent.
- A production CPU/long-task profile on the fixture page is **not** claimed
  here; it is registered as an alpha16 item, together with replacing the replica
  benchmark with an instrumented build if the probe is ever re-tuned.

## Consequences

- Pages with declared-but-unhosted islands pay a bounded amount of DOM work
  (at most 18 fused walks) instead of silently losing the island. Pages with
  no declared islands and pages that hosted everything never schedule a timer.
- `open:island-host-timeout` is public surface. Consumers must arm a listener
  before load and fail closed on their own barrier timeout; the integration
  guide documents it next to `open:ready`.
- Closed shadow roots stay a documented platform limitation, not a supported
  degradation path.
- The give-up path deliberately does not warn on every page; an unhosted
  declared island is legitimate, so the event is the opt-in channel.

## Evidence

- Budget, fused walk, scheduling and give-up dispatch:
  `packages/router/src/vite/internal/ssg/island-scheduler.ts` (budget constants
  and state around lines 126-150, fused walk 466-489, give-up 595-614).
- Unit form: `packages/router/__tests__/island-scheduler.test.ts` (T-1…T-20;
  T-6/T-6b attempt schedule and single event, T-9/T-9b closed-root
  non-fatality with an open-root late host on the same page, T-14 budget never
  restarts, T-18 window/absolute-clock caps; 50 tests in the file).
- Consumer form: `tests/fixtures/third-party-web-components/qualify.ts`
  (three-engine contract corpus: Lit, FAST, real Stencil, native, nested open
  roots, light-DOM late appends into Shoelace/Material/Ionic; closed-root tag
  named by the event; unused-tag zero-fetch control with a positive control).
- Decision record and approved deviations D-1…D-4:
  `docs/release/late-host-island-activation-design.md`.
- Retired known red: KR-17 (internal working ledger, not published).

## Amendment (2026-10-19, PR #1611 review FR-02/FR-03)

The decision above stands. Two state-machine gaps that the review reproduced
are closed without changing the budget, the single activation authority, or the
give-up event. Where this section is more specific than the text above, this
section governs.

### 1. Strategy transitions arm the probe (FR-02)

The original arm condition was "at factory construction, `pendingTags()` is
non-empty". Two legitimate page shapes fall outside it:

- **idle-only** (idle is the DEFAULT strategy): at construction the idle attempt
  is outstanding, so `pendingTags()` excludes the idle tags by design (D-1 in
  the design record) and the probe is not armed. The idle callback then runs
  with no host and is spent — nothing ever looked again.
- **media-only:** a non-matching query is excluded from `pendingTags()` (the
  capability gate). When the query flips to matching with no host, the change
  listener is the only event that transition produces, and at construction
  there was nothing to arm.

Both transitions now arm the SAME bounded probe, and only that:

- the idle deferred step calls `armProbe()` after its load attempt completes —
  the idle load itself still goes through the browser's idle primitive (the
  probe only re-runs the rescan, so idle asynchronous scheduling is preserved);
- the media change listener arms when it turns matching while the tag is still
  unconsumed.

`load()`'s host gate remains the only activation authority: arming never loads
a tag, it is idempotent (one chain per page), and a spent budget still ends in
the one `open:island-host-timeout`. D-1 is narrowed accordingly: the exclusion
while an idle attempt is outstanding is unchanged, but "idle re-arm stays the
post-morph rescan's job" no longer describes the closed state machine.

### 2. The absolute deadline is an entry gate (FR-03)

`probe()` checked the 9000 ms cap only AFTER `collectHosts()`/`observeVisible()`,
and `onIslandLoadActivity()` opened a continuation window without checking the
cap at all — so a suspended or throttled page could still activate a host past
the contract (the review reproduced a load at 10,000 ms). The cap is now the
first check of:

- every `probe()` entry, and
- every continuation-window entry (`onIslandLoadActivity`),

before any DOM scan or activation, through one `probeAgeOut()` path that retires
the chain (clears the outstanding timer), leaves the factories unconsumed and
emits the one give-up event with `elapsedMs >= LATE_HOST_MAX_TOTAL_MS`.
Boundary of the fix: automatic probing stops at the cap; an explicit rescan
(`observeVisible`) and a later media change keep their existing ability to
activate a still-unconsumed factory.

### Updated evidence

- `packages/router/__tests__/island-scheduler.test.ts`: FR-02 idle-only /
  media-only activation with `open:ready`, the no-duplicate-load negative, the
  positive rescan control and the no-host diagnostic; T-18b adds the
  frozen-timer negative (no DOM scan, no `open:ready`, timeout with
  `elapsedMs >= 9000`), T-18c the just-under-cap positive control, and T-18d
  both suspend/throttle continuation entries (awaiting timer and load activity).
  The file now runs 58 tests (was 50); T-18's original three-window cap case is
  unchanged.
- Matching design-record amendment:
  `docs/release/late-host-island-activation-design.md` ("Implementation
  deviations" D-1 note and the 2026-10-19 addendum).
