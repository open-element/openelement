/**
 * `--mode=start|preview` argument parsing for `src/cli/start.ts`.
 *
 * Internal to the Router CLI: the `./cli/start` export entry exists so
 * `deno run npm:@openelement/router/cli/start` can boot the built-output
 * server; its argument parsing is not public API.
 */

export type ServeMode = 'start' | 'preview';

/**
 * Splits `--mode=start|preview` (or `--mode start|preview`) off the CLI args.
 */
export function extractServeMode(argv: string[]): { mode: ServeMode; rest: string[] } {
  const rest: string[] = [];
  let mode: ServeMode = 'start';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const inline = arg.match(/^--mode=(.+)$/);
    if (inline) {
      mode = parseMode(inline[1]);
    } else if (arg === '--mode') {
      const value = argv[++i];
      if (value === undefined) {
        throw new Error('[openElement start] --mode requires a value: start or preview.');
      }
      mode = parseMode(value);
    } else {
      rest.push(arg);
    }
  }
  return { mode, rest };
}

function parseMode(value: string): ServeMode {
  if (value === 'start' || value === 'preview') return value;
  throw new Error(`[openElement start] unknown --mode "${value}"; expected start or preview.`);
}
