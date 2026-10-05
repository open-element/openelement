/** The published CLI version, embedded so packed npm installs are self-contained. */
export const CREATE_VERSION = '1.0.0-alpha.9';

/**
 * The Vite release pinned into the generated starter's package.json (the
 * `${v.vite}` scaffold token in the npm/pnpm starter). Embedded for the same
 * reason as CREATE_VERSION (packed npm installs are self-contained); the
 * repository's Vite-pin check (tools/repo deps:vite-check) anchors this copy
 * to the canonical dev pin.
 */
export const VITE_STARTER_PIN = '8.0.16';
