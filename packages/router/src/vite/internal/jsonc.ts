/**
 * Shared JSONC reader for deno.json-style config files (#708).
 *
 * Single implementation used by workspace-alias.ts and cli/build-client.ts.
 * Parsing is delegated to the mature zero-dependency npm package
 * `jsonc-parser`: deno.json files may contain comments and trailing commas;
 * a real parser handles string literals correctly. `@std/jsonc` is
 * deliberately not used: it would surface as an `npm:@jsr/*` dependency in
 * the packed tarball and force consumers onto the JSR registry bridge.
 */

import { parse, type ParseError } from 'jsonc-parser';

/**
 * Parse JSONC text. Returns null on invalid JSON.
 */
export function parseJsonc(content: string): Record<string, unknown> | null {
  const errors: ParseError[] = [];
  const value: unknown = parse(content, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (errors.length > 0 || value === undefined) return null;
  return value as Record<string, unknown>;
}

/**
 * Read and parse a JSONC file. Returns null when the file is unreadable or
 * its contents are not valid JSONC.
 */
export function readJsonc(path: string): Record<string, unknown> | null {
  let content: string;
  try {
    content = Deno.readTextFileSync(path);
  } catch {
    return null;
  }
  return parseJsonc(content);
}
