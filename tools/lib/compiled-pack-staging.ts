/**
 * Pre-pack compilation staging for packages that ship compiled-element
 * sources (#1301).
 *
 * @element/@property are compile-time-only intrinsics (ADR-0143): the runtime
 * exports are inert no-ops, and the Part Program is produced exclusively by
 * the adapter's open:compiled-element transform from the AUTHORED .tsx
 * source. A pack that transpiles authored .tsx without the element compiler
 * erases the decorator applications — the deno-pack generator did exactly
 * that (TC39 decorator lowering, applyDecs2203R) — so a tarball packed from
 * authored sources can never be admitted by the consumer-side compiler, and
 * packageIslands SSR fails closed with OE_PROGRAM_MISSING.
 *
 * The repair keeps the admission contract unchanged and runs the SAME
 * intrinsic transform in the pack pipeline: `compilePackageElementModules`
 * replaces each opted-in component module by its compiler output, and the vp
 * staging (tools/lib/vp-pack.ts, assembled by the release coordinator) packs
 * those semantics-preserving TS->JS modules into the tarball.
 *
 * The compiler emission carries the same strict types as authored sources:
 * generated statics use typeof/declared annotations with override where the
 * base declares the member, and every computed factory is explicitly typed
 * through the outer __computedFields annotation. No strictness rule is
 * relaxed here; a future emission regression fails the pack typecheck
 * instead of being silently absorbed.
 */

import { walkSync } from '@std/fs/walk';
import { basename, join, relative } from '@std/path';
import { compileElementModule, stripInlineSourceMapComment } from '@openelement/element/compiler';

export interface CompiledModuleOutput {
  /** Package-relative source path (e.g. src/open-button.tsx). */
  relativePath: string;
  /** Compiler emission with the standalone inline source map stripped. */
  code: string;
}

/**
 * Compile every opted-in compiled-element .tsx module under `<pkgDir>/src`.
 * Returns [] when the package ships no compiled-element sources, so callers
 * can pack unchanged-source packages exactly as before. Compiler diagnostics
 * (OEC9xx) propagate — packing a module the compiler rejects must fail.
 */
export function compilePackageElementModules(pkgDir: string): CompiledModuleOutput[] {
  const outputs: CompiledModuleOutput[] = [];
  const srcDir = join(pkgDir, 'src');
  try {
    if (!Deno.statSync(srcDir).isDirectory) return [];
  } catch {
    return []; // no src dir
  }
  for (const entry of walkSync(srcDir, { includeDirs: false, exts: ['.tsx'] })) {
    const source = Deno.readTextFileSync(entry.path);
    const result = compileElementModule(source, basename(entry.path));
    if (!result) continue;
    outputs.push({
      relativePath: relative(pkgDir, entry.path),
      code: stripInlineSourceMapComment(result.code) + '\n',
    });
  }
  return outputs;
}
