/**
 * Deno.Command-shaped subprocess helpers over node:child_process (B1b port).
 *
 * The evidence machinery previously called `new Deno.Command(...).output()`
 * and `.spawn()`. This module ports those call sites to `node:child_process`
 * while preserving the exact shapes the call sites check:
 *
 * - `commandOutput` mirrors `.output()`: it resolves with
 *   `{ success, code, signal, stdout, stderr }` and never throws for a child
 *   that exits or is killed by a signal (stdout/stderr are empty Buffers when
 *   that stream is inherited/ignored).
 * - `commandStatus` mirrors `.spawn()` + `await child.status`.
 * - Default stdio mirrors Deno.Command: stdin `inherit`, stdout/stderr `piped`.
 * - A passed `env` merges over the parent environment (Deno.Command
 *   semantics); node's raw `env` option would replace it wholesale and drop
 *   `PATH`, so the merge is done here.
 * - A child killed by a signal reports Deno's status shape: `code` is the
 *   shell-conventional `128 + signal number` (SIGTERM -> 143) and `signal`
 *   carries the signal name; `success` stays false.
 * - A child that cannot be spawned (missing binary) REJECTS, matching
 *   Deno.Command throwing `NotFound` at the call site.
 */

import { spawn, spawnSync } from 'node:child_process';
import { constants } from 'node:os';
import process from 'node:process';

export interface CommandResult {
  success: boolean;
  code: number;
  signal: string | null;
  stdout: Uint8Array;
  stderr: Uint8Array;
}

export type CommandStdio = 'piped' | 'inherit' | 'null';

export interface CommandOptions {
  args?: string[];
  cwd?: string;
  /**
   * Merged over the parent environment (Deno.Command semantics). Undefined
   * values (possible when spreading process.env) are omitted, matching node's
   * own child_process env handling.
   */
  env?: Record<string, string | undefined>;
  /** Abort kills the child (SIGTERM), mirroring Deno.Command's signal option. */
  signal?: AbortSignal;
  stdin?: 'inherit' | 'null';
  stdout?: CommandStdio;
  stderr?: CommandStdio;
}

const NODE_STDIO: Record<CommandStdio, 'pipe' | 'inherit' | 'ignore'> = {
  piped: 'pipe',
  inherit: 'inherit',
  null: 'ignore',
};

function toSignalNumber(signal: string): number {
  const signals = constants.signals as Record<string, number>;
  return signals[signal] ?? 0;
}

function denoStatus(
  code: number | null,
  signal: string | null,
): { code: number; signal: string | null; success: boolean } {
  if (signal !== null) {
    return { code: 128 + toSignalNumber(signal), signal, success: false };
  }
  return { code: code ?? 1, signal: null, success: code === 0 };
}

/**
 * Deno.Command merges a passed `env` over the parent environment natively,
 * without the caller needing env permission (run-in spawns under bare
 * --allow-run). Reading process.env from JS trips that permission, so an
 * empty/absent env omits the option entirely — node then inherits the parent
 * environment natively, exactly like Deno. A NON-empty env spreads
 * process.env (Deno merge semantics) and therefore requires --allow-env on
 * the caller, which every non-empty caller's task already grants.
 */
function mergedEnv(env: CommandOptions['env']): NodeJS.ProcessEnv | undefined {
  if (!env || Object.keys(env).length === 0) return undefined;
  return { ...process.env, ...env };
}

async function runCommand(command: string, options: CommandOptions): Promise<CommandResult> {
  const {
    args = [],
    cwd,
    env,
    signal,
    stdin = 'inherit',
    stdout = 'piped',
    stderr = 'piped',
  } = options;
  const child = spawn(command, args, {
    cwd,
    env: mergedEnv(env),
    signal,
    stdio: [NODE_STDIO[stdin], NODE_STDIO[stdout], NODE_STDIO[stderr]],
  });
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  const out = child.stdout;
  const err = child.stderr;
  if (stdout === 'piped' && out) out.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
  if (stderr === 'piped' && err) err.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
  const status = await new Promise<{ code: number | null; signal: string | null }>(
    (resolve, reject) => {
      child.on('error', (error: Error) => {
        // An aborted child surfaces as kill+SIGTERM (verified against this
        // runtime); a spawn failure (ENOENT/EACCES) rejects like
        // Deno.Command throwing NotFound at the call site.
        if (!signal?.aborted) reject(error);
      });
      child.on('close', (code, sig) => {
        resolve({ code, signal: sig });
      });
    },
  );
  const result = denoStatus(status.code, status.signal);
  return {
    ...result,
    stdout: stdout === 'piped' ? Buffer.concat(stdoutChunks) : new Uint8Array(0),
    stderr: stderr === 'piped' ? Buffer.concat(stderrChunks) : new Uint8Array(0),
  };
}

export function commandOutput(
  command: string,
  options: CommandOptions = {},
): Promise<CommandResult> {
  return runCommand(command, options);
}

export function commandStatus(
  command: string,
  options: CommandOptions = {},
): Promise<CommandResult> {
  return runCommand(command, options);
}

/** Mirrors `.outputSync()`: same shape, throws when the child cannot spawn. */
export function commandOutputSync(command: string, options: CommandOptions = {}): CommandResult {
  const {
    args = [],
    cwd,
    env,
    signal,
    stdin = 'inherit',
    stdout = 'piped',
    stderr = 'piped',
  } = options;
  const result = spawnSync(command, args, {
    cwd,
    env: mergedEnv(env),
    signal,
    stdio: [NODE_STDIO[stdin], NODE_STDIO[stdout], NODE_STDIO[stderr]],
  });
  // A spawn failure (ENOENT/EACCES) throws like Deno.Command.outputSync.
  if (result.error) throw result.error;
  const status = denoStatus(result.status, result.signal);
  return {
    ...status,
    stdout: stdout === 'piped' ? (result.stdout ?? new Uint8Array(0)) : new Uint8Array(0),
    stderr: stderr === 'piped' ? (result.stderr ?? new Uint8Array(0)) : new Uint8Array(0),
  };
}
