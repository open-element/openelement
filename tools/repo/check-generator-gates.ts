/**
 * Fail closed on generator/emitter drift discipline.
 *
 * Two classes of code-producing scripts with opposite obligations, derived
 * from the canonical workspace + task graph (tools/repo/workspace-tasks.ts) —
 * no workspace list or generator list lives here:
 *
 *   generate-*.ts — committed-output generators. Must carry a real --check
 *     task (a task in the owning workspace whose command runs the same
 *     script with --check) wired into a gate as `<workspace>#<key>`, either
 *     the PR layer (gate:source) or the release train (gate:release).
 *   emit-*.ts — build-artifact emitters (www/dist only). Must NOT declare a
 *     --check task and must NOT appear in either gate; their output is
 *     verified by the build/integration gates that consume the artifact.
 *
 * Orphan detection: every generate- or emit- script physically present in a
 * workspace's script locations must be referenced by some task; an
 * unreferenced script is an unowned mechanism.
 */
import { fromFileUrl, join } from '@std/path';
import {
  discoverScriptFiles,
  emitterEntries,
  generatorEntries,
  readWorkspaces,
} from './workspace-tasks.ts';

const repoRoot = fromFileUrl(new URL('../../', import.meta.url));
const workspaces = await readWorkspaces(repoRoot);
const repoTasks = (
  JSON.parse(await Deno.readTextFile(join(repoRoot, 'tools/repo/deno.json'))) as {
    tasks?: Record<string, string>;
  }
).tasks ?? {};
/**
 * The two gate layers a check task may be wired into: `gate:source` is what
 * every pull request runs, `gate:release` is the release train (the steps
 * that were trimmed out of the PR layer). A generator check must be in one of
 * them — in NEITHER is the wiring bug this scan exists to catch, and having
 * both gates means the checklist can no longer be "is it in gate:source".
 */
const GATE_LAYERS = ['gate:source', 'gate:release'] as const;
const gateSteps = new Map<string, Set<string>>(
  GATE_LAYERS.map((layer) => [layer, new Set(repoTasks[layer]?.split(/\s+/) ?? [])]),
);
const gateOf = (step: string): string | undefined =>
  GATE_LAYERS.find((layer) => gateSteps.get(layer)!.has(step));
for (const layer of GATE_LAYERS) {
  if (gateSteps.get(layer)!.size === 0) {
    console.error(
      `generator-gates: ${layer} is missing or empty in tools/repo/deno.json — refusing to ` +
        `report on a gate list it could not read.`,
    );
    Deno.exit(1);
  }
}

const failures: string[] = [];
const rows: string[] = [];

for (const ws of workspaces) {
  const generators = generatorEntries([ws]);
  for (const entry of generators) {
    const checkTask = Object.keys(ws.tasks).find((key) =>
      ws.tasks[key].includes(entry.script) && ws.tasks[key].includes('--check')
    ) ?? '(none)';
    const inGate = checkTask === '(none)' ? undefined : gateOf(`${ws.workspace}#${checkTask}`);
    rows.push(
      `generate | ${ws.workspace} | ${entry.script} | ${checkTask} | ${inGate ?? 'NO'}`,
    );
    if (checkTask === '(none)') {
      failures.push(`${ws.workspace}/${entry.script}: no --check task wired`);
    } else if (inGate === undefined) {
      failures.push(
        `${ws.workspace}/${entry.script}: --check task ${checkTask} is in no gate ` +
          `(${GATE_LAYERS.join(', ')})`,
      );
    }
  }

  for (const entry of emitterEntries([ws])) {
    const declaresCheck = ws.tasks[entry.taskKey].includes('--check');
    const inGate = gateOf(`${ws.workspace}#${entry.taskKey}`);
    rows.push(
      `emit | ${ws.workspace} | ${entry.script} | ${declaresCheck ? 'has --check' : '(none)'} | ${
        inGate ?? 'no'
      }`,
    );
    if (declaresCheck) {
      failures.push(`${ws.workspace}/${entry.script}: artifact emitter must not declare a --check`);
    }
    if (inGate !== undefined) {
      failures.push(`${ws.workspace}/${entry.script}: artifact emitter must not be in ${inGate}`);
    }
  }
}

// Orphans: a generate- or emit- script that no task references. Task script
// paths are resolved against the workspace dir first and the repo root
// second (tools/repo tasks route through run-in with --root ../.., so their
// paths are repo-relative; www and package tasks are workspace-relative).
async function resolveScript(workspace: string, script: string): Promise<string> {
  const wsDir = workspaces.find((ws) => ws.workspace === workspace)!.dir;
  for (const candidate of [join(wsDir, script), join(repoRoot, script)]) {
    try {
      await Deno.stat(candidate);
      return candidate;
    } catch {
      // try the next base
    }
  }
  return join(wsDir, script);
}
const referenced = new Set<string>();
for (const entry of [...generatorEntries(workspaces), ...emitterEntries(workspaces)]) {
  referenced.add(await resolveScript(entry.workspace, entry.script));
}
for (const file of await discoverScriptFiles(workspaces)) {
  if (!referenced.has(file.abs)) {
    failures.push(`${file.workspace}/${file.script}: no task references this script`);
  }
}

console.log(`class | workspace | script | check task | gate (${GATE_LAYERS.join(' / ')})`);
for (const row of rows.sort()) console.log(row);

const generatorCount = rows.filter((row) => row.startsWith('generate')).length;
const emitterCount = rows.filter((row) => row.startsWith('emit')).length;
if (generatorCount === 0 || emitterCount === 0) {
  console.error(
    `generator-gates: expected both generators and emitters, found ${generatorCount} and ` +
      `${emitterCount} — refusing to vacuously pass.`,
  );
  Deno.exit(1);
}
if (failures.length > 0) {
  console.error(`generator-gates: ${failures.length} wiring problem(s):`);
  for (const failure of failures) console.error(`  ${failure}`);
  Deno.exit(1);
}
console.log(
  `generator-gates: ${generatorCount} committed generator(s) checked, ${emitterCount} artifact emitter(s) clean.`,
);
