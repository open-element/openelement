/**
 * @openelement/router - Workspace alias auto-generation
 *
 * Reads Deno workspace deno.json exports and generates
 * Vite resolve.alias entries. Uses sync Deno APIs so it
 * can run in synchronous plugin hooks (config, configResolved).
 */

import { resolve } from 'node:path';
import { readJsonc } from './internal/jsonc.ts';

interface AliasEntry {
  find: string;
  replacement: string;
}

/**
 * Walk up from startDir to find a deno.json with a "workspace" field.
 */
export function findWorkspaceRoot(startDir: string): string | null {
  let dir = resolve(startDir);
  const fsRoot = resolve('/');
  while (dir !== fsRoot && dir !== resolve(dir, '..')) {
    const cfg = readJsonc(resolve(dir, 'deno.json'));
    if (cfg?.workspace && Array.isArray(cfg.workspace)) return dir;
    dir = resolve(dir, '..');
  }
  return null;
}

/**
 * Generate Vite resolve.alias from workspace packages' deno.json exports.
 * Subpath aliases come before parent (Vite prefix matching rule).
 */
export function generateWorkspaceAliases(workspaceRoot: string): AliasEntry[] {
  const rootCfg = readJsonc(resolve(workspaceRoot, 'deno.json'));
  if (!rootCfg) return [];

  const members: string[] = (rootCfg.workspace as string[]) || [];
  const aliases: AliasEntry[] = [];

  for (const member of members) {
    const memberDir = resolve(workspaceRoot, member);
    const memberCfg = readJsonc(resolve(memberDir, 'deno.json'));
    if (!memberCfg) continue;

    const name = memberCfg.name as string | undefined;
    const exports = memberCfg.exports as
      | Record<string, string>
      | string
      | undefined;
    if (!name || !exports) continue;

    if (typeof exports === 'string') {
      aliases.push({ find: name, replacement: resolve(memberDir, exports) });
      continue;
    }

    // Subpath aliases first (Vite prefix matching)
    for (const [exportPath, sourcePath] of Object.entries(exports)) {
      if (exportPath === '.') continue;
      const subpath = exportPath.replace(/^\.\//, '/');
      aliases.push({
        find: `${name}${subpath}`,
        replacement: resolve(memberDir, sourcePath as string),
      });
    }
    // Parent alias last. Subpath aliases above already handle every exported
    // subpath, so a direct import of the package name resolves to the "./"
    // export entry without falling through to directory-index heuristics.
    if (exports['.']) {
      aliases.push({
        find: name,
        replacement: resolve(memberDir, exports['.'] as string),
      });
    }
  }
  return aliases;
}
