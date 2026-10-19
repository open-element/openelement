# alpha16 candidate register (committed)

Owner ruling 2026-10-18: alpha15's residual work is registered here, in the
repository, instead of only in the gitignored working notes. This file is the
committed register the alpha15 release PR refers to; the long-running internal
draft (`alpha16-candidates.md` under `.zcode/plans/`, gitignored) stays the
working copy. Ids `X*` are carried over from that draft; where the draft had
duplicate ids (`X9`, `X10`) the duplicate entries are re-keyed here, and
`X39`–`X41` — named but undefined in the draft — are defined from the owner
report that introduced them.

Nothing in this file blocks the alpha15 release. Entries are ordered by area,
not by priority; each row names where the evidence lives.

## Tooling and gates

| id | candidate | evidence / tracker | notes |
| --- | --- | --- | --- |
| X13 | the interop fixture's `qualify` mode has no gate execution | qualification reports; `fixture-web-component-interop` gate | recorded in the internal draft; decide gate or retire the mode |
| X18 | two new diagnostic codes should enter the router error-code catalogue | `OEC9032`-family commits; router error-code map | decide catalogue boundary before documenting |
| X19 | no repository-level dead-export survey tool | batch cleanup measured dead exports by hand | candidate for a checker once the interface snapshot matures |
| X21 | `kr2-diagnostic.spec.ts` remains a diagnostic spec inside the same fixture gate | batch cleanup removed the sibling `q1b` spec | same audit family; decide keep-or-retire |
| X28 | `version-bump.ts` still says "the ten stamp sites" while the authority list has grown | version-bump script comment | stale comment, no behavior |
| X29 | `alpha7-design-review.md` line references drifted | maintainers doc | line-range citations need the X31 rule |
| X31 | path:line citations validate only that the line is in range, not that the content still matches | seams/ADR citation practice | needs a content-aware checker or a citation format |
| X32 | only rule 4 of the ADR path-reference policy is a review obligation, not machine-checked | ADR index policy | mechanize or drop the rule |
| X33 | the ADR index policy is stated in two places | ADR README and CONTRIBUTING | one home + reference |
| X35 | `git ls-files` pipelines are duplicated across repo tools | tools/repo checkers | share one helper |
| X36 | the CI fast layer does not run the shims reader, the ADR-index reader or the doc-claims gate | CONTRIBUTING records them as local-only | wire into the PR layer or keep the release-only policy explicit |
| X37 | the seams registry has no lower bound on row content | seams reader | guard against thin rows |
| X42 | CI WebKit `enhance-guards` response wait timed out in one qualification attempt (KR-18 class) | known-reds ledger KR-18 | flake accounting, never retries-based masking |
| X45 | the PR/base CI layer still runs the full three-engine site E2E and the whole fixture/browser matrix, so an ordinary PR — even a docs-only one — pays the giant browser suites | `.github/workflows/autoflow-ci.yml`; main push run 39291529070 (the `site-e2e` job alone ran ~25 min) | owner ruling 2026-10-20: daily/PR CI should carry a fast subset only; move the giant E2E to the release train or a scheduled lane, keep a smoke subset plus affected-suite selection on PRs. Do not delete the proof — re-tier it |

## Release evidence and measurement pipeline

| id | candidate | evidence / tracker | notes |
| --- | --- | --- | --- |
| #1633 | perf/size guardrails: payload closure, zero-island gate, tarball budgets, bench v0 | GitHub issue #1633 | issue already open |
| #1634 | per-release metrics evidence pipeline: A/B + JFB as tracked, machine-checked release artifacts | GitHub issue #1634 | this release staged the raw artifacts as a release asset; #1634 owns automating it |
| E1 | attach `alpha15-ab-jfb-evidence.tar.zst` to the alpha15 GitHub Release at publication | `docs/release/evidence/alpha15/README.md` (digest + manifest) | archive is staged in `.artifacts/release-evidence/`; a Release asset cannot exist before the Release |
| E2 | recover a durable run link or archived log for the KR-18 flake observation | known-reds ledger KR-18 | the originally cited run id now returns 404 |
| E3 | production long-task profile for the late-host probe, plus an instrumented walk benchmark | ADR-0170 "Cost evidence"; design record §7.4 | current numbers come from a replica benchmark |
| E4 | automate the evidence-only handoff prerelease (REL-03) and the Release asset attachment, so a reviewer's first verification never depends on a manual command | `docs/release/evidence/alpha15/README.md`; `tools/release/release-preflight.ts`; `docs/release/alpha15-retrospective.md` §5 | the manual command is documented; the release train has no asset step yet |
| E5 | build and publish the fixed-toolchain image in the release train and record the resolved base/toolchain digests in the qualification report | `tools/release/toolchain/Dockerfile`; `tools/release/check-toolchain-pins.ts` | image recipe + pin auditor land in alpha15; by owner ruling 2026-10-20 the image build/digest recording is **deferred to alpha16** — the qualification host has no Docker runtime, so the acceptance's "image available / gates green inside it" is not claimed for alpha15 |
| E6 | render the PR/release evidence section directly from the REL-01 binder output instead of pasting a checklist | `tools/release/evidence-bind.ts`; `docs/release/alpha15-retrospective.md` §5 | a hand-pasted run pointer is what went stale in FR-06 |
| E7 | document the evidence-only prerelease policy (tag namespace, retention, not-a-release semantics) in CONTRIBUTING | `docs/release/evidence/alpha15/README.md`; retrospective §5 | policy currently stated only in the evidence README |

## Documentation and site

| id | candidate | evidence / tracker | notes |
| --- | --- | --- | --- |
| X22 | two comments still describe the alpha.14 command/manifest shape | batch cleanup report | text only |
| X23 | the starter's Node pin and the docs' Node wording need one authority chain | create template + getting-started | partially closed in alpha15 |
| X24 / X41 | the `/reference` page is 2.0 MB of HTML and is not split; size and split are one item | draft X24 and owner report X41 collide; merged here | owner report calls the action "X41 /reference split" |
| X25 | the search index size has no gate | www search tooling | pair with #1633 |
| X26 | the zh tree has zero axe coverage beyond the locale sweep; the theme-toggle accessible name is hardcoded English and allowlisted | accessibility coverage sweep allowlist; T10 register B4 | framework-component label needs a locale-aware API or a stated exemption |
| X27 | the roadmap timeline stops at the alpha.1 row | www roadmap content | content refresh |
| X30 | the shim inventory was deliberately left in English | task note in the batch report | translate or state the policy |
| X34 | the platform catch-up ledger has no zh mirror and no stated language policy | platform catch-up review | decide mirror or exemption |

## Runtime, assets and framework

| id | candidate | evidence / tracker | notes |
| --- | --- | --- | --- |
| X11 | dependency slim-down after the install surface is measured honestly | install-surface report | registered, not scheduled |
| X12 | the two known-reds ledgers need a sync mechanism | committed ledger vs gitignored working ledger | ids already collide once (KR-5) |
| X14 | the npm initializer does not forward `--no-install` | create CLI / npm create behaviour | upstream npm behaviour; document or adapt |
| X15 | the Node-floor single source needs an inlineable private workspace package | version/floor stamps | design item |
| X16 | the old "npm pack drops dotfiles" comment no longer describes this pipeline | packaging comments | verify then rewrite |
| X17 | a CI comment's request-time case count went stale after the q1b spec deletion | CI comments | text only |
| X20 | the starter and ui-app `main()` orchestration duplicate ~120 lines | create templates / UI appliance | share or justify |
| X38 | `**/.zcode/` is not ignored, so relative report paths under a filtered run can pollute fixture directories | ignore rules | one-line fix candidate |
| X39 | a kernel dashed `@property` declaration is silently dropped | conditional-block runtime; named in the owner report | needs a coded diagnostic or documented unsupported form |
| X40 | island CSS is not de-duplicated or minified | style-asset pipeline; owner report | pair with the style provider port |
| X43 | no stale-output contract test for hybrid projects: a pre-existing `dist/server/index.js` is deployable contract output, while a pure-static tree must not keep `server/` | `packages/router/src/cli/build-ssg.ts` (`finalizePureStaticOutput`); REL-05 evidence | the pure-static removal path is now tested; the hybrid retention state is not |
| X44 | the tweet-length CodeQL dismissal reason (280-char API cap) forces the written rationale into the disposition record instead of the alert itself | `docs/release/evidence/alpha15/rel02-codeql-disposition.md` | keep the record as the authority; link it from the thread reply |

## User-journey dogfood findings (2026-10-19, Lead-run)

These came out of scaffolding the candidate starter from the docs and building a
dynamic loader/action page. The product path (packed tarballs) is green; these
are tooling, CLI and documentation-precision gaps, not release blockers.

| id | candidate | evidence | notes |
| --- | --- | --- | --- |
| F1 | in a workspace-`link:` candidate install, a fresh starter's `pnpm typecheck` dies with a TypeScript internal `Debug Failure`; packed-tarball types typecheck fine | dogfood log; release log records the packed starter typecheck passing | fixture tsconfigs avoid it by excluding the config file; add a linked-mode gate or fix the TypeScript interaction |
| F2 | ~~`oe start --port` is silently ignored and `oe start --help` starts the server~~ — FIXED in the alpha15 cleanup batch (CLI-01): `--help/-h` prints usage and exits before any filesystem/port work, unknown start args fail closed with exit 2 and env-var guidance | dogfood log; `packages/router/__tests__/start-cli.test.ts` | retained as history; the doc contract stays env-only |
| F3 | the config file rejects old keys (`appShell`, `html`) with a generic unknown-key error, while the inline form has rename guidance | dogfood log; app-config rename map | reuse the rename map in the config schema |
| F4 | a directly loaded no-island page still prefetches island chunks in the production build | dogfood browser request log | cost-honesty wording or conditional prefetch |
| F5 | the dev server ignores the `PORT` environment variable | dogfood log | document the dev port knob or honour `OPEN_ELEMENT_PORT` |
