/**
 * `--mode=start|preview` argument parsing for `src/cli/start.ts`.
 *
 * Internal to the Router CLI: the `./cli/start` export entry exists so
 * `deno run npm:@openelement/router/cli/start` can boot the built-output
 * server; its argument parsing is not public API.
 */

import { authoringError, ServeErrorCode } from './error-codes.ts';

export type ServeMode = 'start' | 'preview';

/**
 * Splits `--mode=start|preview` (or `--mode start|preview`) off the CLI args.
 * `--debug` is hoisted out of the pass-through args too: it selects the CLI's
 * own raw-stack rendering (#1413), so it must not reach Vite's argument
 * parser as an unknown flag.
 */
export function extractServeMode(
  argv: string[],
): { mode: ServeMode; rest: string[]; debug: boolean } {
  const rest: string[] = [];
  let mode: ServeMode = 'start';
  let debug = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const inline = arg.match(/^--mode=(.+)$/);
    if (inline) {
      mode = parseMode(inline[1]);
    } else if (arg === '--mode') {
      const value = argv[++i];
      if (value === undefined) {
        throw authoringError(
          ServeErrorCode.MODE,
          '[openElement start] --mode requires a value: start or preview.',
        );
      }
      mode = parseMode(value);
    } else if (arg === '--debug') {
      debug = true;
    } else {
      rest.push(arg);
    }
  }
  return { mode, rest, debug };
}

function parseMode(value: string): ServeMode {
  if (value === 'start' || value === 'preview') return value;
  throw authoringError(
    ServeErrorCode.MODE,
    `[openElement start] unknown --mode "${value}"; expected start or preview.`,
  );
}
