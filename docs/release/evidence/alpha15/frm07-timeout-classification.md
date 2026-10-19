# FRM-07C — run 39216159302 failure classification (review FR-05C)

Candidate: `ef5da43e45d887b214841a99c26d3f8d2dac358b` (branch `alpha15`).
Run: [AutoFlow CI 39216159302](https://github.com/open-element/openelement/actions/runs/39216159302)
(conclusion `failure`; the same SHA's later full qualification
[39219887454](https://github.com/open-element/openelement/actions/runs/39219887454) was
13/13 success, so none of the observations below is a confirmed product defect).
Raw failed log copied by the Lead:
`verification/pr1611/10-ci-evidence/failed-run-39216159302.log` in the verification
workspace (log line numbers below are that file).

The review's FR-05C asks for one thing: when a browser/probe observation times out,
the report must say **engine/probe timeout with phase and URL**, not present it as an
assertion failure. This document classifies each observation from that run and
records the classification change that now makes the packed probe say which kind of
failure it hit.

## 1. The three observations, classified

| # | observation (job) | raw evidence | classification | disposition |
| --- | --- | --- | --- | --- |
| C1 | `packed-consumer-matrix (ubuntu-latest)`: Lit / Firefox browser-continuation probe | `log:1753-1754` `lit / chromium / pass`, `lit / webkit / pass`; `log:1756` `Timed out after 300000ms: … pw-continuation-probe.ts http://127.0.0.1:38617 lit firefox`; `log:1761` child tail `page.evaluate: Target page, context or browser has been closed`; `log:1766` cell `FAIL lit dev — … Browser continuation probe failed (1/3 browsers)` | **Engine/probe timeout** (harness abort at `BROWSER_TIMEOUT_MS` = 300000 ms), not a product assertion failure. The child tail is Playwright teardown after the kill, not a failed probe assertion. Supporting: the same probe script passed all three engines in the start-mode cell two minutes earlier (`log:1837-1840`), and the run's next full qualification was 13/13 green. | classified in code (§2). No retry added, no product assertion changed. |
| C2 | `e2e-full (site-e2e)`: Firefox `/reference` direct-URL load | `log:4753-4755` `Test timeout of 420000ms exceeded.` / `Error: page.waitForLoadState: Test timeout of 420000ms exceeded.`; `log:4764` `at www/e2e/navigation-routing.spec.ts:48:18`; `log:4798-4801` listed under **2 flaky** (the retry passed) | **Engine load timeout** on the generated 2.09 MB `/reference` page, cleared by the retry in the same run (Playwright's `flaky` verdict). Not a product assertion mismatch. | site-spec classification proposal in §3 (outside this lane's write scope). |
| C3 | `e2e-full (site-e2e)`: WebKit `ui-behaviour-matrix.spec.ts:228` focus-visible ring row | `log:4669` failed; `log:4673` `(retry #1)` passed; failure detail `log:4772-4790` `Error: a ring has pixels inside the viewport` at `expectVisibleRing` (`ui-behaviour-matrix.spec.ts:158:77`) | **Flaky engine observation**, retry-cleared in the same run; two other WebKit keyboard rows passed first attempt. Not a confirmed product assertion failure. | observed, not reclassified as a defect; candidate known-reds row in §4. |

The run's final site-e2e verdict (`log:4803-4806`) is also worth reading precisely:
the one *unexpected* failure was the WebKit cinematic loop-video assertion
(`cinematic-home.spec.ts:486`, `Expected > 0.81991919 / Received 0.541958316`) —
that is FRM-07B, fixed in `www/e2e/cinematic-home.spec.ts` in this batch. C2 and C3
were retry-cleared and are `flaky` in Playwright's own accounting; they did not
decide the job.

## 2. What changed in code: the packed-consumer probe now classifies

File: `tools/release/consumer-packaged-shared.ts`.

1. `ProcessRunResult` gains an explicit `timedOut?: boolean`. `runProcess()` sets it
   when the harness aborts the child at `timeoutMs`; the existing
   `Timed out after <n>ms: …` output prefix is kept (a contract test asserts its
   absence on success), so no consumer loses the old diagnostic.
2. `classifyBrowserProbeFailure()` turns a failed probe into exactly one kind:
   - `PROBE-TIMEOUT` — the harness aborted the probe at `BROWSER_TIMEOUT_MS`
     (C1's case). The summary names `phase`, `renderer`, `engine`, `url` and
     `limitMs`, and says explicitly that this is an engine/probe timeout, not a
     product assertion failure;
   - `PROBE-WAIT-TIMEOUT` — the probe's own readiness wait exceeded its limit
     (`Timeout <n>ms exceeded` in the captured output);
   - `ASSERTION-FAILURE` — the probe ran to its own verdict and failed it.
3. `describeBrowserProbeFailure()` is the one failure-line builder: kind first, then
   the classification summary, then the probe output tail. The continuation probe
   passes `phase: 'browser-continuation'` (start cell) / `'dev-continuation'` (dev
   cell) with `url: <baseUrl>/notes`; the dev warm-up probe uses
   `phase: 'dev-warmup'`.

The pre-change output for C1 was a bare cell failure whose only cause-shaped line
was the teardown error; the post-change output for the same event is:

```text
lit / firefox / PROBE-TIMEOUT:
[PROBE-TIMEOUT] phase=browser-continuation renderer=lit engine=firefox url=http://127.0.0.1:38617/notes limitMs=300000 — the harness aborted the browser probe before it finished; this is an engine/probe timeout, not a product assertion failure (the captured tail is teardown output, not a verdict).
--- probe output (tail) ---
Timed out after 300000ms: …
```

Reproducer (scratch, `/tmp/cli-tests/frm07c-classification-evidence.mts`), run on
this toolchain: it drives a real subprocess timeout through `runProcess()` and feeds
the three shapes through the exported classifier. Output:

```text
runProcess timedOut=true success=false
runProcess output starts: Timed out after 150ms: …/node -e setInterval(() => {}, 1000)
case harness-kill kind=PROBE-TIMEOUT
case harness-kill summary=[PROBE-TIMEOUT] phase=browser-continuation renderer=lit engine=firefox url=http://127.0.0.1:38617/notes limitMs=300000 — …
case wait-timeout kind=PROBE-WAIT-TIMEOUT
case wait-timeout summary=[PROBE-WAIT-TIMEOUT] … after=60000ms — a probe ready-wait exceeded its own limit; …
case assertion kind=ASSERTION-FAILURE
case assertion summary=[ASSERTION-FAILURE] … — the probe ran and its assertion failed.
```

No retry was added, and no product assertion was weakened. CI output for C1 will
now be readable as an engine/probe timeout in the job log without opening the raw
child tail.

## 3. Site E2E timeouts: classification applied (Lead-approved scope extension)

The two site-e2e observations (C2, C3) are raised in `www` Playwright specs and
accounted by `tools/repo/site-e2e-result.ts`. Lane C's write scope was extended
by the Lead on 2026-10-19 to land the classification in these files: minimal
diffs, no assertion weakening, no timeout inflation, no retries.

### 3.1 The accounting misclassification (evidence)

`log:4806` prints `- Site E2E flaky=2+expected=939 != executed tests 942` for a run
whose real problem was one **failed** test. That message was produced by
`auditSiteE2e()` (`tools/repo/site-e2e-result.ts`) from the identity
`expected + flaky === executed`, which only holds when `failed === 0` because
`executed` also counts failures. So a timeout/failure in one test was reported as
a flaky-accounting divergence — the precise classification error FR-05C calls out.

### 3.2 What changed

1. `tools/repo/site-e2e-result.ts` — the suite-size identity is now
   `expected + flaky + failed === executed`, and the mismatch message names all
   three buckets. The module header and the `expected` field doc state the same
   identity.
2. `tools/repo/site-e2e-result.ts` — new exported
   `classifyPlaywrightFailures(report)`: a pure read of the JSON report that
   emits one line per failed test, `[TIMEOUT] project=<name> test="<title>"`
   when the final attempt status is Playwright's `'timedOut'`, `[FAILURE] …`
   otherwise. Retry-cleared tests are not reported (they are `flaky`, not
   failures).
3. `tools/repo/site-e2e-run.ts` — prints those classified lines to stderr
   (`site-e2e: failed test classification:`) next to the audit verdict, read from
   the same report bytes already parsed for the sidecar.
4. `www/e2e/helpers.ts` — the single classified-timeout helper:
   `TimeoutClassification`, `classifyTimeoutError()`,
   `observeWithTimeoutClassification()` and `waitForLoadStateClassified()`.
   A Playwright timeout-shaped error is rethrown as
   `engine timeout: phase=<phase> engine=<project> url=<url> — <original message>`
   and logged with `console.error`; every non-timeout error passes through
   untouched. It does not retry and does not change any timeout value.
5. Wrapped `420 s /reference` ceilings:
   `www/e2e/navigation-routing.spec.ts` (direct-URL wait; phase
   `direct-url-access`, URL = route), `www/e2e/accessibility-gate.spec.ts`
   (load+settle and the axe scan; phase `axe-gate`), and
   `www/e2e/accessibility-mega-pages.spec.ts` (load+scan; phase
   `axe-mega-page`). The ceilings themselves (420 s / 120 s), the retries policy
   and every product assertion are unchanged.

### 3.3 Verification

- `pnpm exec vitest run --project tools tools/repo/site-e2e-result.test.ts` →
  **22/22 passed**. The two new tests pin (a) a run with `failed=1` is reported as
  a failure and no longer as a flaky identity divergence, while the identity still
  binds every bucket, and (b) the classifier names `[TIMEOUT]` for a final
  `timedOut` attempt, `[FAILURE]` for an assertion, and skips retry-cleared tests.
- `pnpm exec tsc --noEmit -p tools/tsconfig.json` → clean.
- Targeted Playwright, chromium: `navigation-routing.spec.ts` +
  `accessibility-gate.spec.ts` + `accessibility-mega-pages.spec.ts` → **29/29
  passed** (2.4 min; the two mega-page axe scans 46.3 s / 46.0 s, the resident
  gate's `/reference` scan 2.4 min — the wrapped path still completes normally).
- Targeted Playwright, Firefox, `navigation-routing.spec.ts -g 'Direct URL
  Access'`: **11 passed / 1 failed**, and the failure is the C2 shape reproduced
  locally on this machine — Firefox `/reference` never reaches
  `networkidle` and hits the 420 s ceiling. With the wrapper in place the failure
  now reads:

  ```text
  engine timeout: phase=direct-url-access engine=firefox url=/reference — page.waitForLoadState: Test timeout of 420000ms exceeded.
  Error: engine timeout: phase=direct-url-access engine=firefox url=/reference — page.waitForLoadState: Test timeout of 420000ms exceeded.
  ```

  i.e. the exact CI observation is classified as an engine load timeout with the
  phase and URL, not as an assertion-shaped failure. (The local reproduction is
  also evidence for the known Firefox large-page trap; the other 11 direct-URL
  routes pass in the same run.)
- Classification reproducer: a throwaway spec
  (`/tmp/cli-tests/timeout-classification.spec.ts` + local config) sets a 1500 ms
  test ceiling, wraps a 10 s wait in `observeWithTimeoutClassification`, and its
  failure output is:

  ```text
  engine timeout: phase=direct-url-access engine=chromium url=/reference — page.waitForTimeout: Test timeout of 1500ms exceeded.
  Error: engine timeout: phase=direct-url-access engine=chromium url=/reference — page.waitForTimeout: Test timeout of 1500ms exceeded.
  ```

  i.e. the caught deadline surfaces as the classified error (with phase, engine
  and URL), not as an assertion-shaped failure, and the classified line is in the
  log either way.

None of this loosens a product assertion: the ceilings and the assertions stay,
only the failure label and the accounting identity changed.

## 4. Proposed known-reds row (for `internal working ledger (not published)`)

`internal working ledger (not published)` is Lead/Lane-F-owned; text proposed here,
next free number assumed to be KR-21:

```md
## KR-21 · Browser-engine timeouts under full-suite load (Firefox /reference, WebKit focus ring, packed Lit/Firefox continuation probe)

- **Symptom**: in one full qualification run (39216159302, SHA ef5da43e4) three
  independent browser observations did not complete in time: the packed Lit/Firefox
  continuation probe hit the 300000 ms harness abort; the Firefox `/reference`
  direct-load test hit its 420000 ms test ceiling; the WebKit focus-visible ring row
  failed its offscreen check on attempt 1. The Firefox and WebKit rows passed on
  retry in the same run; the packed probe passed on the run's later full
  qualification (39219887454, 13/13 green, same SHA).
- **Evidence path**: `verification/pr1611/10-ci-evidence/failed-run-39216159302.log`
  (`:1756`, `:4753-4764`, `:4669`, `:4797-4806`); classification changes in
  `tools/release/consumer-packaged-shared.ts`, `tools/repo/site-e2e-result.ts`,
  `tools/repo/site-e2e-run.ts`, `www/e2e/helpers.ts` and the three wrapped site
  specs; `docs/release/evidence/alpha15/frm07-timeout-classification.md`.
- **Impact**: retry-cleared or non-reproduced on the fixed toolchain, so no product
  defect is proven; the cost is diagnostic — a timeout must be read as an
  engine/probe timeout with phase/project/URL, never as a product assertion
  failure (and a failed test must no longer be reported as a flaky-count
  divergence).
- **Owner**: alpha15 batch (Lane C landed all three classifications under the
  Lead-approved scope extension; the ledger row is Lead-owned).
- **Status**: OPEN (observation retained; no retry-inflation, no assertion change).
- **Retirement condition**: three consecutive full qualification runs on the fixed
  toolchain with no timeout in these rows, or a root cause identified and fixed.
- **Latest observation**: 2026-10-19, run 39216159302 @ ef5da43e4 (failed), then
  39219887454 @ ef5da43e4 (13/13 success). Same day locally: macOS Firefox
  reproduced the `/reference` `networkidle` hang at the 420 s ceiling; the
  classified wrapper reported `engine timeout: phase=direct-url-access
  engine=firefox url=/reference`.
```

## 5. What is unverified / open

- The three classified-timeout wrappers are verified on the normal (successful)
  path in chromium (29/29 across the three specs) and the classification path is
  verified against a real ceiling expiry: the Firefox direct-URL run reproduces
  the `/reference` 420 s timeout locally and reports it classified (§3.3).
- The scope-of-work statement in `.github/workflows/autoflow-ci.yml` (`e2e-full`)
  is unchanged by this lane; no new CI job is needed — the classification is
  output-only.
- No attempt was made to reproduce C1's Playwright/Firefox protocol hang locally
  (300 s of a loaded Firefox child); the classification is honest about that: it
  says "engine/probe timeout", not "product defect".
