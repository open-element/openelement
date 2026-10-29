# DOC-01 — alpha15 site truth and guide-command corrections

Lane E (docs-site), task-5. Repo: `<repository root>`, branch `alpha15`, HEAD `ef5da43` plus the batch worktree edits. No commit, push or deploy was performed (this session holds no Cloudflare credentials).

## 1. How the site version is derived

| Layer | Owner | alpha15 fact |
| --- | --- | --- |
| `docs/release/release-state.json` | release lane | `sourceVersion` `1.0.0-alpha.15`; `activeTarget` `v1.0.0-alpha.15`; per-package registry `alpha`/`latest` `1.0.0-alpha.14`; `latestPrerelease` `1.0.0-alpha.14`, state `complete` (read-back 2026-10-10) |
| `www/tools/generate-site-content-data.ts` | generated data | projects release-state into the generated module below; `--check` (no write) reports drift |
| `www/app/data/_generated-release-line.ts` | generated | `SOURCE_VERSION = 1.0.0-alpha.15`; `SOURCE_LINE_PUBLISHED = false`; `ALPHA_RESOLVES_TO = 1.0.0-alpha.14`; `LATEST_PRERELEASE_VERSION = 1.0.0-alpha.14`; `PACKAGE_COUNT = 6` |
| `www/app/data/version.ts` | site source | `OPENELEMENT_VERSION = v${SOURCE_VERSION}`; `sourceLineStamp()` renders `v1.0.0-alpha.15 · repository baseline` while the line is unpublished; `PUBLISHED_LATEST` is the per-package display projection the state-machine check guards |
| `www/package.json` | package | `"version": "1.0.0-alpha.15"` |

Two facts coexist by design and are not a contradiction: the **source line** (`1.0.0-alpha.15`, what this repository builds) and the **registry line** (`1.0.0-alpha.14`, what npm `latest` serves until the publish gate runs). Copy that names a published version reads the registry projection, never the source constant — see the header of `www/app/data/version.ts`.

## 2. Internal consistency — commands and results

```sh
pnpm --dir tools/repo run release:state-machine:check
# Release state check passed: source 1.0.0-alpha.15; common complete none; prerelease 1.0.0-alpha.14 (complete).

pnpm --filter @openelement/www run check:install-command
# Install-command check passed (10 display files, 1 canonical string).
```

`check:content-data` (generated projection drift) is **red at report time** because content documents changed across lanes after the last `generate:all`; the only file named is `www/app/data/_generated-guide-data.ts`. This lane cannot regenerate it (the batch rules reserve `generate:all` for consolidation), and other lanes are editing `www/content/docs/guide/{deployment,security}.md` concurrently, so a targeted regeneration now would snapshot half-written cross-lane content. The Lead runs `generate:all` at consolidation; re-run `check:content-data` after it.

## 3. Built-site facts (local `www/dist`, built 2026-10-19 17:45)

```sh
find www/dist -name "*.html" | wc -l                                    # 74
grep -rl "1.0.0-alpha.15" www/dist --include="*.html" | wc -l           # 64
grep -o "Applies to v1.0.0-alpha.15 · repository baseline" www/dist/guide/getting-started/index.html   # 1
grep -o "适用于 v1.0.0-alpha.15 · 仓库基线" www/dist/zh/guide/getting-started/index.html                 # 1
```

The roadmap page states both lines in one sentence (EN and ZH agree):

```text
The stable maintenance line closed at 0.43.3. The current 1.0 alpha line serves 1.0.0-alpha.14 on
npm's per-package latest dist-tag, with 1.0.0-alpha.15 as the repository baseline.
```

The home page prints the per-package registry table (six `v1.0.0-alpha.14` entries) plus `prerelease line — no stable release yet; all packages share one version` — registry truth, not a source-line claim. No site source or content file asserts alpha.14 as the *current/source* line: `grep -rn "alpha.14" www/content www/app` returns only the registry projection in `www/app/data/version.ts`, the historical changelog archive, and a doc-claims test fixture.

## 4. Live deployment is stale — verified, not fixed here

Fetched 2026-10-19 ~20:07 +08:00 (`curl -s https://openelement.org/ -o /tmp/docs-site/live-home.html`; `web_fetch` refuses the hostname because it resolves to a non-public address):

```sh
grep -o "v1.0.0-alpha.14 · six packages · one version" /tmp/docs-site/live-home.html | wc -l   # 1
grep -c "1.0.0-alpha.15" /tmp/docs-site/live-home.html                                        # 0
```

The live home page is the older single-line layout (`v1.0.0-alpha.14 · six packages · one version`); the current source renders the per-package registry table and the source-line stamp on guide pages. So the live site is an older deployment, exactly as the task book records. **Fixing the deployment is out of reach in this session** (no Cloudflare credentials, and the batch rules forbid a site build).

## 5. Deploy-trigger facts that are repo-verifiable, and what needs the post-merge push

| Fact | Evidence |
| --- | --- |
| The host is Cloudflare Pages with custom domain `openelement.org` | `www/public/CNAME` = `openelement.org`; `www/public/_headers` header comment: "Cloudflare Pages reads this file from the build output root; `www/public/**` is copied into `dist/` verbatim" |
| The Pages build hook exists as a root script | `package.json` `pages:build` = `vp run site:build`; no other workspace script is named for Pages |
| What gets built | `site:build` = gate(`generate:all`, `@openelement/www#build`, `#pagefind`, `#emit:redirects`, `#emit:sitemap`, `#emit:rss`) → output `www/dist` |
| There is no in-repo deploy step | `grep -rn -i "cloudflare|wrangler|pages deploy" .github/workflows` → no hits; the workflows only build/verify (`autoflow-ci.yml` "Build site", `site:build`) |

Consequence: the production deploy is owned by an external Pages project connected to this repository, or by a credentialed manual deploy. Rebuilding production therefore requires the **post-merge push to the deployment branch** (or a manual `wrangler pages deploy www/dist` with Cloudflare credentials). Neither the Pages project build command nor the deployment timestamp can be read back from the repository or the served HTML (the site carries no build marker), so the deploy trigger itself remains unverified in this session.

## 6. Guide corrections: duplicated install and non-existent commands

### 6.1 Duplicated install — none remains in the quickstart

`www/content/docs/guide/getting-started.md` / `.zh.md`: the Install fence is three commands (`{{INSTALL_COMMAND}}`, `cd my-app`, `npm run dev`) and the prose states the generator installs the dependencies, "so there is no separate install step". The count is derived from the fence (`www/lib/quickstart.ts` → `_generated-quickstart.ts`: `QUICKSTART_COMMAND_COUNT = 3`) and `check:install-command` (green) compares both locales, the prose count and the consumers. `guide/tutorial.md` Step 1 repeats the same three commands and repeats the no-separate-install statement; the only `npm install` there is the documented `--no-install` handoff fallback, not a step to run.

### 6.2 Command audit over `www/content/docs/**`

Every documented command was cross-checked against the package that owns the script:

| Documented command | Owner / verdict |
| --- | --- |
| `npm create @openelement my-app` (`{{INSTALL_COMMAND}}`) | canonical string from `packages/create/src/install-command.ts`; `check:install-command` green |
| `npm run dev`, `npm run build`, `npm start`, `npm test`, `npm run typecheck`, `npm run fmt`, `npm run lint` | `packages/create/templates/package.json.tmpl` ships exactly `dev/build/start/test/fmt/lint/typecheck` |
| `npm install @openelement/element`, `npm install -D @openelement/compiler` | package names exist in the workspace; this is getting-started's documented standalone-runtime path (not the quickstart) |
| `npm install marked@^15.0.0` | `marked` is a declared (optional) peer of `@openelement/router`; MDX guide path |
| `openElement start --mode=preview`, `oe start` | `packages/router/package.json` bins `openelement` and `oe`; `packages/router/src/cli/cli.ts` usage lists `start [--mode=preview]` |
| `pnpm run site:build` | root `package.json` script `site:build` |
| `vp run site:verify` | root `package.json` script `site:verify` |
| `pnpm --dir www run generate:content` | `www/package.json` script `generate:content` |
| `npx wrangler pages deploy dist`, `npx nitro deploy --prebuilt`, `npx wrangler --cwd ./ deploy`, `npx nitro@3.0.260610-beta build` | third-party tools, not workspace scripts; the pinned nitro version cannot be validated offline. `deployment.md` is the security lane's file — reported, not edited |

Transcript strings in `tutorial.md` were matched against the tools that print them: `openElement project created at ./my-app/ (template: showcase)` and `openElement project ready` (`packages/create/src/cli.ts`), `[openElement start] request-time server entry loaded (dynamic routes enabled)` (`packages/router/src/cli/start.ts`).

### 6.3 The `pnpm check` suspect

* `grep -rn "pnpm check" www/content/docs` → **0 hits**; the docs never spell the repo gate that way.
* The repo script is `check` (`package.json`), and the repo's own docs use `pnpm run check`. Tested in a scratch project (`/tmp/docs-site/pmexp`): `pnpm check` (no `run`) **does execute** the `check` script under pnpm 12.3.4 (`exit=0`, `$ echo CHECK_RAN`), so the short spelling is not a broken command for this repository.
* The real defect behind the suspect is the **scaffold** side, recorded as CL-23 in `.zcode/plans/alpha15-debt-ledger.md:113` ("new scaffold `pnpm check` → Missing script"). It is already reconciled in the tree: `packages/create/templates/package.json.tmpl` ships no `check` script, and `packages/create/README.md` documents exactly the scripts it ships. No public doc tells a scaffold user to run `check`, so no edit was needed.

## 7. Changes made by this lane (DOC-01 scope)

No site-version fix was required. The DOC-03 copy fix (`www/app/routes/reference.tsx`) and the streaming-guide boundary sentence (`www/content/docs/guide/streaming.md` / `.zh.md`) are recorded in `docs/release/evidence/alpha15/doc02-content-gate-audit.md` §8 and the lane report.

Verification run for this document: `release:state-machine:check` (passed), `check:install-command` (passed), `check:doc-claims` (passed: 74 files, 47 known versions, 37 gates, 10 CI jobs), `pnpm exec vitest run --project www www/tools/check-content-examples.test.ts` (13 passed).

## 8. Post-merge verification (for the Lead, after `site:build` and merge)

```sh
# built output, before deploy
grep -rl "1.0.0-alpha.15" www/dist --include="*.html" | wc -l          # expect 64+
grep -o "alpha.15 as the repository baseline" www/dist/roadmap/index.html | wc -l   # expect 1 (the roadmap's own stamp wording; confirmed on the Lead's empty-dist rebuild)
grep -o "six packages · one version" www/dist/index.html | wc -l        # expect 0 (old layout is gone)

# after the Pages build serves the merge
curl -s https://openelement.org/roadmap | grep -o "1.0.0-alpha.15" | wc -l      # expect >= 1
curl -s https://openelement.org/ | grep -o "six packages · one version" | wc -l  # expect 0
```
