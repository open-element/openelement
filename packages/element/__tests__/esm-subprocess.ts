/**
 * Shared node subprocess runner for the no-DOM and claim-entry suites.
 *
 * node --input-type=module -e: ESM eval resolving the workspace imports from
 * the element package root (cwd matters for bare-specifier lookup).
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import process from 'node:process';

export async function runEsmSubprocess(
  script: string,
): Promise<{ code: number; out: string; err: string }> {
  const child = spawn(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: join(import.meta.dirname!, '../..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const [stdout, stderr] = await Promise.all([
    Array.fromAsync(child.stdout!),
    Array.fromAsync(child.stderr!),
  ]);
  const code = await new Promise<number>((resolve) => child.once('exit', (c) => resolve(c ?? -1)));
  return {
    code,
    out: Buffer.concat(stdout).toString(),
    err: Buffer.concat(stderr).toString(),
  };
}
