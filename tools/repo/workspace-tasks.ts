/**
 * Canonical workspace + task discovery for repo-wide tooling doctrine.
 *
 * One owner for two facts that were previously copied per tool:
 *   - which workspaces exist: derived from the root `pnpm-workspace.yaml`
 *     `packages` globs (the real workspace config), never a hand-maintained
 *     array;
 *   - which scripts are committed generators vs build-artifact emitters:
 *     derived from each workspace's package.json scripts (a script referenced
 *     by a `generate:*` script is a generator; a script named `emit-*.ts`
 *     referenced by any script is an emitter).
 *
 * Consumers: generate-all.ts (runs every generator script) and
 * check-generator-gates.ts (enforces the per-class wiring rules). This
 * module is neutral: it reads files, never exits.
 */
import { join, relative, resolve } from '@std/path';
import { walk } from '../../tools/lib/std-fs.ts';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';

export interface WorkspaceTasks {
  /** Canonical repository-relative workspace path (e.g. 'www'). */
  workspace: string;
  /** Package name declared by the workspace manifest, when present. */
  name?: string;
  dir: string;
  tasks: Record<string, string>;
}

export interface ScriptEntry {
  workspace: string;
  /** Script key that references the file. */
  taskKey: string;
  /** Workspace-relative script path as written in the script command. */
  script: string;
}

interface WorkspaceGlobs {
  include: string[];
  exclude: string[];
}

/**
 * Read the `packages` globs from pnpm-workspace.yaml. The file is
 * intentionally author-restricted to the shape pnpm documents for workspace
 * globs: a top-level `packages:` list of `- '<glob>'` items. Anything else
 * fails closed — a silently unparsed glob would make every downstream
 * consumer miss the same workspaces.
 */
export async function readWorkspaceGlobs(repoRoot: string): Promise<WorkspaceGlobs> {
  const rootDir = resolve(repoRoot);
  const shown = relative(rootDir, join(rootDir, 'pnpm-workspace.yaml')) || '.';
  let text: string;
  try {
    text = await readFile(join(rootDir, 'pnpm-workspace.yaml'), 'utf8');
  } catch (cause) {
    throw new Error('pnpm-workspace.yaml is missing or unreadable at the repository root', {
      cause,
    });
  }
  const lines = text.split('\n');
  const startIndex = lines.findIndex((line) => line.trimEnd() === 'packages:');
  if (startIndex < 0) {
    throw new Error(`${shown}: missing a top-level 'packages:' list`);
  }
  const include: string[] = [];
  const exclude: string[] = [];
  for (let index = startIndex + 1; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    if (!/^\s+-\s/.test(line)) break; // Next top-level key: packages list ended.
    const raw = line
      .replace(/^\s+-\s+/, '')
      .trim()
      .replace(/^['"]|['"]$/g, '');
    if (raw === '') throw new Error(`${shown}: empty entry in the packages list`);
    if (raw.startsWith('!')) exclude.push(raw.slice(1));
    else include.push(raw);
  }
  if (include.length === 0) {
    throw new Error(`${shown}: 'packages:' must list at least one glob`);
  }
  return { include, exclude };
}

/** Expand one workspace glob ('packages/*', 'www', ...) against the root. */
async function expandGlob(rootDir: string, glob: string): Promise<string[]> {
  if (glob.includes('*')) {
    const segments = glob.split('/');
    if (glob.includes('**') || segments.filter((part) => part.includes('*')).length !== 1) {
      throw new Error(`workspace glob '${glob}': only single-level '*' globs are supported`);
    }
    // Single-level star: the '*' lives in the LAST segment ('tests/fixtures/*').
    const slash = glob.lastIndexOf('/');
    const parentDir = slash < 0 ? rootDir : resolve(rootDir, glob.slice(0, slash));
    const stem = slash < 0 ? glob : glob.slice(slash + 1); // e.g. '*'
    const prefix = stem.slice(0, stem.indexOf('*'));
    const suffix = stem.slice(stem.indexOf('*') + 1);
    let names: import('node:fs').Dirent[];
    try {
      names = await readdir(parentDir, { withFileTypes: true });
    } catch (cause) {
      throw new Error(`workspace glob '${glob}': cannot read ${relative(rootDir, parentDir)}`, {
        cause,
      });
    }
    return (
      names
        // Glob-star convention: a '*' segment never matches dot-entries
        // (packages/.DS_Store is a file, not a workspace), and pnpm workspace
        // globs only ever match directories.
        .filter(
          (entry) =>
            entry.isDirectory() &&
            !entry.name.startsWith('.') &&
            entry.name.startsWith(prefix) &&
            entry.name.endsWith(suffix),
        )
        .map((entry) => (slash < 0 ? entry.name : `${glob.slice(0, slash)}/${entry.name}`))
        .sort()
    );
  }
  return [glob];
}

/** Read every workspace's script graph from the canonical workspace list.
 *
 * Strict by design: this discovery feeds generate:all AND the generator
 * gate, so a silently skipped workspace would let both miss the same
 * generators. Every malformed shape throws with the offending path and
 * failure category instead of degrading to an empty or partial list.
 */
export async function readWorkspaces(repoRoot: string): Promise<WorkspaceTasks[]> {
  // Callers pass repoRoot from fromFileUrl (trailing slash) or makeTempDir;
  // normalize so the containment check compares like with like.
  const rootDir = resolve(repoRoot);
  const display = (path: string) => relative(rootDir, path) || '.';
  const globs = await readWorkspaceGlobs(rootDir);
  const matched: string[] = [];
  for (const glob of globs.include) matched.push(...(await expandGlob(rootDir, glob)));
  const excluded = new Set<string>();
  for (const glob of globs.exclude) {
    for (const hit of await expandGlob(rootDir, glob)) excluded.add(hit);
  }
  const members: string[] = matched.filter((member) => !excluded.has(member));
  const seen = new Map<string, string>();
  const out: WorkspaceTasks[] = [];
  for (const member of members) {
    if (typeof member !== 'string' || member.trim() === '') {
      throw new Error(
        `pnpm-workspace.yaml: workspace entries must be non-empty strings (got ${JSON.stringify(
          member,
        )})`,
      );
    }
    const dir = resolve(rootDir, member);
    if (dir !== rootDir && !dir.startsWith(`${rootDir}/`)) {
      throw new Error(`pnpm-workspace.yaml: workspace '${member}' escapes the repository root`);
    }
    // Duplicate detection runs on the canonical repository-relative identity,
    // so 'alpha', './alpha' and 'foo/../alpha' cannot describe the same
    // workspace twice (raw-string dedupe let them through).
    const identity = dir === rootDir ? '.' : relative(rootDir, dir);
    // Symlinked members that resolve to the same directory are one workspace.
    // The physical key is registered even when it equals the raw identity:
    // on a canonical filesystem the first member only stores its raw key, and
    // a later alias would then find `real:<target>` unclaimed (the Linux CI
    // failure this test pins).
    let physicalIdentity: string | undefined;
    try {
      physicalIdentity = relative(rootDir, await realpath(dir)) || '.';
    } catch {
      // Missing directories are diagnosed below with a clear message.
    }
    for (const key of physicalIdentity !== undefined
      ? [identity, `real:${physicalIdentity}`]
      : [identity]) {
      const previous = seen.get(key);
      if (previous !== undefined) {
        throw new Error(
          `pnpm-workspace.yaml: duplicate workspace identity '${identity}' (raw entries '${previous}' and '${member}')`,
        );
      }
      seen.set(key, member);
    }
    try {
      if (!(await stat(dir)).isDirectory()) {
        throw new Error('not a directory');
      }
    } catch (cause) {
      throw new Error(`workspace '${member}': directory ${display(dir)} is missing or unreadable`, {
        cause,
      });
    }
    const configPath = join(dir, 'package.json');
    const config = await readConfigObject(configPath, `workspace '${member}'`, rootDir);
    const tasks = config.scripts ?? {};
    if (tasks === null || typeof tasks !== 'object' || Array.isArray(tasks)) {
      throw new Error(`${configPath}: 'scripts' must be an object when present`);
    }
    for (const [name, command] of Object.entries(tasks as Record<string, unknown>)) {
      if (name.trim() === '') {
        throw new Error(`${display(configPath)}: script names must be non-empty`);
      }
      if (typeof command !== 'string') {
        throw new Error(`${display(configPath)}: script '${name}' must map to a string command`);
      }
    }
    out.push({
      workspace: identity,
      name: typeof config.name === 'string' && config.name !== '' ? config.name : undefined,
      dir,
      tasks: tasks as Record<string, string>,
    });
  }
  if (out.length === 0) {
    throw new Error('pnpm-workspace.yaml: the globs matched zero workspace members');
  }
  return out;
}

/** Read a package.json as a JSON object, failing closed with path + category. */
async function readConfigObject(
  path: string,
  label: string,
  repoRoot: string,
): Promise<Record<string, unknown>> {
  const shown = relative(repoRoot, path) || '.';
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (cause) {
    throw new Error(`${label}: ${shown} is missing or unreadable`, { cause });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new Error(`${label}: ${shown} is not valid JSON`, { cause });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label}: ${shown} must contain a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

/** The first `.ts` path a script command references, if any. */
export function scriptInCommand(command: string): string | undefined {
  // The LAST `.ts` argument: commands may route through run-in.ts first.
  const matches = [...command.matchAll(/(?:^|\s)([A-Za-z0-9._/-]+\.ts)(?=\s|$)/g)];
  return matches.at(-1)?.[1];
}

/** Committed generators: scripts referenced by a `generate:*` script. */
export function generatorEntries(workspaces: readonly WorkspaceTasks[]): ScriptEntry[] {
  const entries: ScriptEntry[] = [];
  for (const ws of workspaces) {
    for (const [taskKey, command] of Object.entries(ws.tasks)) {
      if (!taskKey.startsWith('generate:') || taskKey === 'generate:all') continue;
      const script = scriptInCommand(command);
      if (script) entries.push({ workspace: ws.workspace, taskKey, script });
    }
  }
  return entries;
}

/** Build-artifact emitters: `emit-*.ts` scripts referenced by any script. */
export function emitterEntries(workspaces: readonly WorkspaceTasks[]): ScriptEntry[] {
  const entries: ScriptEntry[] = [];
  for (const ws of workspaces) {
    for (const [taskKey, command] of Object.entries(ws.tasks)) {
      const script = scriptInCommand(command);
      if (script && /(^|\/)emit-[a-z0-9-]+\.ts$/.test(script)) {
        entries.push({ workspace: ws.workspace, taskKey, script });
      }
    }
  }
  return entries;
}

/**
 * Every `generate-*.ts` / `emit-*.ts` script physically present in a
 * workspace's script locations: the workspace root (flat tool dirs like
 * tools/repo) and its `tools/` tree. Used for orphan detection — a script
 * that no task references is an unowned mechanism.
 */
export async function discoverScriptFiles(
  workspaces: readonly WorkspaceTasks[],
): Promise<Array<{ workspace: string; script: string; abs: string }>> {
  const out: Array<{ workspace: string; script: string; abs: string }> = [];
  const isCandidate = (name: string) =>
    name.endsWith('.ts') &&
    !name.endsWith('.test.ts') &&
    (name.startsWith('generate-') || name.startsWith('emit-')) &&
    name !== 'generate-all.ts';
  for (const ws of workspaces) {
    const locations = [ws.dir, join(ws.dir, 'tools')];
    for (const [index, dir] of locations.entries()) {
      try {
        await stat(dir);
      } catch {
        continue;
      }
      for await (const entry of walk(dir, {
        includeDirs: false,
        exts: ['.ts'],
        maxDepth: index === 0 ? 1 : Infinity,
      })) {
        if (!isCandidate(entry.name)) continue;
        out.push({
          workspace: ws.workspace,
          script: entry.path.slice(ws.dir.length + 1),
          abs: entry.path,
        });
      }
    }
  }
  return out;
}
