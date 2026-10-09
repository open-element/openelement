/**
 * www registry-drift assertion (alpha.13 E3): the site's displayed version
 * values must equal what the registry actually serves, checked against the
 * live registry at gate time instead of only asserted in prose ("sourced from
 * truth" becomes a machine guard).
 *
 * What it compares, and why both layers:
 *   - DISPLAY layer (the E3-2 assertion): `PUBLISHED_LATEST` in
 *     www/app/data/version.ts — the per-package values the homepage version
 *     block and the changelog register render — must equal the registry's
 *     `latest` dist-tag for each package, and a package named in
 *     `UNRELEASED_PACKAGES` must NOT be known to the registry. This is the
 *     alpha.12 failure mode exactly: the site displayed alpha.11 while npm
 *     served alpha.12.
 *   - TRACKED layer: docs/release/release-state.json's registry block must
 *     agree with the same answers (its tracked tags must match; its `latest`
 *     must be among the registry's versions). release:registry-check does the
 *     full structural comparison offline-wired; this layer keeps the drift
 *     check honest on its own, so a green drift run cannot be produced by a
 *     display that happens to match while the record does not.
 *
 * Offline behaviour is explicit and loud, never a silent pass: when every
 * query fails for a network reason (ENOTFOUND / EAI_AGAIN / ETIMEDOUT /
 * ECONNREFUSED / ENETUNREACH / ECONNRESET / getaddrinfo), the CLI prints a
 * `SKIP` line naming the reason and exits 0. A query failure that is not a
 * network failure (auth, malformed answer) is a red — an unverifiable display
 * must not pass.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import {
  npmRegistryEvidence,
  RELEASE_STATE_PATH,
  type RegistryEvidence,
  type ReleaseStateDocument,
  WWW_VERSION_PATH,
} from './registry-sync.ts';

/** The read-only query surface (shared with the sync: one implementation). */
export type DriftQuery = (packageName: string) => Promise<RegistryEvidence>;

const NETWORK_MARKERS = [
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'getaddrinfo',
  'socket hang up',
  'request to https://registry.npmjs.org failed',
] as const;

/** True when a query failure reads as "the network is not available". */
export function isOfflineFailure(message: string): boolean {
  return NETWORK_MARKERS.some((marker) => message.includes(marker));
}

/** True when npm answered "no such package" (the expected answer for a name
 * that has never published). */
export function isMissingPackageFailure(message: string): boolean {
  return /\bE404\b|404 Not Found/iu.test(message);
}

/** The display constants this check compares (www/app/data/version.ts). */
export interface DisplayProjection {
  /** Package name -> displayed version WITH the `v` prefix. */
  publishedLatest: Record<string, string>;
  /** Names the site claims have never published. */
  unreleased: readonly string[];
}

/**
 * Where a network failure is recorded instead of aborting the run (see
 * {@link runRegistryDriftCheck}): the finding list keeps what it already
 * proved, and the caller decides — failures first, SKIP only when nothing
 * diverged and something was unreachable.
 */
export interface DriftTolerance {
  onOffline: (message: string) => void;
}

async function queryOrSkip(
  name: string,
  query: DriftQuery,
  tolerance?: DriftTolerance,
): Promise<RegistryEvidence | undefined> {
  try {
    return await query(name);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (tolerance && isOfflineFailure(message)) {
      tolerance.onOffline(message);
      return undefined;
    }
    throw error;
  }
}

/**
 * Read the two display constants out of the www source. Text-level on the
 * same terms as release:state-machine:check and www-release-anchor (both read
 * this file as source), so all three agree about which numbers the site
 * shows. Fail-closed: a missing constant throws instead of returning an empty
 * projection that would vacuously pass.
 */
export function readDisplayProjection(source: string): DisplayProjection {
  const publishedBody =
    /export const PUBLISHED_LATEST: Readonly<Record<string, string>> = \{([\s\S]*?)\n\};/u.exec(
      source,
    )?.[1];
  if (publishedBody === undefined) {
    throw new Error('readDisplayProjection: PUBLISHED_LATEST declaration not found');
  }
  const publishedLatest: Record<string, string> = {};
  for (const match of publishedBody.matchAll(/'([^']+)':\s*'([^']+)'/gu)) {
    publishedLatest[match[1]!] = match[2]!;
  }
  if (Object.keys(publishedLatest).length === 0) {
    throw new Error('readDisplayProjection: PUBLISHED_LATEST carries no entries');
  }
  const unreleasedBody =
    /export const UNRELEASED_PACKAGES: readonly string\[\] = \[([^\]]*)\]/u.exec(source)?.[1];
  if (unreleasedBody === undefined) {
    throw new Error('readDisplayProjection: UNRELEASED_PACKAGES declaration not found');
  }
  const unreleased = [...unreleasedBody.matchAll(/'([^']+)'/gu)].map((match) => match[1]!);
  return { publishedLatest, unreleased };
}

/** One line per package that diverges from the live registry. */
export async function displayDriftFailures(
  display: DisplayProjection,
  query: DriftQuery,
  tolerance?: DriftTolerance,
): Promise<string[]> {
  const failures: string[] = [];
  for (const [name, displayed] of Object.entries(display.publishedLatest)) {
    const evidence = await queryOrSkip(name, query, tolerance);
    if (!evidence) continue;
    const observed = evidence.distTags.latest;
    const expected = displayed.replace(/^v/u, '');
    if (observed !== expected) {
      failures.push(
        `display drift: ${name} shows v${expected} but the registry's latest is ` +
          `${observed ?? '<none>'}`,
      );
    }
  }
  for (const name of display.unreleased) {
    try {
      const { distTags } = await query(name);
      failures.push(
        `display drift: ${name} is named as never-published but the registry serves ` +
          `${Object.values(distTags).join(', ') || '<no tags>'}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isMissingPackageFailure(message)) continue; // expected
      if (tolerance && isOfflineFailure(message)) {
        tolerance.onOffline(message);
        continue;
      }
      throw error;
    }
  }
  return failures;
}

/** One line per tracked registry entry that diverges from the live registry. */
export async function registryDriftFailures(
  document: ReleaseStateDocument,
  query: DriftQuery,
  tolerance?: DriftTolerance,
): Promise<string[]> {
  const failures: string[] = [];
  for (const entry of document.packages) {
    if (entry.status === 'unpublished') {
      if (entry.registry !== undefined) {
        failures.push(`${entry.name} is unpublished but carries a registry block`);
      }
      continue;
    }
    const evidence = await queryOrSkip(entry.name, query, tolerance);
    if (!evidence) continue;
    const { distTags, versions } = evidence;
    if (!entry.registry) {
      failures.push(`${entry.name} is published but carries no registry block`);
      continue;
    }
    for (const [tag, tracked] of Object.entries(entry.registry)) {
      const observed = distTags[tag];
      if (observed !== tracked) {
        failures.push(
          `registry drift: ${entry.name} dist-tag ${tag} tracked as ${tracked}, ` +
            `registry says ${observed ?? 'absent'}`,
        );
      }
    }
    if (!versions.includes(entry.registry.latest ?? '')) {
      failures.push(
        `registry drift: ${entry.name} tracked latest ${entry.registry.latest ?? '<none>'} ` +
          'is not among the registry versions',
      );
    }
  }
  return failures;
}

export interface DriftCheckResult {
  failures: string[];
  /** True when at least one package could not be queried (loud skip, not a pass). */
  skipped: boolean;
  /** The offline reason, when skipped. */
  reason?: string;
  /** How many packages were reachable and verified. */
  verifiedPackages: number;
  /** How many packages a network failure left unverified. */
  unverifiedPackages: number;
}

/**
 * Run both layers. A package whose query fails for a network reason is counted
 * as unverified and skipped — but findings already established from the
 * packages that DID answer are never discarded: the caller fails closed on any
 * failure first, and only reports SKIP when nothing diverged and something
 * could not be reached. (Discarding results on the first hiccup would let a
 * confirmed drift be erased by a later blip, which is the "green that means
 * nothing" this check exists to prevent.) Any non-network query failure is
 * rethrown so it fails closed.
 */
export async function runRegistryDriftCheck(options: {
  document: ReleaseStateDocument;
  display: DisplayProjection;
  query: DriftQuery;
}): Promise<DriftCheckResult> {
  const offlineReasons: string[] = [];
  let unverified = 0;
  const tolerance: DriftTolerance = {
    onOffline: (message) => {
      unverified += 1;
      offlineReasons.push(message);
    },
  };
  const failures = [
    ...(await displayDriftFailures(options.display, options.query, tolerance)),
    ...(await registryDriftFailures(options.document, options.query, tolerance)),
  ];
  const expectedQueries =
    Object.keys(options.display.publishedLatest).length +
    options.display.unreleased.length +
    options.document.packages.filter((entry) => entry.status !== 'unpublished').length;
  return {
    failures,
    skipped: unverified > 0,
    ...(offlineReasons.length > 0 ? { reason: offlineReasons[0]! } : {}),
    verifiedPackages: expectedQueries - unverified,
    unverifiedPackages: unverified,
  };
}

/** Read both tracked sources from the repository root. */
export async function readTrackedTruth(root: string): Promise<{
  document: ReleaseStateDocument;
  display: DisplayProjection;
}> {
  const document = JSON.parse(
    await readFile(join(root, RELEASE_STATE_PATH), 'utf8'),
  ) as ReleaseStateDocument;
  const display = readDisplayProjection(await readFile(join(root, WWW_VERSION_PATH), 'utf8'));
  return { document, display };
}

async function main(): Promise<void> {
  const root = process.cwd();
  const { document, display } = await readTrackedTruth(root);
  const result = await runRegistryDriftCheck({
    document,
    display,
    query: npmRegistryEvidence,
  });
  // Findings first: a network failure elsewhere never erases a proven drift.
  if (result.failures.length > 0) {
    console.error('registry-drift: the site displays version values the registry does not serve:');
    for (const failure of result.failures) console.error(`- ${failure}`);
    console.error(
      "Land the publish train's registry-sync output (docs/release/release-state.json + " +
        'www/app/data/version.ts + the regenerated release-line module) or fix the copy.',
    );
    process.exit(1);
  }
  if (result.skipped) {
    console.log(
      `registry-drift: SKIP (no network — the npm registry could not be reached: ` +
        `${result.reason ?? 'unknown'}). ${result.verifiedPackages} package(s) were ` +
        `verified clean, ${result.unverifiedPackages} could not be verified.`,
    );
    process.exit(0);
  }
  console.log(
    `registry-drift: ${Object.keys(display.publishedLatest).length} displayed package version(s) ` +
      `match the live registry; ${display.unreleased.length} never-published name(s) absent.`,
  );
}

if (import.meta.main) await main();
