/**
 * @openelement/router/cli/build - CLI: Full Static Build
 *
 * One-command build entry. viteBuild() triggers Phase 1,
 * and closeBundle() in open:build plugin automatically runs Phase 2/3.
 * No orchestrator needed - all three phases run in a single viteBuild() call.
 *
 * Usage:
 *   openelement build  (or: node <this module> — the bin's build subcommand)
 */

import process from 'node:process';
import { formatError } from '@openelement/element';
import { buildApp } from '../vite/index.ts';

/**
 * Run the production build and exit with the build's verdict. Shared by the
 * `openelement build` bin subcommand (cli.ts) and this module's own main
 * block, so both faces behave identically.
 */
export async function runBuildCli(): Promise<void> {
  try {
    await buildApp();
    process.exit(0);
  } catch (error) {
    console.error(
      `Build failed: ${
        error instanceof Error ? (error.stack ?? formatError(error)) : formatError(error)
      }`,
    );
    if (error instanceof Error && error.cause) console.error('Caused by:', error.cause);
    process.exit(1);
  }
}

if (import.meta.main) {
  await runBuildCli();
}
