#!/usr/bin/env node
/**
 * @openelement/router - the `openelement` lifecycle CLI.
 *
 * One entry, two bin names, two subcommands (plus version/help), and each
 * subcommand is exactly the packaged subpath entry it dispatches to:
 *
 *   openelement build            -> ./build.ts (buildApp: SSG + client phases)
 *   openelement start            -> ./start.ts (serve dist/ over node:http)
 *   openelement start --mode=preview
 *                                -> ./start.ts with the mode flag passed
 *                                   through (static-only; refuses a build
 *                                   with a request-time server)
 *   openelement version | --version | -v
 *                                -> the router package's own version, read
 *                                   from the installed manifest
 *
 * The manifest declares this file twice as the bin target - `openelement`
 * (the long, unambiguous spelling) and `oe` (the short alias) - and both
 * entries name the same module, so the alias is zero-behavior-difference by
 * construction: the invoked argv differs only in how the program was
 * reached, never in what it runs. The direct subpath entries (`./cli/build`,
 * `./cli/start`) keep working unchanged for callers that import or run them
 * explicitly.
 *
 * The dispatcher body runs only as the process's main module, so importing
 * this file (should a caller ever do that) has no effect. Each subcommand is
 * loaded lazily: `build` pulls the Vite tooling graph, `start` does not, so
 * the serve command keeps resolving without a Vite install in the consumer's
 * tree (the same resolution the `./cli/start` subpath entry has), and the
 * version/usage paths load neither.
 */

import process from 'node:process';
import { readFileSync } from 'node:fs';

/**
 * The one usage text both the no-argument and the unknown-command paths
 * print. The alias line is documentation only: `oe` reaches this same
 * dispatcher through the manifest's second bin entry, so every command and
 * flag below answers identically under either spelling.
 */
const USAGE = [
  'Usage: openelement <command> [options]',
  'Alias: oe <command> [options] (same entry, same behavior)',
  '',
  'Commands:',
  '  build                  production build (SSG + client) into dist/',
  '  start [--mode=preview] serve the built output; preview is static-only',
  '  version                print the router package version',
  '',
  'Options:',
  '  --version, -v          print the router package version',
  '  --help, -h             print this usage',
].join('\n');

/**
 * The CLI's own package version. The manifest is read relative to this module
 * (not the working directory): the CLI runs from an npm-installed tree, and
 * the answer must be the tree that is executing, never the cwd's. The packed
 * layout is `<pkg>/src/cli/cli.js`, so the manifest sits two levels up.
 */
function packageVersion(): string {
  const manifest = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { version?: unknown };
  if (typeof manifest.version !== 'string') {
    throw new Error('[openelement] router package.json carries no version');
  }
  return manifest.version;
}

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
  if (command === 'version' || command === '--version' || command === '-v') {
    console.log(packageVersion());
    process.exit(0);
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
