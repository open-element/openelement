# Pack post-processing: what `vp pack` does not do (vite-plus 1.0.0)

`vp pack` is the **sole code and declaration generator** (A1 toolchain swap;
the previous generator, `deno pack`, is retired). The generator runs in a
per-pack temp workspace staged by `tools/lib/vp-pack.ts` — pinned vite-plus
with `vite` aliased to `@voidzero-dev/vite-plus-core`, every workspace member
symlinked under `node_modules/@openelement/`, and the verified recipe
(explicit client-runtime entries, `unbundle`, `treeshake: false`,
`fixedExtension: false`, JSON imports external). The final npm tarball is
re-wrapped by the release coordinator (`tools/release/publish-npm.ts`) after
payload assembly (dist → `src/`, publish-scoped non-module files, synthesized
manifest), metadata, dependency, peer-dependency, and Create bin assembly.
The repo toolchain outside the generator (task runner, test runner, permission
model) still requires **Deno 2.9** per the pinned `.dvmrc`; the vp swap
replaced the artifact generator only, not the repo's Deno floor.
The coordinator never transpiles the normal module graph, never rewrites
normal relative extensions, never constructs normal exports, and never
deletes files the assembly step excludes. `vp pack` (under
`fixedExtension: false` + `type: "module"`) ships `.js` + `.d.ts`, and the
synthesized raw manifest is `"type": "module"` with
import/types/default-only exports over `src/*.js` — the exact raw shape
`deno pack` used to emit (verified against the alpha.6 baseline tarballs).

The coordinator's repack is constrained by a machine check
(`assertOnlyApprovedManifestChanges`): every file except
`package/package.json` must be byte-identical to the raw assembled tree, and
the manifest delta must be a subset of `APPROVED_MANIFEST_MUTATIONS`. A
source, declaration, or exports-map difference fails the pack. The shipped
tarball is re-extracted and hashed against the verified tree before the pack
completes.

Each retained step below names its generator gap, its regression test, and
the condition under which it must be deleted. "Historically needed" is never
a reason to keep a step.

| Retained step                                                                                                                             | Current gap (vite-plus 1.0.0)                                                                                                                                                                                                                              | Minimal repro / regression test                                                                                                                                       | Delete when                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `findAbsoluteFileUrlPayload` (fail-closed guard, deletes nothing)                                                                         | The vp recipe emits no source maps; the guard proves nothing reintroduces inline maps with absolute `file:///` sources                                                                                                                                     | `findAbsoluteFileUrlPayload fails closed on machine paths in inline maps`; two consecutive `deno task --cwd tools/release pack:dry-run` produce identical SHA-256     | Delete when the generator contract gains a native no-inline-maps proof                                |
| Deterministic final archive writer (`tools/lib/deterministic-tar.ts`)                                                                     | Coordinator re-wraps because of the manifest mutations below; system `tar -czf` writes host mtime/uid/gid/order and gzip metadata, so two builds differ and release bytes are not reproducible                                                             | `deterministic-tar.test.ts` (fixed order/mtime/uid/gid/modes/gzip header; long-path ustar; unsafe paths fail closed); two-build SHA check                             | Delete when the generator accepts post-pack manifest mutations natively and remains byte-reproducible |
| `findRawTypeScriptPayload` (fail-closed guard, deletes nothing)                                                                           | The assembly copies only publish-scoped files and every scoped source module must have a packed `.js`/`.d.ts` (unreachable modules fail closed in `assembleVpPackageTree`); the scan is the belt to that suspend                                           | `findRawTypeScriptPayload flags sources but keeps declarations and templates`; `assembleVpPackageTree` unreachable-module test                                        | Delete when the generator itself rejects raw TypeScript in its payload                                |
| `deriveDependencies` + peer/optional-peer rewrite                                                                                         | The synthesized raw manifest carries no `dependencies` and no `peerDependencies` (they are applied from the same derivation that drives the staging externals)                                                                                             | `deriveDependencies *`, `deriveAllDependencies *`                                                                                                                     | Generate the fields into the raw manifest (one source, no post-mutation)                              |
| Package metadata fields (`type`, `description`, `repository`, `homepage`, `bugs`, `license`, `keywords`, `engines`, `sideEffects`, `bin`) | The synthesized raw manifest omits them; `applyPackageJsonOverrides` writes them from `packedMetadata()`                                                                                                                                                   | `package-artifacts:check` tarball scan; `pack-surface:check` compares the packed manifest against `packedMetadata()`; `assertOnlyApprovedManifestChanges` delta proof | Generate the fields into the raw manifest (one source, no post-mutation)                              |
| `compilePackageElementModules` (#1301)                                                                                                    | Pack-time decorator lowering erases compile-time-only intrinsics, so shipped `.tsx` element modules would register no Part Program; the compiler output replaces the authored modules inside the vp staging before packing                                 | `compiled-pack-staging` tests; packed SSR claim                                                                                                                       | The generator preserves the intrinsics or compiler output becomes pack-stable                         |
| Declaration closure proof (`tools/lib/declaration-closure.ts`)                                                                            | Guards the public declaration tree: every exports subpath must carry an existing `types` condition and relative declaration edges must close inside the package root                                                                                       | `declaration-closure.test.ts` (reachable/missing/escape/cycle/external fixtures); `declarationClosure` pack log line                                                  | Delete when the generator proves declaration-tree completeness itself                                 |
| ~~`emitUiDeclarations` (UI only)~~ (deleted)                                                                                              | Former state: staged UI kept 44 fast-check errors, masked by a tsc declaration fallback. The compiler now emits strict types (typeof statics, override styles, typed computed factories), so all 13 UI export declarations generate natively               | strict-emission test; `package-artifacts:check` types-target scan; packed UI consumer                                                                                 | — (fallback deleted; do not reintroduce)                                                              |
| ~~`@std` bridge in Deno-driven tooling~~ (deleted)                                                                                        | Former state: packed `vite/` + `cli/` kept bare `@std/*` with `@jsr/std__*` manifest deps. Tooling now sources path/JSONC/MIME from pure-ESM npm packages, so packed modules and manifests are `@std`/`@jsr`/`jsr:`-free                                   | `rejects the JSR bridge in every packed module`; `rejects @jsr dependencies in packed manifests`; tarball scan                                                        | — (bridge deleted; do not reintroduce)                                                                |
| ~~`deno pack` diagnostic classifier~~ (deleted in the A1 swap)                                                                            | Former state: `deno pack` warned `Could not generate types ...` for private modules outside the public declaration closure and the pipeline classified them. vp emits no such diagnostics; the classifier and its exception document retired with the swap | —                                                                                                                                                                     | — (retired; do not reintroduce)                                                                       |

## Raw pack vs final tarball

- Content: identical except `package/package.json`; the manifest delta is
  restricted to the approved fields above.
- Archive metadata: the final archive is written deterministically (sorted
  members, uid/gid 0, mtime 0, normalized modes, fixed gzip header).
- The coordinator's mutations are listed in `APPROVED_MANIFEST_MUTATIONS` and
  enforced by `assertOnlyApprovedManifestChanges`; a new mutation needs a new
  row in this table (gap, repro, test, deletion condition) before it can ship.

The vp pack recipe and its staging are contracted in `tools/lib/vp-pack.ts`;
the swap's verification evidence (22/22 main-entry export surface, 8/8 client
runtime modules, d.ts hunk classification) is recorded in the A1 workflow
report. `pack:dry-run` and real-tarball inspection both run in CI before any
publish.
