/**
 * www source-line anchor cross-assertion (#1468).
 *
 * www/app/data/version.ts must keep OPENELEMENT_VERSION derived from the
 * generated release-line module (`_generated-release-line.ts`), and that
 * generated module must mirror docs/release/release-state.json. Two consumers
 * share this audit: tools/repo/version-bump.ts (anchor cross-assertion at
 * bump time) and tools/repo/check-release-state-machine.ts (the offline
 * release gate), so the site can never show two different "current version"
 * claims on one screen.
 */

import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

/** The subset of the release-state shape the anchor audit needs (schema v4). */
export interface AnchorReleaseState {
  sourceVersion: string;
  packages: readonly {
    name: string;
    status?: 'published' | 'unpublished';
    registry?: Record<string, string>;
  }[];
}

function isPublished(
  entry: AnchorReleaseState['packages'][number],
): entry is AnchorReleaseState['packages'][number] & { registry: Record<string, string> } {
  return entry.status !== 'unpublished';
}

/** Repo-relative paths of the audited www truth files. */
export const VERSION_SOURCE_WWW = 'www/app/data/version.ts';
export const RELEASE_LINE_GENERATED = 'www/app/data/_generated-release-line.ts';

export interface DisplayProjection {
  /** Package name to the displayed npm latest, including its `v` prefix. */
  publishedLatest: Record<string, string>;
  unreleased: readonly string[];
}

function generatedValue(source: string, name: string): unknown {
  const match = new RegExp(`^export const ${name}(?::[^=]+)? = ([^\\n]+);$`, 'mu').exec(source);
  if (match?.[1] === undefined) throw new Error(`${name} declaration not found`);
  return JSON.parse(match[1]);
}

/** Read the generated registry projection without executing the site. */
export function readDisplayProjection(source: string): DisplayProjection {
  const publishedLatest = generatedValue(source, 'PUBLISHED_LATEST');
  if (
    publishedLatest === null ||
    typeof publishedLatest !== 'object' ||
    Array.isArray(publishedLatest)
  ) {
    throw new Error('PUBLISHED_LATEST must be a map of packages to npm latest versions');
  }
  if (Object.keys(publishedLatest).length === 0)
    throw new Error('PUBLISHED_LATEST carries no entries');
  const latest: Record<string, string> = {};
  for (const [name, value] of Object.entries(publishedLatest)) {
    if (typeof value !== 'string' || !value.startsWith('v')) {
      throw new Error(`PUBLISHED_LATEST ${name} must have a v-prefixed version`);
    }
    latest[name] = value;
  }
  const unreleased = generatedValue(source, 'UNRELEASED_PACKAGES');
  if (!Array.isArray(unreleased) || !unreleased.every((name) => typeof name === 'string')) {
    throw new Error('UNRELEASED_PACKAGES must be an array of package names');
  }
  return { publishedLatest: latest, unreleased };
}

export function readCommonPublishedVersion(source: string): string | null {
  const value = generatedValue(source, 'COMMON_PUBLISHED_VERSION');
  if (value !== null && typeof value !== 'string') {
    throw new Error('COMMON_PUBLISHED_VERSION must be a stable version string or null');
  }
  return value;
}

/**
 * Cross-assert the www version anchors against release bookkeeping truth.
 * The assertions are text-level (the checks read the modules as source), so
 * they hold without executing the www module graph.
 */
export function wwwReleaseAnchorFailures(
  state: AnchorReleaseState,
  siteVersionSource: string,
  releaseLineSource: string,
): string[] {
  const failures: string[] = [];
  // The site's current-version claim must stay DERIVED from the generated
  // release-line module: a hand-written literal reintroduces the dual-version
  // bug this audit exists to prevent.
  if (!/OPENELEMENT_VERSION\s*=\s*`v\$\{SOURCE_VERSION\}`/.test(siteVersionSource)) {
    failures.push(
      'www OPENELEMENT_VERSION must stay derived from SOURCE_VERSION (no hand-written version)',
    );
  }
  // The generated release-line module must mirror release-state.json
  // — the same truth www#check:content-data regenerates, asserted here so a
  // stale module fails the release gate without the www toolchain.
  const sourceVersionMatch = releaseLineSource.match(/SOURCE_VERSION = '([^']+)'/);
  if (sourceVersionMatch?.[1] !== state.sourceVersion) {
    failures.push(
      'www _generated-release-line.ts SOURCE_VERSION ' +
        (sourceVersionMatch?.[1] ?? 'missing') +
        ' must equal release-state sourceVersion ' +
        state.sourceVersion,
    );
  }
  const publishedMatch = releaseLineSource.match(/SOURCE_LINE_PUBLISHED = (true|false)/);
  // Schema v4 (#1557): only packages that HAVE an @alpha dist-tag can agree or
  // disagree with the source version; an unpublished package carries no
  // dist-tag and cannot vote.
  const expectedPublished = state.packages
    .filter(isPublished)
    .every((entry) => entry.registry.alpha === state.sourceVersion);
  if (publishedMatch?.[1] !== String(expectedPublished)) {
    failures.push(
      'www SOURCE_LINE_PUBLISHED must be ' +
        String(expectedPublished) +
        ' (every package @alpha dist-tag resolving to sourceVersion)',
    );
  }
  const resolvesMatch = releaseLineSource.match(/ALPHA_RESOLVES_TO = '([^']+)'/);
  const expectedResolvesTo =
    state.packages.find((entry) => entry.name === '@openelement/create' && isPublished(entry))
      ?.registry?.alpha ?? 'unknown';
  if (resolvesMatch?.[1] !== expectedResolvesTo) {
    failures.push(
      'www ALPHA_RESOLVES_TO must be ' +
        expectedResolvesTo +
        " (the create package's @alpha dist-tag)",
    );
  }
  return failures;
}

/**
 * Read the live tree's release-state.json plus the two www truth modules and
 * cross-assert them. Returns one message per drifted anchor (empty when the
 * tree is consistent).
 */
export async function wwwReleaseAnchorDrift(root: string): Promise<string[]> {
  let state: AnchorReleaseState;
  try {
    state = JSON.parse(
      await readFile(join(root, 'docs/release/release-state.json'), 'utf8'),
    ) as AnchorReleaseState;
  } catch {
    return ['docs/release/release-state.json: missing or unreadable'];
  }
  const siteVersionSource = await readFile(join(root, VERSION_SOURCE_WWW), 'utf8').catch(
    () => null,
  );
  const releaseLineSource = await readFile(join(root, RELEASE_LINE_GENERATED), 'utf8').catch(
    () => null,
  );
  if (siteVersionSource === null || releaseLineSource === null) {
    return [VERSION_SOURCE_WWW + ' or ' + RELEASE_LINE_GENERATED + ': missing'];
  }
  return wwwReleaseAnchorFailures(state, siteVersionSource, releaseLineSource);
}
