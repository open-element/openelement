/**
 * Shared JSONC reader for deno.json-style config files (#708).
 *
 * Single implementation used by workspace-alias.ts and cli/build-client.ts.
 * Parsing is delegated to `@std/jsonc`: deno.json files may contain comments
 * and trailing commas; a real parser handles string literals correctly.
 */

import { parse } from '@std/jsonc';

/**
 * Parse JSONC text. Returns null on invalid JSON.
 */
export function parseJsonc(content: string): Record<string, unknown> | null {
  try {
    return parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
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
