/**
 * Workspace-shadow gate: node_modules must link workspace members, never
 * replace them.
 *
 * Deno materializes a workspace member into node_modules as a relative symlink
 * (`node_modules/@probe/b -> ../../pkgs/b`, measured). A real directory at that
 * path can therefore only come from outside the workspace — a packed tarball
 * installed by hand, a stray `npm install` of local artifacts, a copied release
 * tree. That copy silently wins module resolution for anything that resolves
 * through node_modules before the Deno workspace (esbuild bundling of a
 * `vite.config.ts`, for instance), so a run tests a build of the past while
 * reporting on the working tree.
 *
 * Observed cost: on 2026-09-17 a packed copy of @openelement/router built
 * 8 hours before `1ae65fc5` (the `c.req.raw` wrapper in the generated dev
 * entry) shadowed the workspace source, and the request-time parity suite
 * failed all 25 dev-channel steps locally while CI stayed green — the
 * divergence had no visible cause from inside the repo.
 *
 * The fix belongs here rather than in each config: the gate names the shadowed
 * member and the command that clears it, so the state cannot be entered
 * silently again.
 */

import { isAbsolute, relative, resolve } from '@std/path';

export const NODE_MODULES_DIR = 'node_modules';
export const WORKSPACE_MANIFEST = 'deno.json';

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

/** Read the workspace member list from the repository manifests. */
export async function readWorkspaceMembers(root = '.'): Promise<WorkspaceMember[]> {
  const rootConfig = JSON.parse(await Deno.readTextFile(resolve(root, WORKSPACE_MANIFEST)));
  const dirs: string[] = Array.isArray(rootConfig.workspace) ? rootConfig.workspace : [];
  const members: WorkspaceMember[] = [];
  for (const rawDir of dirs) {
    // The workspace list is written as `./packages/element`; normalize so the
    // reported paths read like repository paths.
    const dir = rawDir.replace(/^\.\//, '').replace(/\/$/, '');
    for (const manifest of ['deno.json', 'package.json']) {
      try {
        const config = JSON.parse(await Deno.readTextFile(resolve(root, dir, manifest)));
        if (typeof config.name === 'string' && config.name !== '') {
          members.push({ name: config.name, dir });
          break;
        }
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
    }
  }
  return members;
}

/** Inspect what node_modules holds for one member name. */
export async function readNodeModulesEntry(
  name: string,
  root = '.',
): Promise<NodeModulesEntry> {
  const path = resolve(root, NODE_MODULES_DIR, name);
  let stats: Deno.FileInfo;
  try {
    stats = await Deno.lstat(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return { path: name, kind: 'missing' };
    throw error;
  }
  if (!stats.isSymlink) {
    return { path: name, kind: stats.isDirectory ? 'directory' : 'file' };
  }
  let target: string | undefined;
  try {
    const resolved = await Deno.realPath(path);
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
    Deno.exit(1);
  }
  console.log('Workspace links check passed.');
}
