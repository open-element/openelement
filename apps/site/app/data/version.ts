// Current source line. The npm registry line may lag (publish is a gated
// human authorization, not an automatic step); prose that claims a published
// line must not use this constant directly.
export const OPENELEMENT_VERSION = 'v1.0.0-alpha.1';

// Per-package registry `latest` dist-tag truth. There is deliberately NO
// single "published version" constant: @openelement/router has never shipped
// the 0.43.x stable line, so no one version covers all four packages. Site and
// docs copy must present the per-package state, never a fabricated shared
// version. Keep in sync with docs/release/release-state.json
// (release:state-machine:check offline; release:registry-check verifies it
// against the live registry).
export const PUBLISHED_LATEST: Readonly<Record<string, string>> = {
  '@openelement/element': 'v0.43.3',
  '@openelement/create': 'v0.43.3',
  '@openelement/ui': 'v0.43.3',
  '@openelement/router': 'v0.41.0-alpha.6',
};

// The newest STABLE version published for every package, or null when none
// exists. It is null today: Router has no 0.43.x. release:registry-check
// computes this from the live registry and rejects any value that is absent
// from any package.
export const COMMON_PUBLISHED_VERSION: string | null = null;

// Human-readable note for the (absent) common complete version.
export const COMMON_PUBLISHED_NOTE = COMMON_PUBLISHED_VERSION === null
  ? 'no single stable version is published for all four packages'
  : `${COMMON_PUBLISHED_VERSION} — published for all four packages`;

// Human-readable per-package latest summary derived from PUBLISHED_LATEST.
export const REGISTRY_NOTE = Object.entries(PUBLISHED_LATEST)
  .map(([name, version]) => `${name.replace('@openelement/', '')} ${version}`)
  .join(' · ');

// The newest prerelease train. It was a PARTIAL publish: element/create/ui
// published at this version, Router never did. Registry-line copy must use
// this constant with the missing-package fact, never as a four-package line.
export const LATEST_PRERELEASE_VERSION = 'v0.44.0-beta.2.2';

// Per-package registry truth at LATEST_PRERELEASE_VERSION. `null` means the
// package was never published at that version. Keep in sync with
// docs/release/release-state.json (checked by release:state-machine:check).
export const PUBLISHED_PACKAGE_VERSIONS: Readonly<Record<string, string | null>> = {
  '@openelement/element': 'v0.44.0-beta.2.2',
  '@openelement/router': null,
  '@openelement/create': 'v0.44.0-beta.2.2',
  '@openelement/ui': 'v0.44.0-beta.2.2',
};
