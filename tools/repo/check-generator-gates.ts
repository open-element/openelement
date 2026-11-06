/**
 * Fail closed on generator/emitter drift discipline.
 *
 * Two classes of code-producing scripts with opposite obligations, derived
 * from the canonical workspace + task graph (tools/repo/workspace-tasks.ts) —
 * no workspace list or generator list lives here:
 *
 *   generate-*.ts — generators. Must carry a real --check task (a task in the
 *     owning workspace whose command runs the same script with --check) wired
 *     into a gate as `<package>#<key>`, either the PR layer (gate:source) or
 *     the release train (gate:release). This scan checks that wiring, not the
 *     generator's implementation.
 *   emit-*.ts — build-artifact emitters (www/dist only, which Git ignores).
 *     Must NOT declare a --check task and must NOT appear in either gate;
 *     their output is verified by the build/integration gates that consume
 *     the artifact.
 *
 * Trackedness is a property of the OUTPUT, not of the generator class. The
 * same `generate-*.ts` discipline covers tracked outputs
 * (`packages/ui/src/generated-manifest.json`, `packages/ui/custom-elements.json`)
 * and Git-ignored ones (`www/app/data/_generated-*.ts`). A green `--check` is
 * the reproducibility evidence for the inputs: it does not by itself prove the
 * output is committed, and this check does not assert either trackedness or
 * reproducibility (it never runs the generator). docs/agent-contract.md's
 * generated-file map owns the tracked/ignored fact.
 *
 * "Wired into a gate" here means the internal `pkg#task` step is present in
 * the gate's declared argv, which is the gate.ts step form (gate.ts parses it
 * and dispatches the fail-closed `--filter` argv). Whether CI invokes that
 * gate is a CI-layer fact, outside this scan.
 *
 * Gate order is reported, not rewritten. A gate that runs `generate:all`
 * before its paired --check steps compares bytes the generator just wrote:
 * for a Git-TRACKED output the ordering cannot detect a stale committed file,
 * while for a Git-ignored output the same order is harmless because
 * regeneration is its only valid content. Whether an output is tracked is not
 * derivable here — docs/agent-contract.md's generated-file map owns that fact
 * — so the scan reports every affected ordering instead of silently repairing
 * it. The gate lists are owned by the release lane; the root `release:check`
 * aggregator is scanned for the same ordering alongside gate:source and
 * gate:release, because it runs its own generate:all before delegating.
 *
 * Orphan detection: every generate- or emit- script physically present in a
 * workspace's script locations must be referenced by some task; an
 * unreferenced script is an unowned mechanism.
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, stat } from 'node:fs/promises';
import process from 'node:process';
import {
  discoverScriptFiles,
  emitterEntries,
  generatorEntries,
  readWorkspaces,
  scriptInCommand,
  type WorkspaceTasks,
} from './workspace-tasks.ts';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

/**
 * The two gate layers a check task may be wired into: `gate:source` is what
 * every pull request runs, `gate:release` is the release train (the steps
 * that were trimmed out of the PR layer). A generator check must be in one of
 * them — in NEITHER is the wiring bug this scan exists to catch, and having
 * both gates means the checklist can no longer be "is it in gate:source".
 */
export const GATE_LAYERS = ['gate:source', 'gate:release'] as const;
export type GateLayer = (typeof GATE_LAYERS)[number];

/**
 * One layer's ordered step argv, e.g. `@openelement/www#check:content`.
 * A gate command runs `node <gate-script> <step>...`: only the step argv is
 * gate wiring. Splitting the raw command would also admit `node` and the
 * script path as noise tokens, and an empty command would split to `['']`
 * and slip past the empty-gate guard.
 */
export function gateStepLists(
  tasks: Record<string, string>,
  layers: readonly string[] = GATE_LAYERS,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const layer of layers) {
    const raw = (tasks[layer] ?? '').split(/\s+/).filter((token) => token.length > 0);
    const isGate = raw[0] === 'node' && raw[1]?.endsWith('gate.ts') === true;
    out.set(layer, isGate ? raw.slice(2) : []);
  }
  return out;
}

/**
 * The gate layer whose declared step list contains `<pkg>#<task>`, or
 * undefined. This is the INTERNAL gate notation: the package half is the exact
 * package NAME (vp dispatches by name; the path form silently no-ops under vp
 * run), but the step itself is rewritten by gate.ts — it is never handed to vp
 * as a `pkg#task` invocation.
 */
export function gateMember(
  layers: ReadonlyMap<string, readonly string[]>,
  pkg: string,
  task: string,
): string | undefined {
  return [...layers.keys()].find((layer) => layers.get(layer)!.includes(`${pkg}#${task}`));
}

/**
 * The layer lists whose ORDERING is reported. The two CI gates decide wiring
 * membership (GATE_LAYERS), while the root `release:check` aggregator is
 * scanned too: it runs `generate:all` before delegating to `gate:release`, so
 * a check placed after it there is the same self-comparison the CI layers are
 * held to. It is not a third wiring layer — a generator check is still
 * required to appear in gate:source or gate:release.
 */
export function orderingGateLayers(
  repoTasks: Record<string, string>,
  rootTasks: Record<string, string>,
): Map<string, string[]> {
  const layers = gateStepLists(repoTasks);
  const releaseCheck = gateStepLists(rootTasks, ['release:check']).get('release:check')!;
  layers.set('release:check', releaseCheck);
  return layers;
}

export interface GeneratorGateReport {
  rows: string[];
  failures: string[];
  generatorCount: number;
  emitterCount: number;
  /** In-gate internal `pkg#task` steps that are generator --check tasks. */
  generatorCheckSteps: string[];
}

/** Classify every generator and emitter task against the gate layers. */
export function evaluateGeneratorGates(
  workspaces: readonly WorkspaceTasks[],
  layers: ReadonlyMap<string, readonly string[]>,
): GeneratorGateReport {
  const report: GeneratorGateReport = {
    rows: [],
    failures: [],
    generatorCount: 0,
    emitterCount: 0,
    generatorCheckSteps: [],
  };

  for (const ws of workspaces) {
    // Dispatch identity: a workspace without a package name cannot be
    // dispatched by vp, so it can never satisfy a gate wiring check either.
    const pkg = ws.name ?? `(no package name: ${ws.workspace})`;
    for (const entry of generatorEntries([ws])) {
      const checkTask =
        Object.keys(ws.tasks).find(
          (key) => ws.tasks[key]!.includes(entry.script) && ws.tasks[key]!.includes('--check'),
        ) ?? '(none)';
      const inGate = checkTask === '(none)' ? undefined : gateMember(layers, pkg, checkTask);
      report.rows.push(
        `generate | ${ws.workspace} | ${entry.script} | ${checkTask} | ${inGate ?? 'NO'}`,
      );
      report.generatorCount += 1;
      if (checkTask === '(none)') {
        report.failures.push(`${ws.workspace}/${entry.script}: no --check task wired`);
      } else if (inGate === undefined) {
        report.failures.push(
          `${ws.workspace}/${entry.script}: --check task ${checkTask} is in no gate ` +
            `(${GATE_LAYERS.join(', ')})`,
        );
      } else {
        report.generatorCheckSteps.push(`${pkg}#${checkTask}`);
      }
    }

    for (const entry of emitterEntries([ws])) {
      const declaresCheck = ws.tasks[entry.taskKey]!.includes('--check');
      const inGate = gateMember(layers, pkg, entry.taskKey);
      report.rows.push(
        `emit | ${ws.workspace} | ${entry.script} | ${declaresCheck ? 'has --check' : '(none)'} | ${
          inGate ?? 'no'
        }`,
      );
      report.emitterCount += 1;
      if (declaresCheck) {
        report.failures.push(
          `${ws.workspace}/${entry.script}: artifact emitter must not declare a --check`,
        );
      }
      if (inGate !== undefined) {
        report.failures.push(
          `${ws.workspace}/${entry.script}: artifact emitter must not be in ${inGate}`,
        );
      }
    }
  }

  return report;
}

/**
 * Gate-order observations that limit what a green --check proves. A gate that
 * runs `generate:all` before its generator --check steps regenerates the
 * output first; for a tracked output that overwrites the committed bytes
 * before the compare. This is a release-lane decision, reported rather than
 * silently repaired (the gate lists live in package.json, which this check
 * does not own).
 */
export function gateOrderingNotes(
  report: GeneratorGateReport,
  layers: ReadonlyMap<string, readonly string[]>,
): string[] {
  const notes: string[] = [];
  for (const [layer, steps] of layers) {
    const generateAll = steps.findIndex(
      (step) => step === 'generate:all' || step.endsWith('#generate:all'),
    );
    if (generateAll === -1) continue;
    const affected = report.generatorCheckSteps.filter((step) => {
      const index = steps.indexOf(step);
      return index > generateAll;
    });
    if (affected.length === 0) continue;
    notes.push(
      `gate '${layer}' runs ${steps[generateAll]} before ${affected.join(', ')}; ` +
        `for a Git-tracked output the ordering cannot detect committed drift (the check ` +
        `compares freshly regenerated bytes, not the committed file), while for a Git-ignored ` +
        `output the same order is harmless because regeneration is its only valid content ` +
        `(docs/agent-contract.md's generated-file map owns trackedness; release-lane gate order).`,
    );
  }
  return notes;
}

function resolveScript(
  workspaces: readonly WorkspaceTasks[],
  workspace: string,
  script: string,
): Promise<string> {
  const wsDir = workspaces.find((ws) => ws.workspace === workspace)!.dir;
  return (async () => {
    for (const candidate of [join(wsDir, script), join(repoRoot, script)]) {
      try {
        await stat(candidate);
        return candidate;
      } catch {
        // try the next base
      }
    }
    return join(wsDir, script);
  })();
}

/** Orphans: generate-/emit- scripts that no task references (any task). */
export async function orphanedScripts(workspaces: readonly WorkspaceTasks[]): Promise<string[]> {
  const referenced = new Set<string>();
  for (const ws of workspaces) {
    for (const command of Object.values(ws.tasks)) {
      const script = scriptInCommand(command);
      if (script) referenced.add(await resolveScript(workspaces, ws.workspace, script));
    }
  }
  const failures: string[] = [];
  for (const file of await discoverScriptFiles(workspaces)) {
    if (!referenced.has(file.abs)) {
      failures.push(`${file.workspace}/${file.script}: no task references this script`);
    }
  }
  return failures;
}

async function main(): Promise<void> {
  const workspaces = await readWorkspaces(repoRoot);
  const repoTasks =
    (
      JSON.parse(await readFile(join(repoRoot, 'tools/repo/package.json'), 'utf8')) as {
        scripts?: Record<string, string>;
      }
    ).scripts ?? {};
  const rootTasks =
    (
      JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8')) as {
        scripts?: Record<string, string>;
      }
    ).scripts ?? {};
  const layers = gateStepLists(repoTasks);
  for (const layer of GATE_LAYERS) {
    if (layers.get(layer)!.length === 0) {
      console.error(
        `generator-gates: ${layer} is missing or empty in tools/repo/package.json — refusing to ` +
          `report on a gate list it could not read.`,
      );
      process.exit(1);
    }
  }
  const orderingLayers = orderingGateLayers(repoTasks, rootTasks);
  if (orderingLayers.get('release:check')!.length === 0) {
    console.error(
      'generator-gates: release:check is missing or empty in package.json — refusing to report ' +
        'on an ordering layer it could not read.',
    );
    process.exit(1);
  }

  const report = evaluateGeneratorGates(workspaces, layers);
  report.failures.push(...(await orphanedScripts(workspaces)));

  console.log(`class | workspace | script | check task | gate (${GATE_LAYERS.join(' / ')})`);
  for (const row of report.rows.sort()) console.log(row);

  if (report.generatorCount === 0 || report.emitterCount === 0) {
    console.error(
      `generator-gates: expected both generators and emitters, found ${report.generatorCount} and ` +
        `${report.emitterCount} — refusing to vacuously pass.`,
    );
    process.exit(1);
  }
  if (report.failures.length > 0) {
    console.error(`generator-gates: ${report.failures.length} wiring problem(s):`);
    for (const failure of report.failures) console.error(`  ${failure}`);
    process.exit(1);
  }
  for (const note of gateOrderingNotes(report, orderingLayers)) {
    console.log(`generator-gates: note: ${note}`);
  }
  console.log(
    `generator-gates: ${report.generatorCount} generator(s) with a wired --check task, ` +
      `${report.emitterCount} artifact emitter(s) clean.`,
  );
}

if (import.meta.main) await main();
