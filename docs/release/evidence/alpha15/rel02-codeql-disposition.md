# REL-02 — CodeQL disposition record (alpha15, PR #1611)

Task: alpha15 cleanup, FRM-05 (alert #4238), FRM-06 (alert #4241), REL-02
(disposition record and validation). Lane: codeql (task-7).

Repository: open-element/openelement. Branch alpha15. PR #1611.
PR head at observation: ef5da43e45d887b214841a99c26d3f8d2dac358b
(base 8f0e22c03053ebbdb81cb82e88810b3054c238b2).

All GitHub state below was read from this workspace with an authenticated
GitHub CLI (account SisyphusZheng) at the timestamps recorded per section.
The exact commands are reproduced so any reader can re-query; raw responses
were retained in the session scratch directory (see "Evidence index").

## 1. Authoritative alert state

Query time: 2026-10-19T20:01:47+08:00 (2026-10-19T12:01:47Z).

Commands (run from any directory; pagination slurped into a JSON array):

```sh
gh api 'repos/open-element/openelement/code-scanning/alerts?ref=refs%2Fpull%2F1611%2Fmerge&per_page=100' --paginate --slurp
gh api 'repos/open-element/openelement/code-scanning/alerts?ref=refs%2Fheads%2Fmain&per_page=100' --paginate --slurp
gh api 'repos/open-element/openelement/code-scanning/alerts?per_page=100' --paginate --slurp
```

Results at 12:01:47Z:

| ref | alerts | open | fixed | dismissed |
| --- | --- | --- | --- | --- |
| refs/pull/1611/merge | 24 | 2 | 10 | 12 |
| refs/heads/main (and the default list) | 325 | 0 | 214 | 111 |

The two open alerts on the PR merge ref were:

| alert | rule | severity | location | state | ref | observed_at |
| --- | --- | --- | --- | --- | --- | --- |
| #4238 | js/bad-code-sanitization | error | packages/compiler/src/internal/compiler/semantic-core/server-component.ts:677 | open | refs/pull/1611/merge | 2026-10-19T12:01:47Z |
| #4241 | js/trivial-conditional | warning | www/app/routes/changelog.tsx:40 | open | refs/pull/1611/merge | 2026-10-19T12:01:47Z |
| #4236 | js/bad-code-sanitization | error | packages/compiler/src/internal/compiler/semantic-core/server-component.ts:645 | fixed (fixed_at 2026-10-18T05:10:34Z) | refs/pull/1611/merge | 2026-10-19T12:01:47Z |

The rest of the 24 PR-merge-ref alerts were either fixed or dismissed:
#4215-#4218 (tools/repo/node-command.ts, dismissed), #4202-#4208
(dismissed), #4199 (dismissed), #4230-#4235 and #4237, #4239, #4240 (fixed).
Per-item data: alerts-pr-merge-ref.json, alerts-selected-pr-merge-ref.json.

CodeQL check-run on the PR head SHA (ef5da43..., query
gh api 'repos/open-element/openelement/commits/ef5da43e45d887b214841a99c26d3f8d2dac358b/check-runs?per_page=100'):

- conclusion: success; started 2026-10-19T07:14:45Z, completed 07:14:49Z.
- output title: "2 new alerts including 1 medium severity security vulnerability".
- output summary: "Security Alerts: * 1 medium" and "Other Alerts: * 1 warning".

So the check is green *and* carries the two open alerts: the summary is a
delta statement, not a zero-alert statement, and the PR body's "CodeQL 0 open
alerts" holds only for main (0 open there), not for the PR merge ref.

API caveat recorded during this work: GET /code-scanning/alerts/{n} returned
"state": null for the PR-merge-ref alerts sampled (#4234, #4235, #4236, #4238,
#4240, #4241) at query time. The per-ref list endpoint above carries the
authoritative state; after #4238 was dismissed, the single-alert endpoint
reported state "dismissed" because a dismissal is repository-global.

## 2. Thread-number correction (#4236 vs #4238)

The PR has 14 review threads; all 14 are resolved
(pr-threads.json: reviewThreads length 14, isResolved count 14). Resolution is
not alert disposition — the thread state says the discussion was closed, not
that the current alert number was addressed.

The server-component thread at line 677 (discussion r4306643355) links alert
#4238 in its "[Show more details]" URL, while the owner reply (comment
r4311129172) says:

> Code scanning alert #4236 is dismissed with this rationale; no code change
> and no alert-gaming workaround was added.

A second server-component thread (line null) links alert #4236 and has no
owner reply. Facts from the per-ref list and git history:

| claim | fact | evidence |
| --- | --- | --- |
| "#4236 is dismissed" | #4236 is fixed, not dismissed: state fixed, fixed_at 2026-10-18T05:10:34Z, dismissed_at null | alerts-pr-merge-ref.json |
| thread links #4238 | #4238 is a different, open alert at the time: same rule/file, reported line 677 | alerts-pr-merge-ref.json |
| same finding twice? | yes: #4236 and #4238 are the same rule/file/hunk family, split by a revert | see timeline |

Timeline (git commit dates are committer dates, UTC; alert dates from the API):

| when (UTC) | event |
| --- | --- |
| 2026-10-17T17:13:23Z | #4236 created (js/bad-code-sanitization, server-component.ts:645). |
| 2026-10-18T03:19:50Z | commit 953f190dd "quote codegen literals explicitly" adds an explicit QuoteJSONString port in the emitter. |
| 2026-10-18T05:10:34Z | #4236 becomes fixed (the changed emitter no longer matches the query). |
| 2026-10-18T08:18:13Z | commit 3289bb70c reverts that emitter by owner decision ("a code generator must not carry its own QuoteJSONString implementation"); literals go back to JSON.stringify. |
| 2026-10-18T10:18:01Z | #4238 created — the same finding re-raised after the revert, not #4236. |

Correction to record for the PR finalization: the current alert is #4238;
#4236 was fixed and its fix was reverted. The dismissal rationale written for
#4236 therefore cannot be cited for #4238 by number — it had to be re-stated
for the current alert (done in section 3.7 with the current number).

## 3. #4238 (js/bad-code-sanitization): data flow and disposition

### 3.1 The alert

- Instance: server-component.ts:677 (columns 61-84), ref
  refs/pull/1611/merge, analysis commit 71916f9cc4ad236416f114ab233e9c21c6557f67,
  message "Code construction depends on an improperly sanitized value."
  repeated for 16 flows (alert-4238-instances.json, alerts-selected).
- The emitter is ConstructorEmitter in
  packages/compiler/src/internal/compiler/semantic-core/server-component.ts.
- The query's help text (alert JSON: rule.help) states its model: "If using
  JSON.stringify ... to sanitize a string inserted into JavaScript code, then
  make sure to perform additional sanitization or remove potentially dangerous
  characters" — and its example fixes the problem by escaping characters that
  matter when code is embedded in an HTML script element. That is the model
  this disposition tests against the artifact's actual context.

### 3.2 Every reported splice and its guard

Line numbers are the current worktree's (the alert was reported against an
earlier checkout; the emission families are unchanged). "Identifier" means the
emitter's identifier() boundary: plain-identifier regex + OEC9032 fail-closed.
"Stringify" means the value is written as a JSON.stringify-quoted string
literal, i.e. ECMAScript QuoteJSONString escaping for a TS string literal.

| emission family | current lines | value source | guard |
| --- | --- | --- | --- |
| slot-name static literal | 631 | authored static slot attribute | Stringify |
| equality / inequality operand | 647, 649 | ProgramCondition.value (string / finite number / boolean; protocol conditionLiteralAllowed) | Stringify |
| ordering operand | 651, 653, 655, 657 | ProgramCondition.value restricted to a finite numeric literal | String() of a number (cannot carry source) |
| static text literal | 666 | authored primitive child literal | Stringify |
| component prop-entry keys | 699-700 | lowering propsEntries names (keys) next to already-built value fragments | Stringify |
| children key | 704 | constant | Stringify |
| nested component binding | 709 | imported binding resolved by the compiler | Identifier |
| static attribute name/value | 716 | authored static attributes | Stringify both |
| innerHTML sink name + key | 732-733 | lowering sink name | Identifier + constant Stringify |
| class sink name + key | 743-748 | IR/lowering signal; synthesized computed body copied from authored source | Identifier (hardened here) + constant Stringify |
| style sink name + key | 755-756 | lowering sink name | Identifier + constant Stringify |
| attribute sink name | 759-761 | lowering sink name + authored attribute name | Identifier + Stringify |
| item attribute field/name | 771-772 | each item field + authored attribute name | Identifier + Stringify |
| element tags | 785, 790, 793 | authored JSX tag, lowered to the protocol-validated lowercase tag | Stringify |
| __ssr child slot entries | 788 | static slot literal or slot sink name | Stringify / Identifier |

### 3.3 Invariants the tests prove

I1. Literal boundary. Every non-identifier value is written with
JSON.stringify, which is exactly the well-formed JSON/ECMAScript string-literal
escaping; the emitted module therefore re-parses with zero syntax diagnostics
and the literal re-reads as exactly the authored value. A hostile value
(quotes, backslashes, </script>, U+2028/U+2029, template holes, NUL) cannot
leave its slot. Proven by the literal-boundary tests in
packages/compiler/__tests__/server-component-codegen-boundary.test.ts.

I2. Identifier boundary. Every lowering-produced name written into an
identifier position must match /^[A-Za-z_$][A-Za-z0-9_$]*$/ and otherwise
fails the compile CLOSED with OEC9032 (no silent drop, no fallback). Proven for
all 12 splice categories (including the class sink hardened in this change and
the props parameter) by the same test file.

I3. Ordering operands. >, >=, <, <= accept only a finite numeric literal:
protocol validateCondition / conditionLiteralAllowed and the lowering's
parseCondition both close the space, so String(test.value) can never carry
source text. Non-numeric ordering operands are refused with OEC9013; both
directions are tested.

I4. Synthesized class body. The one raw authored-source copy on this path
(conditional-class computed body) is validated by validateComputedExpressionBody
before it is copied; the compiler also copies authored statements verbatim when
it assembles the module, which is what a compiler is for (the input is the
developer's own program), not a data-to-code construction.

### 3.4 Consumer context: the artifact is a module, never HTML

The generated string is CompileServerComponentResult.code — a TS module. Its
consumers:

- packages/compiler/src/internal/compiler/plugin.ts:388 returns
  { code: serverCompiled.code, map: serverCompiled.map } from the Vite
  transform (after the emitted module type-check at line 370).
- packages/router/src/vite/plugin-hmr.ts returns the compiled code/map from the
  dev transform (returns { code: serverResult.code, map } for the server lane).
- Discovery/build walks read only serverCompiled.classCandidates
  (packages/router/src/vite/internal/style-assets.ts:804,
  packages/router/src/vite/internal/collect-shadow-candidates.ts:162,
  packages/router/src/vite/plugin-hmr.ts:139).
- The module is then bundled/imported and executed on the server; HTML is
  produced at runtime by __h/__t/__ssr with the shared escapeText/escapeAttr
  boundary (covered by server-component-xss-matrix.test.ts).

In the consumer trace above, no path concatenates .code into an HTML document
or a <script> element.
Therefore characters that only matter inside an HTML script element
(</script>, U+2028/U+2029) are inert here: < and > inside a TS string literal
cannot terminate anything, and U+2028/U+2029 have been legal inside string
literals since ES2019 (JSON superset). This is the exact assumption the query
does not and cannot model; its sanitizer model is HTML-embedding-shaped.

### 3.5 Trace outcome: one emitter hardening

The trace found one site that relied on upstream validation rather than
enforcing the emitter's documented boundary: the class sink spliced
part.signal without identifier(), although both the IR validator
(packages/protocol/src/part-program.ts:1042 ff. require an identifier for
class/style parts) and the lowering guarantee one. It now takes the same
identifier() boundary (server-component.ts:743). This is defense in depth: no
admitted program changes emitted bytes, because identifier() returns the name
unchanged. The compiler project (15 files / 201 tests) stays green.

### 3.6 Why the alert is not fixed by re-adding an escaper

- The previous explicit-escaper attempt (953f190dd) fixed #4236 by adding a
  QuoteJSONString port to the generator. The owner reverted it (3289bb70c):
  a code generator must not carry its own QuoteJSONString implementation, and
  that shape hides the finding rather than addressing the context.
- packages/router/src/vite/internal/ssg/codegen-literals.ts already exports
  quoteGeneratedJavaScriptValue, which post-stringify escapes <, >, U+2028 and
  U+2029. That helper serves a different boundary. Extracting it downward is
  not available under the dependency rule: router depends on compiler
  (packages/router/package.json lists @openelement/compiler), compiler declares
  only @openelement/protocol and typescript (packages/compiler/package.json),
  so compiler importing router would be a reverse dependency. Moving the
  helper into protocol/compiler would add a shared seam with no consumer need
  and would reproduce the rejected custom escaper.
- Conclusion: the reported flows are not attacker-controlled code construction
  in the artifact's context; this is a false positive under the query's model,
  and the disposition is a written dismissal plus hostile-input regression
  tests — not an escaper.

### 3.7 Disposition action: accepted dismissal of #4238

Command (run 2026-10-19T12:16:36Z):

```sh
gh api --method PATCH repos/open-element/openelement/code-scanning/alerts/4238 \
  -f state=dismissed -f dismissed_reason='false positive' \
  -f dismissed_comment='<266-character comment below>'
```

GitHub caps dismissed_comment at 280 characters: the first attempts (1502 and
304 characters) were rejected with HTTP 422 "Only 280 characters are allowed".
The accepted comment (266 characters) is:

> #4238 FP (FRM-05/REL-02): all 16 flows are JSON.stringify-quoted TS literals
> (correct escaping in a TS module) or OEC9032-validated names; the artifact is
> a standalone TS module, never HTML-inlined. Evidence:
> docs/release/evidence/alpha15/rel02-codeql-disposition.md

Result (alert-4238-after.json, dismiss-4238.json): state dismissed,
dismissed_reason "false positive", dismissed_at 2026-10-19T12:16:36Z,
dismissed_by SisyphusZheng. No 403 was encountered: the authenticated token
(whose scopes include repo) was accepted by the alert update endpoint; the
280-character validation was the only rejection.

Post-dismissal ref state (2026-10-19T12:16:44Z): PR merge ref 24 alerts —
1 open (#4241), 10 fixed, 13 dismissed. Main: 0 open (unchanged).

## 4. #4241 (js/trivial-conditional): fixed by generator-decided copy

### 4.1 Alert and root cause

- Instance: www/app/routes/changelog.tsx:40 (columns 3-27), message
  "This use of variable 'COMMON_PUBLISHED_VERSION' always evaluates to false."
- COMMON_PUBLISHED_VERSION is declared as string | null = null in
  www/app/data/version.ts (line 137). It is a hand-maintained mirror of
  docs/release/release-state.json's commonCompleteVersion; the mirror is
  enforced by tools/repo/check-release-state-machine.ts (regex at line 144 and
  value comparison at lines 149-154). Because the checked-in source is a
  literal null, every route branch on it was statically dead:
  - registerVersionLabel = COMMON_PUBLISHED_VERSION ?? (...)
  - stampCurrent (en/zh) = COMMON_PUBLISHED_VERSION === null ? ... : ...
  - regCurrentSummary (en/zh) = COMMON_PUBLISHED_VERSION === null ? ... : ...
- A second latent deadness: the "values differ" / "none" narrative branches in
  the route could never be emitted either, because generate-site-content-data.ts
  already fails closed when the per-package latest values disagree with
  latestPrerelease.version (the guard around its line 213).

### 4.2 Fix

www/tools/generate-site-content-data.ts now decides the register presentation
from docs/release/release-state.json and emits it into
www/app/data/_generated-release-line.ts (gitignored, regenerated):

- COMMON_COMPLETE_VERSION: string | null — the typed contract, from
  release-state commonCompleteVersion; a non-null value must appear in every
  published package's registry block or generation fails.
- REGISTER_VERSION_LABEL — the common stable version when one exists, else the
  shared prerelease line (today: 1.0.0-alpha.14).
- REGISTER_CURRENT_STAMP / REGISTER_CURRENT_SUMMARY — the register's stamp and
  summary sentence per page locale, decided now.

www/app/routes/changelog.tsx consumes those constants; no conditional over the
nullable mirror remains in the route (or anywhere in the changelog route). A
future common stable release flips the copy by regenerating, not by editing
JSX. version.ts and its enforced mirror are untouched.

Semantics are identical today (before -> after, same strings):

| value | before (route derivation) | after (generated decision) |
| --- | --- | --- |
| label | COMMON_PUBLISHED_VERSION ?? sharedLatestBare = 1.0.0-alpha.14 | REGISTER_VERSION_LABEL = 1.0.0-alpha.14 |
| stamp (en/zh) | Per-package latest / 各包 latest | same, generated |
| summary (en) | 1.0 alpha line: ... 1.0.0-alpha.14. No common stable version is published. | same, generated |
| summary (zh) | 1.0 alpha 线：... 1.0.0-alpha.14；不存在共同 stable 版本。 | same, generated |

### 4.3 Verification

- www/__tests__/release-copy.test.ts (8 tests) includes a new
  generation-time-decision test that pins the typed contract to
  release-state.json, pins both locales' copy, and asserts the route no longer
  branches on the nullable mirror; it also keeps the "register never derives a
  stable line from a latest dist-tag" guard.
- www generate:content regenerated the module
  (sha256 a18607d4c9974b7ec127f734bc6f1e4f5b645ea4689d71dd384a7f32fd0a196b
  before and after a regeneration run, i.e. deterministic);
  www check:content-data passes.
- www route typecheck (node www/tools/check-www-routes-types.ts) passes over
  37 route modules, which type-checks the generated constant imports.
- The alert itself remains open at 12:16:44Z because CodeQL only re-analyzes
  on a push. Expected state on the next PR analysis: fixed (branch and all
  five dead conditionals are gone, including the reported one). No dismissal
  was requested for #4241.

## 5. Validation commands and results

All run in the worktree described at the top; logs under the scratch evidence
directory.

| command | result |
| --- | --- |
| pnpm exec vitest run --project compiler | 15 files / 201 tests passed (includes the new boundary file) |
| pnpm exec vitest run --project compiler packages/compiler/__tests__/server-component-codegen-boundary.test.ts | 1 file / 19 tests passed |
| pnpm exec vitest run --project router packages/router/__tests__/function-page.test.ts | 1 file / 37 tests passed (consumer render path for the compiled artifact) |
| pnpm exec vitest run --project www www/__tests__/release-copy.test.ts | 1 file / 8 tests passed |
| pnpm --dir www run generate:content | wrote 8 modules; release-line module sha stable across runs |
| pnpm --dir www run check:content-data | passed |
| node www/tools/check-www-routes-types.ts | "routes typecheck ok: 37 route module(s) checked" |
| pnpm exec oxfmt --check <changed files> | clean |
| pnpm exec oxlint <changed files> | 0 warnings, 0 errors |

Note on the shared worktree: at 12:17Z a content-data check transiently failed
on www/app/data/_generated-guide-data.ts because other lanes were editing
www/content concurrently between the generation and the check. After
regenerating at 12:18Z the check passed; the release-line module's own hash was
unchanged across regeneration. The Lead's consolidation generate:all owns the
final state.

## 6. Files changed by this lane

| file | change |
| --- | --- |
| packages/compiler/src/internal/compiler/semantic-core/server-component.ts | class-sink identifier hardening; code-construction boundary docblock with alert/test pointers |
| packages/compiler/__tests__/server-component-codegen-boundary.test.ts | new hostile-input regression: literal boundary (I1), identifier boundary (I2), ordering-operand boundary (I3) |
| www/tools/generate-site-content-data.ts | decides REGISTER_* presentation and COMMON_COMPLETE_VERSION contract from release-state; fail-closed validation |
| www/app/routes/changelog.tsx | consumes the generated decisions; removes all five dead branches |
| www/__tests__/release-copy.test.ts | pins the generation-time decision and the no-dead-branch source shape |

## 7. Open items and handoff

1. Re-analysis is external. #4241 is fixed by code but its alert state can
   only flip to fixed when CodeQL analyzes the next PR merge ref; #4238 is
   already dismissed. The consolidation push should show the CodeQL check
   summary without the "2 new alerts" line and the PR-merge-ref list with
   0 open alerts. Record the post-push query in REL-01/REL-07 evidence.
2. PR thread correction (REL-07, PR owner): reply on the resolved
   server-component.ts:677 thread stating that the current alert is #4238
   (dismissed false positive on 2026-10-19 with the rationale above), that
   #4236 is fixed rather than dismissed, and scope the PR body's "CodeQL 0
   open alerts" claim to main. Update/replace the old reply text; do not reuse
   the #4236 number for #4238.
3. Lead-owned docs:
   - docs/architecture/seams.md row "Registry truth <-> site display <->
     publish train": the release-line module now also feeds the changelog
     route's decided register copy. Suggested addition to that row's invariant
     column: "and the release-line module's decided register label/stamp/
     summary (COMMON_COMPLETE_VERSION contract)". The writer is unchanged
     (www/tools/generate-site-content-data.ts) and the consumer-form test is
     www/__tests__/release-copy.test.ts, so this is a description update, not a
     new seam.
   - internal working ledger (not published): no new known-red required (the
     alerts are closed or fix-pending); if the ledger tracks CodeQL state,
     record "#4238 dismissed false positive 2026-10-19; #4241 fixed-by-code
     pending re-analysis".
4. Scratch evidence is session-local and not committed; the commands in this
   document reproduce every number. Raw JSON sizes are a few MB (the 4-page
   main list), which is why the record cites queries instead of committing
   bytes.

## Evidence index (session scratch; reproduce with the commands above)

| file | contents |
| --- | --- |
| observed-at-utc.txt / observed-at-local.txt | first query timestamps |
| observed-at-utc-after.txt | post-dismissal query timestamp |
| alerts-pr-merge-ref.json | PR merge ref list at 12:01:47Z (24 alerts) |
| alerts-selected-pr-merge-ref.json | #4236/#4238/#4241 subset with messages/locations |
| alerts-main-ref.json, alerts-default.json | main/default lists (325 alerts, 0 open) |
| alert-4236.json / alert-4238.json / alert-4241.json | single-alert reads (state null caveat) |
| alert-4238-instances.json | instance ref/analysis commit |
| alerts-pr-merge-ref-after.json | PR merge ref list after dismissal (1 open) |
| alert-4238-after.json, dismiss-4238.json | accepted dismissal response |
| check-runs.json | CodeQL check-run summary for the PR head SHA |
| pr-1611.json | PR metadata (head/base SHA) |
| pr-threads.json, threads.graphql | review threads and numbers |
| logs/ | command outputs quoted in section 5 |
