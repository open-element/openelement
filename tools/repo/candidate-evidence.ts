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
 *   check | gate:source | gate:packed | publish:npm:dry-run (the sole pack
 *   diagnostic owner: repo-fixable diagnostics fail its exit code; exact
 *   upstream private-module warnings are structured per package, see
 *   .artifacts/deno-pack-repros/README.md) |
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

interface FreshCloneCommand {
  argv: string[];
  cwd: string;
  startedAt: string;
  durationMs: number;
  exitCode: number;
  logPath: string;
  logSha256: string;
}

interface FreshCloneProof {
  sha: string;
  cloneDir: string;
  envSummary: Record<string, string>;
  commands: FreshCloneCommand[];
  note: string;
}

/**
 * Fresh-clone proof at the bound SHA: clone --no-hardlinks into a temp dir,
 * detach at the SHA, and run the README bootstrap plus the packed and
 * publish gates with empty DENO_DIR / npm cache (nothing copied:
 * no node_modules, dist, tgz, or coverage). Playwright browser binaries are
 * reused from the preinstalled user cache (disclosed, not hidden). The temp
 * clone is removed afterwards; logs and hashes stay under .artifacts/logs.
 */
async function runFreshClone(
  sha: string,
  denoExe: string,
  logsDir: string,
): Promise<{ proof: FreshCloneProof; combinedLog: string }> {
  const tmpRoot = await Deno.makeTempDir({ prefix: 'fresh-candidate-' });
  const cloneDir = join(tmpRoot, 'repo');
  const denoDir = join(tmpRoot, 'deno-dir');
  const npmCache = join(tmpRoot, 'npm-cache');
  const commands: FreshCloneCommand[] = [];
  const combined: string[] = [];
  const run = async (argv: string[], cwd: string, env?: Record<string, string>): Promise<void> => {
    const startedAt = new Date().toISOString();
    const started = Date.now();
    const output = await new Deno.Command(argv[0], {
      args: argv.slice(1),
      cwd,
      stdin: 'null',
      stdout: 'piped',
      stderr: 'piped',
      env,
    }).output();
    const text = new TextDecoder().decode(output.stdout) + new TextDecoder().decode(output.stderr);
    const logPath = join(logsDir, `fresh-clone-${commands.length}-${argv[0].split('/').pop()}.log`);
    await Deno.writeTextFile(logPath, text);
    commands.push({
      argv,
      cwd,
      startedAt,
      durationMs: Date.now() - started,
      exitCode: output.code,
      logPath: logPath.startsWith(repoRoot) ? logPath.slice(repoRoot.length + 1) : logPath,
      logSha256: await sha256Bytes(new TextEncoder().encode(text)),
    });
    combined.push(`$ ${argv.join(' ')}  # cwd=${cwd}  -> exit ${output.code}\n${text}`);
    if (!output.success) {
      throw new Error(`fresh-clone step failed: ${argv.join(' ')} (exit ${output.code})`);
    }
  };
  try {
    await run(['git', 'clone', '--no-hardlinks', repoRoot, cloneDir], tmpRoot);
    await run(['git', '-C', cloneDir, 'checkout', sha], tmpRoot);
    const clonedSha = (await required('git', ['-C', cloneDir, 'rev-parse', 'HEAD'])).trim();
    if (clonedSha !== sha) throw new Error(`fresh clone checked out ${clonedSha}, want ${sha}`);
    const isolatedEnv = {
      ...Deno.env.toObject(),
      DENO_DIR: denoDir,
      NPM_CONFIG_CACHE: npmCache,
      npm_config_cache: npmCache,
      DENO_NO_UPDATE_CHECK: '1',
    };
    await run([denoExe, 'install'], cloneDir, isolatedEnv);
    await run([denoExe, 'task', 'check'], cloneDir, isolatedEnv);
    await run([denoExe, 'task', '--cwd', 'tools/release', 'gate:packed'], cloneDir, isolatedEnv);
    await run(
      [denoExe, 'task', '--cwd', 'tools/release', 'publish:npm:dry-run'],
      cloneDir,
      isolatedEnv,
    );
  } finally {
    await Deno.remove(tmpRoot, { recursive: true }).catch(() => undefined);
  }
  return {
    proof: {
      sha,
      cloneDir: `${tmpRoot}/repo (removed after the run; logs retained)`,
      envSummary: {
        DENO_DIR: `${denoDir} (fresh, empty at start)`,
        npmCache: `${npmCache} (fresh, empty at start)`,
        shared: 'HOME (Playwright browser binaries reused from the preinstalled cache)',
        copied: 'nothing: no node_modules, dist, tgz, or coverage carried over',
      },
      commands,
      note: 'README bootstrap + packed + publish gates, stdin closed throughout.',
    },
    combinedLog: combined.join('\n'),
  };
}

function stripAnsi(text: string): string {
  // Intentional ANSI color stripping for log scans.
  // deno-lint-ignore no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Test counts from Deno's final summary line (`ok | N passed | M failed`).
 * Never derived by counting per-test `ok` markers (that inflated 3-test
 * files to 4+).
 */
function parseDenoTestSummary(logText: string): { passed: number; failed: number } {
  const summaries = [...stripAnsi(logText).matchAll(/(\d+) passed \| (\d+) failed/g)];
  if (summaries.length === 0) return { passed: 0, failed: -1 };
  const last = summaries[summaries.length - 1];
  return { passed: Number(last[1]), failed: Number(last[2]) };
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

async function skipCounts(): Promise<
  { counts: Record<string, number>; files: Record<string, string[]>; note: string }
> {
  // Tracked files only (git grep): untracked caches, node_modules, and .git
  // must never inflate the counts.
  const counts: Record<string, number> = {};
  const files: Record<string, string[]> = {};
  const probes: Array<[string, string[]]> = [
    ['fixme', ['grep', '-l', '-i', 'fixme', '--', '*.ts']],
    ['testSkip', ['grep', '-l', '-E', '\\b(test|it|describe)\\.skip\\b', '--', '*.ts']],
    ['bfcache', ['grep', '-l', '-i', 'bfcache', '--', '*.ts']],
  ];
  for (const [key, args] of probes) {
    try {
      const child = new Deno.Command('git', {
        args,
        cwd: repoRoot,
        stdout: 'piped',
        stderr: 'piped',
      });
      const result = await child.output();
      const list = new TextDecoder().decode(result.stdout).split('\n').map((line) => line.trim())
        .filter((
          line,
        ) => line.length > 0);
      files[key] = list;
      counts[key] = list.length;
    } catch {
      files[key] = [];
      counts[key] = -1;
    }
  }
  return {
    counts,
    files,
    note:
      'Tracked files with >=1 match. The starter-matrix back-forward-cache entry is a declared Playwright-harness limit (one site, three browsers); all other skips must be listed in the final report.',
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
  const publishDryRun = await run('publish-npm-dry-run', [
    denoExe,
    'task',
    '--cwd',
    'tools/release',
    'publish:npm:dry-run',
  ]);
  // Structured per-package pack diagnostics printed by publish-npm.ts (the
  // sole diagnostic owner). Any repo-fixable diagnostic already failed the
  // section exit code above; the remaining counts are exact upstream
  // private-module warnings with complete public declarations.
  const packSummaries = [
    ...stripAnsi(logs['publish-npm-dry-run']).matchAll(
      /\[npm\] (@openelement\/\S+): pack diagnostics errors=(\d+) unexpectedWarnings=(\d+) knownUpstreamPrivateWarnings=(\d+) publicDeclarations=(\d+)/g,
    ),
  ].map((match) => ({
    package: match[1],
    errors: Number(match[2]),
    unexpectedWarnings: Number(match[3]),
    knownUpstreamPrivateWarnings: Number(match[4]),
    publicDeclarations: Number(match[5]),
  }));
  publishDryRun.counts = {
    packages: packSummaries.length,
    errors: packSummaries.reduce((sum, entry) => sum + entry.errors, 0),
    unexpectedWarnings: packSummaries.reduce((sum, entry) => sum + entry.unexpectedWarnings, 0),
    knownUpstreamPrivateWarnings: packSummaries.reduce(
      (sum, entry) => sum + entry.knownUpstreamPrivateWarnings,
      0,
    ),
    publicDeclarations: packSummaries.reduce((sum, entry) => sum + entry.publicDeclarations, 0),
  };
  if (packSummaries.length < 4) {
    throw new Error(
      `publish dry-run printed ${packSummaries.length} pack summaries, expected 4 (one per package).`,
    );
  }

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
  permScans.counts = parseDenoTestSummary(logs['permission-scans']);

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
  ffiProof.counts = parseDenoTestSummary(logs['ffi-non-interactive']);

  console.log('[evidence] starting fresh-clone: git clone + bootstrap + gates at the bound SHA');
  const freshStartedAt = new Date().toISOString();
  const freshStarted = Date.now();
  const { proof: freshClone, combinedLog: freshCombined } = await runFreshClone(
    sha,
    denoExe,
    logsDir,
  );
  const freshLogPath = join(logsDir, 'fresh-clone.log');
  await Deno.writeTextFile(freshLogPath, freshCombined);
  const freshSection: SectionResult = {
    name: 'fresh-clone',
    command: ['git', 'clone', '--no-hardlinks', '<repo>', '<tmp>/repo', '+ bootstrap + gates'],
    startedAt: freshStartedAt,
    durationMs: Date.now() - freshStarted,
    exitCode: 0,
    result: 'PASS',
    counts: {
      commands: freshClone.commands.length,
      failed: freshClone.commands.filter((command) => command.exitCode !== 0).length,
    },
    logPath: freshLogPath.startsWith(repoRoot)
      ? freshLogPath.slice(repoRoot.length + 1)
      : freshLogPath,
    logSha256: await sha256Bytes(new TextEncoder().encode(freshCombined)),
  };
  sections.push(freshSection);
  logs['fresh-clone'] = freshCombined;
  console.log(
    `[evidence] PASS fresh-clone (${(freshSection.durationMs / 1000).toFixed(1)}s)`,
  );

  // Rollup: named proofs parsed from the gate logs (no re-runs).
  const packedLog = logs['gate-packed'] ?? '';
  const sourceLog = logs['gate-source'] ?? '';
  const matrixCells = packedLog.split('\n').filter((line) =>
    /chromium|firefox|webkit/i.test(line) && /pass|fail/i.test(line)
  ).slice(0, 100);
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
  // gate:packed embeds the package-artifact scan and every packed consumer;
  // its PASS plus the publish dry-run PASS is the artifact/consumer proof.
  // requiredOk is fail-closed: any repo-fixable diagnostic already failed
  // its section exit code, so result PASS never coexists with one.
  const artifactCheck = /PASS tools\/release#package-artifacts:check/.test(packedLog);
  const consumerSteps = (packedLog.match(/^PASS tools\/release#consumer:[^\n]*$/gm) ?? []).length;
  const requiredOk = ['check', 'gate-source', 'gate-packed', 'publish-npm-dry-run'].every(
    (name) => sections.find((section) => section.name === name)?.result === 'PASS',
  ) && artifactCheck && consumerSteps >= 5;
  const upstreamWarnings = publishDryRun.counts['knownUpstreamPrivateWarnings'] ?? 0;
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
    rollup: { ...rollup, artifactCheck, consumerSteps, packSummaries },
    freshClone,
    skips,
    requiredOk,
    externalPending: upstreamWarnings > 0
      ? [
        `deno-pack exact private-module warnings: ${upstreamWarnings} (structured per package, ` +
        'all public declarations native and complete; repro: .artifacts/deno-pack-repros/)',
      ]
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
    freshClone?: {
      sha: string;
      commands: Array<{ argv: string[]; exitCode: number; logPath: string; logSha256: string }>;
    };
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
  if (!evidence.freshClone) {
    failures.push('freshClone proof missing');
  } else {
    if (evidence.freshClone.sha !== sha) {
      failures.push(`freshClone sha ${evidence.freshClone.sha} != HEAD ${sha}`);
    }
    if (evidence.freshClone.commands.length < 6) {
      failures.push('freshClone commands incomplete (clone+checkout+install+check+packed+publish)');
    }
    for (const command of evidence.freshClone.commands) {
      if (command.exitCode !== 0) {
        failures.push(`freshClone step failed: ${command.argv.join(' ')}`);
      }
      const bytes = await Deno.readFile(join(repoRoot, command.logPath)).catch(() => null);
      if (!bytes) {
        failures.push(`freshClone log missing at ${command.logPath}`);
      } else if ((await sha256Bytes(bytes)) !== command.logSha256) {
        failures.push(`freshClone log hash mismatch at ${command.logPath}`);
      }
    }
  }
  const raw = JSON.stringify(evidence);
  if (raw.includes('www/') || raw.includes('www\\')) {
    failures.push('evidence references stale www/ paths');
  }
  // Log/tarball sha256 digests (64 hex) legitimately contain 40-hex runs,
  // as does the bound tree hash: strip them and the bound SHA before
  // looking for a second commit SHA.
  const scrubbed = raw.replace(/sha256:[0-9a-f]{64}/g, '').replaceAll(evidence.sha, '').replaceAll(
    evidence.tree,
    '',
  );
  if (/[0-9a-f]{40}/.test(scrubbed)) {
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
