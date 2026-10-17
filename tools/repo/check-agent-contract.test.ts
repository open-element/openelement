/**
 * The agent development contract's conformance tests (#1613).
 *
 * Positive: the merged contract conforms — every command it names resolves
 * against the real workspace facts, the derived blocks match package.json,
 * and the diagnostics section is anchored in the sources that implement it.
 * Negative/adversarial: a stale command, a drifted derived block, a dropped
 * anchor, or a missing published surface each fail the validator — the drift
 * guard the issue pins. The validator runs against the REAL repo tree, so
 * these tests are the standing gate: a task rename or deletion that the
 * contract names turns the tools project red.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import {
  applyDerivedBlock,
  extractCommands,
  gateCompositions,
  isCommandShape,
  MIN_COMMANDS,
  readContractFacts,
  renderGatesBlock,
  renderWorkspacesBlock,
  resolveCommand,
  validateContract,
  validateLlmsTxt,
  validateMarkdown,
} from './check-agent-contract.ts';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

test('the merged contract conforms: every command resolves and the derived blocks match the facts', async () => {
  const facts = await readContractFacts(repoRoot);
  const { failures, commandCount } = await validateContract(repoRoot, facts);
  expect(failures, failures.join('\n')).toEqual([]);
  // The conformance must be substantive: a contract the extractor cannot
  // read commands from passes vacuously, so pin the floor.
  expect(commandCount).toBeGreaterThanOrEqual(MIN_COMMANDS);
});

test('the extractor reads commands from fences and inline code, and skips prose', () => {
  const markdown = [
    '```sh',
    'vp run fmt',
    'vp run --fail-if-no-match @openelement/element#test   # canonical form',
    '```',
    'Run `vp run check` (the gate), see `packages/router/src/cli/cli.ts`',
    'and `zizmor --offline .`.',
  ].join('\n');
  expect(extractCommands(markdown)).toEqual([
    'vp run fmt',
    'vp run --fail-if-no-match @openelement/element#test',
    'vp run check',
    'zizmor --offline .',
  ]);
});

test('isCommandShape rejects prose tokens so the contract may cite code freely', () => {
  expect(isCommandShape('packages/router/src/cli/cli.ts')).toBe(false);
  expect(isCommandShape('openelement.config.ts')).toBe(false);
  expect(isCommandShape('docs/maintainers/agent-contract.md')).toBe(false);
  expect(isCommandShape('vp run fmt')).toBe(true);
  expect(isCommandShape('pnpm --dir tools/repo run version-bump <version> [--write]')).toBe(true);
});

test('drift guard: a stale vp task in the contract fails resolution by name', async () => {
  const facts = await readContractFacts(repoRoot);
  const renamed = await resolveCommand(
    'vp run --fail-if-no-match @openelement/element#test-renamed-away',
    facts,
    repoRoot,
  );
  expect(renamed).toMatch(/@openelement\/element has no task 'test-renamed-away'/);

  const deletedPackage = await resolveCommand(
    'vp run --fail-if-no-match @openelement/ghost#test',
    facts,
    repoRoot,
  );
  expect(deletedPackage).toMatch(/no workspace package named '@openelement\/ghost'/);

  const staleRoot = await resolveCommand('vp run no-such-root-script', facts, repoRoot);
  expect(staleRoot).toMatch(/no root script named 'no-such-root-script'/);
});

test('drift guard: an undocumented vp flag and a wrong --fail-if-no-match omission shape fail', async () => {
  const facts = await readContractFacts(repoRoot);
  const flag = await resolveCommand('vp run --filter @openelement/element test', facts, repoRoot);
  expect(flag).toMatch(/undocumented flag '--filter'/);
});

test('drift guard: pnpm --dir targets a real workspace script', async () => {
  const facts = await readContractFacts(repoRoot);
  expect(
    await resolveCommand('pnpm --dir tools/repo run version-bump', facts, repoRoot),
  ).toBeNull();
  const stale = await resolveCommand('pnpm --dir tools/repo run version-bump-all', facts, repoRoot);
  expect(stale).toMatch(/no script named 'version-bump-all'/);
  const missing = await resolveCommand('pnpm --dir tools/gone run build', facts, repoRoot);
  expect(missing).toMatch(/'tools\/gone' is not a workspace directory/);
});

test('drift guard: a mutated derived block fails the byte compare, a stale command fails resolution', async () => {
  const facts = await readContractFacts(repoRoot);
  const markdown = await readFile(join(repoRoot, 'docs/maintainers/agent-contract.md'), 'utf8');

  // The checked-in derived blocks are current (byte-identical to the facts).
  const current = applyDerivedBlock(
    applyDerivedBlock(markdown, 'workspaces', renderWorkspacesBlock(facts)),
    'gates',
    renderGatesBlock(facts),
  );
  expect(current).toBe(markdown);

  // Adversarial: a gate composition edit that did not reach the contract.
  // Corrupt INSIDE the derived:gates block the way a stale doc would read
  // after the root `check` script gains a step.
  const corrupted = markdown.replace(
    '| `vp run check` | `fmt:check` →',
    '| `vp run check` | `fmt:check` → `lint:old` →',
  );
  expect(corrupted).not.toBe(markdown);
  const drifted = await validateMarkdown(corrupted, facts, repoRoot);
  expect(drifted.failures.join('\n')).toMatch(
    /the derived:gates block drifted from package\.json facts/,
  );

  // Adversarial: a renamed task the contract still names.
  const stale = await validateMarkdown(
    markdown.replace(
      'vp run --fail-if-no-match @openelement/compiler#test',
      'vp run --fail-if-no-match @openelement/compiler#test:all',
    ),
    facts,
    repoRoot,
  );
  expect(stale.failures.join('\n')).toMatch(/@openelement\/compiler has no task 'test:all'/);
});

test('gate compositions derive from the root gate.ts scripts only', () => {
  const compositions = gateCompositions({
    check: 'node tools/repo/gate.ts fmt:check lint',
    'not-a-gate': 'vitest run --project tools',
    empty: 'node tools/repo/gate.ts',
  });
  expect(compositions).toEqual([{ script: 'check', steps: ['fmt:check', 'lint'] }]);
});

test('the published llms.txt fails closed when a repository link rots', async () => {
  const contract = await readFile(join(repoRoot, 'docs/maintainers/agent-contract.md'), 'utf8');
  const clean = await validateLlmsTxt(repoRoot, contract);
  expect(clean, clean.join('\n')).toEqual([]);

  const stale = await validateLlmsTxt(repoRoot, 'no llms mention');
  expect(stale.join('\n')).toMatch(/llms\.txt and the contract must reference each other/);
});

test('node script resolution checks the file system', async () => {
  const facts = await readContractFacts(repoRoot);
  expect(
    await resolveCommand('node tools/repo/check-agent-contract.ts', facts, repoRoot),
  ).toBeNull();
  const stale = await resolveCommand('node tools/repo/gone-script.ts', facts, repoRoot);
  expect(stale).toMatch(/no such script 'tools\/repo\/gone-script\.ts'/);
});
