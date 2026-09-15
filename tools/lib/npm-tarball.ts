/**
 * Shared npm tarball naming helpers (#793).
 *
 * The tarball file name mirrors `deno pack --output`: scoped package name with
 * the scope marker stripped, plus the package version. Used by publish-npm.ts
 * (which writes the tarballs) and check-package-artifacts.ts (which reads them).
 */

import type { PackageInfo } from './package-graph.ts';

/** Logical artifact naming: name + version only, no workspace path. */
export type TarballNameInput = Pick<PackageInfo, 'name' | 'version'>;

/** Producer workspace physical path: naming inputs plus the package dir. */
export type TarballPathInput = Pick<PackageInfo, 'dir' | 'name' | 'version'>;

export function npmTarballName(pkg: TarballNameInput): string {
  return `${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`;
}

export function tarballPath(pkg: TarballPathInput): string {
  return `${pkg.dir}/${npmTarballName(pkg)}`;
}
