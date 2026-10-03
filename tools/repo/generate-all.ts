/**
 * Runs every generator script declared by every workspace.
 *
 * Discovery is canonical (tools/repo/workspace-tasks.ts): the workspace list
 * comes from the root pnpm-workspace.yaml `packages` globs and the generator
 * set from each workspace's `generate:*` package.json scripts. Adding a
 * generator script enrolls it here automatically — there is no list to keep.
 */
import { fileURLToPath } from 'node:url';
import { commandStatus } from './node-command.ts';
import process from 'node:process';
import { generatorEntries, readWorkspaces } from './workspace-tasks.ts';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const workspaces = await readWorkspaces(repoRoot);
const entries = generatorEntries(workspaces).sort((a, b) =>
  `${a.workspace}#${a.taskKey}`.localeCompare(`${b.workspace}#${b.taskKey}`),
);

if (entries.length === 0) {
  console.error('generate:all: no generate:* scripts found — refusing to vacuously pass.');
  process.exit(1);
}

/**
 * Same launcher discipline as gate.ts: prefer the running pnpm's own JS
 * entry (set by pnpm as npm_execpath) over a PATH lookup of the shim.
 */
function pnpmLauncher(): { command: string; extraArgs: string[] } {
  const execpath = process.env.npm_execpath;
  if (execpath && execpath.endsWith('.cjs')) {
    return { command: process.execPath, extraArgs: [execpath] };
  }
  return { command: 'pnpm', extraArgs: [] };
}

for (const { workspace, taskKey } of entries) {
  const ws = workspaces.find((candidate) => candidate.workspace === workspace);
  if (!ws) throw new Error(`generate:all: unknown workspace ${workspace}`);
  const { command, extraArgs } = pnpmLauncher();
  const { code } = await commandStatus(command, {
    args: [...extraArgs, '--dir', ws.dir, 'run', taskKey],
    cwd: repoRoot,
    stdin: 'null',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (code !== 0) {
    throw new Error(`generate:all: ${workspace}#${taskKey} exited ${code}`);
  }
}
console.log(
  `generate:all: ${entries.length} generator task(s) ok (${entries
    .map(({ workspace, taskKey }) => `${workspace}#${taskKey}`)
    .join(', ')})`,
);
