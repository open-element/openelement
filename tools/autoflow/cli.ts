import {
  AUTOFLOW_POLICY_VERSION,
  type AutoFlowTier,
  type GateDefinition,
  selectGates,
} from './policy.ts';
import { runWithOutput } from '../lib/process.ts';

type GitOutput = (args: string[]) => Promise<string | undefined>;

async function gitOutput(args: string[]): Promise<string | undefined> {
  const output = await runWithOutput('git', args);
  return output.code === 0 ? output.stdout : undefined;
}

export function addPaths(paths: Set<string>, output: string | undefined): void {
  for (const path of output?.split(/\r?\n/) ?? []) if (path) paths.add(path);
}

export async function gitChangedPaths(
  tier: AutoFlowTier,
  output: GitOutput = gitOutput,
): Promise<string[]> {
  const paths = new Set<string>();

  if (tier === 'dev') {
    for (
      const args of [
        ['diff', '--cached', '--name-only'],
        ['diff', '--name-only'],
        ['ls-files', '--others', '--exclude-standard'],
      ]
    ) addPaths(paths, await output(args));
    return [...paths].sort();
  }

  if (tier === 'ci') {
    const parentDiff = await output(['diff', '--name-only', 'HEAD^', 'HEAD']);
    if (parentDiff !== undefined) {
      addPaths(paths, parentDiff);
      return [...paths].sort();
    }
    const treeDiff = await output([
      'diff-tree',
      '--root',
      '--no-commit-id',
      '--name-only',
      '-r',
      'HEAD',
    ]);
    if (treeDiff === undefined) throw new Error('Unable to determine changed paths for ci tier');
    addPaths(paths, treeDiff);
    return [...paths].sort();
  }

  for (
    const args of [
      ['diff', '--name-only', '@{u}...HEAD'],
      ['diff', '--cached', '--name-only'],
      ['diff', '--name-only'],
      ['ls-files', '--others', '--exclude-standard'],
    ]
  ) addPaths(paths, await output(args));
  return [...paths].sort();
}

async function runGate(gate: GateDefinition, dryRun: boolean): Promise<boolean> {
  if (dryRun) {
    console.log(`DRY ${gate.name}: ${gate.command.join(' ')}`);
    return true;
  }
  const output = await runWithOutput(gate.command[0], gate.command.slice(1));
  if (output.code === 0) {
    console.log(`PASS ${gate.name}`);
    return true;
  }
  console.error(`FAIL ${gate.name}`);
  console.error(`${output.stdout}${output.stderr}`.trim());
  return false;
}

export async function main(args: string[]): Promise<void> {
  const command = args[0] ?? 'dev';
  if (!['dev', 'push', 'ci', 'release'].includes(command)) {
    throw new Error('Usage: autoflow <dev|push|ci|release> [--dry-run]');
  }
  const tier = command as AutoFlowTier;
  const changedPaths = await gitChangedPaths(tier);
  const gates = selectGates(tier, changedPaths);
  console.log(`AutoFlow ${tier} (${AUTOFLOW_POLICY_VERSION}): ${gates.length} gates`);

  const failed: string[] = [];
  for (const gate of gates) {
    if (!await runGate(gate, args.includes('--dry-run'))) failed.push(gate.name);
  }
  if (failed.length) throw new Error(`AutoFlow ${tier} failed: ${failed.join(', ')}`);
}

if (import.meta.main) await main(Deno.args);
