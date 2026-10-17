/**
 * The hand-maintained retired-token list for the current-doc retired-API scan
 * (`check-retired-api-refs.ts`).
 *
 * This list exists for packages, subpaths and symbols that never reached a
 * release tag (the release-snapshot diff cannot derive those); everything
 * else is derived at scan time from the newest tagged public-interface
 * snapshot. A token belongs here only while it names something the current
 * line genuinely no longer publishes —
 * `check-retired-api-refs.test.ts` pins that no token names a live workspace
 * package, and that the historical entries stay listed, so the scan cannot be
 * gutted to reach GREEN.
 */
export const RETIRED_API_TOKENS = [
  '@openelement/app',
  '@openelement/adapter-vite',
  'adapter-vite',
  '@openelement/core',
  '@openelement/signal',
  '@openelement/content',
  '@openelement/ssg',
  '/preact',
  'preact-render-to-string',
];
