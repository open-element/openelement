/**
 * Canonical Open Props version discovery for the token generator.
 *
 * The package.json dependency declaration is the one editable declaration of
 * the open-props dependency; the generator derives its provenance header
 * from it instead of carrying a second version constant.
 */

const SPEC = /^([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)$/;

/**
 * Extract the declared open-props version from a package.json dependency
 * object. Fails closed with `sourceLabel` context on anything malformed.
 */
export function parseOpenPropsVersion(dependencies: unknown, sourceLabel: string): string {
  if (dependencies === null || typeof dependencies !== 'object' || Array.isArray(dependencies)) {
    throw new Error(`${sourceLabel}: 'dependencies' must be an object declaring open-props`);
  }
  const map = dependencies as Record<string, unknown>;
  const base = map['open-props'];
  if (typeof base !== 'string') {
    throw new Error(`${sourceLabel}: missing 'open-props' dependency declaration`);
  }
  const match = SPEC.exec(base);
  if (!match) {
    throw new Error(
      `${sourceLabel}: 'open-props' must pin an exact version (got ${JSON.stringify(base)})`,
    );
  }
  return match[1];
}
