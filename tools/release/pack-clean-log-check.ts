/**
 * Native `deno pack` clean-log gate (1.0 Alpha convergence, pack item 9).
 *
 * Runs a real `deno pack --dry-run --allow-dirty` per workspace package in a
 * clean subdirectory-free invocation (the package's own directory, so its own
 * deno.json applies) and fails closed on ANY of these tokens in the combined
 * stdout/stderr:
 *   Could not generate types / Types will not be included / error[ /
 *   warning / slow type / missing-explicit / unsupported / failed
 * Output is never redirected to /dev/null: per-package logs are written to
 * the logs directory (default .artifacts/logs) and the summary prints every
 * offending line. Each tarball-level invariant (module type, export maps,
 * declarations, publint/ATTW, ESM import, browser consumers) stays owned by
 * package-artifacts:check and the packed consumers — this gate owns the
 * warning-free pack itself.
 */

import { join } from '@std/path';
import { readPackages } from '../lib/package-graph.ts';

export const CLEAN_LOG_TOKENS = [
  'Could not generate types',
  'Types will not be included',
  'error[',
  'warning',
  'slow type',
  'missing-explicit',
  'unsupported',
  'failed',
] as const;

/** Offending lines (token + line) found in one pack log. */
export function scanPackLog(output: string): Array<{ token: string; line: string }> {
  const hits: Array<{ token: string; line: string }> = [];
  for (const rawLine of output.split('\n')) {
    // Intentional ANSI color stripping for log scans.
    // deno-lint-ignore no-control-regex
    const line = rawLine.replace(/\x1b\[[0-9;]*m/g, '');
    for (const token of CLEAN_LOG_TOKENS) {
      if (line.includes(token)) {
        hits.push({ token, line: line.trim().slice(0, 220) });
        break;
      }
    }
  }
  return hits;
}

export interface CleanLogResult {
  package: string;
  dir: string;
  code: number;
  hits: Array<{ token: string; line: string }>;
  logPath: string;
}

export async function checkPackCleanLogs(
  logsDir: string,
  runPack?: (dir: string) => Promise<{ code: number; output: string }>,
): Promise<CleanLogResult[]> {
  const packages = await readPackages();
  await Deno.mkdir(logsDir, { recursive: true });
  const results: CleanLogResult[] = [];
  const run = runPack ??
    (async (dir: string) => {
      const child = new Deno.Command(Deno.execPath(), {
        args: ['pack', '--dry-run', '--allow-dirty'],
        cwd: dir,
        stdin: 'null',
        stdout: 'piped',
        stderr: 'piped',
      });
      const output = await child.output();
      const decoder = new TextDecoder();
      return {
        code: output.code,
        output: decoder.decode(output.stdout) + '\n' + decoder.decode(output.stderr),
      };
    });
  for (const pkg of packages) {
    const short = pkg.name.replace('@openelement/', '');
    const logPath = join(logsDir, `pack-clean-${short}.log`);
    const { code, output } = await run(pkg.dir);
    await Deno.writeTextFile(logPath, output);
    results.push({ package: pkg.name, dir: pkg.dir, code, hits: scanPackLog(output), logPath });
  }
  return results;
}

if (import.meta.main) {
  const logsIndex = Deno.args.indexOf('--logs');
  const logsDir = logsIndex === -1 ? '.artifacts/logs' : Deno.args[logsIndex + 1];
  if (!logsDir) {
    console.error('pack-clean-log-check: --logs requires a directory');
    Deno.exit(2);
  }
  const results = await checkPackCleanLogs(logsDir);
  let failed = 0;
  for (const result of results) {
    if (result.code !== 0) {
      failed++;
      console.error(`FAIL ${result.package}: pack exited ${result.code} (${result.logPath})`);
      continue;
    }
    if (result.hits.length > 0) {
      failed++;
      console.error(
        `FAIL ${result.package}: ${result.hits.length} warning line(s) (${result.logPath})`,
      );
      for (const hit of result.hits.slice(0, 20)) {
        console.error(`  [${hit.token}] ${hit.line}`);
      }
      if (result.hits.length > 20) console.error(`  ... and ${result.hits.length - 20} more`);
      continue;
    }
    console.log(`PASS ${result.package} (clean pack log)`);
  }
  if (failed > 0) {
    console.error(
      `pack clean-log check failed for ${failed}/${results.length} package(s). ` +
        'See .artifacts/deno-pack-repros/README.md for the upstream repro.',
    );
    Deno.exit(1);
  }
  console.log(`pack clean-log check ok (${results.length} packages).`);
}
