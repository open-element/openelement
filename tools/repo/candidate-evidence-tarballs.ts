/**
 * Candidate evidence — tarball staging and the byte/hash guard foundation
 * (issue #1473 extraction).
 *
 * Staging moves byte-verified release archives into a self-contained evidence
 * tree (`stageTarballEvidence`, the producer side) and carries them into the
 * final bundle from downloaded evidence alone (`carryPackedTarballs`, the
 * aggregator side); `collectPackedTarballFailures` is the job-level packed
 * tarball contract. This module is also the spawn-free foundation both audit
 * lanes reuse: the SHA-256 helper and the byte/path guards sit here so the
 * validate lane can import them without an audit → producer import edge.
 * Moved out of candidate-evidence.ts verbatim: shapes, checks, and error
 * texts are unchanged.
 */

import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { npmTarballName } from '../lib/npm-tarball.ts';
import { auditTarballPackage } from './tarball-inspect.ts';

/** Required production-package tarball keys; extras or fakes are rejected. */
export const REQUIRED_PACKAGE_TARBALLS: readonly string[] = [
  '@openelement/element',
  '@openelement/router',
  '@openelement/create',
  '@openelement/ui',
];

export const SHA256_HEX = /^sha256:[0-9a-f]{64}$/u;

export const PACKAGE_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function auditSafeRelativePath(value: unknown): string[] {
  if (typeof value !== 'string' || value === '') return ['path must be a non-empty string'];
  if (value.startsWith('/') || value.includes('\\')) {
    return [`path must be a relative POSIX path, got ${JSON.stringify(value)}`];
  }
  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return [`path must not contain empty, '.', or '..' segments, got ${JSON.stringify(value)}`];
  }
  return [];
}

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return (
    'sha256:' +
    Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  );
}

interface TarballEvidencePackage {
  name: string;
  version: string;
}

/** Copy byte-verified release archives into a self-contained evidence tree. */
export async function stageTarballEvidence<T extends TarballEvidencePackage>(
  packages: readonly T[],
  sourcePath: (pkg: T) => string,
  destinationRoot: string,
  expectedHashes?: Readonly<Record<string, string>>,
): Promise<{ hashes: Record<string, string>; files: Record<string, string> }> {
  const hashes: Record<string, string> = {};
  const files: Record<string, string> = {};
  await mkdir(join(destinationRoot, 'tarballs'), { recursive: true });
  for (const pkg of packages) {
    const source = sourcePath(pkg);
    const bytes = await readFile(source).catch(() => null);
    if (!bytes) throw new Error(`Candidate tarball missing for ${pkg.name}: ${source}`);
    const hash = await sha256Bytes(bytes);
    const expected = expectedHashes?.[pkg.name];
    if (expectedHashes && expected !== hash) {
      throw new Error(
        `Candidate tarball hash mismatch for ${pkg.name}: expected ${expected}, got ${hash}`,
      );
    }
    const relativeArchive = `tarballs/${npmTarballName(pkg)}`;
    await writeFile(join(destinationRoot, relativeArchive), bytes);
    hashes[pkg.name] = hash;
    files[pkg.name] = relativeArchive;
  }
  return { hashes, files };
}

/**
 * Job-level packed tarball contract (producer ownership). Validates the
 * packed extras shape (exact package set, safe paths, filename binding) and,
 * when `checkBytes` is true, the carried archive bytes (existence, sha256,
 * package name/version). Reuses auditTarballPackage; no second tar parser.
 */
export async function collectPackedTarballFailures(
  extras: unknown,
  options: {
    read: (path: string) => Promise<Uint8Array | null>;
    checkBytes?: boolean;
  },
): Promise<string[]> {
  const failures: string[] = [];
  if (!isRecord(extras)) return ['packed: extras must be an object'];
  const checkBytes = options.checkBytes ?? true;
  const version = extras.packageVersion;
  if (typeof version !== 'string' || !PACKAGE_VERSION_PATTERN.test(version)) {
    failures.push(
      `packed packageVersion must be an x.y.z(-label) string, got ${JSON.stringify(version)}`,
    );
  }
  const tarballs = isRecord(extras.tarballs) ? (extras.tarballs as Record<string, unknown>) : {};
  const tarballKeys = Object.keys(tarballs).sort();
  const expectedKeys = [...REQUIRED_PACKAGE_TARBALLS].sort();
  if (tarballKeys.join(',') !== expectedKeys.join(',')) {
    failures.push(
      `packed tarballs must contain exactly ${expectedKeys.join(', ')}; found ${
        tarballKeys.join(', ') || 'none'
      }`,
    );
  }
  for (const name of REQUIRED_PACKAGE_TARBALLS) {
    const hash = tarballs[name];
    if (typeof hash !== 'string' || !SHA256_HEX.test(hash)) {
      failures.push(`packed tarball ${name}: missing or malformed sha256`);
    }
  }
  const files = isRecord(extras.tarballFiles)
    ? (extras.tarballFiles as Record<string, unknown>)
    : {};
  const fileKeys = Object.keys(files).sort();
  if (fileKeys.join(',') !== expectedKeys.join(',')) {
    failures.push(
      `packed tarballFiles must map exactly ${expectedKeys.join(', ')}; found ${
        fileKeys.join(', ') || 'none'
      }`,
    );
  }
  const seenPaths = new Set<string>();
  for (const name of REQUIRED_PACKAGE_TARBALLS) {
    const path = files[name];
    const pathFailures = auditSafeRelativePath(path);
    if (pathFailures.length > 0) {
      failures.push(`packed tarballFiles.${name}: ${pathFailures.join('; ')}`);
      continue;
    }
    const relativePath = path as string;
    if (!relativePath.startsWith('tarballs/') || !relativePath.endsWith('.tgz')) {
      failures.push(
        `packed tarballFiles.${name}: must be a tarballs/*.tgz path, got ${relativePath}`,
      );
      continue;
    }
    if (typeof version === 'string' && PACKAGE_VERSION_PATTERN.test(version)) {
      const expectedPath = `tarballs/${npmTarballName({ name, version })}`;
      if (relativePath !== expectedPath) {
        failures.push(`packed tarballFiles.${name}: must be ${expectedPath}, got ${relativePath}`);
        continue;
      }
    }
    if (seenPaths.has(relativePath)) {
      failures.push(`packed tarballFiles.${name}: duplicate archive path ${relativePath}`);
      continue;
    }
    seenPaths.add(relativePath);
    if (!checkBytes) continue;
    const bytes = await options.read(relativePath);
    if (!bytes) {
      failures.push(`packed tarball ${name}: archive missing at ${relativePath}`);
      continue;
    }
    const actual = await sha256Bytes(bytes);
    if (tarballs[name] !== actual) {
      failures.push(
        `packed tarball ${name}: archive sha256 ${actual} != recorded ${tarballs[name]}`,
      );
    }
    if (typeof version === 'string' && PACKAGE_VERSION_PATTERN.test(version)) {
      failures.push(
        ...(await auditTarballPackage(bytes, name, version)).map(
          (failure) => `packed tarball ${name}: ${failure}`,
        ),
      );
    }
  }
  return failures;
}

/**
 * Aggregator composition (aggregator ownership). Carries the packed-evidence
 * archives into the final bundle using only the downloaded evidence: no
 * readPackages(), no tarballPath(), no re-pack, no producer workspace paths.
 */
export async function carryPackedTarballs(
  extras: unknown,
  readPacked: (path: string) => Promise<Uint8Array | null>,
  outDir: string,
): Promise<{
  tarballs: Record<string, string>;
  tarballFiles: Record<string, string>;
  packageVersion: string;
}> {
  if (!isRecord(extras)) throw new Error('packed job: extras must be an object');
  const packageVersion = extras.packageVersion;
  const recorded = isRecord(extras.tarballs) ? (extras.tarballs as Record<string, string>) : {};
  const carried = isRecord(extras.tarballFiles)
    ? (extras.tarballFiles as Record<string, string>)
    : {};
  const expectedKeys = [...REQUIRED_PACKAGE_TARBALLS].sort();
  if (Object.keys(recorded).sort().join(',') !== expectedKeys.join(',')) {
    throw new Error(
      `packed job: tarballs must contain exactly ${expectedKeys.join(', ')}; found ${
        Object.keys(recorded).sort().join(', ') || 'none'
      }`,
    );
  }
  if (Object.keys(carried).sort().join(',') !== expectedKeys.join(',')) {
    throw new Error(
      `packed job: tarballFiles must map exactly ${expectedKeys.join(', ')}; found ${
        Object.keys(carried).sort().join(', ') || 'none'
      }`,
    );
  }
  if (typeof packageVersion !== 'string' || !PACKAGE_VERSION_PATTERN.test(packageVersion)) {
    throw new Error(
      `packed job: packageVersion must be an x.y.z(-label) string, got ${JSON.stringify(
        packageVersion,
      )}`,
    );
  }
  const tarballFiles: Record<string, string> = {};
  await mkdir(join(outDir, 'tarballs'), { recursive: true });
  for (const packageName of REQUIRED_PACKAGE_TARBALLS) {
    const sourcePath = carried[packageName];
    const pathFailures = auditSafeRelativePath(sourcePath);
    if (pathFailures.length > 0) {
      throw new Error(
        `packed job: tarballFiles.${packageName} ${pathFailures.join('; ')}, got ${JSON.stringify(
          sourcePath,
        )}`,
      );
    }
    if (!sourcePath.startsWith('tarballs/') || !sourcePath.endsWith('.tgz')) {
      throw new Error(
        `packed job: tarballFiles.${packageName} must be a tarballs/*.tgz path, got ${sourcePath}`,
      );
    }
    const bytes = await readPacked(sourcePath);
    if (!bytes) {
      throw new Error(`packed tarball missing for ${packageName}: ${sourcePath}`);
    }
    const actualHash = await sha256Bytes(bytes);
    if (actualHash !== recorded[packageName]) {
      throw new Error(
        `packed tarball hash mismatch for ${packageName}: expected ${
          recorded[packageName]
        }, got ${actualHash}`,
      );
    }
    const fileName = sourcePath.split('/').at(-1) as string;
    const finalRelativePath = `tarballs/${fileName}`;
    if (Object.values(tarballFiles).includes(finalRelativePath)) {
      throw new Error(`packed job: duplicate archive path ${finalRelativePath}`);
    }
    await writeFile(join(outDir, finalRelativePath), bytes);
    tarballFiles[packageName] = finalRelativePath;
  }
  return { tarballs: { ...recorded }, tarballFiles, packageVersion };
}
