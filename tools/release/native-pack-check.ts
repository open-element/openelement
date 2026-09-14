/**
 * Native `deno pack --dry-run` packability proof (1.0 Alpha baseline).
 *
 * `deno pack` is the sole code and declaration generator. The final npm
 * tarball is a deterministic re-wrap after approved manifest mutation
 * (docs/maintainers/pack-post-processing.md); tools/release#pack:dry-run runs
 * the real pack plus that coordinator step. This gate member proves the
 * workspace packages stay packable by the native command alone, failing closed
 * listing every package whose native dry-run fails. The coordinator steps this
 * does NOT cover are documented with deletion conditions in
 * docs/maintainers/pack-post-processing.md.
 */

import { type PackageInfo, readPackages } from '../lib/package-graph.ts';

export interface NativePackIo {
  runDryRun(dir: string): Promise<{ code: number; stderr: string }>;
}

export const defaultNativePackIo: NativePackIo = {
  async runDryRun(dir: string) {
    const output = await new Deno.Command(Deno.execPath(), {
      args: ['pack', '--dry-run', '--allow-dirty'],
      cwd: dir,
      stdout: 'piped',
      stderr: 'piped',
    }).output();
    return {
      code: output.code,
      stderr: new TextDecoder().decode(output.stderr).trim(),
    };
  },
};

export async function checkNativePack(
  packages: PackageInfo[],
  io: NativePackIo = defaultNativePackIo,
): Promise<string[]> {
  const failed: string[] = [];
  for (const pkg of packages) {
    const result = await io.runDryRun(pkg.dir);
    if (result.code !== 0) failed.push(`${pkg.name} (${pkg.dir}):\n${result.stderr}`);
  }
  return failed;
}

if (import.meta.main) {
  const packages = await readPackages();
  const failed = await checkNativePack(packages);
  if (failed.length > 0) {
    console.error(
      `native pack check failed for ${failed.length} package(s):\n${failed.join('\n')}`,
    );
    Deno.exit(1);
  }
  console.log(`native pack check ok (${packages.length} packages).`);
}
