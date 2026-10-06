/**
 * Workspace-shadow gate: node_modules must link workspace members, never
 * replace them.
 *
 * The package manager materializes a workspace member into node_modules as a
 * symlink. A real directory at that path can therefore only come from outside
 * the workspace — a packed tarball installed by hand, a stray `npm install` of
 * local artifacts, a copied release tree. That copy silently wins module
 * resolution for anything that resolves through node_modules before the
 * workspace source (the bundler's oxc lowering of a `vite.config.ts`, for
 * instance), so
 * a run tests a build of the past while reporting on the working tree.
 *
 * The fix belongs here rather than in each config: the gate names the shadowed
 * member and the command that clears it, so the state cannot be entered
 * silently again.
 */

import { isAbsolute, relative, resolve } from 'node:path';
import { lstat, realpath } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import process from 'node:process';
import { readWorkspaces } from './workspace-tasks.ts';

export const NODE_MODULES_DIR = 'node_modules';
export const WORKSPACE_MANIFEST = 'package.json';

export interface WorkspaceMember {
  /** The member's package name, e.g. `@openelement/router`. */
  name: string;
  /** Member directory relative to the repository root. */
  dir: string;
}

export interface NodeModulesEntry {
  /** The path under node_modules that matches the member name, e.g. `@scope/name`. */
  path: string;
  kind: 'missing' | 'symlink' | 'directory' | 'file';
  /** For `symlink`: the resolved target, or undefined when the link dangles. */
  target?: string;
}

/** True when `child` is `parent` itself or lives inside it. */
function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Pure decision function: given the workspace members and what node_modules
 * actually holds for each name, return one message per shadowing entry.
 */
export function findWorkspaceShadowFailures(
  members: readonly WorkspaceMember[],
  entries: readonly NodeModulesEntry[],
): string[] {
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  const failures: string[] = [];
  for (const member of members) {
    const entry = byPath.get(member.name);
    if (!entry || entry.kind === 'missing') continue;
    if (entry.kind !== 'symlink') {
      failures.push(
        `${NODE_MODULES_DIR}/${member.name} is a real ${entry.kind}, not a link to ` +
          `${member.dir} — a packed copy shadows the workspace source. ` +
          `Remove it: rm -rf ${NODE_MODULES_DIR}/${member.name}`,
      );
      continue;
    }
    if (entry.target === undefined) {
      failures.push(
        `${NODE_MODULES_DIR}/${member.name} is a dangling symlink (expected ${member.dir})`,
      );
      continue;
    }
    if (!isInside(member.dir, entry.target)) {
      failures.push(
        `${NODE_MODULES_DIR}/${member.name} links to ${entry.target}, outside the ` +
          `workspace member ${member.dir}`,
      );
    }
  }
  return failures;
}

/**
 * Read the workspace member list via the canonical discovery
 * (workspace-tasks.ts owns workspace parsing); members without a declared
 * package name are not node_modules residents and are skipped here.
 */
export async function readWorkspaceMembers(root = '.'): Promise<WorkspaceMember[]> {
  const workspaces = await readWorkspaces(root);
  return workspaces
    .filter((workspace) => workspace.name !== undefined)
    .map((workspace) => ({ name: workspace.name!, dir: workspace.workspace }));
}

/** Inspect what node_modules holds for one member name. */
export async function readNodeModulesEntry(name: string, root = '.'): Promise<NodeModulesEntry> {
  const path = resolve(root, NODE_MODULES_DIR, name);
  let stats: Stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    // node:fs signals "path does not exist" with ENOENT.
    if ((error as { code?: string }).code === 'ENOENT') return { path: name, kind: 'missing' };
    throw error;
  }
  if (!stats.isSymbolicLink()) {
    return { path: name, kind: stats.isDirectory() ? 'directory' : 'file' };
  }
  let target: string | undefined;
  try {
    const resolved = await realpath(path);
    // Report workspace-relative paths so the message is stable across checkouts.
    target = relative(resolve(root), resolved) || '.';
  } catch {
    target = undefined;
  }
  return { path: name, kind: 'symlink', target };
}

export async function scanWorkspaceShadows(root = '.'): Promise<string[]> {
  const members = await readWorkspaceMembers(root);
  const entries: NodeModulesEntry[] = [];
  for (const member of members) {
    entries.push(await readNodeModulesEntry(member.name, root));
  }
  return findWorkspaceShadowFailures(members, entries);
}

if (import.meta.main) {
  const failures = await scanWorkspaceShadows();
  if (failures.length > 0) {
    console.error('Workspace shadow check failed:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log('Workspace links check passed.');
}
