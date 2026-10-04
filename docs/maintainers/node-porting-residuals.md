# node-porting residuals (B1b)

Fact sheet from the B1b port (tools/repo, www, apps/saas — 103 distinct files
touched across commits 4f8c6fec9, 6efbac2d0, and this one; the 66+46+22
per-lane estimates in the plan sum higher because files are shared). It lists
the Deno-native capabilities that have **no direct node:\* equivalent**, where
each one still lives, and its expiry path. Facts only; design decisions belong
to the lanes that own them.

## 1. Test registration — `Deno.test` — RESOLVED IN B3

The B3 lane migrated every suite to vitest (runner decision: vitest 5.x on the
node host; registration + `@std/assert` moved by the auditable codemods in
`tools/repo/codemod-deno-test-to-vitest.ts` and `codemod-deno-runtime-to-node.ts`,
with the special-construct helpers in `tests/lib/vitest-asserts.ts`). The root
`bench` script now runs the vitest benchmarks project (B3 补漏), and B4 moved
the JFB harness itself onto node:\* (that in-repo JFB surface was then removed
entirely on 2026-10-03, owner ruling — the upstream benchmark lane lives on
the fork). Remaining `Deno.test` text is product/docs
prose that teaches framework users their own test setups. Package `test`
scripts now invoke vitest.

Sub-residuals disclosed at the cutover:
- **Sanitizer leak detection retired with the host**: the deno runner's
  `--sanitizeOps/--sanitizeResources/--sanitizeExit` options (dropped by the
  codemod from 11 registrations) and the `deny-ffi`/`no-prompt` non-interactive
  flags had no node equivalent — leak detection and permission-prompt
  suppression are deno-host facilities. Node's own guards (unhandledRejection
  process traps in the ported suites) cover the rejection half.
- **Browser gate engine matrix**: `browser:gate` runs chromium only (PR
  layer); `browser:gate:full` sets `OE_BROWSER_MATRIX=full` for the
  chromium+firefox+webkit conformance matrix through the vitest playwright
  provider — same fail-closed engine-list rule as the retired
  web-test-runner gate.

## 2. Permission model (`--allow-*`) — RESOLVED IN S2 (owner ruling 2026-10-03)

Deno gated fs/net/env/ffi even when access happened through `node:*` imports.
Probed during the port: `node:child_process` spawn calls
`Deno.env.toObject()` internally on every spawn, so a script holding bare
`--allow-run` failed with `NotCapable: Requires env access`. That is why the
port gave every task whose first process was `run-in.ts`/`gate.ts` (and the
spawning children: release-state-machine, retired-api, version-bump,
export-files, clean-proof, check:doc-figures) a `--allow-env` flag on its
then-`deno run` entry. The S2 Node-host migration removed those entries and
the flags with them — no workspace package.json carries `--allow-*` today —
and with the flags went the fail-closed prompt property. That loss was the
cost of migration, not something B1b solved.

## 3. Runtime entry and task graph

RESOLVED IN S2 (owner ruling 2026-10-03): every CI-reachable entry is
node/pnpm. The workflows, the composite setup action, and the candidate-evidence
chain (`candidate-steps.ts` argv contracts, schema v3) entered through
`node`/`pnpm` at the B4 cutover; the S2 release-lane port converted the rest —
the `tools/release` package.json entries (publish/pack, the packaged-consumer
harnesses, the published-consumer qualification), the fixture/qualify scripts
(`router-nitro` proofs, `third-party-web-components`, `web-component-interop`),
the fixture e2e servers and their Playwright `webServer` commands, and the
qualify harness's temp-app universe (build-router, workspace-alias,
scaffold-app) — and deleted the transitional `setup-deno` step from
`setup-node-workspace` (deno@2.9.0, the retired `.dvmrc` pin, is no longer
installed anywhere in CI). The published-consumer qualification's Deno-consumer
leg retired with the host: the npm-mode Node consumer leg (core imports plus
the `@openelement/router/vite` entry) now carries that proof. The alpha8
residue sweep closed the last non-CI entries too: the `apps/saas` package
scripts (`nitro:build` / `nitro:build-workers`) run
`node ../../tools/release/nitro-build.ts`, the provider-gated
`apps/saas/scripts/quota-race-proof.ts` carries a `#!/usr/bin/env node`
shebang (still deliberately excluded from the saas vitest project — the
script races the real Supabase project and reads provider secrets), and the
streaming measurement script moved onto the node-http shape (§5). What
remains is dormant or textual, none of it an executed entry: the
`benchmarks/micro` standalone `import.meta.main` blocks (`micro.ts`,
`keyed-reorder.ts`) are now ported onto `node:*` — standalone evidence runs
go through `node benchmarks/micro/micro.ts --write` (and the
`keyed-reorder.ts` equivalent), while the vitest benchmarks project still
exercises only the deterministic self-checks in `micro.test.ts`, never a
standalone entry — and a few `tools/repo` script headers (clean-proof,
run-in, check-release-version, check-esm-boundary) still carry stale
`deno run` usage prose.

## 4. Module resolution artifacts

RESOLVED IN B2: `deno.lock` (root + six fixture universes), `vendor: true`
and `nodeModulesDir: "manual"` retired with the deno.json files; the
repository carries a single `pnpm-lock.yaml` (per-fixture npm-shaped
universes like url-pattern-list-audit keep their own committed lockfile).
The JSR specifier dependencies B2 still carried through the JSR npm-compat
registry mirrors were retired in the alpha8 dependency lane: the lock holds
no registry-mirror entries and the registry `.npmrc` bridge is deleted.
`check-fixture-locks.ts` was deleted with its gate step.

## 5. `Deno.serve` — no node:\* one-liner; RESOLVED in the alpha8 residue sweep

No node:\* one-liner exists for a fetch-handler server. B1a replaced the
router product usage with `packages/router/src/internal/node-http.ts`
(fetch(Request): Response on node:http). B2/B3 retired the shared static
server (`tools/lib/static-server.ts`), the pack qualification server
(`tools/release/consumer-packaged-element.ts`), and the parity harness;
B4 ported the JFB harness's `run.ts` onto `node:http` (that whole in-repo JFB
surface was removed on 2026-10-03, owner ruling — upstream lane on the fork —
taking its unrunnable swap-repeat probe with it). The last executable call —
the manual `benchmarks/streaming/measure.ts` fixture server — now runs the
same `serveFetch` adapter (node:http carrying the standard fetch(Request):
Response dispatch), so no executable `Deno.serve` remains in the repository.

Comment-only mentions (no executable call), owned by the other lanes of the
same sweep: `docs/adr/ADR-0154`; `www/content/docs/guide/deployment*.md` and
one blog post teach it in prose.

## 6. Error taxonomy

Call sites are now errno-based: the tools/repo production classifiers check
`ENOENT` only (old `Deno.errors.NotFound`) — `clean.ts:159`,
`check-release-state-machine.ts:241`, `check-workspace-links.ts:111`,
`check-no-allow-all.test.ts:158`. `EACCES`/`EPERM` (old `PermissionDenied`)
appears only in the test stub `check-no-allow-all.scope.test.ts:136` and in
pre-B1a product code (`packages/create/src/cli.ts:33`).
Residual: errors thrown by the Deno runtime itself (`NotCapable`, permission
prompts) had no node shape and surfaced as Deno classes. Collected with S2:
the expiry condition — the runtime stops being Deno — is satisfied, since
every CI-reachable and production entry runs on node/pnpm (§3); no
executable repository path can raise Deno runtime error classes anymore.

## 7. Subprocess semantics deltas — centralized, probed

`tools/repo/node-command.ts` is the single seam. Deltas it absorbs (all
probed against this runtime during B1b): signal-killed children report
`code = 128 + signal number` (Deno shape) instead of node's `code null`;
`env` merges over the parent (Deno semantics) instead of replacing; default
stdio `stdin inherit, stdout/stderr piped`; spawn failure rejects (Deno threw
`NotFound`). The helper uses only node:\* APIs, so it runs unchanged on a real
Node host. Residual: the abort path was verified under Deno only (kill +
SIGTERM, no AbortError event); a Node-host run should re-verify that one path.

## 8. Workers boundary

Deno APIs have no Cloudflare Workers mapping; node builtins map through
`nodejs_compat`. `tools/repo/check-workers-boundary.ts` allowlists exactly
`node:process` and `node:buffer` in the packed Workers output (5 server
modules, verified green after the port). The B1b port strictly widened what
can deploy there; any reintroduced Deno API would fail that boundary check.

## 9. Kept as-is on purpose

- `@std/*` jsr dependencies (`@std/path`, `@std/fs/walk`, `@std/semver`,
  `@std/assert`): originally kept as Deno-ecosystem but runtime-portable.
  That call was reversed in alpha8 — retirement is complete: every tooling
  import now uses `node:path`/`node:url`/`node:assert/strict`/`node:util`,
  the npm `semver` package replaces `@std/semver`, the homemade walk/glob/
  YAML helpers are gone (node:fs recursion, fast-glob + yaml), the `.npmrc`
  JSR registry bridge is deleted, and the lock carries zero `@jsr` entries.
  The pack surface was already `@std`/`@jsr`/`jsr:`-free (see
  pack-post-processing.md).
- `import.meta.main` as the entry-module idiom in CLI scripts: supported on
  Node 24.2+ — the repository floor (root `package.json` `engines` requires
  `node >=24.2`, and `.node-version` pins the 24.18 development line, where
  it is verified working) — so it stays with no substitute needed.
- `@openelement/element/build-utils` and the TypeScript compiler API surfaces:
  already host-neutral.
