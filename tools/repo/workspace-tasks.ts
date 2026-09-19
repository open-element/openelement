/**
 * Canonical workspace + task discovery for repo-wide tooling doctrine.
 *
 * One owner for two facts that were previously copied per tool:
 *   - which workspaces exist: derived from the root `deno.json` `workspace`
 *     list (the real workspace config), never a hand-maintained array;
 *   - which scripts are committed generators vs build-artifact emitters:
 *     derived from each workspace's task graph (a script referenced by a
 *     `generate:*` task is a generator; a script named `emit-*.ts` referenced
 *     by any task is an emitter).
 *
 * Consumers: generate-all.ts (runs every generator task) and
 * check-generator-gates.ts (enforces the per-class wiring rules). This
 * module is neutral: it reads files, never exits.
 */
import { join, relative, resolve } from '@std/path';
import { walk } from '@std/fs/walk';

export interface WorkspaceTasks {
  /** Workspace path as written in the root `workspace` list (e.g. 'www'). */
  workspace: string;
  dir: string;
  tasks: Record<string, string>;
}

export interface ScriptEntry {
  workspace: string;
  /** Task key that references the script. */
  taskKey: string;
  /** Workspace-relative script path as written in the task command. */
  script: string;
}

/** Read every workspace's task graph from the canonical workspace list.
 *
 * Strict by design: this discovery feeds generate-all AND the generator
 * gate, so a silently skipped workspace would let both miss the same
 * generators. Every malformed shape throws with the offending path and
 * failure category instead of degrading to an empty or partial list.
 */
export async function readWorkspaces(repoRoot: string): Promise<WorkspaceTasks[]> {
  // Callers pass repoRoot from fromFileUrl (trailing slash) or makeTempDir;
  // normalize so the containment check compares like with like.
  const rootDir = resolve(repoRoot);
  const rootPath = join(rootDir, 'deno.json');
  const root = await readConfigObject(rootPath, 'root workspace configuration');
  const members = root.workspace;
  if (!Array.isArray(members)) {
    throw new Error(`${rootPath}: 'workspace' must be an array of workspace paths`);
  }
  const seen = new Map<string, string>();
  const out: WorkspaceTasks[] = [];
  for (const member of members) {
    if (typeof member !== 'string' || member.trim() === '') {
      throw new Error(
        `${rootPath}: workspace entries must be non-empty strings (got ${JSON.stringify(member)})`,
      );
    }
    const dir = resolve(rootDir, member);
    if (dir !== rootDir && !dir.startsWith(`${rootDir}/`)) {
      throw new Error(`${rootPath}: workspace '${member}' escapes the repository root`);
    }
    // Duplicate detection runs on the canonical repository-relative identity,
    // so 'alpha', './alpha' and 'foo/../alpha' cannot describe the same
    // workspace twice (raw-string dedupe let them through).
    const identity = dir === rootDir ? '.' : relative(rootDir, dir);
    const previous = seen.get(identity);
    if (previous !== undefined) {
      throw new Error(
        `${rootPath}: duplicate workspace identity '${identity}' (raw entries '${previous}' and '${member}')`,
      );
    }
    seen.set(identity, member);
    try {
      if (!(await Deno.stat(dir)).isDirectory) {
        throw new Error('not a directory');
      }
    } catch (cause) {
      throw new Error(`workspace '${member}': directory ${dir} is missing or unreadable`, {
        cause,
      });
    }
    const configPath = join(dir, 'deno.json');
    const config = await readConfigObject(configPath, `workspace '${member}'`);
    const tasks = config.tasks ?? {};
    if (tasks === null || typeof tasks !== 'object' || Array.isArray(tasks)) {
      throw new Error(`${configPath}: 'tasks' must be an object when present`);
    }
    for (const [name, command] of Object.entries(tasks as Record<string, unknown>)) {
      if (name.trim() === '') throw new Error(`${configPath}: task names must be non-empty`);
      if (typeof command !== 'string') {
        throw new Error(`${configPath}: task '${name}' must map to a string command`);
      }
    }
    out.push({
      workspace: identity,
      dir,
      tasks: tasks as Record<string, string>,
    });
  }
  return out;
}

/** Read a deno.json as a JSON object, failing closed with path + category. */
async function readConfigObject(
  path: string,
  label: string,
): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (cause) {
    throw new Error(`${label}: ${path} is missing or unreadable`, { cause });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new Error(`${label}: ${path} is not valid JSON`, { cause });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label}: ${path} must contain a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

/** The first `.ts` path a task command references, if any. */
function scriptInCommand(command: string): string | undefined {
  // The LAST `.ts` argument: commands may route through run-in.ts first.
  const matches = [...command.matchAll(/(?:^|\s)([A-Za-z0-9._/-]+\.ts)(?=\s|$)/g)];
  return matches.at(-1)?.[1];
}

/** Committed generators: scripts referenced by a `generate:*` task. */
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

/** Build-artifact emitters: `emit-*.ts` scripts referenced by any task. */
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
    name.endsWith('.ts') && !name.endsWith('.test.ts') &&
    (name.startsWith('generate-') || name.startsWith('emit-')) && name !== 'generate-all.ts';
  for (const ws of workspaces) {
    const locations = [ws.dir, join(ws.dir, 'tools')];
    for (const [index, dir] of locations.entries()) {
      try {
        await Deno.stat(dir);
      } catch {
        continue;
      }
      for await (
        const entry of walk(dir, {
          includeDirs: false,
          exts: ['.ts'],
          maxDepth: index === 0 ? 1 : Infinity,
        })
      ) {
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
