# Browser conformance tests

This npm-local test world compiles representative Element fixtures, then runs
the resulting browser modules with Web Test Runner on Chromium, Firefox, and
WebKit (#1333).

```sh
deno task test:element:browser:gate
```

The positive suite covers compiled rendering, events, forms, shadow DOM,
hydration/claim behavior, and instance isolation. A fail-closed configuration
smoke proves the suite's own wiring fails correctly: a run that executes zero
tests is flipped to failed by the zero-tests-guard reporter and exits non-zero.

`package-lock.json` is committed because `npm ci` is part of the hermetic gate.

This directory is intentionally self-contained: it has its own `package.json`
with exact-pinned npm deps and its own `node_modules`, and it is **not** part
of the Deno workspace. It is wired into the repo gates through the
`test:element:browser:*` tasks in the root `deno.json`.

## Layout

```
__wtr__/
├── package.json                       npm-local pinned deps (exact versions)
├── web-test-runner.config.mjs         main config: 3 browsers, alias, esbuild, zero-test guard
├── fixtures/                          authored TSX grammar (compiler input)
│   ├── wtr-shadow-button.tsx          shadow-open event source
│   └── wtr-field.tsx                  minimal FACE (distilled from packages/ui open-input)
├── generated/                         OFFICIAL compiler output, committed (regenerable)
│   ├── oe-program-counter.ts          from packages/element/__fixtures__/compiled-element-v1/counter.tsx (byte-for-byte source)
│   ├── wtr-shadow-button.ts
│   ├── wtr-field.ts
│   ├── open-dialog.ts                 production packages/ui component (#1339 case 8)
│   └── open-dropdown.ts               production packages/ui component (#1339 case 8)
├── tests/                             the browser cases (mocha + chai)
│   ├── compiled-lifecycle.test.js
│   ├── composed-event.test.js
│   ├── form-contract.test.js
│   ├── form-platform.test.js          #1339 §5A cases 1-7
│   ├── overlay-contract.test.js       #1339 §5A case 8
│   └── lit-host.test.js
├── negative/                          exit-contract proofs (see below)
└── tools/compile-fixtures.ts          regeneration script (Deno)
```

## How to run

```sh
# hermetic gate (npm ci + compile + browsers + negative proofs):
deno task test:element:browser:gate

# manual equivalents, from the repository root:
deno task test:element:browser:compile   # regenerate generated/ via tools/compile-fixtures.ts
# green suite (Chromium + Firefox + WebKit):
cd packages/element/__wtr__ && npx web-test-runner
# negative proofs:
deno task test:element:browser:negative
```

## Decision: compile path

Chosen: **`compileElementModule`** from
`packages/element/src/internal/compiler/plugin.ts` (the exact function the
`open:compiled-element` Vite plugin's `transform` hook calls), driven by
`tools/compile-fixtures.ts` and emitted into `generated/`.

Not chosen: the full vite lib-mode path (`tools/consumer-packaged-element.ts`
style). That path packs tarballs and npm-installs them into temp dirs; it is
already exercised by `deno task consumer:packaged-element`, and repeating it
here would add install cost without adding evidence about browser behavior.
`compileElementModule` is a pure function, keeps the suite hermetic, and is
guaranteed not to drift from the plugin because the plugin delegates to it.

No second TSX transform exists in this suite: the compiler's emitted module
keeps its TS annotations (`counter.tsx` grammar emits typed field/method
signatures verbatim), exactly as it arrives downstream of the Vite plugin in a
real build. The WTR dev server lowers those annotations with
`@web/dev-server-esbuild` (`ts: true`), mirroring Vite's builtin TS lowering
that runs after the plugin. The `.ts` extension on `generated/*` files reflects
this reality.

Runtime resolution: generated modules import the bare specifier
`@openelement/element`; the config's `open-element-runtime-alias` plugin maps it
to `/src/index.ts`, i.e. **this working tree's runtime source** (served and
esbuild-transformed), not a published tarball. `lit`/`chai` resolve from this
directory's own `node_modules` via `nodeResolve: true`.

## Migrated cases (from the simulated DOM)

| WTR case | Migrated from (`packages/element/__tests__/compiled-runtime/`, facade-dom.ts harness) |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/compiled-lifecycle.test.js` — fresh create → connect → attribute change reflection → disconnect → reconnect; node identity (`assert.strictEqual` on nodes), no duplicate parts, one listener per click | facade.test.ts: "fresh connect renders the compiled program end to end", "attribute writes convert and drive Parts and Regions", "reflect properties mirror post-connect writes to attributes", "event handlers wire to instance methods and survive reconnect once", "SSR-delivered attributes win at connect; defaults restore on removal" |
| `tests/composed-event.test.js` — native click inside the compiled element's open shadow root reaches a `document` listener via the composed path; retargeting and `composedPath()` asserted; handler ran exactly once | facade-activation.test.ts: the open-shadow CSR shape of "open shadow CSR fires onCsrRendered only" and the live-handler click dispatch of "closed shadow DSD claim fires onDsdHydrated (H3)" (re-expressed against a real open shadow root with a native composed click) |
| `tests/form-contract.test.js` — new browser truth for the form slice: FACE listed in `form.elements`; required+empty ⇒ `:invalid`, `form.checkValidity() === false`, `invalid` event fires, submission blocked; typed value validates and submits with submitter name/value in `FormData`; `form.reset()` restores via `formResetCallback` | new (form "First cases"); component distilled from `packages/ui/src/open-input.tsx` |
| `tests/lit-host.test.js` — LitElement (lit@3.3.3, its own runtime) connects, renders, reacts to a property change, disconnects/reconnects with node identity; plus same-page coexistence with the compiled OE element | new (interop evidence, NOT Lit Framework Mode) |

## Form/platform matrix (#1339 §5A, 2026-09-10)

`tests/form-platform.test.js` (7 cases) and `tests/overlay-contract.test.js`
(7 cases) extend the suite with the form/platform contract rows. All pass in
all three engines. Engine notes recorded while landing them:

- **requestSubmit(FACE host)** throws a `TypeError` in all three engines; the
  message text diverges (Chromium/WebKit: "The specified element is not a
  submit button."; Firefox: "HTMLFormElement.requestSubmit: The submitter is
  not a submit button."). A FACE is not accepted as a native submit button.
- **Submitter IDL missing-value defaults**: `form.action`/`button.formAction`
  read the document URL when the attribute is absent (#576), but
  `button.formMethod`/`formEnctype` return `''` (not the form's defaults) —
  identical in Chromium, Firefox, WebKit.
- **Enter implicit submission** (via `@web/test-runner-commands` sendKeys —
  synthetic untrusted key events do not trigger it) picks the default
  submitter = the FIRST submit button in tree order; its name/value lands in
  FormData. Identical across engines.
- **Popover toggle events coalesce per spec**: state flips separated by less
  than a task dispatch no toggle event. Overlay tests settle each transition
  (state AND its toggle event) before the next action.
- **open-dropdown focus-restore race (FIXED in this round)**: the old
  `watchFocusReturn` reset `popoverHadFocus` in the queued 'open' toggle
  handler, so focus entering the popover before that task ran had its focusin
  record wiped and focus return silently never happened (menu-button
  composition: the opening click moves focus to the first item synchronously;
  also any direct `showPopover()` open path). The capture/reset is now
  anchored at the SYNCHRONOUS 'beforetoggle' point
  (`packages/ui/src/open-dropdown.tsx`), which runs inside `togglePopover()`
  before the open flip and before any same-task focus move. Two regression
  tests in `tests/overlay-contract.test.js` pin both racy orderings; both
  fail against the pre-fix implementation in all three engines (proven by
  stashing the regenerated `generated/open-dropdown.ts`).
- **Restore-reason path NOT RUN**: neither `packages/ui/src/open-input.tsx`
  nor the distilled `wtr-field` fixture implements `formStateRestoreCallback`
  (only `formResetCallback`); the inherited base-class callback is a safe
  no-op, which case 7 asserts directly. The reset/restore matrix row is
  covered for what the component implements (reset), and the
  restoration-reason slice is deferred until a component implements it.

Case 8 compiles the REAL production components
(`packages/ui/src/open-dialog.tsx` / `open-dropdown.tsx`) through the suite's
official fixture path — no fakes. Their `./component-recipes.ts` /
`./instance-state.ts` imports are served straight from `packages/ui/src` by
the `ui-source` plugin in `web-test-runner.config.mjs` (nothing copied), so
the tests cannot drift from production sources. The config also raises the
mocha timeout to 15s: trusted-input cases (sendKeys/sendMouse round-trip
through the Playwright driver) exceed the 2s default; every wait remains a
bounded predicate poll, never a sleep.

Migration notes discovered on the real platform:

- `event.composedPath()` returns `[]` after dispatch ends; the path must be
  captured inside the listener.
- A FACE host does **not** expose `validity`/`checkValidity()` (probed in
  Chromium: `undefined` on the host, present on `ElementInternals`; `:invalid`
  matching and form-level `checkValidity()` work). The form test therefore
  asserts through platform-observable channels only.

## Results (2026-09-09, macOS arm64, Deno 2.9.0, Node 24.18.0)

Green run: `npx web-test-runner` → **exit 0**, "Finished running tests in 2.4s,
all tests passed!", wall time ≈ 3.7 s. Per browser: **9 passed / 0 failed, 4/4
test files** in each of:

- Chromium 147.0.7727.15 (playwright revision chromium-1217)
- Firefox 148.0.2 (firefox-1511)
- WebKit 26.4 (webkit-2272)

Updated 2026-09-10 with the #1339 §5A additions: **23 passed / 0 failed, 6/6
test files** per browser (two consecutive full runs, no flakes), same browser
revisions.

Browser binaries come from the existing `~/Library/Caches/ms-playwright` cache;
`playwright@1.59.1` is pinned directly so the launcher uses the same revision
map as the repo's E2E stack (`@web/test-runner-playwright@1.0.0` accepts it via
`playwright: ^1.53.0`, deduped to one copy).

## Negative proofs (exit contract)

All run with `set -o pipefail`; exit codes are the runner's own. The full
five-proof sweep runs as `deno task test:element:browser:negative`.

| Proof | Command (`cd packages/element/__wtr__`) | Exit | Evidence excerpt |
| ----- | --------------------------------------- | ---- | ---------------- |
| (a) failing assertion | `npx web-test-runner --config negative/failing-assertion.config.mjs` | **1** | `AssertionError: intentional failure` at `negative/failing-assertion.test.js:5:11` |
| (b) missing browser | `npx web-test-runner --config negative/missing-browser.config.mjs` | **1** | `browserType.launch: Failed to launch chromium because executable doesn't exist at /nonexistent/wtr-pilot-bogus-chromium-executable` |
| (c1) setup/transform failure | `npx web-test-runner --config negative/broken-transform.config.mjs` | **1** | `Error while handling server request. Error: intentional transform failure` → `Could not import your test module` |
| (c2) zero tests executed | `npx web-test-runner --config negative/zero-tests.config.mjs` | **1** | `zero-tests-guard: run executed 0 tests; marking the run as failed` → `Error while running tests.` |
| (c3) files glob matches nothing | `npx web-test-runner --config negative/no-matching-files.config.mjs` | **1** | `Error: Could not find any test files with pattern(s): negative/no-such-dir/**/*.test.js` |

Zero-test caveat and guard: stock WTR 1.0.0 **reports success** on a run that
executes zero tests — proven by the committed counterfactual
`negative/zero-tests-unguarded.config.mjs` (same run without the guard: exit
**0**, "all tests passed!"). A session only counts as failed when a test or the
session itself errors. The main config therefore carries `zero-tests-guard`, a
small reporter that flips zero-test runs to failed. Gate wiring must keep the
main config (or the guard) in the required path.

## Debugging / source-map quality

- WTR maps assertion-failure stacks to authored test locations:
  `negative/failing-assertion.test.js:5:11` in proof (a).
- Each compiled artifact embeds a real Source Map v3 (inline) back to the
  authored `.tsx`, with `sourcesContent` and the `x_openElement` provenance
  records (root/property/element/part spans) — verified at generation time by
  `tools/compile-fixtures.ts`.
- Verified empirically via a standalone dev-server probe: esbuild's transform
  **consumes the compiler's inline map and composes it**, so the single map on
  the served module points straight at the authored `.tsx`
  (`sources: ['wtr-field.tsx']`). Browser stack traces inside compiled component
  code resolve to authored TSX lines.
- The working-tree runtime at `/src/**` is served through esbuild with inline
  maps (`sourcefile` = served path), one transform hop.

## Install footprint / dependency delta

Direct deps (exact pins in `package.json`): `@web/test-runner@1.0.0`,
`@web/test-runner-playwright@1.0.0`, `@web/dev-server-esbuild@2.0.0`,
`chai@6.2.2`, `lit@3.3.3`, `playwright@1.59.1`.

- `npm install` output: **added 306 packages** (direct 6 + transitive 300);
  `npm ls --all --parseable` reports 307 lines incl. the root.
- `node_modules/` size: **98 MB** total. Largest contributors: `playwright-core`
  11 MB, `@esbuild` (platform binary) 11 MB, `@mdn/browser-compat-data` 10 MB
  (via dev-server-esbuild), `chromium-bidi` 10 MB and `puppeteer-core` 8.4 MB
  (via the bundled `@web/test-runner-chrome`), `@web/*` 4.6 MB, `playwright` 3.5
  MB, `lit`+`lit-html`+`@lit/*` ≈ 3.9 MB.
- Scope of the delta: everything lands in `packages/element/__wtr__/` only. Root
  `deno.json`, `packages/element/deno.json` tasks/imports, `deno.lock`, and CI
  workflows are untouched; `package-lock.json` and `node_modules/` are covered
  by existing root `.gitignore` entries. `generated/` is committed, matching the
  repo convention for generated fixtures.
- Known npm warning: npm's allow-scripts policy blocked esbuild's `postinstall`;
  harmless here because the platform binary resolves from the
  `@esbuild/darwin-arm64` optional dependency (verified with a transform smoke
  test).

## Repo-gate status

- `deno fmt --check` (root): flags the compiler-emitted files under
  `generated/` (machine output must stay byte-identical). Minimal fix:
  `"fmt": { "exclude": ["__wtr__/generated/"] }` in
  `packages/element/deno.json` — the only repo-file edit. All authored
  `__wtr__` files (configs, tests, fixtures, tools, this README) are
  deno-fmt-clean. Lint needs no exclude: `deno lint` reports no problems in
  `__wtr__` (generated code included).
- `__wtr__` is excluded from the root Deno workspace sweep (root deno.json
  `exclude` + the `deno task test` `--ignore` flag). This directory keeps its
  own npm-local conventions.

## Not proven / follow-ups

- Watch mode, code coverage, and WTR SSR middleware were not exercised.
- DSD claim/hydration in a real browser remains Playwright-E2E-owned in this
  slice; only fresh-connect paths run under WTR.
- The alias plugin maps only the `@openelement/element` root specifier; new
  subpath imports in compiled output would need one more mapping line.
- WebKit/Firefox FACE behavior matches Chromium for the tested surface (listing,
  validity mirroring, reset, FormData); deeper constraint kinds (type=email,
  minlength, …) remain future work, as in `open-input`.
- Candidates surfaced by the #1339 matrix (all reported, none fixed here —
  production code is outside this slice's scope):
  - The FACE restoration-reason channel (`formStateRestoreCallback`) is
    unimplemented in `open-input`/`wtr-field`; test it once a component
    implements it.
