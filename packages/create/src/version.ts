/** The published CLI version, embedded so packed npm installs are self-contained. */
export const CREATE_VERSION = '1.0.0-alpha.1';

/**
 * The Vite dev release stamped into the generated starter's import map and
 * dev task. Embedded for the same reason as CREATE_VERSION (packed npm
 * installs are self-contained); deps:vite-check anchors this copy to the
 * canonical VITE_DEV_PIN in tools/repo/deps-vite-check.ts.
 */
export const VITE_STARTER_PIN = '8.0.16';
