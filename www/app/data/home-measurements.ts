/**
 * Measured facts shown in the homepage evidence strip.
 *
 * The demo island's hydration chunk measured 8,328 bytes raw and 2,195 bytes
 * with Node zlib gzip at level 9 in the 2026-11-27 site build.
 *
 * To refresh both values, run `vp run site:build` from the repository root,
 * then measure the emitted chunk:
 *
 * ```sh
 * node -e 'const chunk = require("node:fs").readFileSync(process.argv[1]); console.log(chunk.length, require("node:zlib").gzipSync(chunk, { level: 9 }).length)' www/dist/client/islands/island-open-counter-*.js
 * ```
 *
 * The values are checked in so the homepage renderer can use them during a
 * clean build.
 */

/** Raw bytes of the emitted `island-open-counter-*` client chunk. */
export const HOME_DEMO_HYDRATION_BYTES = 8328;

/** Gzip bytes of the same chunk. */
export const HOME_DEMO_HYDRATION_GZIP_BYTES = 2195;

/** Decimal kB, one fraction digit — the site's copy style for sizes. */
export function homeKilobytes(bytes: number): string {
  return `${(bytes / 1000).toFixed(1)} kB`;
}
