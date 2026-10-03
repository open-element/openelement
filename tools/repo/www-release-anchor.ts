/**
 * www source-line anchor cross-assertion (#1468).
 *
 * www/app/data/version.ts must keep OPENELEMENT_VERSION derived from the
 * generated release-line module (`_generated-release-line.ts`), and that
 * committed module must mirror docs/release/release-state.json. Two consumers
 * share this audit: tools/repo/version-bump.ts (anchor cross-assertion at
 * bump time) and tools/repo/check-release-state-machine.ts (the offline
 * release gate), so the site can never show two different "current version"
 * claims on one screen.
 */

import { join } from '@std/path';
import { readFile } from 'node:fs/promises';

/** The subset of the release-state shape the anchor audit needs. */
export interface AnchorReleaseState {
  sourceVersion: string;
  packages: readonly {
    name: string;
    registry: Record<string, string>;
  }[];
}

/** Repo-relative paths of the audited www truth files. */
export const VERSION_SOURCE_WWW = 'www/app/data/version.ts';
export const RELEASE_LINE_GENERATED = 'www/app/data/_generated-release-line.ts';

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
  // The committed generated release-line module must mirror release-state.json
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
  const expectedPublished = state.packages.every(
    (entry) => entry.registry.alpha === state.sourceVersion,
  );
  if (publishedMatch?.[1] !== String(expectedPublished)) {
    failures.push(
      'www SOURCE_LINE_PUBLISHED must be ' +
        String(expectedPublished) +
        ' (every package @alpha dist-tag resolving to sourceVersion)',
    );
  }
  const resolvesMatch = releaseLineSource.match(/ALPHA_RESOLVES_TO = '([^']+)'/);
  const expectedResolvesTo =
    state.packages.find((entry) => entry.name === '@openelement/create')?.registry.alpha ??
    'unknown';
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
