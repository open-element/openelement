# Pack post-processing: what `deno pack` does not do (Deno 2.9)

`deno pack` is the **sole code and declaration generator**. The final npm
tarball is re-wrapped by the release coordinator (`tools/release/publish-npm.ts`)
after metadata, dependency, peer-dependency, and Create bin assembly. The
coordinator never transpiles the normal module graph, never rewrites normal
relative extensions, never constructs normal exports, and never deletes files
pack already excludes. `deno pack` itself ships `.js` + `.d.ts`,
`"type": "module"`, and import/types/default-only exports (verified against a
raw `deno pack --allow-dirty` of `@openelement/element` on Deno 2.9.0).

The coordinator's repack is constrained by a machine check
(`assertOnlyApprovedManifestChanges`): every file except
`package/package.json` must be byte-identical to the raw pack output, and the
manifest delta must be a subset of `APPROVED_MANIFEST_MUTATIONS`. A source,
declaration, or exports-map difference fails the pack. The shipped tarball is
re-extracted and hashed against the verified tree before the pack completes.

Each retained step below names its Deno 2.9 gap, its minimal repro, its
regression test, and the condition under which it must be deleted. "Historically
needed" is never a reason to keep a step.

| Retained step                                                                       | Current Deno 2.9 gap                                                                                                                                                                                                                                      | Minimal repro / regression test                                                                                                                    | Delete when                                                                                                                                       |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--no-source-maps` + `findAbsoluteFileUrlPayload` (fail-closed guard, deletes nothing) | `deno pack` embeds inline maps whose `sources` are absolute `file:///` URLs (`file:///Users/<maintainer>/...`, or the random `openelement-pack-staging-*` temp dir for staged UI packs) — machine-path leak and byte-reproducibility break             | `packArgs pins deterministic path hygiene`; `findAbsoluteFileUrlPayload fails closed on machine paths in inline maps`; two consecutive `deno task --cwd tools/release pack:dry-run` produce identical SHA-256 | Delete the flag and the scan when `deno pack` emits portable relative `sources` (or no maps) and the two-build SHA check still passes              |
| Deterministic final archive writer (`tools/lib/deterministic-tar.ts`)               | Coordinator re-wraps because of the manifest mutations below; system `tar -czf` writes host mtime/uid/gid/order and gzip metadata, so two builds differ and release bytes are not reproducible                                                              | `deterministic-tar.test.ts` (fixed order/mtime/uid/gid/modes/gzip header; long-path ustar; unsafe paths fail closed); two-build SHA check              | Delete when `deno pack` accepts post-pack manifest mutations natively and remains byte-reproducible                                               |
| `findRawTypeScriptPayload` (fail-closed guard, deletes nothing)                     | Raw pack used to retain unimported TypeScript sources (element provenance markers, now `publish.exclude`d)                                                                                                                                                | `findRawTypeScriptPayload flags sources but keeps declarations and templates`; raw `deno pack` of element/create shows zero non-declaration `.ts`   | Delete the guard only when `deno pack` itself rejects unimported sources (until then a regression must fail the pack, never be silently stripped) |
| `deriveDependencies` + peer/optional-peer rewrite                                   | Raw `package.json` has no `dependencies` and no `peerDependencies`                                                                                                                                                                                        | `deriveDependencies *`, `deriveAllDependencies *`                                                                                                 | Pack propagates `npm:` imports and `deno.json` peers                                                                                              |
| Package metadata fields (`type`, `description`, `repository`, `homepage`, `bugs`, `license`, `keywords`, `bin`) | Raw `package.json` omits them                                                                                                                                                                                                                             | `package-artifacts:check` tarball scan; `assertOnlyApprovedManifestChanges` delta proof                                                             | Pack propagates them from `deno.json`                                                                                                             |
| `stageCompiledPackWorkspace` (#1301)                                                | Pack-time decorator lowering erases compile-time-only intrinsics, so shipped `.tsx` element modules would register no Part Program                                                                                                                        | `compiled-pack-staging` tests; packed SSR claim                                                                                                   | Pack preserves the intrinsics or compiler output becomes pack-stable                                                                              |
| Declaration closure proof (`tools/lib/declaration-closure.ts`)                      | Pack can drop a private module's standalone `.d.ts` while exiting 0; "not a direct export" does not prove privacy                                                                                                                                         | `declaration-closure.test.ts` (reachable/missing/escape/cycle/external fixtures); `knownUpstreamPrivateWarnings` and `declarationClosure` pack log lines | Delete when `deno pack` only omits declarations for modules provably unreachable from public types (or generates them all)                       |
| ~~`emitUiDeclarations` (UI only)~~ (deleted)                                        | Former state: staged UI kept 44 fast-check errors, masked by a tsc declaration fallback. The compiler now emits strict types (typeof statics, override styles, typed computed factories), so `deno pack` generates all 13 UI export declarations natively | strict-emission test; `package-artifacts:check` types-target scan; packed UI consumer                                                               | — (fallback deleted; do not reintroduce)                                                                                                          |
| ~~`@std` bridge in Deno-driven tooling~~ (deleted)                                  | Former state: packed `vite/` + `cli/` kept bare `@std/*` with `@jsr/std__*` manifest deps. Tooling now sources path/JSONC/MIME from pure-ESM npm packages, so packed modules and manifests are `@std`/`@jsr`/`jsr:`-free                                  | `rejects the JSR bridge in every packed module`; `rejects @jsr dependencies in packed manifests`; tarball scan                                    | — (bridge deleted; do not reintroduce)                                                                                                            |

## Raw pack vs final tarball

- Content: identical except `package/package.json`; the manifest delta is
  restricted to the approved fields above.
- Archive metadata: the final archive is written deterministically (sorted
  members, uid/gid 0, mtime 0, normalized modes, fixed gzip header). The raw
  pack archive's own metadata is discarded with the re-wrap.
- The coordinator's mutations are listed in `APPROVED_MANIFEST_MUTATIONS` and
  enforced by `assertOnlyApprovedManifestChanges`; a new mutation needs a new
  row in this table (gap, repro, test, deletion condition) before it can ship.

The `deno pack` diagnostic exception (private-module warnings) is documented
separately in [deno-pack-diagnostic-exception.md](./deno-pack-diagnostic-exception.md).
The coordinator keeps only: multi-package order, version consistency, tarball
collection, tarball safety checks (`package-artifacts:check`), the declaration
closure proof, isolated consumer verification, the `npm publish <tgz>` call,
and the partial-publish guard. `deno pack --dry-run` and real-tarball
inspection both run in CI before any publish.
