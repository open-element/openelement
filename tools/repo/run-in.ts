/**
 * Portable `cd` + env replacement for package.json task strings; subprocesses
 * run through node:child_process.
 *
 * Root tasks must not `cd` (Windows cmd has no `cd ... &&` composition that
 * behaves like POSIX sh, and directory-hopping inside task strings hides the
 * real working directory from readers). `run-in` makes the directory and the
 * extra environment explicit flags and inherits stdio, so the child behaves
 * exactly as if it had been started there:
 *
 * Usage:
 *   node tools/repo/run-in.ts --root <dir> [--env K=V ...] -- <cmd> [args...]
 *
 * The child exit code passes through; a spawn failure exits 127.
 */

import { commandStatus } from './node-command.ts';
import process from 'node:process';

export interface RunInOptions {
  root: string;
  env: Record<string, string>;
  command: string[];
}

export function parseRunInArgs(args: string[]): RunInOptions {
  let root: string | undefined;
  const env: Record<string, string> = {};
  const rest = [...args];
  while (rest.length > 0 && rest[0] !== '--') {
    const flag = rest.shift()!;
    if (flag === '--root') {
      const value = rest.shift();
      if (!value) throw new Error('run-in: --root requires a directory');
      root = value;
    } else if (flag === '--env') {
      const value = rest.shift();
      const eq = value?.indexOf('=') ?? -1;
      if (!value || eq < 1) throw new Error('run-in: --env requires KEY=VALUE');
      env[value.slice(0, eq)] = value.slice(eq + 1);
    } else {
      throw new Error(`run-in: unknown flag '${flag}' (expected --root, --env, or --)`);
    }
  }
  if (!root) throw new Error('run-in: --root <dir> is required');
  if (rest[0] !== '--') throw new Error('run-in: missing -- before the command');
  const command = rest.slice(1);
  if (command.length === 0) throw new Error('run-in: no command after --');
  return { root, env, command };
}

export async function execute(options: RunInOptions): Promise<number> {
  const [command, ...commandArgs] = options.command;
  try {
    // node's raw env option replaces the parent environment (dropping PATH),
    // so commandStatus merges `env` over the parent instead.
    const status = await commandStatus(command, {
      args: commandArgs,
      cwd: options.root,
      env: options.env,
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    });
    return status.code;
  } catch (error) {
    console.error(`run-in: cannot start '${options.command.join(' ')}': ${String(error)}`);
    return 127;
  }
}

if (import.meta.main) {
  try {
    process.exit(await execute(parseRunInArgs(process.argv.slice(2))));
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error));
    process.exit(2);
  }
}
