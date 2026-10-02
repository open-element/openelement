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
with the special-construct helpers in `tests/lib/vitest-asserts.ts`). The only
remaining `Deno.test` code is `benchmarks/` (still on `deno test benchmarks/`
via the root `bench` script) and product/docs prose that teaches framework
users their own test setups. Package `test` scripts now invoke vitest.

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

## 2. Permission model (`--allow-*`) — no node equivalent

Deno gates fs/net/env/ffi even when access happens through `node:*` imports.
Probed during the port: `node:child_process` spawn calls
`Deno.env.toObject()` internally on every spawn, so a script holding bare
`--allow-run` fails with `NotCapable: Requires env access`. That is why every
task whose first process is `run-in.ts`/`gate.ts` (and the spawning children:
release-state-machine, retired-api, version-bump, export-files, clean-proof,
check:doc-figures) now carries `--allow-env`. Current posture: flags stay on
the `deno run` entries; there is no node-side replacement. Expiry: a Node-host
migration removes the flags and, with them, the fail-closed prompt property —
that loss is the cost of migration, not something B1b solved.

## 3. Runtime entry and task graph

`deno run` / `deno task` / `deno test` shebangs and the nested
`run-in.ts --root …` invocation style are the runtime entry. node:\* is only
the library layer beneath them. Expiry: any Node-host shift changes the entry
points, not the ported APIs.

## 4. Module resolution artifacts

RESOLVED IN B2: `deno.lock` (root + six fixture universes), `vendor: true`
and `nodeModulesDir: "manual"` retired with the deno.json files; the
repository carries a single `pnpm-lock.yaml` (per-fixture npm-shaped
universes like url-pattern-list-audit keep their own committed lockfile).
jsr: specifiers survive as pnpm `jsr:` dependencies resolved to `@jsr/*`
registry mirrors. `check-fixture-locks.ts` was deleted with its gate step.

## 5. `Deno.serve` — no node:\* one-liner; product replaced, repo has live residuals

No node:\* one-liner exists for a fetch-handler server. B1a replaced the
router product usage with `packages/router/src/internal/node-http.ts`
(fetch(Request): Response on node:http), but `Deno.serve` calls survive
outside the B1b lanes — B2/B3 residuals, listed here rather than claimed zero:

- `tools/lib/static-server.ts:113` — the shared static server; serving the
  www e2e web server through the thin wrapper `www/e2e/static-server.ts:14`
- `tools/release/consumer-packaged-element.ts:145` — pack qualification server
- `packages/router/__tests__/request-time-parity.test.ts:37` — dev/prod parity
  harness (its doc comment, line 11, names Deno.serve too)
- `benchmarks/jfb/harness/run.ts:329`, `benchmarks/jfb/harness/swap-repeat-probe.ts:125`,
  `benchmarks/streaming/measure.ts:85` — benchmark harnesses

Comment-only mentions (no executable call): `tests/lib/qualify-harness/serve-static.ts:5`,
`tools/release/consumer-packaged-node-serve.ts:21`, `docs/adr/ADR-0154`.
`www/content/docs/guide/deployment*.md` and one blog post teach it in prose.
Expiry: the B2/B3 lanes (or a benchmark-owner pass) replace the live calls with
the node-http shape; docs follow the product copy.

## 6. Error taxonomy

Call sites are now errno-based: the tools/repo production classifiers check
`ENOENT` only (old `Deno.errors.NotFound`) — `clean.ts:159`,
`check-release-state-machine.ts:241`, `check-workspace-links.ts:111`,
`check-no-allow-all.test.ts:158`. `EACCES`/`EPERM` (old `PermissionDenied`)
appears only in the test stub `check-no-allow-all.scope.test.ts:136` and in
pre-B1a product code (`packages/create/src/cli.ts:33`).
Residual: errors thrown by the Deno runtime itself (`NotCapable`, permission
prompts) have no node shape and still surface as Deno classes. Expiry: they
disappear only when the runtime stops being Deno.

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
  `@std/assert`): Deno-ecosystem but runtime-portable; porting them bought
  nothing.
- `import.meta.main` as the entry-module idiom in CLI scripts (no node
  equivalent; `import.meta.url` comparisons would be the substitute). Expiry:
  same as the runtime entry, §3.
- `@openelement/element/build-utils` and the TypeScript compiler API surfaces:
  already host-neutral.
