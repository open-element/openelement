---
status: active
topic: F16 handoff
summary: Where Alpha16 closeout stands, what remains, the traps that cost the most time, and how to verify.
---

# F16 handoff — Alpha16 closeout

Written 2026-11-23 for a fresh session. Read this before touching anything.

## 1. Where things are

| item | value |
| --- | --- |
| worktree | `.agents/worktrees/alpha16-retirement` |
| branch | `feat/alpha16-retirement` |
| HEAD | `b8085974d` |
| remote | `fork` = `SisyphusZheng/openelement`, **in sync** |
| PR | [open-element/openelement#1805](https://github.com/open-element/openelement/pull/1805) — `OPEN`, `MERGEABLE`, 100 commits, **+22,452 / −35,763 across 536 files** |
| worktree state | clean |

`origin` is `open-element/openelement` (upstream). The fork's DEFAULT branch is
`alpha15`, not `main` — a PR must target upstream `main`, which is what #1805 does.

## 2. What is DONE

The class component lane is deleted as one change set. **No file in the repo imports
the class compiler.**

Removed with no shim: `semantic-core/compile.ts` (`compileElementProgram`),
`emit-module.ts`, `emit-program.ts`, `style-imports.ts`, the class-shape half of
`analyze-module.ts`, the `open:core` transform's class branch, every barrel re-export,
`COMPILED_MODULE_ABI_VERSION`, the whole `__partProgram` serialization in
`public-runtime.ts`, six class modules (`open-element*`, `error-boundary`,
`facade-host`), `OpenElement` / `ErrorBoundary`, and the inert `element` / `property`
decorators.

`PART_PROGRAM_VERSION` **stays** — the runtime still validates the wire format on
revive. That is a different thing from the authoring lane.

Fixtures migrated: `router-base-path`, `router-ui-dogfood`, `router-request-time`,
`router-native-framework`, `site-light-probe`, both foreign-WC fixtures.

Breaking removals, recorded not softened:
- **`ErrorBoundary`'s cross-element containment is gone.** `onError` is
  element-scoped, two capture points, both update-phase.
- **`renderIntent.stream` retired** with the artifact it deferred against.

## 3. Measured state (read the caveat first)

**CAVEAT — THE ENVIRONMENT LOSES PLAYWRIGHT PERIODICALLY.** The
`~/Library/Caches/ms-playwright` directory has been wiped **twice** during this work
(installed once, gone ~11h later). When it is missing, ~13 router rows fail with
`browserType.launch: Executable doesn't exist` and the total jumps by that much. **Check
`ls ~/Library/Caches/ms-playwright` before believing any router number**, and never
attribute that error to a code change — I did once, and reverted a correct change
because of it.

| suite | result |
| --- | --- |
| element | **600 passed / 5 skipped** — green |
| compiler | **1314 passed / 2 failed** — both `browserType.launch` |
| saas | 150 — green |
| benchmarks | 4 — green |
| `check` | **5/5** |
| `www` site build | exit 0 |
| router | **41 failed / 1795 passed**, but **13 of the 41 are the missing browser**, so the code-level count is **~28** |

## 4. What REMAINS

### 4.1 Chinese doc mirrors — 5 files, 19 examples — LOW RISK, DO FIRST

`node www/tools/check-content-examples.ts` lists them:

```
streaming.zh.md (4)   routing-and-data.zh.md (4)   recipe-form-actions.zh.md (4)
error-handling.zh.md (4)   styling.zh.md (3)
```

Their **English twins are already clean** — rewrite each `.zh.md` against its `.md`:
same code blocks (translate only prose comments), same technical claims, Chinese prose.
This is translation sync, not design. Five files were already done this way
(`compiled-grammar.zh.md` alone was 51 examples and is now clean).

### 4.2 Dev style channel — 27 router rows — HARD, AND I FAILED AT IT FOUR TIMES

`dev-authored-css` 16, `dev-tailwind` 7, `dev-nonroot-base` 4.

**The runtime half EXISTS and is inert.** What is missing is the dev entry's injection.

- `GeneratedElementDescriptor.devLiveStyles` — `shell.ts:826`, normalized at `:966`,
  threaded at `:1513`.
- `adoptClientStyles` reads it off the CONSTRUCTOR (`shell.ts:2631`), *not* the
  descriptor, because the descriptor is a module-local constant the dev entry cannot
  reach. It adopts even into an adopted DSD root — that is the whole point.
- **Nothing writes `__oeDevLiveStyles` onto a registered class.** That is the missing
  piece.

**The trap that cost four rounds.** `styleAssetGraphId(registryKey)`
(`style-assets.ts:136`) produces `\0oe-style-asset:<b64>.js`. Generating
`import x from '<that id>'` into the dev style-links module 404s even after `resolveId`
was taught to answer the id — which is EVIDENCE that the request reaches the BROWSER's
module graph, so the answer must come from **dev-server middleware**, not a plugin hook.
**Start there.** Do not repeat the plugin-hook attempt.

Also open in this block and separable: the dev derivation of `routeDocumentStyleLinks`
does not join a PAGE MODULE's own sheet (P-2b) to its route. Adding that took
`dev-tailwind` from 7 to 6 but also added links to documents whose assertions count
them — it needs a measurement pass, not a guess.

### 4.3 The 13 browser rows

`stream-browser` 7, `router-browser` 4, `error-boundary-capture` 2. Reinstall Playwright
(`./node_modules/.bin/playwright install chromium`) and re-measure before concluding
anything.

### 4.4 Three class-authored fixtures — need NEW capabilities, not migration

- `router-request-time/app/islands/zag-combobox{,-light}.tsx` — their specs call
  **authored instance methods** (`demoSetControlledValue`, `demoSnapshot`) on the
  element. ADR-0182:405 states the generated lane has no authored-method capability.
- `router-native-framework/app/components/page-note-edit.tsx` — `<textarea>{body}</textarea>`.
  RCDATA makes a comment literal, so the claim anchor cannot be placed. The refusal is
  `OEIR_LEAF_UNSUPPORTED_TEXT_CONTEXT`, raised from
  `generated-leaf/generate.ts:3888` (`assertTextBoundaryContext`). **I tried four times
  and reverted four times.** The honest options are: (a) withhold the CLAIM and keep the
  SSR producer — but the mount path is gated on the same flag, which is where it broke;
  (b) record it as a breaking removal.
- `router-request-time/app/routes/{styled/[id],decoupled}.tsx` contain only
  COMMENT references to the old API — no action needed.

### 4.5 `gate:packed`

Passes its first six steps (packed sources, pack surface, typecheck of every packed
package). Stops at `consumer:packaged` because `@openelement/ui` depends on
`@openelement/*@1.0.0-alpha.16`, which is **not published**. Verified, not assumed: the
protocol tarball alone installs in 211 ms; the ui tarball alone fails with `notarget`.
**Not a source problem.** Needs a published alpha.16 or a local-registry override.

## 5. Traps that cost the most, in order

1. **P-5 was never a capability gap.** The first port omitted `root: 'shadow'`, the
   island became a light root, and the morph client correctly replaced it. Same root
   restored 114/114 and 342/342 across three engines. A "morph continuity contract"
   would have been built for a bug that does not exist.
2. **A nested light child's sheets DO hoist.** The failure was an ordering bug: a
   producer is a STRING BUILDER, so its `styleLinks` are read while the template is
   written and cannot be amended afterwards. Three attempts "proved the map has the
   URLs" and still shipped no link. Pre-fill the sink at expander CONSTRUCTION.
3. **MDX was four bugs wearing one label** — lowering shape, classification owner,
   page-root admission for a virtual module, and site-resolver spelling of the virtual
   id. Each hid the next. It is now DONE; do not re-open it.
4. **`emitted.lines` vs `stateLines`**: when debugging the leaf generator, the
   component-level gate and the chunk assembly are different places; a probe at the
   wrong one reads 0 and sends you chasing the wrong file.
5. **A stale generated manifest ships a subpath the artifact does not declare.**
   `generated-export-files.ts` is generated FROM the package exports map; the pre-push
   gate catches drift. Run `node tools/repo/generate-openelement-export-files.ts` after
   touching any package's `exports`.

## 6. Verify

```bash
./node_modules/.bin/vp run --no-cache --fail-if-no-match check          # 5/5
./node_modules/.bin/vitest run --project element                        # expect green
./node_modules/.bin/vitest run --project compiler                        # expect 2 browser rows only
node www/tools/check-content-examples.ts                                 # expect no output
ls ~/Library/Caches/ms-playwright                                        # BEFORE trusting router
./node_modules/.bin/vitest run --project router --reporter=dot
```

Gates that must pass before a push (the pre-push hook runs them and its output is
truncated by git — capture with `> /tmp/push.log 2>&1` or you will see only
`error: failed to push`).

## 7. How to run the remaining work

Adversarial acceptance is the point: the lead verifies, agents implement, and **no agent
may report success without a command and its output.** Partition by file ownership so
two agents never touch one file.

Suggested split:
- **Agent A** — the five `.zh.md` files. Gate: `check-content-examples` prints nothing.
- **Agent B** — dev-server middleware answer for the graph id (read §4.2 first).
- **Agent C** — the `<textarea>` decision: implement the claim/SSR split, or write the
  breaking-removal record. **Report before writing.**
- **Lead** — reinstall Playwright, re-measure the browser rows, and adversarially verify
  every claim: re-run the gate yourself, never accept "the agent said it passes".

Rules this work learned the hard way: push after every substantive commit (41 commits
once sat unpushed for 38 hours); state local-vs-remote sync in every report; and when
the same approach fails twice, change the approach instead of trying it a third time.

## 8. Closeout log (2026-11-23 session)

Pushed on `feat/alpha16-retirement` (all pre-push gates passed each time):

| commit | what |
| --- | --- |
| `bd6662693` | six stale zh mirrors + the alpha16-18 dispatch fence synced; `check-content-examples` zero diagnostics, exit 0 |
| `5fa9b8384` | dev live-sheet channel: the graph-id arm on the DEV style plugin (not middleware), client-entry imports and the constructor attach; dev-authored-css 21/21, dev-nonroot-base 5/5 |
| `d669f2ce5` | dev component-sheet linking for a class-only shadow island + page-module route links; dev-tailwind 12/12 |

Measured after `d669f2ce5`: browser rows 13/13 on chromium, firefox and webkit;
dev-authored-css 21/21, dev-nonroot-base 5/5, dev-tailwind 12/12. The "~27"
in §4.2 counted 12 rows that were only a missing-browser launch; the real
code-level count was 14, all green now. §4.2's middleware premise was wrong:
the 404 was an SSR module failing an unresolvable import, and the `/@id/` 200
came from the transform pipeline — the fix belongs in the dev plugin's
resolve/load hooks.

`<textarea>` RCDATA (§4.4) is recorded as an explicit breaking removal, not
implemented: `m08-text-boundary.md` §4 amendment + capability inventory. The
fixture's edit page migrated to the `value` property channel.

**Newly discovered and NOT done — needs a decision.** Admitting the
`router-native-framework` fixture's four typed `definePage<Data>(…)` routes
(the page-component scanner regex cannot match a type argument, so those pages
have no host producer and the build fails) turns them into a *silent* wipe:
their `attribute: false` props have no SSR→claim seed (ADR-0181 A5), so the
claim re-reads the declared defaults. Measured: fixture typecheck + build green,
but **24/132 e2e rows fail**, none on the edit page (`#build-count` goes
`build-count=2`→`0`, `#note-title` is cleared, the 422 error branch is gone).
The admission is therefore NOT committed; the fixture build stays red at `/`
(`OE_PROGRAM_MISSING`). The fix direction is to extend the existing
`data-oe-prop-seed` JSON channel to property-only primitives (it already
carries non-primitives) and amend ADR-0181 A5 — an owner decision.
`router-request-time` has the same typed-`definePage` defect at four sites.
