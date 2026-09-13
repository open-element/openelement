/**
 * Bind Alpha admission evidence to one explicit Git commit. This script is
 * deliberately strict: a caller must supply CANDIDATE_SHA (or --expected-sha)
 * and tracked changes reject the run before any artifacts are trusted.
 */

import { readPackages } from './lib/package-graph.ts';
import { tarballPath } from './lib/npm-tarball.ts';

interface CommandResult {
  ok: boolean;
  output: string;
}

async function command(command: string, args: string[]): Promise<CommandResult> {
  const result = await new Deno.Command(command, {
    args,
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  return {
    ok: result.success,
    output: new TextDecoder().decode(result.stdout).trim() +
      new TextDecoder().decode(result.stderr).trim(),
  };
}

async function required(commandName: string, args: string[]): Promise<string> {
  const result = await command(commandName, args);
  if (!result.ok) throw new Error(`${commandName} ${args.join(' ')} failed: ${result.output}`);
  return result.output;
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

async function sha256(path: string): Promise<string> {
  const bytes = await Deno.readFile(path);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return 'sha256:' +
    Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
}

async function assertTarballsFresh(
  packages: Awaited<ReturnType<typeof readPackages>>,
  packStartedAt: number,
): Promise<void> {
  for (const pkg of packages) {
    const path = tarballPath(pkg);
    const stat = await Deno.stat(path).catch(() => null);
    if (!stat?.mtime || stat.mtime.getTime() < packStartedAt) {
      throw new Error(
        `Candidate pack left a stale tarball for ${pkg.name}: ${path}. ` +
          'Every candidate archive must be regenerated after the candidate gate starts.',
      );
    }
  }
}

async function assertTrackedClean(): Promise<void> {
  for (const args of [['diff', '--quiet'], ['diff', '--cached', '--quiet']]) {
    const result = await command('git', args);
    if (!result.ok) {
      throw new Error(
        `Candidate requires a tracked-clean worktree (${args.join(' ')} failed). ` +
          'Untracked local migration residues are not candidate inputs.',
      );
    }
  }
}

async function main(): Promise<void> {
  const expected = expectedSha();
  const sha = await required('git', ['rev-parse', 'HEAD']);
  if (sha !== expected) {
    throw new Error(`Candidate SHA mismatch: expected ${expected}, checked out ${sha}.`);
  }
  await assertTrackedClean();

  const packStartedAt = Date.now();
  const packed = await command(Deno.execPath(), ['task', 'pack:dry-run']);
  if (!packed.ok) throw new Error(`pack:dry-run failed:\n${packed.output}`);

  const packages = await readPackages();
  await assertTarballsFresh(packages, packStartedAt);
  const tarballs: Record<string, string> = {};
  for (const pkg of packages) tarballs[pkg.name] = await sha256(tarballPath(pkg));

  const [node, npm] = await Promise.all([
    required('node', ['--version']),
    required('npm', ['--version']),
  ]);
  const evidence = {
    sha,
    tree: await required('git', ['rev-parse', 'HEAD^{tree}']),
    trackedClean: true,
    toolVersions: { deno: Deno.version.deno, node, npm },
    tarballs,
    sections: [{ name: 'pack:dry-run', result: 'PASS' }],
    packStartedAt: new Date(packStartedAt).toISOString(),
    result: 'PASS',
  };
  const output = Deno.env.get('CANDIDATE_EVIDENCE_OUTPUT') ?? '.artifacts/candidate-evidence.json';
  await Deno.mkdir(output.slice(0, Math.max(output.lastIndexOf('/'), 0)) || '.', {
    recursive: true,
  });
  await Deno.writeTextFile(output, JSON.stringify(evidence, null, 2) + '\n');
  console.log(`Candidate evidence PASS: ${output}`);
}

if (import.meta.main) await main();
