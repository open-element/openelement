/**
 * @openelement/router/cli/dev - CLI: Vite dev server (SSR + HMR)
 *
 * `oe dev` / `openelement dev` boots the framework's own dev server: the
 * project's `vite.config.ts` (which registers `openElement()`) is loaded
 * through Vite, and the plugin's `@hono/vite-dev-server` bridge — loaded
 * lazily on the first dev hook, `apply: 'serve'` — turns the SSR pipeline on.
 * There is no second dev implementation here: this module owns the process
 * lifecycle (config load, listen, the CLI's own failure rendering) and Vite
 * owns the server.
 *
 * The generated starter's `dev` script runs exactly this subcommand
 * (`"dev": "oe dev"`), which is what makes the starter's lifecycle
 * package-manager neutral: `npm run dev`, `pnpm run dev`, `yarn run dev` and
 * `bun run dev` all reach the same server through the router's `oe` bin
 * instead of a manager-specific tool wrapper.
 *
 * Flags mirror the useful slice of `vite dev`: `--port`, `--host`,
 * `--strictPort`, `--open`, plus `--debug` for a raw stack (#1413 style).
 * Anything else is refused with one actionable line rather than silently
 * dropped — a dev server that ignores `--https` is worse than one that says
 * it does not support it.
 */

import process from 'node:process';
import { formatError } from '@openelement/element';

const USAGE = [
  'Usage: openelement dev [options]',
  '',
  'Start the Vite dev server for the app in the current directory (SSR, HMR,',
  'and the Tailwind pipeline come from the project vite.config.ts, which',
  'registers openElement()).',
  '',
  'Options:',
  '  --port <number>        port to listen on (default: 5173)',
  '  --host [host]          listen on all addresses, or on <host>',
  '  --strictPort           exit if the port is already in use',
  '  --open [path]          open the browser (at <path>) on start',
  '  --debug                print the raw stack on failure',
  '  --help, -h             print this usage',
].join('\n');

/** What `oe dev` parsed out of its arguments. */
export interface DevListenOptions {
  port?: number;
  host?: string | true;
  strictPort: boolean;
  open?: string | true;
  debug: boolean;
}

/** `--debug` state for the process; set once before any server work runs. */
let cliDebug = false;

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

function parsePortValue(raw: string, source: string): number {
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail(`Invalid port "${raw}" (from ${source}): expected an integer between 1 and 65535.`);
  }
  return port;
}

/**
 * Parse `oe dev`'s pass-through arguments. `--host` and `--open` carry an
 * optional value (`vite dev` semantics): a bare flag keeps the boolean form,
 * a following non-flag token becomes the value. Everything unrecognized is a
 * hard failure — a dropped flag is a silently different server.
 */
export function parseDevArgs(argv: string[]): DevListenOptions {
  const options: DevListenOptions = { strictPort: false, debug: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else if (arg === '--port' || arg.startsWith('--port=')) {
      const raw = arg.includes('=') ? arg.slice('--port='.length) : argv[++index];
      if (raw === undefined) fail('--port requires a value (the port number).');
      options.port = parsePortValue(raw, '--port');
    } else if (arg === '--strictPort' || arg === '--strict-port') {
      options.strictPort = true;
    } else if (arg === '--debug') {
      options.debug = true;
    } else if (arg === '--host' || arg.startsWith('--host=')) {
      if (arg.includes('=')) {
        options.host = arg.slice('--host='.length);
      } else {
        const value = argv[index + 1];
        if (value !== undefined && !value.startsWith('-')) {
          options.host = value;
          index++;
        } else {
          options.host = true;
        }
      }
    } else if (arg === '--open' || arg.startsWith('--open=')) {
      if (arg.includes('=')) {
        options.open = arg.slice('--open='.length);
      } else {
        const value = argv[index + 1];
        if (value !== undefined && !value.startsWith('-')) {
          options.open = value;
          index++;
        } else {
          options.open = true;
        }
      }
    } else {
      fail(
        `Unknown flag "${arg}". Supported: --port, --host, --strictPort, --open, --debug ` +
          '(run `oe dev --help`).',
      );
    }
  }
  return options;
}

/**
 * One actionable line per failure (#1413 style): the cause chain through the
 * framework's own `formatError`, never a raw stack unless `--debug` asked for
 * it.
 */
function renderDevFailure(error: unknown, debug: boolean): string {
  const message = formatError(error);
  if (!debug) return `Dev failed: ${message}`;
  const stack = error instanceof Error ? error.stack : undefined;
  return `Dev failed: ${message}\n${stack ?? '(no stack captured)'}`;
}

async function main(argv: string[]): Promise<void> {
  const options = parseDevArgs(argv);
  cliDebug = options.debug;

  // Vite is an OPTIONAL peer of @openelement/router (the same contract the
  // build and the lazy dev-server bridge have): a consumer that never runs
  // `dev` must not need it, and a consumer that does gets one line naming
  // what to install instead of ERR_MODULE_NOT_FOUND.
  let createServer: typeof import('vite').createServer;
  try {
    ({ createServer } = await import('vite'));
  } catch (cause) {
    throw new Error(
      'openElement dev mode requires vite (an optional peer of @openelement/router). ' +
        'Install it into your app to use `oe dev`: add "vite" to the devDependencies of ' +
        'your package.json (`npm install --save-dev vite` does the same).',
      { cause },
    );
  }

  const server = await createServer({
    // The project's own vite.config.ts is the one place the app registers
    // `openElement()`; loading it natively is what `oe build` does too.
    configLoader: 'native',
    server: {
      ...(options.port === undefined ? {} : { port: options.port }),
      ...(options.host === undefined ? {} : { host: options.host }),
      ...(options.strictPort ? { strictPort: true } : {}),
      ...(options.open === undefined ? {} : { open: options.open }),
    },
  });
  await server.listen();
  // Vite owns the URL banner (local + network, and the "port in use, trying
  // another one" notice); printing it here keeps `oe dev`'s output identical
  // to the same server started by Vite's own CLI.
  server.printUrls();
}

/**
 * Run the dev CLI with the arguments that follow the command (the bin's `dev`
 * subcommand passes them through verbatim). The server keeps the process
 * alive until the user stops it (Ctrl-C), which is the whole contract of a
 * dev command.
 */
export async function runDevCli(argv: string[] = []): Promise<void> {
  try {
    await main(argv);
  } catch (error) {
    console.error(renderDevFailure(error, cliDebug));
    process.exit(1);
  }
}

if (import.meta.main) {
  await runDevCli(process.argv.slice(2));
}
