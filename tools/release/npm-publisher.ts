/**
 * npm publish policy: version existence, the publish invocation, and the
 * dist-tag policy (prereleases never move `latest`). Reads no workspace state
 * beyond the package graph and the packed tarball path.
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

async function npmPackageVersionExists(
  name: string,
  version: string,
): Promise<boolean> {
  try {
    return await npmView(`${name}@${version}`, 'version') === version;
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
  if (!dryRun && Deno.env.get('GITHUB_ACTIONS') === 'true') {
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
  // #607: prerelease publishes use --tag alpha|beta|rc only. Never move
  // `latest` onto an alpha — `latest` stays on the last stable line so
  // `npm install @openelement/*` does not land on prerelease by default.
  // Stable publishes keep npm's default `latest` tag.
}

export function npmPublishTag(version: string): string {
  // Canonical prerelease/version truth: tools/lib/version.ts (#1231 M16).
  const channel = prereleaseChannel(version);
  if (channel) return channel;
  // Only called for prereleases (see publishPackage), and the release line
  // produces alpha/beta/rc only — anything else is a tooling bug, not 'next'.
  throw new Error(`No npm publish tag for version: ${version}`);
}
