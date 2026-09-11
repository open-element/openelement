/**
 * Pre-pack staging for packages that ship compiled-element sources (#1301).
 *
 * @element/@property are compile-time-only intrinsics (ADR-0143): the runtime
 * exports are inert no-ops, and the Part Program is produced exclusively by
 * the adapter's open:compiled-element transform from the AUTHORED .tsx
 * source. `deno pack` transpiles .tsx to .js with TC39 decorator lowering
 * (applyDecs2203R), which erases the decorator applications — a tarball
 * packed from authored sources can never be admitted by the consumer-side
 * compiler, so packageIslands SSR fails closed with OE_PROGRAM_MISSING.
 *
 * The repair keeps the admission contract unchanged and runs the SAME
 * intrinsic transform in the pack pipeline: each opted-in component module is
 * replaced by its compiler output in a staged copy, and `deno pack`
 * transpiles that (semantics-preserving TS->JS) into the tarball. The staged
 * copy lives in a minimal temporary workspace so the package's workspace
 * dependencies (e.g. @openelement/element for @acme/components) keep resolving
 * to source during the pack-time module-graph build.
 *
 * The compiler emission predates strict pack-time typechecking: it drops the
 * authored `override` modifiers on statics and leaves computed-factory
 * parameters implicitly typed (consumers never typecheck the emission — Vite
 * transpiles it). The staged member therefore relaxes noImplicitOverride and
 * noImplicitAny; the authored sources remain strictly typechecked by the
 * package's own gates.
 */

import { walkSync } from '@std/fs/walk';
import { basename, join, relative } from '@std/path';
import { compileElementModule, stripInlineSourceMapComment } from '@openelement/element/compiler';
import { formatJson } from '@openelement/element/build-utils';
import type { PackageInfo } from './package-graph.ts';

export interface CompiledModuleOutput {
  /** Package-relative source path (e.g. src/open-button.tsx). */
  relativePath: string;
  /** Compiler emission with the standalone inline source map stripped. */
  code: string;
}

export interface StagedPackWorkspace {
  /** Staged package directory to run `deno pack` in. */
  packDir: string;
  /** Remove the staged workspace. */
  cleanup: () => Promise<void>;
}

interface DenoJsonShape {
  imports?: Record<string, string>;
  compilerOptions?: Record<string, unknown>;
  [key: string]: unknown;
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

function copyPackageDir(src: string, dest: string): void {
  Deno.mkdirSync(dest, { recursive: true });
  for (const entry of Deno.readDirSync(src)) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    if (entry.isFile && entry.name.endsWith('.tgz')) continue;
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory) {
      copyPackageDir(from, to);
    } else if (entry.isFile) {
      Deno.copyFileSync(from, to);
    }
  }
}

/**
 * Stage a temporary workspace in which every compiled-element module of `pkg`
 * is replaced by its compiler output, ready for `deno pack`. `members` must
 * include `pkg` plus every workspace package its sources import, so the
 * staged pack resolves internal dependencies exactly like the real workspace.
 * `rootDenoJson` supplies the import map and compiler options the real
 * workspace root provides. `compiled` comes from compilePackageElementModules
 * so callers compile each module exactly once.
 */
export async function stageCompiledPackWorkspace(
  pkg: PackageInfo,
  members: PackageInfo[],
  rootDenoJson: DenoJsonShape,
  compiled: CompiledModuleOutput[],
): Promise<StagedPackWorkspace> {
  const tmp = await Deno.makeTempDir({ prefix: 'openelement-pack-staging-' });
  const cleanup = () => Deno.remove(tmp, { recursive: true }).catch(() => undefined);
  try {
    const memberDirs: string[] = [];
    for (const member of members) {
      const base = basename(member.dir);
      copyPackageDir(member.dir, join(tmp, base));
      memberDirs.push(`./${base}`);
    }

    const stagedRoot: DenoJsonShape = { workspace: memberDirs };
    if (rootDenoJson.imports) stagedRoot.imports = rootDenoJson.imports;
    if (rootDenoJson.compilerOptions) stagedRoot.compilerOptions = rootDenoJson.compilerOptions;
    Deno.writeTextFileSync(join(tmp, 'deno.json'), formatJson(stagedRoot));

    const packDir = join(tmp, basename(pkg.dir));
    for (const output of compiled) {
      Deno.writeTextFileSync(join(packDir, output.relativePath), output.code);
    }

    // Relax only the two strictness rules the compiler emission does not
    // satisfy; everything else stays at the workspace root's strictness.
    const memberConfigPath = join(packDir, 'deno.json');
    const memberConfig = JSON.parse(Deno.readTextFileSync(memberConfigPath)) as DenoJsonShape;
    memberConfig.compilerOptions = {
      ...(memberConfig.compilerOptions ?? {}),
      noImplicitOverride: false,
      noImplicitAny: false,
    };
    Deno.writeTextFileSync(memberConfigPath, formatJson(memberConfig));

    return { packDir, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
