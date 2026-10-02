/**
 * Shared subprocess step for the qualify harnesses (#1472).
 *
 * One runner replaces the per-consumer copies (qualify.ts runCommand,
 * third-party qualify.ts run, starter-smoke setup.ts run/runCapture): it
 * prints the command line up front, captures stdout/stderr, replays the
 * captured output on failure, and supports stdin feeding and documented
 * nonzero exits for the probe-style invocations.
 */

import { spawn } from 'node:child_process';
import process from 'node:process';

export interface RunStepOptions {
  /** Working directory for the subprocess. */
  cwd: string;
  /** Extra environment variables layered over the inherited environment. */
  env?: Record<string, string>;
  /** Text written to the subprocess's stdin; stdin is closed afterwards. */
  stdin?: string;
  /** Treat a nonzero exit as a documented outcome instead of a failure. */
  allowFailure?: boolean;
}

export interface RunStepResult {
  stdout: string;
  stderr: string;
}

/** Run a command, capturing output; a nonzero exit is reported with its logs. */
export async function runStep(
  command: string,
  args: string[],
  options: RunStepOptions,
): Promise<RunStepResult> {
  console.log(`$ ${command} ${args.join(' ')}  # cwd=${options.cwd}`);
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env === undefined ? process.env : { ...process.env, ...options.env },
    stdio: [options.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  });
  if (options.stdin !== undefined) {
    child.stdin.write(options.stdin);
    child.stdin.end();
  }
  const [code, stdoutBuf, stderrBuf] = await Promise.all([
    new Promise<number>((resolve) => child.once('exit', (c) => resolve(c ?? -1))),
    Array.fromAsync(child.stdout!),
    Array.fromAsync(child.stderr!),
  ]);
  // Buffer.concat, never Buffer.from(chunk[]): the latter coerces each chunk
  // to a single number, collapsing captured output to NUL bytes (surfaced by
  // the B5 starter-smoke node-host run).
  const stdout = Buffer.concat(stdoutBuf).toString();
  const stderr = Buffer.concat(stderrBuf).toString();
  if (code !== 0 && options.allowFailure !== true) {
    if (stdout.trim()) console.error(stdout.trim());
    if (stderr.trim()) console.error(stderr.trim());
    throw new Error(`command failed with exit code ${code}: ${command} ${args.join(' ')}`);
  }
  return { stdout, stderr };
}
