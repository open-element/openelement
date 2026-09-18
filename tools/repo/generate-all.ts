/**
 * Runs every generate:* task declared by the workspaces that own generators,
 * sorted. Adding a generator task enrolls it here automatically — the
 * workspace list is repo structure (who owns generators), not a generator
 * list, so it stays stable while generators come and go.
 */
import { fromFileUrl, join } from '@std/path';

const repoRoot = fromFileUrl(new URL('../../', import.meta.url));
/** Workspaces that declare generate:* tasks. */
const WORKSPACES = ['tools/repo', 'packages/ui'] as const;

const tasks: Array<{ workspace: string; key: string }> = [];
for (const workspace of WORKSPACES) {
  const denoJson = JSON.parse(await Deno.readTextFile(join(repoRoot, workspace, 'deno.json'))) as {
    tasks?: Record<string, string>;
  };
  for (const key of Object.keys(denoJson.tasks ?? {})) {
    if (key.startsWith('generate:') && key !== 'generate:all') tasks.push({ workspace, key });
  }
}

if (tasks.length === 0) {
  console.error('generate:all: no generate:* tasks found — refusing to vacuously pass.');
  Deno.exit(1);
}

for (const { workspace, key } of tasks) {
  const child = new Deno.Command(Deno.execPath(), {
    args: ['task', '--cwd', join(repoRoot, workspace), key],
    stdin: 'null',
    stdout: 'inherit',
    stderr: 'inherit',
  }).spawn();
  const { code } = await child.status;
  if (code !== 0) {
    throw new Error(`generate:all: ${workspace}#${key} exited ${code}`);
  }
}
console.log(
  `generate:all: ${tasks.length} generator task(s) ok (${
    tasks.map(({ workspace, key }) => `${workspace}#${key}`).join(', ')
  })`,
);
