/**
 * @openelement/router - Workspace alias auto-generation
 *
 * Reads Deno workspace deno.json exports and generates
 * Vite resolve.alias entries. Uses sync Deno APIs so it
 * can run in synchronous plugin hooks (config, configResolved).
 */

import { resolve } from '../internal/host-path.ts';
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

/** One `@openelement/*` specifier an app pins to a registry package. */
export interface RegistryPinnedImport {
  specifier: string;
  target: string;
}

/** The app-inside-a-checkout state that would silently swap the app's deps. */
export interface WorkspaceAliasHijack {
  /** The app root whose imports would be rewritten. */
  appRoot: string;
  /** The enclosing workspace whose aliases would win. */
  workspaceRoot: string;
  /** The app's registry-pinned `@openelement/*` specifiers. */
  pinned: RegistryPinnedImport[];
}

/**
 * Finding A guard (#1415, same family as #1371): an app created INSIDE a
 * framework checkout declares `@openelement/*` at registry versions, but the
 * workspace aliases generated from the enclosing checkout silently replace
 * those specifiers with the checkout's sources. The build then reports success
 * while testing a different framework version than the app asked for — the
 * feature log line (`Auto-generated N resolve alias(es) from workspace`)
 * appears in both the correct monorepo case and this broken one.
 *
 * The discriminator is the app's own pin: a repo-owned fixture expresses its
 * workspace dependency with a relative source path (`../../../packages/...`)
 * and is left alone; a scaffolded consumer app pins `npm:`/`jsr:` and is
 * refused. Apps that are workspace members are exempt for the same reason
 * (the workspace IS their dependency declaration).
 */
export function detectWorkspaceAliasHijack(appRoot: string): WorkspaceAliasHijack | null {
  const dir = resolve(appRoot);
  const appCfg = readJsonc(resolve(dir, 'deno.json'));
  if (!appCfg) return null;
  const imports = appCfg.imports as Record<string, string> | undefined;
  if (!imports) return null;
  const pinned = Object.entries(imports)
    .filter(([specifier, target]) =>
      specifier.startsWith('@openelement/') &&
      (target.startsWith('npm:') || target.startsWith('jsr:'))
    )
    .map(([specifier, target]) => ({ specifier, target }));
  if (pinned.length === 0) return null;

  const workspaceRoot = findWorkspaceRoot(dir);
  if (workspaceRoot === null || workspaceRoot === dir) return null;

  // A workspace member declares its dependency through the workspace itself.
  const rootCfg = readJsonc(resolve(workspaceRoot, 'deno.json'));
  const members: string[] = (rootCfg?.workspace as string[]) || [];
  if (
    members.some((member) => resolve(workspaceRoot, member) === dir)
  ) {
    return null;
  }

  return { appRoot: dir, workspaceRoot, pinned };
}

/** The fail-closed error for {@linkcode detectWorkspaceAliasHijack}. */
export function workspaceAliasHijackError(hijack: WorkspaceAliasHijack): Error {
  const details = hijack.pinned.map((entry) => `  ${entry.specifier} -> ${entry.target}`).join(
    '\n',
  );
  return new Error(
    `[openElement] This app is built inside a Deno workspace, so the workspace's ` +
      `@openelement/* aliases would silently replace the versions it declares:\n${details}\n` +
      `  app:            ${hijack.appRoot}\n` +
      `  enclosing repo: ${hijack.workspaceRoot}\n` +
      `The build refuses to guess (a build that resolves a different framework ` +
      `version than the app asked for is not a passing build). Either move the app ` +
      `outside the checkout, or delete its @openelement/* import-map entries to ` +
      `consume the checkout's sources on purpose.`,
  );
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
