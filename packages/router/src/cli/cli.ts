#!/usr/bin/env node
/**
 * @openelement/router - the `openelement` lifecycle CLI.
 *
 * One entry, two bin names, three subcommands (plus version/help). `build` and
 * `start` are also packaged subpath entries (`./cli/build`, `./cli/start`);
 * `dev` is bin-only (no app imports a dev server) but rides the same
 * dispatcher. Each subcommand body is exactly the module it dispatches to:
 *
 *   openelement dev              -> ./dev.ts (Vite dev server: SSR + HMR)
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
 * loaded lazily: `dev` and `build` pull the Vite tooling graph, `start` does
 * not, so the serve command keeps resolving without a Vite install in the
 * consumer's tree (the same resolution the `./cli/start` subpath entry has),
 * and the version/usage paths load none of them.
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
  '  dev [--port <n> | --host [h] | --strictPort | --open [path]]',
  '                         start the Vite dev server (SSR + HMR) for the',
  '                         app in the current directory',
  '  build [--diagnostics=json | --diagnostics-file=<path>]',
  '                         production build (SSG + client) into dist/; the',
  '                         diagnostics flags add a machine-readable report',
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
  if (command === 'dev') {
    const { runDevCli } = await import('./dev.ts');
    // The subcommand's own flags ride along (`--port`, `--host`,
    // `--strictPort`, `--open`, `--debug`).
    await runDevCli(rest);
    return;
  }
  if (command === 'build') {
    const { runBuildCli } = await import('./build.ts');
    // The subcommand's own flags ride along (`--diagnostics=json` and
    // `--diagnostics-file=<path>` open the machine-readable exit, #1612).
    await runBuildCli(rest);
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
