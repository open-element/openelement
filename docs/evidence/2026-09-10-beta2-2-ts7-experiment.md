# Beta.2.2 — TypeScript 7 (stable) evaluation for the type/declaration pipeline

- Date: 2026-09-10
- Issue: #1156 (Beta.2.2 slice)
- Harness: `tools/experiments/ts7/` (this record is produced by re-running it, not by
  transcription; sibling experiments for the same issue: `tools/experiments/oxc/`,
  `tools/experiments/cem/`)
- Experimenter: agent session, evidence-hardening pass (supersedes the earlier
  chat-only report whose scratch state lived in /tmp, and the intermediate record
  that targeted the `@typescript/native-preview` daily dev build)

```text
STATUS: PASS (all hard criteria), DECISION: PROCEED with conditions (Alpha-stage,
type/declaration pipeline only — NOT a deno check replacement, NOT a Compiler-API
replacement)

TESTED_IMPLEMENTATION_SHA:
f83398daeac7c3d25b88e6df2abbece493607db4
("fix: close Beta.2.2 review findings (ADR-0153)") — the implementation commit
whose clean tree this harness ran against (git status at run time: clean apart
from the untracked docs/evidence/ files being drafted; the harness itself writes
only under tools/experiments/ts7/.work/, gitignored). This evidence file is
added by a LATER evidence-only commit that changes no code, harness, lockfile or
generated file; the PR final SHA is bound by the remote CI run on that final
SHA, not by this file.

Environment: macOS 26.5.1 (build 25F80), Apple Silicon (arm64, darwin/aarch64);
Deno 2.9.0 (stable, release, aarch64-apple-darwin); Node v24.18.0; npm 11.16.0
(for the pinned toolchain install only).
Toolchain under test: typescript@7.0.2 — the exact STABLE 7.0.x package
(installed under the npm alias `typescript-7`; the harness invokes the real
package binary tools/experiments/ts7/toolchain/node_modules/typescript-7/bin/tsc
directly). Runtime verification: `tsc --version` prints "Version 7.0.2" and the
harness hard-gates on that output — the version under test is never inferred
from package.json. Reference line: typescript@5.9.3 (alias `typescript-5`,
matches the root deno.json import-map pin npm:typescript@^5.9).
VERSION CHOICE: 7.0.2 is the newest stable 7.0.x on npm as of 2026-09-10
(`npm view typescript dist-tags`: latest=7.0.2; the only other stable-line
artifact is the 7.0.1-rc prerelease). The earlier dev-build target
@typescript/native-preview@7.0.0-dev.20260707.2 is superseded: TS7 now ships as
the stable `typescript` 7.x package itself, so the experiment pins that exact
stable version (no latest/next/^/~ anywhere; toolchain/package-lock.json pins
the resolved tarball URLs + integrity hashes).

INPUTS (sample set):
- packages/app/src (19 modules incl. the document.ts export surface) via
  `deno check src/` in packages/app — the repo gate — vs ts7 on a scratch
  tsconfig (strict, bundler resolution, allowImportingTsExtensions, skipLibCheck,
  paths mapping @openelement/element + subpaths incl. /authoring to workspace
  sources).
- packages/ui/src/open-button.tsx (real compiled-element component: @element
  class decorator + @property field decorators, JSX with jsxImportSource
  @openelement/element).
- Resolution matrix fixtures (generated): npm dep (hono), relative pair with
  explicit .ts extension, subpath-exports package, npm:/jsr: specifiers, paths
  shim, removed baseUrl.
- Declaration emit: packages/app via ts7 --declaration --emitDeclarationOnly
  --declarationMap, the same config under tsc 5.9, and the repo's real pack path
  (`deno pack --allow-dirty`) run on a scratch workspace copy — never published.
- Compiled-element staging: the repo's own tools/lib/compiled-pack-staging.ts
  (compilePackageElementModules + stageCompiledPackWorkspace) for @openelement/ui
  (10 compiled .tsx modules), then ts7 strict/relaxed/emit and `deno pack` on the
  staged directory.
- Independent consumer: the packed app+element tarballs installed into a scratch
  node_modules; a small program typechecked with BOTH tsc 5.9 and ts7.

PASS/FAIL CRITERIA:
Hard (exit 1 on any failure): ts7 clean where deno check is clean (app, ui TSX);
npm:/jsr: must fail with exactly TS2307; relative .ts imports must require
allowImportingTsExtensions (TS5097) and pass with it; npm-dep and subpath-export
resolution must work; ts7 declaration emit must cover every packages/app module
and every module deno pack typed (superset); tsc 5.9 must emit the same .d.ts
file set; staged compiled output must fail full-strict ts7 with implicit-any
codes and pass with exactly the two documented relaxations; ts7 must emit
declarations for every staged ui module; consumer parity both directions (clean
on valid, identical diagnostic codes on invalid).
Soft (recorded, non-gating): urlpattern-polyfill TS2300 collisions without
skipLibCheck; tsc 5.9 lib.dom gap (NavigateEvent/URLPattern globals); deno pack
silently untyped modules; ts7-vs-tsc byte-level declaration differences; timing
and memory.

RESULTS MATRIX (harness run on the TESTED_IMPLEMENTATION_SHA tree, exit 0;
hard 20/20 pass, soft 7/7 recorded):
[H1] toolchain pins exact: ts7 7.0.2 (stable, runtime --version verified),
     tsc 5.9.3. PASS.
[H2] res npm-dep hono via node_modules: ts7 exit 0. PASS.
[H3] relative "./util.ts": TS5097 without allowImportingTsExtensions, clean
     with. PASS.
[H4] subpath exports (pkg + pkg/extra via exports map): ts7 exit 0. PASS.
[H5] npm:/jsr: specifiers: TS2307 x2 — "error TS2307: Cannot find module
     'npm:hono@^4.12' or its corresponding type declarations." (and likewise for
     'jsr:@std/fs/walk'). No import-map support. PASS (documented unsupported).
[H6] packages/app: deno check exit 0; ts7 exit 0 — PARITY. PASS.
[H7] packages/ui open-button.tsx: deno check 0, ts7 0, tsc 5.9: 0. The decorator
     intrinsics are typed `(target: unknown, context?: unknown) => void`
     (packages/element/src/internal/core/compile-decorators.ts) — accepted under
     BOTH TC39-standard (ts7 default) and legacy typings; no
     experimentalDecorators requirement. PASS.
[H8] emit app: ts7 exit 0, 19/19 modules, 73 declaration maps. PASS.
[H9] emit app ts7-vs-tsc: identical .d.ts file set; 2 byte-differing files
     (element/src/internal/protocol/errors.d.ts, framework.d.ts — quote style
     'SSR_RENDER_ERROR' vs "SSR_RENDER_ERROR" only). PASS.
[H10] ts7 d.ts superset of deno pack d.ts for app: 16/16 covered. PASS.
[H11] staged ui: staging config carries exactly noImplicitOverride:false +
      noImplicitAny:false; full-strict ts7 fails with 23 implicit-any-class
      errors (TS7006 x17, TS7034 x3, TS7005 x3); relaxed ts7 exit 0; ts7 emit
      16/16 staged modules. PASS.
[H12] consumer: valid program clean under both compilers; invalid program
      rejected by both with identical codes (TS2305+TS2554 each). PASS.
[S1] app without skipLibCheck: TS2300 x9 (urlpattern-polyfill `declare global`
     URLPattern* vs TS7 lib.dom, which ships URLPattern). Deno's gate does
     not surface this because the root compilerOptions set skipLibCheck:true.
[S2] tsc 5.9 on the identical app config FAILS where ts7/deno pass: 9 errors —
     TS2552 'navigation' x2, TS2304 'NavigateEvent' x6 (both in
     src/internal/router/client-router.ts), TS2339 globalThis.URLPattern x1
     (route-table.ts). TS7's lib.dom is NEWER than the repo-pinned tsc's and
     matches Deno's gate better.
[S3] deno pack type-generation gaps re-verified on the CURRENT tree: app ships
     16 d.ts and silently drops src/internal/action-error, dev-mode,
     spa-request-cache (same 3 as the earlier base); element ships 45 d.ts and
     drops 18 internal modules; the STAGED ui pack ships ZERO d.ts (16
     type-generation failures). ts7 covers all of these. Root cause not
     diagnosed (deno pack prints no reason even at --log-level=debug). This
     deep-.d.ts/deno-pack gap stays on the Beta.2.3 list.
[S4] known divergence locked by assertion: ts7/tsc declarations retain '.ts'
     import specifiers ("from './authoring.ts'"); deno pack rewrites to '.js'.
     rewriteRelativeImportExtensions rewrites JS emit only — identical behavior
     in tsc 5.9 and ts7 (verified in a fixture), so this is upstream TS, not a
     ts7 bug. A ts7 declaration pipeline needs a .ts->.js specifier post-pass.
[S5] TS7 removed baseUrl: "error TS5102: Option 'baseUrl' has been removed.
     Please remove it from your configuration. Use '"paths": {"*": ["./*"]}'
     instead."
[S6] diagnostic cosmetics: ts7 elaboration is shallower (tsc wraps
     assignability failures in TS2345, ts7 reports only the leaf code, e.g.
     TS2740) and error exit codes differ (tsc=2, ts7=1). A literal tsconfig
     'paths' key CAN rescue an 'npm:' specifier (leaving the 'jsr:' one as
     TS2307) — a manual, version-unaware shim, not import-map semantics.

TIME + MEMORY (3 runs each, warm caches, packages/app scope = 19-module sample,
program pulls @openelement/element sources; wall ms via harness timer, peak RSS
MB via /usr/bin/time -l — AVAILABLE on this host):
  deno check src/ (app)   : 308/301/321 ms   217.0/217.8/220.4 MB
  ts7 --noEmit (same)     : 108/107/105 ms   100.9/100.4/105.0 MB
  tsc 5.9 --noEmit (same) : 662/665/651 ms   320.4/322.0/319.4 MB
  ts7 declaration emit    : 112/113/111 ms   110.1/110.7/110.4 MB
  tsc 5.9 same emit       : 728/720/724 ms   325.9/324.5/325.9 MB
  deno pack app           : 384/369/378 ms   230.4/230.4/232.9 MB
On this fixed 19-module sample, on this machine, inside this bounded harness,
the ts7 CLI run is ~2.9x faster and ~2.1x leaner than deno check and ~6.2x
faster and ~3.2x leaner than tsc 5.9 on identical work. This is a fixed-sample,
single-host parser/type-pipeline micro-measurement — NOT an OpenElement
production-build speedup claim. Cold-cache timing NOT measured.

TYPESCRIPT COMPILER-API BOUNDARY INVENTORY (TESTED_IMPLEMENTATION_SHA; grep
"from 'typescript'" over tools/ + packages/ = 20 files — the ts7 CLI replaces
NONE of these; TS7 stable ships no supported programmatic Compiler API, so they
stay on npm:typescript@^5.9):
  Full-program analysis (ts.createProgram):
    tools/check-content-examples.ts, tools/check-content-examples.test.ts,
    tools/check-public-interface-snapshot.ts, tools/lib/api-reference.ts
  Declaration/import-graph walks (ts.preProcessFile / ts.resolveModuleName):
    tools/consumer-packaged-element.ts, tools/consumer-packaged-app.ts
  AST parse / structural walks (ts.createSourceFile, ts.is* guards,
  ts.getDecorators):
    tools/lib/typescript-ast.ts, tools/lib/content-graph-adapters.ts,
    tools/check-www-truth.ts, tools/check-v044-legacy-absence.ts,
    tools/generate-ui-manifest.ts, tools/coverage-summary.ts,
    tools/migration/v044/migrate.ts,
    packages/adapter-vite/src/internal/content/nav/scanner.ts
  Element compiler core (createSourceFile + ts.transpileModule for syntax
  diagnostics):
    packages/adapter-vite/src/internal/compiler/semantic-core/compile.ts,
    packages/adapter-vite/src/internal/compiler/semantic-core/module-analysis.ts,
    packages/adapter-vite/src/internal/compiler/semantic-core/diagnostics/index.ts,
    packages/adapter-vite/__tests__/compiler-semantic-core-boundary.test.ts
  Sibling experiments:
    tools/experiments/oxc/run.ts, tools/experiments/cem/oe-plugin.ts

MEANINGFULNESS_EVIDENCE:
The harness has teeth, demonstrated against this very tree: the first harness
run FAILED hard (exit-1 path exercised) on parity.app and emit.app because the
branch had moved past the earlier experiment's base — app/src now imports the
new @openelement/element/authoring subpath export, which the tsconfig paths map
did not yet cover (TS2307 x6). After adding the @openelement/element/* source
wildcard, the same harness passes 20/20 hard on the unmodified tree. The
negative fixtures (npm:/jsr:, TS5097, strict-vs-relaxed staging) are constructed
to fail; they fail with exactly the documented codes.
COMMANDS_AND_EXIT_CODES:
- npm install --prefix tools/experiments/ts7/toolchain --no-audit --no-fund →
  exit 0 (exact stable pins installable; lock committed)
- deno task experiment:ts7 (root deno.json task; equals
  deno run --allow-read --allow-write --allow-run --allow-env --allow-net
  tools/experiments/ts7/run.ts) → exit 0, "hard: 20 pass, 0 fail; soft: 7 pass";
  structured output tools/experiments/ts7/.work/report.json (records
  repoHead=f83398daeac7c3d25b88e6df2abbece493607db4)
- inside the harness: deno check src/ (packages/app) → 0; ts7 -p (app) → 0;
  tsc -p (app) → 2 (lib gap, expected); ts7 emit → 0; deno pack app/element →
  0 (tarballs, never published); staged deno pack ui → 0 with 16
  type-generation failures; consumer tsc/ts7 on valid program → 0/0, on
  invalid program → 2/1 with identical code sets
- deno check tools/experiments/ts7/run.ts → 0
- deno fmt --check tools/experiments/ts7/ → clean; deno lint
  tools/experiments/ts7/ → clean

TESTS_OR_FIXTURES_ADDED:
tools/experiments/ts7/{run.ts, README.md, .gitignore, toolchain/package.json,
toolchain/package-lock.json}; root deno.json gains the `experiment:ts7` task and
the `**/.work` ignore entry. No package src, CI, or tools/autoflow changes. The
harness writes only under tools/experiments/ts7/.work/ (gitignored) and the OS
tempdir.

NOT TESTED / KNOWN LIMITATIONS:
Cold-cache timings; packages/adapter-vite sources (largest Compiler-API
consumer) not typechecked by ts7 in this slice; watch/incremental modes,
project references, ts7 LSP; Windows/Linux hosts (ts7 ran here as the
darwin-arm64 native binary via the typescript-7 package's launcher); runtime
behavior of emitted JS (emit was declaration-only); the deno pack missing-.d.ts
root cause (Beta.2.3 item); TS7 has NO stable programmatic Compiler API — this
evaluation covers the CLI type/declaration pipeline only and must not be read
as a Compiler-API replacement.

RESIDUAL_RISKS:
- A ts7 declaration pipeline needs a .ts->.js specifier rewrite post-pass and
  must keep the compiled-pack-staging relaxations (proven load-bearing: 23
  implicit-any errors without them).
- skipLibCheck:true is required for the app graph under ts7 (urlpattern-
  polyfill global collision); this matches the repo root compilerOptions.
- ts7 must never be wired in as a deno check replacement (no import maps) nor
  presented as covering the 20 Compiler-API consumers.

PRODUCTION_CODE_UNCHANGED: yes

DECISION: PROCEED with conditions — Alpha-stage adoption evaluation for the
type/declaration pipeline only. This is an Alpha INPUT, not Alpha admission and
not a production migration. Conditions: (1) exact-version pin as committed;
(2) declarations require a .ts->.js specifier post-pass to match deno pack
output shape; (3) keep noImplicitAny/noImplicitOverride relaxations for staged
compiled-element output; (4) deno check remains the typecheck gate; (5) the 20
Compiler-API consumer files remain on typescript@5.9 — TS7 stable ships no
programmatic API to replace them. Notable upside re-verified on this tree: ts7
emits declarations for everything deno pack silently drops (3 app modules, 18
element modules, ALL 16 staged ui modules), typechecks the real sample sources
~2.9x faster and at ~half the memory of deno check on this fixed-sample
bounded harness, and matches Deno's gate better than the repo-pinned tsc 5.9 on
Navigation-API/URLPattern globals.
```
