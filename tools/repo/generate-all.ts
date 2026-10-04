/**
 * Runs every generator script declared by every workspace.
 *
 * Discovery is canonical (tools/repo/workspace-tasks.ts): the workspace list
 * comes from the root pnpm-workspace.yaml `packages` globs and the generator
 * set from each workspace's `generate:*` package.json scripts. Adding a
 * generator script enrolls it here automatically — there is no list to keep.
 * This module is only the discovery-to-dispatch bridge: each generator task
 * runs as one vp-dispatched task (tools/repo/vp-dispatch.ts), serially, and
 * the first failure stops the run. Classification (--check wiring, emitter
 * rules, orphan detection) stays in check-generator-gates.ts; nothing here
 * re-resolves workspaces or tasks beyond what discovery already produced.
 */
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { commandStatus } from './node-command.ts';
import { generatorEntries, readWorkspaces } from './workspace-tasks.ts';
import { vpExecutable, vpTaskArgv } from './vp-dispatch.ts';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const workspaces = await readWorkspaces(repoRoot);
const entries = generatorEntries(workspaces).sort((a, b) =>
  `${a.workspace}#${a.taskKey}`.localeCompare(`${b.workspace}#${b.taskKey}`),
);

if (entries.length === 0) {
  console.error('generate:all: no generate:* scripts found — refusing to vacuously pass.');
  process.exit(1);
}

const executable = vpExecutable(repoRoot);

for (const { workspace, taskKey } of entries) {
  const ws = workspaces.find((candidate) => candidate.workspace === workspace);
  if (!ws) throw new Error(`generate:all: unknown workspace ${workspace}`);
  // vp dispatches by exact package name; a nameless workspace member cannot
  // dispatch, so it stops the run instead of being skipped.
  if (!ws.name) {
    throw new Error(
      `generate:all: workspace '${workspace}' has no package name; ` +
        `vp dispatch requires exact package names.`,
    );
  }
  const { code } = await commandStatus(executable, {
    args: vpTaskArgv(ws.name, taskKey).slice(1),
    cwd: repoRoot,
    stdin: 'null',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (code !== 0) {
    throw new Error(`generate:all: ${ws.name}#${taskKey} exited ${code}`);
  }
}
console.log(
  `generate:all: ${entries.length} generator task(s) ok (${entries
    .map(({ workspace, taskKey }) => `${workspace}#${taskKey}`)
    .join(', ')})`,
);
