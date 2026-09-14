// Current source line. The npm registry line may lag (publish is a gated
// human authorization, not an automatic step); prose that claims a published
// line must not use this constant directly.
export const OPENELEMENT_VERSION = 'v1.0.0-alpha.1';

// Current npm registry line — the newest actually published four-package
// release. Registry-line copy must use this constant; OPENELEMENT_VERSION is
// reserved for source-line context.
export const PUBLISHED_PACKAGE_VERSION = 'v0.44.0-beta.2.2';

// The published stable line (npm `latest`). Stable-line copy must use this
// constant, never the alpha PUBLISHED_PACKAGE_VERSION (#1066).
export const PUBLISHED_STABLE_VERSION = 'v0.43.3';
