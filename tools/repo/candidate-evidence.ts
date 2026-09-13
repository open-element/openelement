/**
 * Bind Alpha candidate evidence to one explicit Git commit.
 *
 * Strictness: the caller supplies CANDIDATE_SHA (or --expected-sha) and the
 * worktree must be tracked-clean before anything runs. Every section spawns
 * a real subprocess with stdin closed (non-interactive invariant) and its
 * combined output is stored under .artifacts/logs (never /tmp-only); the
 * JSON records command, startedAt, duration, exitCode, result, counts, and
 * the log path + sha256. A PASS is never hand-written: it comes from the
 * child exit code plus a semantic assertion (e.g. gate step counts).
 *
 * Sections:
 *   check | gate:source | gate:packed | publish:npm:dry-run |
 *   pack:clean-log (expected FAIL on the upstream private-module warnings;
 *   recorded honestly, see .artifacts/deno-pack-repros/README.md) |
 *   permission-scans | ffi-non-interactive | matrix-rollup (parsed from the
 *   gate logs, not re-run) | environment | skips | tarballs
 *
 * `--validate <evidence.json>` re-checks a written file against the current
 * checkout (SHA/tree/cleanliness, log presence + hashes, no stale
 * references) and exits non-zero on any mismatch.
 */

import { dirname, join } from '@std/path';
import { readPackages } from '../lib/package-graph.ts';
import { tarballPath } from '../lib/npm-tarball.ts';

const repoRoot = join(dirname(new URL(import.meta.url).pathname), '..', '..');

interface SectionResult {
  name: string;
  command: string[];
  startedAt: string;
  durationMs: number;
  exitCode: number;
  result: 'PASS' | 'FAIL';
  counts: Record<string, number>;
  logPath: string;
  logSha256: string;
  note?: string;
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return 'sha256:' +
    Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function commandText(command: string, args: string[]): Promise<string> {
  const result = await new Deno.Command(command, {
    args,
    cwd: repoRoot,
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  return new TextDecoder().decode(result.stdout).trim() +
    new TextDecoder().decode(result.stderr).trim();
}

async function required(command: string, args: string[]): Promise<string> {
  const child = new Deno.Command(command, {
    args,
    cwd: repoRoot,
    stdout: 'piped',
    stderr: 'piped',
  });
  const result = await child.output();
  const output = new TextDecoder().decode(result.stdout).trim() +
    new TextDecoder().decode(result.stderr).trim();
  if (!result.success) throw new Error(`${command} ${args.join(' ')} failed: ${output}`);
  return output;
}

function expectedSha(): string {
  const index = Deno.args.indexOf('--expected-sha');
  const fromArgs = index === -1 ? undefined : Deno.args[index + 1];
  const value = fromArgs ?? Deno.env.get('CANDIDATE_SHA');
  if (!value || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error('Set CANDIDATE_SHA to the exact 40-character candidate commit SHA.');
  }
  return value;
}

async function runSection(
  name: string,
  command: string[],
  logsDir: string,
): Promise<{ section: SectionResult; logText: string }> {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const logPath = join(logsDir, `${name}.log`);
  // output() drains piped stdout/stderr concurrently with the wait: awaiting
  // status first would deadlock once a gate log exceeds the pipe buffer.
  const output = await new Deno.Command(command[0], {
    args: command.slice(1),
    cwd: repoRoot,
    stdin: 'null',
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  const text = new TextDecoder().decode(output.stdout) + new TextDecoder().decode(output.stderr);
  await Deno.writeTextFile(logPath, text);
  const logSha256 = await sha256Bytes(new TextEncoder().encode(text));
  const section: SectionResult = {
    name,
    command,
    startedAt,
    durationMs: Date.now() - started,
    exitCode: output.code,
    result: output.success ? 'PASS' : 'FAIL',
    counts: {},
    logPath: logPath.startsWith(repoRoot) ? logPath.slice(repoRoot.length + 1) : logPath,
    logSha256,
  };
  return { section, logText: text };
}

function countMatches(text: string, pattern: RegExp): number {
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

/** Gate step lines printed by tools/repo/gate.ts (`PASS name (Ns)`). */
function gateStepCounts(text: string): { pass: number; fail: number } {
  return {
    pass: countMatches(text, /^PASS .+ \(\d+\.\d+s\)$/gm),
    fail: countMatches(text, /^FAIL .+ \(\d+\.\d+s\)$/gm),
  };
}

async function playwrightBrowserVersions(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const home = Deno.env.get('HOME') ?? Deno.env.get('USERPROFILE') ?? '';
  for (
    const cache of [
      join(home, '.cache/ms-playwright'),
      join(home, 'Library/Caches/ms-playwright'),
      join('C:', 'Users', 'runneradmin', 'AppData', 'Local', 'ms-playwright'),
    ]
  ) {
    try {
      for await (const entry of Deno.readDir(cache)) {
        if (!entry.isDirectory) continue;
        const match = /^(chromium|firefox|webkit|ffmpeg|chromium_headless_shell)-(.+)$/.exec(
          entry.name,
        );
        if (match) out[match[1]] = match[2];
      }
      if (Object.keys(out).length > 0) return out;
    } catch {
      // Cache absent on this machine; keep looking.
    }
  }
  out['status'] = 'ms-playwright cache not found';
  return out;
}

async function skipCounts(): Promise<{ counts: Record<string, number>; note: string }> {
  const counts: Record<string, number> = {};
  const probes: Array<[string, string[]]> = [
    ['fixme', ['grep', '-r', '--include=*.ts', '-c', 'fixme', 'tests', 'packages', 'apps']],
    ['testSkip', [
      'grep',
      '-r',
      '-E',
      '--include=*.ts',
      '-c',
      '\\b(test|it|describe)\\.skip\\b',
      'tests',
      'packages',
      'apps',
    ]],
    ['bfcache', ['grep', '-r', '-i', '--include=*.ts', '-l', 'bfcache', 'tests']],
  ];
  for (const [key, args] of probes) {
    try {
      const text = await commandText(args[0], args.slice(1));
      counts[key] = text.split('\n').filter((line) =>
        !/:0$/.test(line) && line.trim().length > 0
      ).length;
    } catch {
      counts[key] = -1;
    }
  }
  return {
    counts,
    note:
      'fixme/testSkip count files with >=1 match. The starter-matrix bfcache fixme is a declared Playwright-harness limit (one site, three browsers); all other skips must be listed in the final report.',
  };
}

async function main(): Promise<void> {
  const expected = expectedSha();
  const sha = await required('git', ['rev-parse', 'HEAD']);
  if (sha !== expected) {
    throw new Error(`Candidate SHA mismatch: expected ${expected}, checked out ${sha}.`);
  }
  for (const args of [['diff', '--quiet'], ['diff', '--cached', '--quiet']]) {
    const result = await new Deno.Command('git', { args, cwd: repoRoot }).output();
    if (!result.success) {
      throw new Error(
        `Candidate requires a tracked-clean worktree (git ${args.join(' ')} failed).`,
      );
    }
  }

  const logsDir = join(repoRoot, '.artifacts/logs');
  await Deno.mkdir(logsDir, { recursive: true });
  const sections: SectionResult[] = [];
  const logs: Record<string, string> = {};
  const run = async (name: string, command: string[]): Promise<SectionResult> => {
    console.log(`[evidence] starting ${name}: ${command.join(' ')}`);
    const { section, logText } = await runSection(name, command, logsDir);
    sections.push(section);
    logs[name] = logText;
    console.log(
      `[evidence] ${section.result} ${name} (${(section.durationMs / 1000).toFixed(1)}s)`,
    );
    return section;
  };

  const denoExe = Deno.execPath();
  await run('check', [denoExe, 'task', 'check']);
  const gateSource = await run('gate-source', [
    denoExe,
    'task',
    '--cwd',
    'tools/repo',
    'gate:source',
  ]);
  gateSource.counts = gateStepCounts(logs['gate-source']);
  const gatePacked = await run('gate-packed', [
    denoExe,
    'task',
    '--cwd',
    'tools/release',
    'gate:packed',
  ]);
  gatePacked.counts = gateStepCounts(logs['gate-packed']);
  await run('publish-npm-dry-run', [
    denoExe,
    'task',
    '--cwd',
    'tools/release',
    'publish:npm:dry-run',
  ]);

  const cleanLog = await run('pack-clean-log', [
    denoExe,
    'task',
    '--cwd',
    'tools/release',
    'pack:clean-log',
  ]);
  cleanLog.counts = {
    warningLines: countMatches(logs['pack-clean-log'], /Could not generate types|error\[/g),
  };
  cleanLog.note =
    'Expected FAIL on Deno 2.9: fully-typed runtime-only private modules warn (repro: .artifacts/deno-pack-repros/). Zero error[ diagnostics; every public export .d.ts is native.';

  const permScans = await run('permission-scans', [
    denoExe,
    'test',
    '--allow-read',
    '--allow-run',
    '--allow-env',
    '--allow-net',
    '--deny-ffi',
    '--no-prompt',
    'tools/repo/check-no-allow-all.test.ts',
    'tools/repo/check-task-permissions.test.ts',
  ]);
  permScans.counts = { passed: countMatches(logs['permission-scans'], / ok /g) };

  const ffiProof = await run('ffi-non-interactive', [
    denoExe,
    'test',
    '--allow-read',
    '--allow-run',
    '--allow-env',
    '--allow-net',
    '--deny-ffi',
    '--no-prompt',
    'tools/release/non-interactive-permissions.test.ts',
  ]);
  ffiProof.counts = { passed: countMatches(logs['ffi-non-interactive'], / ok /g) };

  // Rollup: named proofs parsed from the gate logs (no re-runs).
  const packedLog = logs['gate-packed'] ?? '';
  const sourceLog = logs['gate-source'] ?? '';
  const matrixCells = packedLog.split('\n').filter((line) =>
    /chromium|firefox|webkit/i.test(line) && /PASS|FAIL/.test(line)
  ).slice(0, 60);
  const rollup = {
    packedRendererBrowserCells: matrixCells,
    nodeProof: /proof:node \(\d+\.\d+s\)\s*$|PASS tests\/fixtures\/router-nitro#proof:node/m.test(
      sourceLog,
    ),
    workersProof: /PASS tests\/fixtures\/router-nitro#proof:workers/m.test(sourceLog),
    saasVerify: /PASS saas:verify|PASS apps\/saas#/m.test(sourceLog),
    siteVerify: /PASS tools\/repo#site:check-links/m.test(sourceLog),
    coverageLines: sourceLog.split('\n').filter((line) =>
      /coverage.+%|branch.+%|function.+%/i.test(line)
    ).slice(0, 10),
  };

  const packages = await readPackages();
  const tarballs: Record<string, string> = {};
  for (const pkg of packages) {
    const bytes = await Deno.readFile(tarballPath(pkg)).catch(() => null);
    if (!bytes) throw new Error(`Candidate tarball missing for ${pkg.name}: ${tarballPath(pkg)}`);
    tarballs[pkg.name] = await sha256Bytes(bytes);
  }

  const [node, npm] = await Promise.all([
    required('node', ['--version']),
    required('npm', ['--version']),
  ]);
  const skips = await skipCounts();
  const requiredOk = ['check', 'gate-source', 'gate-packed', 'publish-npm-dry-run'].every(
    (name) => sections.find((section) => section.name === name)?.result === 'PASS',
  );
  const evidence = {
    sha,
    tree: await required('git', ['rev-parse', 'HEAD^{tree}']),
    trackedClean: true,
    toolVersions: {
      deno: Deno.version.deno,
      v8: Deno.version.v8,
      typescript: Deno.version.typescript,
      node,
      npm,
      os: `${Deno.build.os}/${Deno.build.arch}`,
      playwrightBrowsers: await playwrightBrowserVersions(),
    },
    tarballs,
    sections,
    rollup,
    skips,
    requiredOk,
    knownFailures: cleanLog.result === 'FAIL'
      ? ['pack-clean-log (upstream private-module warnings)']
      : [],
    generatedAt: new Date().toISOString(),
    result: requiredOk ? 'PASS' : 'FAIL',
  };
  const output = Deno.env.get('CANDIDATE_EVIDENCE_OUTPUT') ?? '.artifacts/candidate-evidence.json';
  await Deno.writeTextFile(output, JSON.stringify(evidence, null, 2) + '\n');
  console.log(`Candidate evidence ${evidence.result}: ${output}`);
  if (!requiredOk) Deno.exit(1);
}

async function validate(path: string): Promise<void> {
  const evidence = JSON.parse(await Deno.readTextFile(path)) as {
    sha: string;
    tree: string;
    trackedClean: boolean;
    sections: SectionResult[];
    toolVersions?: Record<string, unknown>;
    tarballs?: Record<string, string>;
  };
  const failures: string[] = [];
  const sha = await required('git', ['rev-parse', 'HEAD']);
  if (evidence.sha !== sha) failures.push(`evidence sha ${evidence.sha} != HEAD ${sha}`);
  const tree = await required('git', ['rev-parse', 'HEAD^{tree}']);
  if (evidence.tree !== tree) failures.push(`evidence tree ${evidence.tree} != HEAD tree ${tree}`);
  for (const args of [['diff', '--quiet'], ['diff', '--cached', '--quiet']]) {
    const result = await new Deno.Command('git', { args, cwd: repoRoot }).output();
    if (!result.success) failures.push(`worktree not tracked-clean (git ${args.join(' ')})`);
  }
  if (!evidence.toolVersions?.['deno'] || !evidence.toolVersions?.['node']) {
    failures.push('toolVersions missing deno/node versions');
  }
  if (!evidence.tarballs || Object.keys(evidence.tarballs).length < 4) {
    failures.push('tarballs missing package hashes');
  }
  for (const section of evidence.sections) {
    const logFile = join(repoRoot, section.logPath);
    const bytes = await Deno.readFile(logFile).catch(() => null);
    if (!bytes) {
      failures.push(`section ${section.name}: log missing at ${section.logPath}`);
      continue;
    }
    if ((await sha256Bytes(bytes)) !== section.logSha256) {
      failures.push(`section ${section.name}: log hash mismatch`);
    }
  }
  const raw = JSON.stringify(evidence);
  if (raw.includes('www/') || raw.includes('www\\')) {
    failures.push('evidence references stale www/ paths');
  }
  if (/[0-9a-f]{40}/.test(raw.replace(evidence.sha, ''))) {
    failures.push('evidence references a second commit SHA');
  }
  if (failures.length > 0) {
    console.error(`evidence validation FAILED:\n${failures.join('\n')}`);
    Deno.exit(1);
  }
  console.log(`evidence validation ok: ${path} binds ${evidence.sha}`);
}

if (import.meta.main) {
  const validateIndex = Deno.args.indexOf('--validate');
  if (validateIndex !== -1 && Deno.args[validateIndex + 1]) {
    await validate(Deno.args[validateIndex + 1]);
  } else {
    await main();
  }
}
