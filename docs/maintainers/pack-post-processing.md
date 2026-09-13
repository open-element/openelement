# Pack post-processing: what `deno pack` does not do (Deno 2.9)

`deno pack` is the sole tarball generator. The release coordinator
(`tools/publish-npm.ts`) never transpiles the normal module graph, never
rewrites normal relative extensions, never constructs normal exports, and
never deletes files pack already excludes — native output already ships
`.js` + `.d.ts` (+ inline source maps), `"type": "module"`, and
import/types/default-only exports (verified against a raw
`deno pack --allow-dirty` of `@openelement/element` on Deno 2.9.0).

Each retained step below names its Deno 2.9 repro, its regression test, and
the condition under which it must be deleted. "Historically needed" is never
a reason to keep a step.

| Retained step                                                                       | Deno 2.9 repro (element, unless noted)                                                                                             | Regression test                                                       | Delete when                                                          |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `removeRawTypeScriptPayload`                                                        | Raw pack retains `src/internal/protocol/hydration-markers.ts` and `ssr-registry-markers.ts`                                        | `removeRawTypeScriptPayload keeps declarations and template payloads` | Pack stops emitting non-declaration `.ts`                            |
| `deriveDependencies` + peer/optional-peer rewrite                                   | Raw `package.json` has no `dependencies` and no `peerDependencies`                                                                 | `deriveDependencies *`, `deriveAllDependencies *`                     | Pack propagates `npm:` imports and `deno.json` peers                 |
| Package metadata fields (`description`, `repository`, `license`, `keywords`, `bin`) | Raw `package.json` omits them                                                                                                      | `package-artifacts:check` tarball scan                                | Pack propagates them from `deno.json`                                |
| `emitUiDeclarations` (UI only)                                                      | Pack drops UI declarations (`Could not generate types`) because every UI module infers types through element internals             | `package-artifacts:check` types-target scan; packed UI consumer       | Pack emits UI declarations natively                                  |
| `rewriteDtsRelativeExtensions` (UI emit only)                                       | Scoped to the UI `tsc` emit: `allowImportingTsExtensions` preserves `.ts` specifiers                                               | `rewriteDtsRelativeExtensions *`                                      | No longer needed once the UI emit goes away                          |
| `stageCompiledPackWorkspace` (#1301)                                                | Pack-time decorator lowering erases compile-time-only intrinsics, so shipped `.tsx` element modules would register no Part Program | `compiled-pack-staging` tests; packed SSR claim                       | Pack preserves the intrinsics or compiler output becomes pack-stable |

The coordinator keeps only: multi-package order, version consistency,
tarball collection, tarball safety checks (`package-artifacts:check`),
isolated consumer verification, the `npm publish <tgz>` call, and the
partial-publish guard. `deno pack --dry-run` and real-tarball inspection
both run in CI before any publish.
