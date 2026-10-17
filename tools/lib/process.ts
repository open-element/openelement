/**
 * Shared process/command helpers for openElement tooling.
 *
 * These helpers run on node:* via tools/repo/node-command.ts; the exported
 * shapes (runCommand throwing on non-zero exit, runWithOutput capturing
 * stdio, runCaptured's error copy) are shared by the release-flow call sites.
 */
import { spawnCommand } from '../repo/node-command.ts';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

/** Read the value of a `--flag value` pair from process.argv, or null. */
export function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return null;
}

export interface RunCommandOptions {
  cwd?: string | URL;
  env?: Record<string, string>;
  // 'piped' is deliberately absent: the spawn layer only supports
  // inherit/null for stdin, and the old 'piped'->'inherit' coercion silently
  // changed caller intent (M-T3). A caller that needs piped stdin must do its
  // own spawn instead of silently getting inheritance.
  stdin?: 'inherit' | 'null';
  stdout?: 'inherit' | 'piped' | 'null';
  stderr?: 'inherit' | 'piped' | 'null';
  signal?: AbortSignal;
}

export interface RunWithOutputResult {
  success: boolean;
  code: number;
  stdout: string;
  stderr: string;
}

/** Resolve a string|URL cwd to the string the spawn layer takes. A URL cwd is
 * honored via fileURLToPath — never silently dropped (M-T3). */
function resolveCwd(cwd: string | URL | undefined): string | undefined {
  if (cwd === undefined) return undefined;
  return typeof cwd === 'string' ? cwd : fileURLToPath(cwd);
}

/** Run a command and stream stdio by default. Throws on non-zero exit. */
export async function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions = {},
): Promise<void> {
  const { cwd, env, stdin = 'inherit', stdout = 'inherit', stderr = 'inherit', signal } = options;
  const effectiveCwd = resolveCwd(cwd);
  console.log(`$ ${[command, ...args].join(' ')}${effectiveCwd ? `  # cwd=${effectiveCwd}` : ''}`);
  const status = await spawnCommand(command, {
    args,
    cwd: effectiveCwd,
    env,
    signal,
    stdin,
    stdout,
    stderr,
  });
  if (!status.success) {
    throw new Error(`Command failed with exit code ${status.code}: ${command} ${args.join(' ')}`);
  }
}

export interface RunWithOutputOptions {
  cwd?: string | URL;
  env?: Record<string, string>;
  signal?: AbortSignal;
}

/** Run a command capturing stdout/stderr and return the result without throwing. */
export async function runWithOutput(
  command: string,
  args: string[],
  options: RunWithOutputOptions = {},
): Promise<RunWithOutputResult> {
  const { cwd, env, signal } = options;
  const result = await spawnCommand(command, {
    args,
    cwd: resolveCwd(cwd),
    env,
    signal,
    stdout: 'piped',
    stderr: 'piped',
  });
  const decoder = new TextDecoder();
  return {
    success: result.success,
    code: result.code,
    stdout: decoder.decode(result.stdout),
    stderr: decoder.decode(result.stderr),
  };
}

/**
 * Run a command (git, gh, ...) capturing stdout; returns stdout on success.
 * Throws with the command line, exit code, and captured stdout+stderr on
 * failure. Release-flow diagnostics rely on this exact error shape.
 */
export async function runCaptured(
  command: string[],
  options: RunWithOutputOptions = {},
): Promise<string> {
  const result = await runWithOutput(command[0], command.slice(1), options);
  if (!result.success) {
    throw new Error(
      `${command.join(' ')} failed with exit ${result.code}\n${result.stdout}${result.stderr}`,
    );
  }
  return result.stdout;
}
