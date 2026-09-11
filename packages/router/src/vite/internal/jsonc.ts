/**
 * Shared JSONC reader for deno.json-style config files (#708).
 *
 * Single implementation used by workspace-alias.ts and cli/build-client.ts.
 * Parsing is delegated to the `jsonc-parser` npm package (#886): deno.json
 * files may contain comments and trailing commas; a real parser handles
 * string literals correctly. The dependency is externalized by `deno pack`
 * like any other npm dependency — no vendored sources in this package.
 */

import { parse, type ParseError } from 'jsonc-parser';
import { readFileSync } from 'node:fs';

/**
 * Parse JSONC text. Returns null on invalid JSON.
 */
export function parseJsonc(content: string): Record<string, unknown> | null {
  const errors: ParseError[] = [];
  const result = parse(content, errors, { allowTrailingComma: true });
  return errors.length > 0 ? null : (result as Record<string, unknown>);
}

/**
 * Read and parse a JSONC file. Returns null when the file is unreadable or
 * its contents are not valid JSONC.
 *
 * H-12 fix: Use platform-appropriate file reading API —
 * Deno.readTextFileSync in Deno environments, node:fs in Node.js (Vite).
 */
export function readJsonc(path: string): Record<string, unknown> | null {
  let content: string;
  try {
    content = typeof Deno !== 'undefined'
      ? Deno.readTextFileSync(path)
      : readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
  return parseJsonc(content);
}
