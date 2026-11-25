import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import process from 'node:process';
import { expect } from 'vitest';

export const packageDir = join(import.meta.dirname!, '..');

/**
 * The environment a DIRECT `node …/cli.ts` run sees: the manager signals a
 * wrapper (`npm create`, `pnpm dlx`) exports to its child are removed, because
 * this suite spawns the CLI itself rather than through one. Manager resolution
 * then falls back to the PATH probe, which the install/handoff tests pin; the
 * TPL-02 invocation tests set the signals explicitly on top of this base.
 */
export function directInvocationEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.npm_config_user_agent;
  delete env.npm_execpath;
  delete env.npm_lifecycle_event;
  return { ...env, ...overrides };
}

export async function runCreate(
  executable: string,
  cwd: string,
  name: string,
  ...extra: string[]
): Promise<{ stdout: string; stderr: string; code: number }> {
  const child = spawn(process.execPath, [executable, name, ...extra], {
    cwd,
    env: directInvocationEnv(),
  });
  const [out, err, [code]] = await Promise.all([
    Array.fromAsync(child.stdout!),
    Array.fromAsync(child.stderr!),
    once(child, 'close'),
  ]);
  return {
    stdout: Buffer.concat(out).toString(),
    stderr: Buffer.concat(err).toString(),
    code: code ?? -1,
  };
}

/** A create run expected to succeed; asserts exit 0 with a clean stderr. */
export async function runCreateOk(
  executable: string,
  cwd: string,
  name: string,
  ...extra: string[]
): Promise<string> {
  const { stdout, stderr, code } = await runCreate(executable, cwd, name, ...extra);
  expect(code, stderr).toEqual(0);
  return stdout;
}

export async function runCreateExpectingFailure(
  executable: string,
  cwd: string,
  name: string,
  ...extra: string[]
): Promise<string> {
  const { stderr, code } = await runCreate(executable, cwd, name, ...extra);
  expect(code !== 0, `expected create to fail for "${name}" (${extra.join(' ')})`).toBeTruthy();
  return stderr;
}

// A clean, actionable CLI error is a single message line: no runtime stack
// trace vomit (L9). Deno stack frames are indented `at file:///` lines.
export function assertCleanError(stderr: string): void {
  expect(stderr.includes('\n    at '), `stack trace leaked into CLI error:\n${stderr}`).toBeFalsy();
}
