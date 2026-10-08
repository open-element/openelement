/**
 * npm publish policy: version existence, the publish invocation, and the
 * dist-tag policy (the 1.0 prerelease line rides `latest` — owner ruling
 * 2026-10-07 — while earlier lines keep the #607 channel tag). Reads no
 * workspace state beyond the package graph and the packed tarball path.
 */

import { assertPublicReleaseVersion, prereleaseChannel } from '../lib/version.ts';
import { formatError } from '@openelement/element';
import { type PackageInfo } from '../lib/package-graph.ts';
import { tarballPath } from '../lib/npm-tarball.ts';
import { runCommand } from '../lib/process.ts';
import { npmView } from './npm-release-verifier.ts';

function isPrerelease(version: string): boolean {
  return version.includes('-');
}

async function npmPackageVersionExists(name: string, version: string): Promise<boolean> {
  try {
    return (await npmView(`${name}@${version}`, 'version')) === version;
  } catch {
    // #875: keep the lazy semantics — a failed registry query must not block
    // publish; the publish step itself retries/propagates real failures.
    return false;
  }
}

export interface PublishPackageIo {
  versionExists: (name: string, version: string) => Promise<boolean>;
  publish: (args: string[]) => Promise<void>;
  log: (message: string) => void;
}

const defaultPublishPackageIo: PublishPackageIo = {
  versionExists: npmPackageVersionExists,
  publish: (args) => runCommand('npm', args),
  log: console.log,
};

export async function publishPackage(
  pkg: PackageInfo,
  dryRun: boolean,
  io: PublishPackageIo = defaultPublishPackageIo,
): Promise<void> {
  assertPublicReleaseVersion(pkg.version);
  const tar = tarballPath(pkg);
  if (await io.versionExists(pkg.name, pkg.version)) {
    io.log(`[npm] ${pkg.name}@${pkg.version} already published; skipping.`);
    return;
  }
  const args = dryRun
    ? ['publish', tar, '--dry-run', '--access', 'public']
    : ['publish', tar, '--access', 'public'];
  // Provenance requires GitHub Actions OIDC; skip locally and on other CI providers.
  // #1187: in the Actions lane, auth is npm Trusted Publishing (no token);
  // `--provenance` stays explicit so the attestation intent is visible here.
  if (!dryRun && process.env.GITHUB_ACTIONS === 'true') {
    args.push('--provenance');
  }
  if (isPrerelease(pkg.version)) {
    args.push('--tag', npmPublishTag(pkg.version));
  }
  try {
    await io.publish(args);
  } catch (error) {
    const msg = formatError(error);
    if (msg.includes('E403') || msg.includes('previously published versions')) {
      // #1038: E403 is not unique to already-published — npm also returns it
      // for insufficient token scope and 2FA policy, and npmPackageVersionExists
      // answers false on query failure (#875). Re-check the registry and skip
      // only when the version is actually there; otherwise the pipeline would
      // go green with the package unpublished.
      if (await io.versionExists(pkg.name, pkg.version)) {
        io.log(`[npm] ${pkg.name}@${pkg.version} already published; skipping.`);
        return;
      }
    }
    throw error;
  }
  // See npmPublishTag: the 1.0 prerelease line publishes onto `latest`
  // (owner ruling 2026-10-07); earlier lines keep the #607 channel-only rule.
}

/**
 * Owner ruling 2026-10-07: from 1.0.0-alpha.11 the 1.0 prerelease line
 * rides the `latest` dist-tag — `npm install @openelement/*` should land on
 * the current 1.0 line (the pre-1.0 0.x registry history stays behind it).
 * This supersedes #607's never-move-latest-with-a-prerelease rule for this
 * line; the channel tag (alpha) stays as an alias, re-pointed post-publish
 * by the release workflow so `@alpha` consumers keep resolving.
 */
export function npmPublishTag(version: string): string {
  // Canonical prerelease/version truth: tools/lib/version.ts (#1231 M16).
  const channel = prereleaseChannel(version);
  if (!channel) {
    // Only called for prereleases (see publishPackage); anything else is a
    // tooling bug, not 'next'.
    throw new Error(`No npm publish tag for version: ${version}`);
  }
  return isOneOhPrereleaseLine(version) ? 'latest' : channel;
}

function isOneOhPrereleaseLine(version: string): boolean {
  return version.startsWith('1.0.0-');
}
