# Deno pack diagnostic exception (`Could not generate types`)

Status: **active, narrowly scoped, time-boxed by upstream**
Upstream issue: <https://github.com/denoland/deno/issues/36829> (open; no fix released as of 2026-09-14)

This document is the normative source for the only `deno pack` diagnostic the
release pipeline is allowed to classify as an upstream private-module warning.
`.artifacts/` holds repro logs only; it is never the truth source.

## The allowed diagnostic shape

Exactly one line shape may be classified as a known upstream warning:

```text
Could not generate types for '<file-url>'. Types will not be included for this module.
```

All of the following still fail the pack closed (`tools/release/publish-npm.ts`):

- any `error[` fast-check diagnostic or `missing-explicit` mention;
- any other `warning`, `slow type`, `unsupported`, or `failed` token;
- a warned file outside the packed package;
- a warned declaration reachable from the public declaration closure;
- a relative declaration edge that resolves to no declaration;
- a declaration edge escaping the package root.

## Verified versions and warning counts

| Deno version | Verified where                                                                            | `deno pack` private-module warnings                              | Notes                                                                                                                                                                       |
| ------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.9.0        | repo-locked `.dvmrc`; native pack proof + minimal repro in `.artifacts/deno-pack-repros/` | element 16, router 61, create 2, ui 2 (final 1.0.0-alpha.1 tree) | Counts are per exact candidate tree and were 18/60/2/2 before the protocol/marker consolidation moved modules; they are measured at every pack, never hardcoded in the gate |
| 2.9.6        | upstream issue body (`denoland/deno#36829`, reported by the maintainer)                   | minimal repro only (1 warning)                                   | Not re-verified in this repository; do not widen the exception on this row alone                                                                                            |

First observed: during the `1.0.0-alpha.1` native-pack proof on the
Deno 2.9.0 pipeline (the earliest toolchain this repository has run the native
pack proof with). No earlier Deno version is claimed because none was
re-measured.

## Why this is not a missing public declaration

1. Every public export in the final staged tarball carries a `types` condition
   that exists on disk (`publish-npm.ts` verifies each).
2. The declaration closure proof (`tools/lib/declaration-closure.ts`) starts at
   every public `types` target and follows every package-local relative
   declaration edge (`import`/`export ... from`, `import("...")`, triple-slash
   path references). A warned module is only accepted when its declaration is
   provably _outside_ that reachable closure; a reachable warning, a missing
   edge, or an escape fails the pack.
3. ATTW, publint, and the packed consumer typechecks run on the actual
   tarballs. They compile consumer projects against the shipped declarations,
   so an incomplete public type surface cannot pass them.

The warning is produced for a private runtime module whose standalone
declaration no consumer can import; `deno publish --dry-run` reports
`Checking for slow types in the public API... Success` on the same sources.
The diagnostic is informational for private modules, but the release pipeline
cannot distinguish informational from fatal without the closure proof — hence
this exception is paired with the machine check, never used alone.

## Re-verification duties

- After every Deno upgrade: run the native pack (`deno task --cwd tools/release
  pack:native-check`) and the minimal repro in `.artifacts/deno-pack-repros/`
  with the new exact version; append a row above with measured counts.
- Any new warning shape fails the pipeline until this document adds it together
  with a closure-based argument for why it is private.
- Unknown warnings always fail; there is no catch-all allowance.

## Deletion condition

Delete this exception — the classifier branch and this document — when **all**
of the following hold:

1. an upstream Deno release includes the fix for
   `denoland/deno#36829`; and
2. the four packages' native `deno pack` runs no longer emit the allowed
   diagnostic; and
3. the two-build reproducibility and declaration closure checks still pass with
   the exception removed.

The exception is deleted from the classifier, not kept "for safety": a stale
exception would hide a real regression in public declarations.
