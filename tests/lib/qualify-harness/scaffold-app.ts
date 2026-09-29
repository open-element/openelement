/**
 * Scaffold a temporary OpenElement application with packages/create (#1472).
 *
 * One ritual for "fresh app from the documented generator": run the create
 * CLI (workspace source or packed tarball output) with the shared scoped flag
 * set, then optionally copy fixture sources verbatim into the generated app.
 * The qualify fixtures scaffold with the source CLI; the starter smoke uses
 * the packed CLI plus a minimum-dependency-age override.
 */

import { dirname, fromFileUrl, join } from '@std/path';
import { runStep } from './command-run.ts';

/** The scoped flag set every scaffold/prime subprocess runs under. */
export const CREATE_CLI_FLAGS = [
  '--allow-read',
  '--allow-write',
  '--allow-env',
  '--allow-net',
  '--deny-ffi',
  '--no-prompt',
] as const;

export interface ScaffoldAppOptions {
  /** Directory the project subdirectory is generated into. */
  workDir: string;
  /** Project (and directory) name passed to the create CLI. */
  projectName: string;
  /** Entrypoint of the create CLI (source cli.ts or packed cli.js). */
  createCli: string;
  /** Extra CLI arguments, e.g. a minimum-dependency-age override. */
  extraArgs?: readonly string[];
  /** Fixture sources copied verbatim into the app after scaffolding. */
  copySources?: {
    fromRoot: string | URL;
    files: readonly string[];
  };
}

/** Resolve a fixture-relative path against a directory root that may be a URL. */
export function pathFromRoot(root: string | URL, relativePath: string): string {
  return typeof root === 'string'
    ? join(root, relativePath)
    : fromFileUrl(new URL(relativePath, root));
}

/**
 * Generate the app with the create CLI and copy the fixture sources in.
 * Returns the generated app directory.
 */
export async function scaffoldApp(options: ScaffoldAppOptions): Promise<string> {
  await runStep(
    Deno.execPath(),
    [
      'run',
      ...CREATE_CLI_FLAGS,
      ...(options.extraArgs ?? []),
      options.createCli,
      options.projectName,
    ],
    { cwd: options.workDir },
  );
  const appDir = join(options.workDir, options.projectName);
  if (options.copySources) {
    for (const relativePath of options.copySources.files) {
      const destination = join(appDir, relativePath);
      await Deno.mkdir(dirname(destination), { recursive: true });
      await Deno.copyFile(
        pathFromRoot(options.copySources.fromRoot, relativePath),
        destination,
      );
    }
  }
  return appDir;
}
