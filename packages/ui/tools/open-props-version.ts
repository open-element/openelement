/**
 * Canonical Open Props version discovery for the token generator.
 *
 * The root deno.json import map is the one editable declaration of the
 * open-props dependency; the generator derives its provenance header from
 * it instead of carrying a second version constant, and every open-props
 * subpath mapping must agree with the base mapping. node_modules is never
 * consulted: the installed tree is a build product, not governance truth.
 */

const MAPPING = /^npm:open-props@([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)(?:\/.*)?$/;

/**
 * Extract the declared open-props version from a deno.json `imports` map.
 * Fails closed with `sourceLabel` context on anything malformed or
 * inconsistent.
 */
export function parseOpenPropsVersion(imports: unknown, sourceLabel: string): string {
  if (imports === null || typeof imports !== 'object' || Array.isArray(imports)) {
    throw new Error(`${sourceLabel}: 'imports' must be an object declaring open-props`);
  }
  const map = imports as Record<string, unknown>;
  const base = map['open-props'];
  if (typeof base !== 'string') {
    throw new Error(`${sourceLabel}: missing 'open-props' dependency mapping`);
  }
  const match = MAPPING.exec(base);
  if (!match) {
    throw new Error(
      `${sourceLabel}: 'open-props' must map to npm:open-props@<version> (got ${
        JSON.stringify(base)
      })`,
    );
  }
  const version = match[1];
  for (const [specifier, target] of Object.entries(map)) {
    if (!specifier.startsWith('open-props/')) continue;
    if (typeof target !== 'string') {
      throw new Error(`${sourceLabel}: '${specifier}' must map to a string`);
    }
    const subMatch = MAPPING.exec(target);
    if (!subMatch) {
      throw new Error(
        `${sourceLabel}: '${specifier}' must map to npm:open-props@<version>/... (got ${
          JSON.stringify(target)
        })`,
      );
    }
    if (subMatch[1] !== version) {
      throw new Error(
        `${sourceLabel}: '${specifier}' pins open-props@${
          subMatch[1]
        } but the base declares ${version}`,
      );
    }
  }
  return version;
}
