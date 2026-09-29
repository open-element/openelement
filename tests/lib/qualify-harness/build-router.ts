/**
 * Router build wiring for the qualify harnesses (#1472).
 *
 * All three consumers build their temporary app with the in-repo Router
 * build CLI; this module owns the task string, the CLI path arithmetic, the
 * build run, and the generated-artifact lookups (server entry location).
 */

import { join } from '@std/path';
import { runStep } from './command-run.ts';

/** Absolute path of a Router CLI subcommand source file in the repository. */
export function routerCliPath(
  repoRoot: string,
  subcommand: 'build' | 'start',
): string {
  return join(repoRoot, 'packages', 'router', 'src', 'cli', `${subcommand}.ts`);
}

/**
 * The app `build` task that runs the in-repo Router build CLI. The CLI path
 * is repo-derived (never external input) and is embedded double-quoted so a
 * path containing spaces cannot split the task's command line.
 */
export function routerBuildTask(repoRoot: string): string {
  const cliPath = JSON.stringify(routerCliPath(repoRoot, 'build'));
  return 'deno run --unstable-sloppy-imports --config deno.json --allow-read' +
    ' --allow-write --allow-env --allow-net --allow-run --allow-sys' +
    ` --allow-ffi --no-prompt ${cliPath}`;
}

/** Run the scaffolded app's own `build` task. */
export async function runRouterBuild(appDir: string): Promise<void> {
  await runStep(Deno.execPath(), ['task', 'build'], { cwd: appDir });
}

/** Depth-first search for a file by name; null when absent. */
export async function findFile(root: string, name: string): Promise<string | null> {
  for await (const entry of Deno.readDir(root)) {
    const path = join(root, entry.name);
    if (entry.isFile && entry.name === name) return path;
    if (entry.isDirectory) {
      const found = await findFile(path, name);
      if (found) return found;
    }
  }
  return null;
}

/**
 * The generated server entry: dist/server/entry.js, or the first entry.js
 * the dist tree holds when the canonical layout moves.
 */
export async function findServerEntry(distDir: string): Promise<string> {
  const serverEntryPath = join(distDir, 'server', 'entry.js');
  return await Deno.stat(serverEntryPath).then(() => serverEntryPath)
    .catch(async () => {
      const found = await findFile(distDir, 'entry.js');
      if (!found) {
        throw new Error(`generated server entry not found under ${distDir}`);
      }
      return found;
    });
}
