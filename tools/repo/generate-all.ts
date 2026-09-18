/**
 * Runs every generate:* task declared in tools/repo/deno.json, sorted.
 * Adding a generator task enrolls it here automatically — no list to keep.
 */
import { fromFileUrl, join } from '@std/path';

const toolsDir = fromFileUrl(new URL('.', import.meta.url));
const denoJsonPath = join(toolsDir, 'deno.json');

const denoJson = JSON.parse(await Deno.readTextFile(denoJsonPath)) as {
  tasks?: Record<string, string>;
};
const tasks = Object.keys(denoJson.tasks ?? {})
  .filter((key) => key.startsWith('generate:') && key !== 'generate:all')
  .sort();

if (tasks.length === 0) {
  console.error('generate:all: no generate:* tasks found in tools/repo/deno.json — refusing to vacuously pass.');
  Deno.exit(1);
}

for (const key of tasks) {
  const child = new Deno.Command(Deno.execPath(), {
    args: ['task', '--cwd', toolsDir, key],
    stdin: 'null',
    stdout: 'inherit',
    stderr: 'inherit',
  }).spawn();
  const { code } = await child.status;
  if (code !== 0) {
    throw new Error(`generate:all: task ${key} exited ${code}`);
  }
}
console.log(`generate:all: ${tasks.length} generator task(s) ok (${tasks.join(', ')})`);
