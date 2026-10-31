# DOC-02 — audit of the existing content-example gate

Lane E (docs-site), task-5. Scope: audit `www/tools/check-content-examples.ts` and its tests, close real coverage gaps **with tests** (no new gate), and make at most minimal robustness fixes. Measured on the batch worktree (branch `alpha15`, HEAD `ef5da43` plus lane edits), 2026-10-19. Raw logs under `<scratch>/docs-site/`.

## 1. What the gate decides

| Invariant | Entry point | Fence scope | Failure output |
| --- | --- | --- | --- |
| Every `@openelement/*` named import resolves against the generated export inventory | `validateFrameworkImports` (`ANY_FENCE`) | every `.md`/`.mdx` under `www/content` (55 files today: 54 docs + 1 blog dispatch) | `unknown @openelement subpath ...` / `... is not exported from ...` |
| Authoring-pattern tripwires | `validateAuthoringPatterns` (`FENCE_PATTERN`) | maintained dirs only (`www/content/docs/guide`, `www/content/docs/architecture`) | "render() declares a local before its return" / "a .replace(...) unpacks a message pattern by hand" |
| Framework examples type-check against the real sources | `typeCheckExamples` | extracted examples from the maintained dirs, deduped by fence bytes | `TS#### at line N: ...` |
| Documented code actually compiles | `compileExample` / `compileExamples` (both admission bridges, island sidecar) | extracted examples from the maintained dirs, deduped, minus the excluded pages | `OEC####: ...` with the compiler's own boundary+fix text |

## 2. Coverage classes (measured 2026-10-19)

252 fenced blocks in the 54 maintained-dir files: `ts` 68, `tsx` 66, `bash` 46, `text` 46, `html` 8, `css` 8, `sh` 6, `json` 4. 106 fence occurrences contain `@openelement/`; 73 are unique by bytes (the en/zh pairs are byte-identical and deduped).

| Fence class | Discovered by `FENCE_PATTERN` | Type-checked | Compile-run | Import-scanned |
| --- | --- | --- | --- | --- |
| `ts` / `tsx` / `typescript` / `js` / `javascript` containing `@openelement/` | yes | yes (73 unique) | yes (52 unique) | yes |
| same classes without `@openelement/` (fragments: options objects, `render()` bodies, config blocks) | yes | no | no | yes |
| `bash` / `sh` / `text` / `html` / `css` / `json` | no | no | no | no |
| fences on `compiled-grammar.md` / `.zh.md` | yes | yes | **excluded** (21 unique fences) | yes |
| `.mdx` files | same rule as `.md` | same | same | same |
| `www/content/blog` | n/a (outside maintained dirs) | no (historical exclusion) | no | yes |

So shell, JSON, text, HTML and CSS fences are never sent to the compiler or the type-checker — that is a **coverage class**, not an exemption: `ANY_FENCE` does not match them either, so a shell fence cannot produce an import failure. The `tsx` corpus today has no `js`/`javascript` instances; the alias is covered synthetically (see §4).

## 3. Exemption mechanism and its allowlist

* `COMPILE_EXCLUDED_PAGES` (exported): exactly two entries, `compiled-grammar.md` and `compiled-grammar.zh.md`, each carrying its rationale (the page prints rejected forms beside admitted ones). No other page is excluded; the test pins four non-excluded pages by name.
* Extraction rule: only fences whose bytes contain `@opentelement/` become examples. A fragment is not compile-run because it is not extracted **and** because both admission bridges answer `null` for it — the compiler's own module boundary, never a heuristic.
* Elision suppression (`suppressElidedDiagnostic`): `TS2307` for non-`@openelement` module specifiers (the `@openelement/generated/*` consumer namespace included), `TS2304` except documented framework exports, `TS7006`, and `TS2339` on the uninferred `{}` loader generic. Everything on the framework surface stays visible.
* Blog exclusion: `www/content/blog` is import-validated only; the dated dispatch is history, not current authoring guidance.

## 4. Tests that cover it

`www/tools/check-content-examples.test.ts` — 14 tests, all green (`pnpm exec vitest run --project www www/tools/check-content-examples.test.ts`, ~1.1 s, 2026-10-19).

| Test | Pins |
| --- | --- |
| the D4 branch-text recipe is caught red with the compiler diagnostic | `OEC9012` negative proof with the compiler's own message and the fixture file |
| the working static-branch-text shape compiles clean | green control for the same page |
| an island config sidecar is admitted exactly like the real build | `ISLAND_ADMISSION` sidecar path |
| a fragment fence is not compile-run | the compiler-boundary fragment rule |
| the documented-rejection grammar reference is the explicit exclusion; nothing else is | allowlist membership and four non-excluded pages |
| the documented-rejection exclusion matches the absolute paths the content walk produces | **new** — the allowlist key spelling (regression for the §6.2 fix) |
| a server function page fence is compile-run by the second admission bridge (OEC9026 proof) | **new** — the server-function bridge is live, not orphaned |
| only ts-family fences are discovered; shell, JSON and text fences never reach the compiler | **new** — coverage classes |
| a fence opener with trailing whitespace or CRLF is still discovered | **new** — the §6.1 fix |
| import validation fails unknown subpaths/exports and resolves inline type/alias modifiers | **new** — `validateFrameworkImports` negative direction |
| authoring-pattern tripwires reject a render() local and a hand-rolled message replace | **new** — both tripwires |
| elision suppression hides only elided context, never a framework-surface error | **new** — all five suppression branches |
| compileExamples respects the documented-rejection exclusion and nothing else | **new** — excluded page skipped, same bytes red on a live page |
| compileExamples runs every fence it is given and aggregates the failures | failure aggregation |

## 5. Coverage gaps closed in this lane

1. **Second admission bridge was untested.** The gate calls `compileElementModule` and then `compileServerComponentIfAdmitted`; every pre-existing test exercised only the element bridge (the alpha15 server function page lane, ADR-0169, had no gate-level proof). Added a green server-function fence plus its own sink denial (`innerHTML` without a `TrustedHtml` property → `OEC9026`). A fragment answers `null` from both bridges, so the red case is what proves the second bridge runs.
2. **Coverage classes were untested.** Nothing pinned that shell/JSON/text fences stay out of the compiler; a careless regex widening would have silently sent shell commands to the type-checker. Added the discovery test.
3. **The import invariant had no test at all.** Added unknown-subpath, unknown-export, `type X`/`X as Y` resolution, and "a shell fence is not an import site".
4. **The authoring-pattern tripwires had no test.** Added both red cases and a clean control.
5. **The elision suppression boundary had no test.** Added all branches, including the two that must stay visible (`@openelement/nope`, a documented framework name used without import).
6. **The exemption was unreachable in the real walk** (see §6.2). Added a regression test that passes the absolute path the walk produces.

## 6. Minimal robustness fixes

### 6.1 Fence openers with trailing whitespace / CRLF were skipped silently

`FENCE_PATTERN` required a bare `\n` immediately after the language token, so ```` ```tsx ```` (trailing space) or a CRLF opener was not discovered by the type-check **or** the compile run. One character class (`[^\S\n]*`) now tolerates that spacing; `ANY_FENCE` already did.

Behavior-neutral on today's corpus: `grep -rn "^```\(ts\|tsx\|js\|javascript\|typescript\)[ \t]\+$" www/content` returns no hits, and the full gate still passes (log: `<scratch>/docs-site/gate-final.log`).

### 6.2 The documented-rejection exclusion was dead code in the real gate

`checkContent()` readdir()s an absolute root, so `example.file` is absolute; `COMPILE_EXCLUDED_PAGES` is keyed repo-relative. `isCompileExcluded` did a plain map lookup, so it answered `false` for every walked page — the exemption only ever worked for the tests, which pass relative fixture names.

Evidence with the pre-fix module copied from `HEAD` to `<scratch>/docs-site/prefix/` (relative imports rewritten to absolute so it runs):

```text
HEAD (pre-fix) isCompileExcluded(absolute): false
HEAD (pre-fix) compileExample(absolute grammar page): 1 failure
after the fix: isCompileExcluded(absolute): true; compileExample: []
```

The bug was latent, not red: all 16 unique grammar-page fences in the current corpus compile green even when run (`<scratch>/docs-site/probe-exclusion.ts`), so no gate run was failing. But the documented suppression path did not exist, and the first whole-unit rejected teaching form would have failed the gate with no way to use the allowlist. Fix: `isCompileExcluded` accepts the raw key or the path relative to the repo root.

## 7. Gaps left open (documented, deliberately not fixed here)

* **Info-string and indented fences** (` ```tsx title="x" `, a fence indented four spaces) are still not discovered. No file under `www/content` uses either form today; supporting them needs a Markdown-aware scan, which is beyond a minimal fix.
* **Fragments without `@openelement/`** are never type-checked (extraction rule), so a broken snippet that mentions no framework package is not caught. Widening extraction would newly type-check ~100 partial snippets; that is a deliberate boundary, not a gap to close in a cleanup batch.
* **Blog dispatches** stay out of the type-check and compile run (historical record).
* **`checkContent()`'s own walk and dedupe** have no unit test; the gate run in CI covers it end to end. A fixture-tree test would need a configurable root.
* The allowlist has no machine-checked "reason is non-empty" rule (unlike `check-doc-claims`); the rationale lives in the map comment and the header.

## 8. Post-deploy check: site content matches the alpha15 recipe

Before deploy, the gate is the machine check:

```sh
pnpm --filter @openelement/www run check:content        # compiles the recipe fences with the real compiler
pnpm --filter @openelement/www run check:install-command
```

After the Pages build serves the merge (tag-stripping joins shiki-highlighted code back into its source text):

```sh
# recipe-form-actions: the working static shape is present, the rejected branch text is absent
curl -s https://openelement.org/guide/recipe-form-actions | sed 's/<[^>]*>//g' | grep -c "role='alert' hidden={this.hideError}"   # expect >= 1
curl -s https://openelement.org/guide/recipe-form-actions | sed 's/<[^>]*>//g' | grep -c 'error ? <p'                            # expect 0

# API reference: streaming is supported for class pages, session/cache are the uncommitted items
curl -s https://openelement.org/reference | grep -c "Streaming is supported for compiled class pages"   # expect 1
curl -s https://openelement.org/reference | grep -c "framework session and active cache"                # expect 1
curl -s https://openelement.org/reference | grep -c 'href="/guide/streaming"'                          # expect >= 1
curl -s https://openelement.org/zh/reference | grep -c "流式渲染则已对编译的 class 页面受支持"            # expect 1

# Streaming guide: the function-page rejection boundary is stated
curl -s https://openelement.org/guide/streaming | sed 's/<[^>]*>//g' | grep -c 'so is a server function page'   # expect 1

# Version truth (see doc01-site-alpha15.md)
curl -s https://openelement.org/roadmap | grep -c "1.0.0-alpha.15"                 # expect >= 1
curl -s https://openelement.org/ | grep -c "six packages · one version"            # expect 0 (old layout gone)
```

These greps are the same checks run against the local build in `doc01-site-alpha15.md` §3/§8.

## 9. Verification run for this audit

```sh
pnpm exec vitest run --project www www/tools/check-content-examples.test.ts   # 14 passed
pnpm --filter @openelement/www run check:content                              # passed (imports, patterns, type-check, compile)
pnpm --filter @openelement/www run check:doc-claims                           # passed (74 files, 47 versions, 37 gates, 10 CI jobs)
pnpm --filter @openelement/www run check:routes-types                         # passed (37 route modules)
pnpm --filter @openelement/www run check:install-command                      # passed (10 display files)
```

Logs: `<scratch>/docs-site/gate-baseline.log`, `gate-after.log`, `gate-final.log`, `doc-claims.log`, `routes-types.log`, `check-install-command.log`, `prefix-exclusion.txt`, `corpus-counts.txt`.
