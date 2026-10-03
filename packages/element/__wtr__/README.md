# Browser conformance tests

This npm-local directory holds the element browser conformance suite's
runtime dependencies and test files. The suite RUNS under **vitest browser
mode** — the `element-browser` project in the root `vitest.config.ts` —
driven by the `browser:*` tasks in `packages/element/package.json`:

```sh
pnpm --dir packages/element run browser:gate        # PR layer: Chromium only
pnpm --dir packages/element run browser:gate:full   # release train: all three engines
```

The engine matrix comes from `OE_BROWSER_MATRIX` in `vitest.config.ts`
(default `chromium`; `full` = chromium+firefox+webkit; anything else fails
closed). `browser:gate` is the fast PR-layer subset the trimmed source gate
runs; `browser:gate:full` is the complete three-engine matrix the release
train (`tools/repo#gate:release`) requires.

The positive suite covers compiled rendering, events, forms, shadow DOM,
hydration/claim behavior, and instance isolation. A fail-closed configuration
smoke (`browser:negative`) proves the suite's own wiring fails correctly —
see "Negative proofs" below.

## Layout

```
__wtr__/
├── package.json                npm-local runtime deps (exact versions, see below)
├── package-lock.json           committed; `npm ci` is part of the hermetic gate
├── fixtures/                   authored TSX grammar (compiler input)
│   ├── wtr-shadow-button.tsx   shadow-open event source
│   └── wtr-field.tsx           minimal FACE (distilled from packages/ui open-input)
├── generated/                  OFFICIAL compiler output, committed (regenerable)
│   ├── oe-program-counter.ts   from packages/element/__fixtures__/compiled-element-v1/counter.tsx
│   ├── wtr-shadow-button.ts
│   ├── wtr-field.ts
│   ├── open-dialog.ts          production packages/ui component (#1339 case 8)
│   └── open-dropdown.ts        production packages/ui component (#1339 case 8)
├── tests/                      the browser cases (collected by the element-browser vitest project)
└── tools/
    ├── compile-fixtures.ts     regenerates generated/ (browser:compile)
    └── negative-proofs.ts      the fail-closed configuration smoke (browser:negative)
```

## Why npm-local, and what each dependency is for

This directory is intentionally self-contained: it has its own `package.json`
with exact-pinned npm deps and its own `node_modules`, and it is **not** a
workspace member. `browser:install` runs `npm ci` here (with
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`; browser binaries come from the shared
Playwright cache) before the suite runs, so the gate stays hermetic.
`package-lock.json` is committed for that `npm ci`.

Dependencies are tiered by actual consumption:

- `chai@6.2.2` — kept: five conformance test files import it explicitly
  (the suites follow the retired web-test-runner's injected-globals
  convention, which is also why the vitest project opts into
  `globals: true`).
- `lit@3.3.3` — kept: `tests/lit-host.test.js` mounts a real LitElement
  against the compiled OE element (interop evidence, not Lit Framework
  Mode).
- Everything else was retired with the web-test-runner runner
  (`@web/test-runner`, `@web/test-runner-playwright`,
  `@web/dev-server-esbuild`, `playwright`): the runner, its config, and its
  negative-config fixtures are gone. The vitest side of the stack
  (`vitest`, `@vitest/browser`, `@vitest/browser-playwright`, `playwright`)
  resolves from the root workspace devDependencies — the tests import
  `vitest` and `vitest/browser` (`userEvent`), and the playwright provider
  plus its browser revisions come from the root install, the same revision
  map the repo's E2E stack uses.

## Compile path (unchanged decision)

Chosen: **`compileElementModule`** from
`packages/element/src/internal/compiler/plugin.ts` (the exact function the
`open:compiled-element` Vite plugin's `transform` hook calls), driven by
`tools/compile-fixtures.ts` and emitted into `generated/` — a pure function,
hermetic, and guaranteed not to drift from the plugin because the plugin
delegates to it. Not chosen: the full vite lib-mode path
(`tools/consumer-packaged-element.ts` style); that packs tarballs and
npm-installs them into temp dirs, which `consumer:packaged-element` already
exercises.

No second TSX transform exists in this suite: the compiler's emitted module
keeps its TS annotations, and vite's oxc transform lowers them at serve time
(mirroring what the plugin-plus-vite pipeline does in a real build). The
`.ts` extension on `generated/*` files reflects this. Runtime resolution:
generated modules import the bare specifier `@openelement/element`; the
`element-browser` project's alias maps it to `packages/element/src/index.ts`
— this working tree's runtime source, not a published tarball — and the two
production ui imports (`component-recipes.ts`, `instance-state.ts`) resolve
straight from `packages/ui/src`, so the tests cannot drift from production
sources. `lit`/`chai` resolve from this directory's own `node_modules`.

## Negative proofs (exit contract)

`browser:negative` runs `tools/negative-proofs.ts`, which drives the live
vitest browser project over transient scratch suites written INSIDE the
collected include (`tests/negative-scratch/`, removed on exit):

1. `failing-assertion` — a scratch test that fails must exit non-zero, the
   report must show the test, and the `AssertionError` must match;
2. `broken-transform` — invalid code must collect, fail the file, and
   report the `SyntaxError`;
3. `zero-tests` — a filter matching nothing must exit non-zero
   (`passWithNoTests` stays false), and the report must say so.

Every case additionally fails the smoke if the scratch suite was never
collected ("No test files found") — that signature is the false-green
vector the smoke exists to exclude. The scratch runs inherit
`OE_BROWSER_MATRIX`, so the full gate proves the exit contract on all three
engines.

Historical note: under the retired web-test-runner this contract was proven
by `negative/*.config.js` fixtures plus a `zero-tests-guard` reporter,
because stock WTR 1.0.0 reported success on a zero-test run. Both halves
were deleted with the runner; vitest's own `passWithNoTests: false` default
plus the script above hold the same line.

## Platform notes (engine truths recorded under WTR, still pinned by the tests)

- `requestSubmit(FACE host)` throws a `TypeError` in all three engines; the
  message text diverges (Chromium/WebKit: "The specified element is not a
  submit button."; Firefox: "HTMLFormElement.requestSubmit: The submitter is
  not a submit button."). A FACE is not accepted as a native submit button.
- **Submitter IDL missing-value defaults**: `form.action`/`button.formAction`
  read the document URL when the attribute is absent (#576), but
  `button.formMethod`/`formEnctype` return `''` — identical across engines.
- **Enter implicit submission** (trusted key events via `userEvent.keyboard`;
  synthetic untrusted events do not trigger it) picks the default submitter =
  the FIRST submit button in tree order; its name/value lands in FormData.
- **Popover toggle events coalesce per spec**: state flips separated by less
  than a task dispatch emit no toggle event. Overlay tests settle each
  transition (state AND its toggle event) before the next action.
- **open-dropdown focus-restore race (fixed)**: `watchFocusReturn` used to
  reset `popoverHadFocus` in the queued 'open' toggle handler, silently
  losing focus-return. The capture/reset is anchored at the SYNCHRONOUS
  'beforetoggle' point (`packages/ui/src/open-dropdown.tsx`); two regression
  tests in `tests/overlay-contract.test.js` pin both racy orderings.
- `event.composedPath()` returns `[]` after dispatch ends; the path must be
  captured inside the listener.
- A FACE host does **not** expose `validity`/`checkValidity()`; `:invalid`
  matching and form-level `checkValidity()` work. The form test asserts
  through platform-observable channels only.
- The FACE restoration-reason channel (`formStateRestoreCallback`) is
  unimplemented in `open-input`/`wtr-field`; test it once a component
  implements it.
