// This module is loaded by Nitro/jiti under Node. Keep it free of jsr:/npm: imports.

export const PACKAGE_VERSION = '1.0.0-alpha.1';
export const PACKAGE_VERSION_TAG = `v${PACKAGE_VERSION}`;

export const RETAINED_PACKAGE_NAMES = Object.freeze([
  '@openelement/adapter-vite',
  '@openelement/router',
  '@openelement/create',
  '@openelement/element',
]);

export const PACKAGE_COUNT = RETAINED_PACKAGE_NAMES.length;
export const NITRO_COMPATIBILITY_DATE = '2026-06-12';
