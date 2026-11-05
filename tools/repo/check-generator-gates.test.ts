/**
 * check-generator-gates.test.ts — the consumer-form test for the generator /
 * emitter wiring scan.
 *
 * The scan's green state on today's tree is not enough: it must fail on the
 * exact regressions a review would reintroduce (a generator without a --check
 * task, a --check task outside both gates, an emitter that grows a --check or
 * enters a gate), and it must keep the INTERNAL `pkg#task` gate notation
 * distinct from a directly executable vp selector. The pure evaluation layer
 * is imported here; the CLI wrapper stays a thin dispatcher.
 */
import { expect, test } from 'vitest';
import {
  evaluateGeneratorGates,
  gateMember,
  gateOrderingNotes,
  gateStepLists,
  orderingGateLayers,
  type GeneratorGateReport,
} from './check-generator-gates.ts';
import type { WorkspaceTasks } from './workspace-tasks.ts';

function workspace(
  workspacePath: string,
  name: string,
  tasks: Record<string, string>,
): WorkspaceTasks {
  return { workspace: workspacePath, name, dir: `/fixture/${workspacePath}`, tasks };
}

test('gate steps use the internal pkg#task notation, resolved by exact package name', () => {
  const layers = new Map([
    ['gate:source', ['check:dep-age', '@openelement/www#check:content']],
    ['gate:release', ['@openelement/ui#ui-cem:check']],
  ]);
  // The package NAME selects, exactly as gate.ts parses it.
  expect(gateMember(layers, '@openelement/www', 'check:content')).toEqual('gate:source');
  expect(gateMember(layers, '@openelement/ui', 'ui-cem:check')).toEqual('gate:release');
  // The path-shaped selector is not the internal gate form either.
  expect(gateMember(layers, 'www', 'check:content')).toBeUndefined();
  expect(gateMember(layers, '@openelement/www', 'check:absent')).toBeUndefined();
  // A bare step is a root script, not a package task.
  expect(gateMember(layers, '@openelement/tools-repo', 'check:dep-age')).toBeUndefined();
});

test('generator/emitter classification is green only when both rules hold', () => {
  const workspaces = [
    workspace('www', '@openelement/www', {
      'generate:content': 'node tools/generate-content.ts',
      'check:content': 'node tools/generate-content.ts --check',
      'emit:rss': 'node tools/emit-rss.ts',
    }),
    workspace('packages/ui', '@openelement/ui', {
      'generate:ui-manifest': 'node tools/generate-ui-manifest.ts',
      'ui-manifest:check': 'node tools/generate-ui-manifest.ts --check',
    }),
  ];
  const layers = new Map([
    ['gate:source', ['@openelement/www#check:content']],
    ['gate:release', ['@openelement/ui#ui-manifest:check']],
  ]);

  const report = evaluateGeneratorGates(workspaces, layers);
  expect(report.failures).toEqual([]);
  expect(report.generatorCount).toEqual(2);
  expect(report.emitterCount).toEqual(1);
  expect(report.generatorCheckSteps.sort()).toEqual([
    '@openelement/ui#ui-manifest:check',
    '@openelement/www#check:content',
  ]);
  expect(report.rows).toContain(
    'generate | www | tools/generate-content.ts | check:content | gate:source',
  );
  expect(report.rows).toContain('emit | www | tools/emit-rss.ts | (none) | no');
});

test('each regression direction reports its own naming failure', () => {
  const workspaces = [
    workspace('www', '@openelement/www', {
      'generate:orphan': 'node tools/generate-orphan.ts',
      'generate:stale': 'node tools/generate-stale.ts',
      'check:stale': 'node tools/generate-stale.ts --check',
      'emit:bad': 'node tools/emit-bad.ts --check',
    }),
  ];
  const layers = new Map([
    ['gate:source', []],
    ['gate:release', ['@openelement/www#emit:bad']],
  ]);

  const report = evaluateGeneratorGates(workspaces, layers);
  expect(report.generatorCount).toEqual(2);
  expect(report.emitterCount).toEqual(1);
  expect(report.failures).toEqual([
    'www/tools/generate-orphan.ts: no --check task wired',
    'www/tools/generate-stale.ts: --check task check:stale is in no gate (gate:source, gate:release)',
    'www/tools/emit-bad.ts: artifact emitter must not declare a --check',
    'www/tools/emit-bad.ts: artifact emitter must not be in gate:release',
  ]);
});

test('gateStepLists reads only the step argv of a gate.ts composition', () => {
  const layers = gateStepLists(
    {
      check: 'node tools/repo/gate.ts fmt:check lint @openelement/www#check:content',
      'gate:source': 'node ../../tools/repo/gate.ts @openelement/tools-repo#typecheck',
      build: 'tsc --noEmit',
    },
    ['check', 'gate:source', 'build'],
  );
  expect(layers.get('check')).toEqual(['fmt:check', 'lint', '@openelement/www#check:content']);
  expect(layers.get('gate:source')).toEqual(['@openelement/tools-repo#typecheck']);
  expect(layers.get('build')).toEqual([]);
});

test('gate ordering also scans the root release:check aggregator', () => {
  const repoTasks = {
    'gate:source': 'node tools/repo/gate.ts check:dep-age',
    'gate:release': 'node tools/repo/gate.ts @openelement/ui#ui-manifest:check',
  };
  const rootTasks = {
    'release:check':
      'node tools/repo/gate.ts @openelement/tools-repo#generate:all @openelement/ui#ui-manifest:check',
  };
  const layers = orderingGateLayers(repoTasks, rootTasks);
  expect([...layers.keys()]).toEqual(['gate:source', 'gate:release', 'release:check']);
  expect(layers.get('release:check')).toEqual([
    '@openelement/tools-repo#generate:all',
    '@openelement/ui#ui-manifest:check',
  ]);
  const report: GeneratorGateReport = {
    rows: [],
    failures: [],
    generatorCount: 1,
    emitterCount: 1,
    generatorCheckSteps: ['@openelement/ui#ui-manifest:check'],
  };
  const notes = gateOrderingNotes(report, layers);
  expect(notes).toHaveLength(1);
  expect(notes[0]).toMatch(
    /gate 'release:check' runs @openelement\/tools-repo#generate:all before/,
  );
});

test('gate ordering is reported when generate:all precedes the paired checks', () => {
  const report: GeneratorGateReport = {
    rows: [],
    failures: [],
    generatorCount: 1,
    emitterCount: 1,
    generatorCheckSteps: ['@openelement/ui#ui-manifest:check'],
  };
  const releaseWithGenerate = new Map([
    ['gate:release', ['@openelement/tools-repo#generate:all', '@openelement/ui#ui-manifest:check']],
  ]);
  const notes = gateOrderingNotes(report, releaseWithGenerate);
  expect(notes).toHaveLength(1);
  expect(notes[0]).toMatch(/runs @openelement\/tools-repo#generate:all before/);
  // The note is precise per output class: tracked output ⇒ the ordering cannot
  // detect committed drift; ignored output ⇒ same order is harmless because
  // regeneration is its only valid content. This scan does not own
  // trackedness, so it names the limitation without asserting the class.
  expect(notes[0]).toMatch(/for a Git-tracked output the ordering cannot detect committed drift/);
  expect(notes[0]).toMatch(/for a Git-ignored output the same order is harmless/);
  expect(notes[0]).toMatch(/generated-file map/);

  const releaseWithCheckFirst = new Map([
    ['gate:release', ['@openelement/ui#ui-manifest:check', '@openelement/tools-repo#generate:all']],
  ]);
  expect(gateOrderingNotes(report, releaseWithCheckFirst)).toEqual([]);
  // A gate with no generate:all step has no ordering note either.
  expect(
    gateOrderingNotes(report, new Map([['gate:source', ['@openelement/ui#ui-manifest:check']]])),
  ).toEqual([]);
});

test('the real gate:release compares the tracked UI outputs before generate:all rewrites them', async () => {
  // The two TRACKED generated outputs (docs/agent-contract.md's map) are the
  // ones whose committed bytes a later generate:all would overwrite. Pin the
  // real ordering the release lane chose, so a future edit cannot silently
  // regress the check to a self-comparison. This reads the real manifest on
  // purpose: the unit matrix above cannot see the shipped gate list.
  const { readFile } = await import('node:fs/promises');
  const manifest = JSON.parse(
    await readFile(new URL('./package.json', import.meta.url), 'utf8'),
  ) as { scripts: Record<string, string> };
  const steps = gateStepLists(manifest.scripts).get('gate:release')!;
  const generateAll = steps.indexOf('@openelement/tools-repo#generate:all');
  expect(generateAll, 'gate:release must run generate:all').toBeGreaterThanOrEqual(0);
  for (const tracked of ['@openelement/ui#ui-manifest:check', '@openelement/ui#ui-cem:check']) {
    const index = steps.indexOf(tracked);
    expect(index, `${tracked} must be wired into gate:release`).toBeGreaterThanOrEqual(0);
    expect(index, `${tracked} must run before generate:all`).toBeLessThan(generateAll);
  }
  // The Git-ignored www checks may follow generate:all: regeneration is their
  // only valid content, so a self-compare is the correct proof there.
  expect(steps.indexOf('@openelement/www#check:content-data')).toBeGreaterThan(generateAll);
});

test('the real root release:check compares the tracked UI outputs before generate:all', async () => {
  // `release:check` runs its own generate:all before delegating to
  // `gate:release`. Without leading tracked checks, the nested `gate:release`
  // checks would compare regenerated bytes — the same self-comparison the
  // root gate must not have. This reads the real root manifest on purpose.
  const { readFile } = await import('node:fs/promises');
  const manifest = JSON.parse(
    await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { scripts: Record<string, string> };
  const layers = gateStepLists(manifest.scripts, ['release:check']);
  const steps = layers.get('release:check')!;
  const generateAll = steps.indexOf('@openelement/tools-repo#generate:all');
  expect(generateAll, 'release:check must run generate:all').toBeGreaterThanOrEqual(0);
  const tracked = ['@openelement/ui#ui-manifest:check', '@openelement/ui#ui-cem:check'];
  for (const trackedStep of tracked) {
    const index = steps.indexOf(trackedStep);
    expect(index, `${trackedStep} must be wired into release:check`).toBeGreaterThanOrEqual(0);
    expect(index, `${trackedStep} must run before generate:all`).toBeLessThan(generateAll);
    // Each check is listed once: the root gate must not duplicate the work.
    expect(steps.filter((step) => step === trackedStep)).toHaveLength(1);
  }

  const report: GeneratorGateReport = {
    rows: [],
    failures: [],
    generatorCount: 1,
    emitterCount: 1,
    generatorCheckSteps: tracked,
  };
  // The shipped root order must produce no ordering note.
  expect(gateOrderingNotes(report, layers)).toEqual([]);
  // Negative control: putting the REAL generate:all step in front of the REAL
  // check steps must be reported, so this pin is able to fail.
  const reversed = new Map([
    ['release:check', [steps[generateAll]!, ...steps.filter((_, index) => index !== generateAll)]],
  ]);
  const notes = gateOrderingNotes(report, reversed);
  expect(notes).toHaveLength(1);
  expect(notes[0]).toMatch(/gate 'release:check' runs/);
  expect(notes[0]).toMatch(/before @openelement\/ui#ui-manifest:check/);
});
