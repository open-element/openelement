/**
 * First-party subprocess helper over node:child_process.
 *
 * `spawnCommand` / `spawnCommandSync` wait for a child process and resolve
 * with the repository's canonical status shape. The semantics are explicit
 * here because importers depend on them:
 *
 * - A child that exits non-zero or is killed by a signal resolves with
 *   `success: false`; only a spawn failure (missing binary, ENOENT/EACCES)
 *   rejects (async) or throws (sync). Callers treat "could not start"
 *   differently from "ran and failed".
 * - `code` is the child's exit code, or the shell-conventional
 *   `128 + signal number` when a signal killed it (SIGTERM -> 143, SIGKILL ->
 *   137). The arithmetic is kept deliberately, not as residue: check-coverage's
 *   native-crash retry classifies exits >= 128 (`check-coverage.ts`, issue
 *   #1278), run-in/gate pass `code` to process.exit where node's `code: null`
 *   would exit 0, and the release harnesses print it in failure diagnostics.
 *   node-command.contract.test.ts pins the numbers and the classifier link.
 * - `signal` carries the terminating signal name, else null.
 * - A passed `env` merges over the parent environment (node's raw option
 *   replaces it wholesale and would drop PATH); an absent/empty env inherits
 *   the parent untouched.
 * - Default stdio: stdin `inherit`, stdout/stderr `piped`. Piped streams are
 *   collected into `stdout`/`stderr`; inherited/ignored streams yield empty
 *   Uint8Arrays.
 * - Aborting the `signal` option kills the child with SIGTERM and the wait
 *   STILL RESOLVES (status 128 + SIGTERM); the packed-consumer timeout harness
 *   depends on that to report a timeout instead of an AbortError. Re-verified
 *   on Node 24 by node-command.contract.test.ts.
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
  /** Exit code, or 128 + signal number when a signal terminated the child. */
  code: number;
  /** Terminating signal name, else null. */
  signal: string | null;
  stdout: Uint8Array;
  stderr: Uint8Array;
}

export type CommandStdio = 'piped' | 'inherit' | 'null';

export interface CommandOptions {
  args?: string[];
  cwd?: string;
  /**
   * Merged over the parent environment; undefined values are omitted,
   * matching node's own child_process env handling.
   */
  env?: Record<string, string | undefined>;
  /** Abort kills the child (SIGTERM); the wait resolves, it does not reject. */
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

function signalNumber(signal: string): number {
  const signals = constants.signals as Record<string, number>;
  return signals[signal] ?? 0;
}

/**
 * node close-status -> repository status shape. See the module header for why
 * `128 + signal` stays: the mapping is a proven caller dependency, pinned by
 * node-command.contract.test.ts.
 */
function exitStatus(
  code: number | null,
  signal: string | null,
): { code: number; signal: string | null; success: boolean } {
  if (signal !== null) {
    return { code: 128 + signalNumber(signal), signal, success: false };
  }
  return { code: code ?? 1, signal: null, success: code === 0 };
}

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

export async function spawnCommand(
  command: string,
  options: CommandOptions = {},
): Promise<CommandResult> {
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
        // An aborted child on node 24 emits an ABORT_ERR 'error' event and a
        // SIGTERM 'close' (observed in both orders); the wait below must resolve
        // with the SIGTERM status, so the abort path never rejects. A genuine
        // spawn failure (ENOENT/EACCES) rejects.
        if (!signal?.aborted) reject(error);
      });
      child.on('close', (code, sig) => {
        resolve({ code, signal: sig });
      });
    },
  );
  const result = exitStatus(status.code, status.signal);
  return {
    ...result,
    stdout: stdout === 'piped' ? Buffer.concat(stdoutChunks) : new Uint8Array(0),
    stderr: stderr === 'piped' ? Buffer.concat(stderrChunks) : new Uint8Array(0),
  };
}

/** Synchronous sibling of `spawnCommand`: same shape, throws on spawn failure. */
export function spawnCommandSync(command: string, options: CommandOptions = {}): CommandResult {
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
  // A spawn failure (ENOENT/EACCES) throws with the underlying node error.
  if (result.error) throw result.error;
  const status = exitStatus(result.status, result.signal);
  return {
    ...status,
    stdout: stdout === 'piped' ? (result.stdout ?? new Uint8Array(0)) : new Uint8Array(0),
    stderr: stderr === 'piped' ? (result.stderr ?? new Uint8Array(0)) : new Uint8Array(0),
  };
}
