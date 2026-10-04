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
 * - On win32 only, extension-less commands resolve through PATH x PATHEXT
 *   (planWin32Spawn below) so `.cmd` shims like npm/pnpm execute; POSIX
 *   behavior is untouched.
 */

import { spawn, spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { constants } from 'node:os';
import { join } from 'node:path';
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

// ---------------------------------------------------------------------------
// win32 spawn planning: npm/pnpm are .cmd shims
// ---------------------------------------------------------------------------

/** The spawn target a command resolves to (win32 only; posix always yields null). */
export interface SpawnPlan {
  args: string[];
  file: string;
  /**
   * Pass windowsVerbatimArguments: the command line is fully pre-quoted, so
   * node must join file+args verbatim instead of applying its MSVCRT quoting
   * (whose `\"` escapes cmd.exe does not parse).
   */
  verbatim: boolean;
}

/** The env keys win32 resolution reads (injectable for tests). */
export interface Win32SpawnEnv {
  comspec?: string;
  PATH?: string;
  PATHEXT?: string;
}

const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

/**
 * Conservative cmd.exe argument quoting: whitespace and shell metacharacters
 * force double quotes (they are literal inside quotes), embedded quotes double.
 */
function quoteForCmd(arg: string): string {
  // cmd expands %VAR% even inside double quotes, so such an argument cannot be
  // passed faithfully through a .cmd shim — fail closed instead of corrupting it.
  if (arg.includes('%')) {
    throw new Error(`cannot pass an argument containing '%' through cmd.exe: ${arg}`);
  }
  if (arg === '') return '""';
  const escaped = arg.replaceAll('"', '""');
  return /[\s"&|<>^()]/.test(escaped) ? `"${escaped}"` : escaped;
}

function cmdShellPlan(resolved: string, args: readonly string[], env: Win32SpawnEnv): SpawnPlan {
  const line = [resolved, ...args].map(quoteForCmd).join(' ');
  // /d skips AutoRun registry scripts; /s makes cmd strip exactly the outer
  // quote pair below — the same ['cmd.exe','/d','/s','/c','"<line>"'] shape
  // node itself builds for shell:true.
  return { args: ['/d', '/s', '/c', `"${line}"`], file: env.comspec ?? 'cmd.exe', verbatim: true };
}

/**
 * Resolve an extension-less command the way cmd.exe would (PATH x PATHEXT) and
 * return the spawn target:
 *
 * - `.exe`/`.com` hit → direct spawn with verbatim args, identical to the POSIX
 *   path (no shell parsing anywhere).
 * - `.cmd`/`.bat` (or any other PATHEXT hit) → `cmd.exe /d /s /c` wrapper. npm
 *   and pnpm on win32 are `.cmd` shims: CreateProcess appends only `.exe`, and
 *   node refuses to spawn `.cmd`/`.bat` without a shell (the CVE-2024-27980
 *   EINVAL hardening), so a resolved shim must go through cmd.exe. Blanket
 *   `shell: true` was rejected on purpose: it drags every extension-less
 *   command's args through cmd parsing; resolution keeps the shell scoped to
 *   the shim class that genuinely requires it.
 * - No hit, or a command that already carries an extension or a path separator
 *   → null: spawn exactly as before (CreateProcess keeps its own PATH + `.exe`
 *   search). On POSIX this always returns null, so posix behavior is
 *   unchanged.
 */
export function planWin32Spawn(
  command: string,
  args: readonly string[],
  platform: string,
  env: Win32SpawnEnv,
  isFile: (path: string) => boolean,
): SpawnPlan | null {
  if (platform !== 'win32') return null;
  // Path-qualified and extension-bearing commands are out of scope: they spawn
  // unchanged today (CreateProcess handles both) and must keep doing so.
  if (/[\\/]/.test(command) || /\.[^\\/]+$/.test(command)) return null;
  const extensions = (env.PATHEXT ?? DEFAULT_PATHEXT).split(';');
  for (const rawDir of (env.PATH ?? '').split(';')) {
    // Legacy PATH entries may carry surrounding quotes.
    const dir = rawDir.replace(/^"(.*)"$/, '$1');
    if (dir === '') continue;
    for (const ext of extensions) {
      if (ext === '') continue;
      const candidate = join(dir, command + ext);
      if (!isFile(candidate)) continue;
      return /\.(exe|com)$/i.test(candidate)
        ? { args: [...args], file: candidate, verbatim: false }
        : cmdShellPlan(candidate, args, env);
    }
  }
  return null;
}

/** Production file probe for planWin32Spawn: existence + regular file. */
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolution against the environment the child will actually see (a passed env
 * merges over the parent and may retarget PATH), not the parent's alone.
 */
function spawnPlanFor(
  command: string,
  args: readonly string[],
  env: CommandOptions['env'],
): SpawnPlan | null {
  return planWin32Spawn(command, args, process.platform, mergedEnv(env) ?? process.env, isFile);
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
  const plan = spawnPlanFor(command, args, env);
  const child = spawn(plan?.file ?? command, plan?.args ?? args, {
    cwd,
    env: mergedEnv(env),
    signal,
    stdio: [NODE_STDIO[stdin], NODE_STDIO[stdout], NODE_STDIO[stderr]],
    ...(plan?.verbatim ? { windowsVerbatimArguments: true } : {}),
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
  const plan = spawnPlanFor(command, args, env);
  const result = spawnSync(plan?.file ?? command, plan?.args ?? args, {
    cwd,
    env: mergedEnv(env),
    signal,
    stdio: [NODE_STDIO[stdin], NODE_STDIO[stdout], NODE_STDIO[stderr]],
    ...(plan?.verbatim ? { windowsVerbatimArguments: true } : {}),
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
