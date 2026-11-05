/**
 * The agent development contract's conformance tests (#1613).
 *
 * Positive: the merged contract conforms — every command it names resolves
 * against the real workspace facts, every internal gate step names a real
 * package + task, the derived blocks match package.json, and the diagnostics
 * section is anchored in the sources that implement it.
 * Negative/adversarial: a stale command, a nonexistent package/task, a
 * specifier-form selector, a drifted derived block, a dropped anchor, or a
 * missing published surface each fail the validator — the drift guard the
 * issue pins. The validator runs against the REAL repo tree, so these tests
 * are the standing gate: a task rename or deletion that the contract names
 * turns the tools project red.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import {
  allGateCompositions,
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
  validateGateSteps,
  validateLlmsTxt,
  validateMarkdown,
} from './check-agent-contract.ts';
import { scanFileText, type ScanReport, type SelectorFacts } from './check-vp-selector-flags.ts';

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
    'vp run --no-cache --fail-if-no-match --filter @openelement/element test   # canonical form',
    '```',
    'Run `vp run check` (the gate), see `packages/router/src/cli/cli.ts`',
    'and `zizmor --offline .`.',
  ].join('\n');
  expect(extractCommands(markdown)).toEqual([
    'vp run fmt',
    'vp run --no-cache --fail-if-no-match --filter @openelement/element test',
    'vp run check',
    'zizmor --offline .',
  ]);
});

test('isCommandShape rejects prose tokens so the contract may cite code freely', () => {
  expect(isCommandShape('packages/router/src/cli/cli.ts')).toBe(false);
  expect(isCommandShape('openelement.config.ts')).toBe(false);
  expect(isCommandShape('docs/agent-contract.md')).toBe(false);
  // gate.ts's internal step notation is data, not a vp invocation.
  expect(isCommandShape('@openelement/www#build')).toBe(false);
  expect(isCommandShape('vp run fmt')).toBe(true);
  expect(isCommandShape('pnpm --dir tools/repo run version-bump <version> [--write]')).toBe(true);
});

test('drift guard: a stale vp package or task in the contract fails resolution by name', async () => {
  const facts = await readContractFacts(repoRoot);
  const canonical = 'vp run --no-cache --fail-if-no-match --filter';

  const renamed = await resolveCommand(
    `${canonical} @openelement/element test-renamed-away`,
    facts,
    repoRoot,
  );
  expect(renamed).toMatch(/@openelement\/element has no task 'test-renamed-away'/);

  const deletedPackage = await resolveCommand(
    `${canonical} @openelement/ghost test`,
    facts,
    repoRoot,
  );
  expect(deletedPackage).toMatch(/no workspace package named '@openelement\/ghost'/);

  const staleRoot = await resolveCommand('vp run no-such-root-script', facts, repoRoot);
  expect(staleRoot).toMatch(/no root script named 'no-such-root-script'/);
});

test('drift guard: the executable form needs --no-cache, --fail-if-no-match and a real filter', async () => {
  const facts = await readContractFacts(repoRoot);
  const missingNoCache = await resolveCommand(
    'vp run --fail-if-no-match --filter @openelement/element test',
    facts,
    repoRoot,
  );
  expect(missingNoCache).toMatch(/must carry --no-cache/);

  const missingFlag = await resolveCommand(
    'vp run --no-cache --filter @openelement/element test',
    facts,
    repoRoot,
  );
  expect(missingFlag).toMatch(/must carry --fail-if-no-match/);

  const unknownFlag = await resolveCommand(
    'vp run --no-cache --fail-if-no-match --filter @openelement/element test --bogus',
    facts,
    repoRoot,
  );
  expect(unknownFlag).toMatch(/undocumented flag '--bogus'/);

  // The pkg#task specifier is never the executable form, even with the flag:
  // the flag is inert on it (the shared parser keeps this in step with the
  // repository-wide selector scan).
  const specifier = await resolveCommand(
    'vp run --no-cache --fail-if-no-match @openelement/element#test',
    facts,
    repoRoot,
  );
  expect(specifier).toMatch(/internal pkg#task specifier form/);
  expect(specifier).toMatch(/--filter <pkg> <task>/);
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
  const markdown = await readFile(join(repoRoot, 'docs/agent-contract.md'), 'utf8');

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
      'vp run --no-cache --fail-if-no-match --filter @openelement/compiler test',
      'vp run --no-cache --fail-if-no-match --filter @openelement/compiler test:all',
    ),
    facts,
    repoRoot,
  );
  expect(stale.failures.join('\n')).toMatch(/@openelement\/compiler has no task 'test:all'/);

  // Adversarial: the contract falls back to the inert specifier form.
  const specifier = await validateMarkdown(
    markdown.replace(
      'vp run --no-cache --fail-if-no-match --filter @openelement/compiler test',
      'vp run --no-cache --fail-if-no-match @openelement/compiler#test',
    ),
    facts,
    repoRoot,
  );
  expect(specifier.failures.join('\n')).toMatch(/internal pkg#task specifier form/);
});

test('gate compositions derive from the root gate.ts scripts only', () => {
  const compositions = gateCompositions({
    check: 'node tools/repo/gate.ts fmt:check lint',
    'not-a-gate': 'vitest run --project tools',
    empty: 'node tools/repo/gate.ts',
  });
  expect(compositions).toEqual([{ script: 'check', steps: ['fmt:check', 'lint'] }]);
});

test('internal gate steps are legal only as gate.ts wiring, and must resolve', async () => {
  const facts = await readContractFacts(repoRoot);
  // The live task graph: every root and workspace gate step names a real root
  // script or package + task. The internal `pkg#task` form is legal here.
  expect(validateGateSteps(facts), validateGateSteps(facts).join('\n')).toEqual([]);
  const nested = allGateCompositions(facts).find(
    (gate) => gate.owner === 'tools/repo' && gate.script === 'gate:release',
  );
  expect(nested).toBeDefined();
  expect(nested!.steps).toContain('@openelement/tools-repo#generator-gates:check');

  const ghost = {
    ...facts,
    rootScripts: {
      ...facts.rootScripts,
      check: 'node tools/repo/gate.ts fmt:check @openelement/ghost#lint',
    },
  };
  expect(validateGateSteps(ghost).join('\n')).toMatch(
    /names no workspace package '@openelement\/ghost'/,
  );

  const staleTask = {
    ...facts,
    rootScripts: {
      ...facts.rootScripts,
      check: 'node tools/repo/gate.ts @openelement/www#check:absent',
    },
  };
  expect(validateGateSteps(staleTask).join('\n')).toMatch(
    /names no task 'check:absent' in @openelement\/www/,
  );

  const pathSelector = {
    ...facts,
    rootScripts: {
      ...facts.rootScripts,
      check: 'node tools/repo/gate.ts tools/repo#typecheck',
    },
  };
  expect(validateGateSteps(pathSelector).join('\n')).toMatch(/path selector/);
});

test('the contract resolver and the selector scan agree on the executable form', async () => {
  const facts = await readContractFacts(repoRoot);
  const selectorFacts: SelectorFacts = {
    packages: new Map(
      facts.workspaces
        .filter((ws) => ws.name !== undefined)
        .map((ws) => [ws.name!, new Set(Object.keys(ws.tasks))]),
    ),
  };
  const emptyReport = (): ScanReport => ({
    violations: [],
    protectedCount: 0,
    exemptions: [],
    qualifiedCount: 0,
    filesScanned: 0,
  });
  const scan = (command: string): ScanReport => {
    const report = emptyReport();
    scanFileText('fixture.sh', command, selectorFacts, report);
    return report;
  };

  // One canonical form, accepted by both checks.
  const canonical = 'vp run --no-cache --fail-if-no-match --filter @openelement/element test';
  expect(await resolveCommand(canonical, facts, repoRoot)).toBeNull();
  const green = scan(canonical);
  expect(green.violations).toEqual([]);
  expect(green.qualifiedCount).toEqual(1);
  expect(green.protectedCount).toEqual(1);

  // One invalid specifier form, rejected by both.
  const specifier = 'vp run --no-cache --fail-if-no-match @openelement/element#test';
  expect(await resolveCommand(specifier, facts, repoRoot)).toMatch(/specifier form/);
  expect(scan(specifier).violations.map((violation) => violation.kind)).toEqual(['specifier-form']);

  // Shape-only placeholders remain documents, not runnable claims.
  expect(
    await resolveCommand(
      'vp run --no-cache --fail-if-no-match --filter <pkg> <task>',
      facts,
      repoRoot,
    ),
  ).toBeNull();
  expect(await resolveCommand('vp run <task>', facts, repoRoot)).toBeNull();
});

test('the published llms.txt fails closed when a repository link rots', async () => {
  const contract = await readFile(join(repoRoot, 'docs/agent-contract.md'), 'utf8');
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
