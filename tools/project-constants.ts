// NOTE: this module is also loaded by Nitro/jiti under Node
// (packages/adapter-vite/__fixtures__/nitro-proof/nitro.config.ts) — keep it
// and its imports (./lib/version.ts) free of jsr:/npm: imports.

import { previousPrereleaseVersion } from './lib/version.ts';

export const PACKAGE_VERSION = '0.44.0-beta.2.1';
export const PACKAGE_VERSION_TAG = `v${PACKAGE_VERSION}`;
// Release-train truth is intentionally separate from the package and registry
// line: work may be landed on main before the next package is published.
export const LATEST_LANDED_TRAIN = 'v0.44.0-beta.2.1';
export const ACTIVE_EXECUTION_VERSION = 'v0.44.0-beta.2.1';
export const NEXT_EXECUTION_VERSION = 'v0.44.0-beta.2.2';
// Internal v0.44 admission checkpoints are not package versions. The Alpha
// checkpoint train closed at Alpha.10 (verifier PASS, #1150); with Beta.1
// published as a public prerelease there is no active internal checkpoint —
// the value records that closure so the VERSION_PLAN anchor stays honest.
export const ACTIVE_INTERNAL_CHECKPOINT =
  'none — internal Alpha checkpoints closed at Alpha.10 (verifier PASS, #1150); the active line is Beta.2.x convergence before public 1.0 Alpha (ADR-0152)';
export const NEXT_PUBLIC_PRERELEASE = 'v0.44.0-beta.2.2';
export const RETAINED_PACKAGE_NAMES = Object.freeze([
  '@openelement/adapter-vite',
  '@openelement/app',
  '@openelement/create',
  '@openelement/element',
  '@openelement/ui',
]);
export const REMOVED_PACKAGE_NAMES = Object.freeze([
  '@openelement/adapter-lit',
  '@openelement/adapter-react',
  '@openelement/adapter-vanilla',
  '@openelement/cem',
  '@openelement/compat-check',
  '@openelement/content',
  '@openelement/core',
  '@openelement/elements',
  '@openelement/hub',
  '@openelement/protocol',
  '@openelement/protocols',
  '@openelement/router',
  '@openelement/rpc',
  '@openelement/runtime',
  '@openelement/signal',
  '@openelement/signals',
  '@openelement/ssg',
  '@openelement/style-sheet',
]);
export const REMOVED_PACKAGE_DIRECTORY_NAMES = Object.freeze([
  '@openelement/adapter-lit',
  '@openelement/adapter-react',
  '@openelement/adapter-vanilla',
  '@openelement/cem',
  '@openelement/compat-check',
  '@openelement/elements',
  '@openelement/hub',
  '@openelement/protocols',
  '@openelement/rpc',
  '@openelement/runtime',
  '@openelement/signals',
  '@openelement/style-sheet',
]);
export const PACKAGE_COUNT = RETAINED_PACKAGE_NAMES.length;
export const NITRO_COMPATIBILITY_DATE = '2026-06-12';

// The package line being replaced on the next release bump. This is the
// single source of truth for the "from" side of version-anchor replacements
// (see buildVersionAnchorReplacements in tools/autoflow/release.ts). It is
// kept in sync automatically by updateProjectConstants() during a bump.
export const PREVIOUS_PACKAGE_VERSION = '0.44.0-beta.2';
export const PREVIOUS_PACKAGE_VERSION_TAG = `v${PREVIOUS_PACKAGE_VERSION}`;

// The theme the www roadmap current-line timeline entry carried immediately
// after the last mechanical version bump. The bump rewrites the entry's
// version string but cannot invent the new release's theme — that is human
// release prose. The www gate of check-docs-truth.ts
// (deno task www:check-current-truth) fails while the entry still names
// this superseded theme (the 0.41.1 bump left 'third audit cleanup
// sweep' describing alpha.19 under the v0.41.1 entry). The bump side
// re-records this constant from the pre-bump entry; bootstrap value
// documents the incident.
export const PREVIOUS_RELEASE_THEME = 'framework qualification + governance freeze';

/**
 * Version strings that must never reappear in the head anchor zone of the
 * governed docs (check-version-anchors.ts) or in "published as"-style
 * currency claims (check-strategic-docs.ts). Derived from
 * PREVIOUS_PACKAGE_VERSION plus the enumerable pre-release line before it, so
 * the set stays honest across bumps without a hand-maintained list. A stable
 * (non-prerelease) previous line enumerates no earlier history: its
 * predecessors are not mechanically derivable.
 */
export function stalePackageVersionClaims(): string[] {
  const claims = [PREVIOUS_PACKAGE_VERSION, PREVIOUS_PACKAGE_VERSION_TAG];
  // Canonical prerelease truth lives in ./lib/version.ts (import-free, so this
  // module stays loadable by Nitro/jiti under Node).
  for (
    let previous = previousPrereleaseVersion(PREVIOUS_PACKAGE_VERSION);
    previous !== null;
    previous = previousPrereleaseVersion(previous)
  ) {
    claims.push(previous, `v${previous}`);
  }
  return claims;
}
