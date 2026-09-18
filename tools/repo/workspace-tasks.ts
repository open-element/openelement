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
import { join } from '@std/path';
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

/** Read every workspace's task graph from the canonical workspace list. */
export async function readWorkspaces(repoRoot: string): Promise<WorkspaceTasks[]> {
  const root = JSON.parse(await Deno.readTextFile(join(repoRoot, 'deno.json'))) as {
    workspace?: string[];
  };
  const out: WorkspaceTasks[] = [];
  for (const member of root.workspace ?? []) {
    const dir = join(repoRoot, member);
    let parsed: { tasks?: Record<string, string> };
    try {
      parsed = JSON.parse(await Deno.readTextFile(join(dir, 'deno.json')));
    } catch {
      continue;
    }
    out.push({ workspace: member.replace(/^\.\//, ''), dir, tasks: parsed.tasks ?? {} });
  }
  return out;
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
