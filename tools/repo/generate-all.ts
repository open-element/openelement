/**
 * Runs every generator task declared by every workspace.
 *
 * Discovery is canonical (tools/repo/workspace-tasks.ts): the workspace list
 * comes from the root deno.json `workspace` field and the generator set from
 * each workspace's `generate:*` task graph. Adding a generator task enrolls
 * it here automatically — there is no list to keep.
 */
import { fromFileUrl } from '@std/path';
import { commandStatus } from './node-command.ts';
import process from 'node:process';
import { generatorEntries, readWorkspaces } from './workspace-tasks.ts';

const repoRoot = fromFileUrl(new URL('../../', import.meta.url));
const workspaces = await readWorkspaces(repoRoot);
const entries = generatorEntries(workspaces).sort((a, b) =>
  `${a.workspace}#${a.taskKey}`.localeCompare(`${b.workspace}#${b.taskKey}`),
);

if (entries.length === 0) {
  console.error('generate:all: no generate:* tasks found — refusing to vacuously pass.');
  process.exit(1);
}

for (const { workspace, taskKey } of entries) {
  const ws = workspaces.find((candidate) => candidate.workspace === workspace);
  if (!ws) throw new Error(`generate:all: unknown workspace ${workspace}`);
  const { code } = await commandStatus(process.execPath, {
    args: ['task', '--cwd', ws.dir, taskKey],
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
