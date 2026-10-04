/**
 * Router build wiring for the qualify harnesses (#1472).
 *
 * All three consumers build their temporary app with the in-repo Router
 * build CLI; this module owns the build-script string, the CLI path
 * arithmetic, the build run, and the generated-artifact lookups (server entry
 * location).
 */

import { stat } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { runStep } from './command-run.ts';

/** Absolute path of a Router CLI subcommand source file in the repository. */
export function routerCliPath(repoRoot: string, subcommand: 'build' | 'start'): string {
  return join(repoRoot, 'packages', 'router', 'src', 'cli', `${subcommand}.ts`);
}

/**
 * The app package.json `build` script that runs the in-repo Router build CLI
 * under node. The CLI path is repo-derived (never external input) and is
 * embedded double-quoted so a path containing spaces cannot split the
 * script's command line.
 */
export function routerBuildScript(repoRoot: string): string {
  const cliPath = JSON.stringify(routerCliPath(repoRoot, 'build'));
  return `node ${cliPath}`;
}

/** Run the scaffolded app's own `build` script. */
export async function runRouterBuild(appDir: string): Promise<void> {
  await runStep('pnpm', ['run', 'build'], { cwd: appDir });
}

/** Depth-first search for a file by name; null when absent. */
export async function findFile(root: string, name: string): Promise<string | null> {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isFile() && entry.name === name) return path;
    if (entry.isDirectory()) {
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
  return await stat(serverEntryPath)
    .then(() => serverEntryPath)
    .catch(async () => {
      const found = await findFile(distDir, 'entry.js');
      if (!found) {
        throw new Error(`generated server entry not found under ${distDir}`);
      }
      return found;
    });
}
