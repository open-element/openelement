/** The published CLI version, embedded so packed npm installs are self-contained. */
export const CREATE_VERSION = '1.0.0-alpha.2';

/**
 * The Vite dev release stamped into the generated starter's import map and
 * dev task. Embedded for the same reason as CREATE_VERSION (packed npm
 * installs are self-contained); the repository's Vite-pin check anchors this
 * copy to the canonical dev pin.
 */
export const VITE_STARTER_PIN = '8.0.16';
