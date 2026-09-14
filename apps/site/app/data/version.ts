// Current source line. The npm registry line may lag (publish is a gated
// human authorization, not an automatic step); prose that claims a published
// line must not use this constant directly.
export const OPENELEMENT_VERSION = 'v1.0.0-alpha.1';

// The newest release published for ALL four packages (npm `latest`). Stable
// registry-line copy uses this; a prerelease that shipped only some packages
// must never be presented as the complete published line.
export const PUBLISHED_STABLE_VERSION = 'v0.43.3';

// The newest release published for all four packages, named for callers that
// want the complete published line without implying the stable track.
export const PUBLISHED_PACKAGE_VERSION = 'v0.43.3';

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
