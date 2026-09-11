import releaseState from '../docs/release/release-state.json' with { type: 'json' };

export const PACKAGE_VERSION = releaseState.sourceVersion;
export const PACKAGE_VERSION_TAG = `v${PACKAGE_VERSION}`;

export const RETAINED_PACKAGE_NAMES = Object.freeze(releaseState.packages);

export const PACKAGE_COUNT = RETAINED_PACKAGE_NAMES.length;
