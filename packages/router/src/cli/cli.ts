#!/usr/bin/env node
/**
 * @openelement/router - the `openelement` lifecycle CLI.
 *
 * One bin, two subcommands, and each subcommand is exactly the packaged
 * subpath entry it dispatches to:
 *
 *   openelement build            -> ./build.ts (buildApp: SSG + client phases)
 *   openelement start            -> ./start.ts (serve dist/ over node:http)
 *   openelement start --mode=preview
 *                                -> ./start.ts with the mode flag passed
 *                                   through (static-only; refuses a build
 *                                   with a request-time server)
 *
 * The packed manifest declares this file as the `openelement` bin (the
 * release coordinator writes the declaration from the same path constant the
 * pack input list uses), so a generated project's scripts run the CLI through
 * the installed `.bin` shim instead of reaching into the installed tree by
 * path. The direct subpath entries (`./cli/build`, `./cli/start`) keep
 * working unchanged for callers that import or run them explicitly.
 *
 * The dispatcher body runs only as the process's main module, so importing
 * this file (should a caller ever do that) has no effect. Each subcommand is
 * loaded lazily: `build` pulls the Vite tooling graph, `start` does not, so
 * the serve command keeps resolving without a Vite install in the consumer's
 * tree (the same resolution the `./cli/start` subpath entry has), and the
 * usage paths load neither.
 */

import process from 'node:process';

/** The one usage text both the no-argument and the unknown-command paths print. */
const USAGE = [
  'Usage: openelement <command> [options]',
  '',
  'Commands:',
  '  build                  production build (SSG + client) into dist/',
  '  start [--mode=preview] serve the built output; preview is static-only',
].join('\n');

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'build') {
    const { runBuildCli } = await import('./build.ts');
    await runBuildCli();
    return;
  }
  if (command === 'start') {
    const { runServeCli } = await import('./start.ts');
    await runServeCli(rest);
    return;
  }
  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(USAGE);
    process.exit(0);
  }
  console.error(command === undefined ? USAGE : `Unknown command "${command}".\n\n${USAGE}`);
  process.exit(1);
}

if (import.meta.main) {
  await main();
}
