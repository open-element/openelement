// Nitro/jiti loads this module under Node. Keep it free of Deno and non-relative imports.
export const NITRO_COMPATIBILITY_DATE = '2026-06-12';

/**
 * Single-source Nitro version for every first-party consumer (fixture
 * proofs, packed-consumer harnesses, root import map). The pinned line
 * formally supports the Alpha Vite major in its peer metadata, so no
 * `--legacy-peer-deps` workaround is needed anywhere.
 */
export const NITRO_VERSION = '3.0.260610-beta';
