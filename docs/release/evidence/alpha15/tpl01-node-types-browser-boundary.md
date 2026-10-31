# TPL-01 / TPL-02 — starter Node types, browser boundary, manager-matched handoff

Lane D (templates-ci), task-4. Branch `alpha15`, base HEAD `ef5da43` plus this
lane's edits, 2026-10-19. Scratch logs under `<scratch>/templates-ci/`.

## TPL-01 — starter Node types + the browser entry's Node boundary

### What changed

1. **Generated manifest** — `packages/create/templates/package.json.tmpl` pins
   `@types/node` at the repository's own devDependency pin (`26.5.0`, one
   alignment asserted against the root manifest by the create tests). A fresh
   scaffold now ships the Node type surface its generated tsconfig names.
2. **Generated tsconfig** — `packages/create/templates/tsconfig.json.tmpl` keeps
   `"@openelement/element/css-modules"` and adds `"node"`:
   `types: ["@openelement/element/css-modules", "node"]`. `include` is
   unchanged (`app`, `vite.config.ts`, `openelement.config.ts`) — the fix is the
   entry, never an `exclude` that drops `app/components` from the check.
3. **Timer typing** — `app/islands/live-timer.tsx.tmpl` uses `window.setInterval`
   / `window.clearInterval` and keeps the field a plain `number`. The DOM call
   returns a number; the bare global resolves to Node's overload once
   `@types/node` is loaded (`NodeJS.Timeout`), and
   `ReturnType<typeof window.setInterval>` does NOT repair that — the merged
   window type's `ReturnType` is Node's Timeout too (measured: see RED below).
4. **Fail-closed browser boundary** — new
   `packages/router/src/vite/internal/browser-entry-boundary.ts`, registered as
   the FIRST plugin of the nested client build in
   `packages/router/src/cli/build-client.ts` (two-line registration: import +
   plugins-array entry). A `resolveId` hook with `enforce: 'pre'`, so it sees the
   raw specifier before Vite's core resolver replaces it with
   `__vite-browser-external`. Any `node:*` specifier reached from the client
   entry's module graph — direct or transitive, static or dynamic — fails the
   build with `OE_CLIENT_BUILD_BROWSER_ENTRY_NODE_BUILTIN`, naming the specifier
   and the importer. The SSR build is untouched: a route `loader` importing
   `node:fs/promises` still builds (zero-config server-side story).

### RED / GREEN evidence

| proof | command | result |
| --- | --- | --- |
| pre-fix timer fails the typecheck | packed-tarball scaffold with the pre-fix timer (bare `setInterval`, `number` field), `tsc --noEmit -p tsconfig.json` | exit 2, `app/islands/live-timer.tsx(40,5): error TS2322: Type 'Timeout' is not assignable to type 'number'.` (`<scratch>/templates-ci/tpl01-timer-red.log`) |
| fixed generated starter typechecks | packed create CLI → packed framework tarballs in the consumer tree, repo `tsc` on the GENERATED tsconfig | exit 0 (`<scratch>/templates-ci/e2e-quality.log`, same tree as the TPL-03 chain) |
| Vite fails open without the guard | plain Vite browser build of an island importing `node:fs` | exit 0; emitted chunk carries the inlined `__vite-browser-external` stub (`<scratch>/templates-ci/vite-fail-open.log`) |
| guard fails closed | router build of the same island fixture | exit 1, `[OE_CLIENT_BUILD_BROWSER_ENTRY_NODE_BUILTIN] ... imports the Node builtin "node:fs" (from .../app/islands/probe-counter.tsx)` (`<scratch>/templates-ci/probe-after-guard.log`) |
| loader page stays green | router build with a route `loader` importing `node:fs/promises` | exit 0, build complete, island chunk emitted (`<scratch>/templates-ci/probe-after-guard.log`) |

Tests: `packages/router/__tests__/browser-entry-boundary.test.ts` — 4 tests,
green (unit: specifier matcher + plugin shape + coded error; real router-CLI
builds: island-direct fails, island-transitive-through-helper fails,
loader-node passes). Create tests pin the template surface: devDependencies
include the exact `@types/node` pin (aligned with the root manifest), the
generated tsconfig's `types` list carries both entries and has no `exclude`,
the timer spells `window.setInterval`/`window.clearInterval` with a plain
number, and no `ReturnType<typeof …` survives.

## TPL-02 — create's next-steps prompt matches the INVOKING package manager

### What changed

`packages/create/src/pm.ts` gains `detectInvokingPackageManager(env, argv)` and
`resolvePackageManager({env, argv, probe})`:

1. the invoking wrapper first — `npm_config_user_agent` (`<name>/<version> …`,
   the signal all four managers export), then `npm_execpath` (basename match,
   pnpm before npm because `pnpm` contains `npm`), then `process.argv[1]`
   (runner names: `npm`/`npx`, `pnpm`/`pnpx`, `yarn`/`yarnpkg`, `bun`/`bunx`);
   names that are not one of the four (e.g. `corepack`) fall through to the
   next signal;
2. the existing PATH probe (pnpm → npm → yarn → bun) only when no wrapper named
   itself — a direct `node …/cli.ts` run.

`cli.ts` now uses `resolvePackageManager()` for BOTH the install action and the
`--no-install` handoff box (install command + dev command), so a packed
`npm create @openelement` run on a host that merely has pnpm on PATH spells
npm's commands instead of advising `pnpm install`.

### RED / GREEN evidence

Before: the handoff box and the install step both read the PATH probe, so
`pnpm` won whenever it was installed — the packed/npm scenario the review
flagged. Tests (all in `packages/create/__tests__/cli.test.ts`):

- unit: signal precedence (user agent → exec path → argv[1]), corepack
  fall-through, Windows exec-path shapes, direct-node = no signal;
- unit: `resolvePackageManager` returns the invoking manager and never consults
  the probe, then falls back to the probe (injected) when there is none;
- CLI (fake-PM PATH): a run with an npm-like agent prints **npm** install/dev
  lines and no pnpm line, even though a fake pnpm is on PATH; a pnpm-like agent
  prints pnpm's lines;
- CLI (fake-PM PATH): the default install drives npm (one recorded
  `npm install` invocation, no `--version` probe of the invoking manager) while
  pnpm is also on PATH.

Direct child runs in the rest of the suite neutralize inherited manager signals
(`directInvocationEnv`), so PATH-probe tests stay deterministic no matter which
manager runs the tests.

## Targeted verification (this lane)

```text
vitest run --project create                                 68 passed (3 files), exit 0
vitest run --project router packages/router/__tests__/browser-entry-boundary.test.ts
                                                            4 passed, exit 0
tsc --noEmit -p packages/create/tsconfig.json               exit 0
tsc --noEmit -p packages/router/tsconfig.json               exit 0
tsc --noEmit -p tests/e2e/starter-smoke/tsconfig.json       exit 0
oxlint <changed files>                                      0 warnings / 0 errors
oxfmt --check <changed files>                               clean
```
