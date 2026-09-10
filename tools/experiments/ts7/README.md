# TS7 evaluation harness — issue #1156, Beta.2.2 slice

Reproducible harness for the TypeScript 7 evaluation. Evidence
record: `docs/evidence/2026-09-10-beta2-2-ts7-experiment.md`.

## Toolchain pin

The unit under test is the exact STABLE `typescript@7.0.2` package (the
native compiler, invoked through its real `tsc` CLI — the stable 7.0 line no
longer ships as `@typescript/native-preview` dev builds). Both compilers are
installed under npm aliases so neither package's `.bin/tsc` link can shadow
the other; the harness always calls the real package bin directly:

```sh
npm install --prefix tools/experiments/ts7/toolchain
# installs typescript-7 = npm:typescript@7.0.2 (under test)
#     and typescript-5 = npm:typescript@5.9.3 (repo reference line)
```

`toolchain/package.json` pins both versions exactly (no ranges, no dist-tags)
and the committed `toolchain/package-lock.json` pins the resolved tarball
URLs + integrity hashes. The harness verifies the RUNNING binary's
`--version` output (`Version 7.0.2` / `Version 5.9.3`) as a hard gate — the
version under test is never inferred from package.json. `typescript@5.9.3`
matches the repo import-map pin `npm:typescript@^5.9` (root `deno.json`).

## Prerequisites

- Deno 2.9+ (repo gate runtime), Node 24+ and npm (toolchain install only).
- Repo deps resolved once (`deno task typecheck` or any `deno check` run warms
  the caches; root `node_modules/` must exist — it is created by `deno
  install` / the standard repo setup).

## Run

From the repo root:

```sh
deno run --allow-read --allow-write --allow-run --allow-env --allow-net \
  tools/experiments/ts7/run.ts
```

Exit codes: `0` all hard pass/fail criteria met; `1` at least one parity
criterion failed; `2` BLOCKED (missing prerequisite, exact reason on stderr).

All scratch state lives under `tools/experiments/ts7/.work/` (gitignored);
the structured result is `.work/report.json`. Nothing outside `.work/` and
the OS tempdir is written.

## What it checks (hard = fails the run; soft = recorded drift signal)

- Hard: ts7 typechecks `packages/app/src` clean iff `deno check src/` does;
  ts7 typechecks `packages/ui/src/open-button.tsx` clean iff deno does;
  `npm:`/`jsr:` specifiers fail with TS2307; relative `.ts` imports need
  `allowImportingTsExtensions`; npm-dep and subpath-export resolution work;
  ts7 declaration emit covers every module `deno pack` covers (app);
  ts7 vs tsc 5.9 emit the same `.d.ts` file set; staged compiled-element
  output fails full-strict ts7 with implicit-any codes and passes with the
  two documented relaxations (`noImplicitAny`/`noImplicitOverride` off);
  ts7 emits declarations for every staged ui module; a consumer of the packed
  tarballs typechecks clean under BOTH tsc 5.9 and ts7 and both reject the
  same invalid program with the same diagnostic codes.
- Soft (recorded, not gating): tsc 5.9 lib.dom divergence (`NavigateEvent` /
  `URLPattern` globals — ts7 matches `deno check`, tsc 5.9 does not);
  `urlpattern-polyfill` global-vs-lib.dom TS2300 duplicates without
  `skipLibCheck`; `.d.ts` modules `deno pack` silently drops; byte-level
  ts7-vs-tsc declaration differences; wall time and peak RSS.
