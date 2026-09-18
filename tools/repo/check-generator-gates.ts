/**
 * Fail closed on generator/emitter drift discipline.
 *
 * The repository has two classes of code-producing scripts, and they have
 * opposite obligations. Everything is derived from the filesystem and each
 * workspace's task graph — the only fixed input is the workspace list (repo
 * structure, not a generator list):
 *
 *   generate-*.ts — committed-output generators. Must carry a real --check
 *     task (a task in the owning workspace whose command runs the script
 *     with --check) and that task must be wired into gate:source as
 *     `<workspace>#<task>`. No vacuous checks.
 *   emit-*.ts — build-artifact emitters (www/dist only). Must NOT pretend a
 *     drift check exists and must NOT appear in gate:source; their output is
 *     verified by the build/integration tests that consume the artifact.
 *
 * Any failure prints class / script / check task / gate-wiring rows and
 * exits non-zero. Zero scripts of either class is an error, never a vacuous
 * pass.
 */
import { fromFileUrl, join } from '@std/path';

const repoRoot = fromFileUrl(new URL('../../', import.meta.url));
/** Workspaces with generator/emitter scripts and their script locations. */
const WORKSPACES = [
  { workspace: 'tools/repo', scriptsDir: 'tools/repo' },
  { workspace: 'packages/ui', scriptsDir: 'packages/ui/tools' },
] as const;

const gateSteps = new Set(
  (JSON.parse(await Deno.readTextFile(join(repoRoot, 'tools/repo/deno.json'))) as {
    tasks?: Record<string, string>;
  }).tasks?.['gate:source']?.split(/\s+/) ?? [],
);

interface Row {
  kind: 'generate' | 'emit';
  workspace: string;
  script: string;
  checkTask: string;
  inGate: boolean;
}

const rows: Row[] = [];
const failures: string[] = [];

for (const { workspace, scriptsDir } of WORKSPACES) {
  const tasks = (JSON.parse(await Deno.readTextFile(join(repoRoot, workspace, 'deno.json'))) as {
    tasks?: Record<string, string>;
  }).tasks ?? {};

  const generators: string[] = [];
  const emitters: string[] = [];
  for await (const entry of Deno.readDir(join(repoRoot, scriptsDir))) {
    if (!entry.isFile) continue;
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;
    if (entry.name === 'generate-all.ts') continue;
    if (entry.name.startsWith('generate-')) generators.push(entry.name);
    else if (entry.name.startsWith('emit-')) emitters.push(entry.name);
  }
  generators.sort();
  emitters.sort();

  for (const script of generators) {
    const checkTask = Object.keys(tasks).find((key) =>
      tasks[key].includes(script) && tasks[key].includes('--check')
    ) ?? '(none)';
    const inGate = gateSteps.has(`${workspace}#${checkTask}`);
    rows.push({ kind: 'generate', workspace, script, checkTask, inGate });
    if (checkTask === '(none)') {
      failures.push(`${workspace}/${script}: no --check task wired`);
    } else if (!inGate) {
      failures.push(`${workspace}/${script}: --check task ${checkTask} not in gate:source`);
    }
  }

  for (const script of emitters) {
    const checkTask = Object.keys(tasks).find((key) =>
      tasks[key].includes(script) && tasks[key].includes('--check')
    );
    const inGateTask = Object.entries(tasks).find(([, command]) => command.includes(script));
    const inGate = inGateTask !== undefined && gateSteps.has(`${workspace}#${inGateTask[0]}`);
    rows.push({
      kind: 'emit',
      workspace,
      script,
      checkTask: checkTask ?? '(none)',
      inGate,
    });
    if (checkTask) {
      failures.push(`${workspace}/${script}: artifact emitter must not declare a --check task`);
    }
    if (inGate) {
      failures.push(`${workspace}/${script}: artifact emitter must not be wired into gate:source`);
    }
  }
}

console.log('class | workspace | script | check task | in gate:source');
for (const row of rows) {
  console.log(
    `${row.kind} | ${row.workspace} | ${row.script} | ${row.checkTask} | ${
      row.inGate ? 'yes' : 'no'
    }`,
  );
}
const generatorCount = rows.filter((row) => row.kind === 'generate').length;
const emitterCount = rows.filter((row) => row.kind === 'emit').length;
if (generatorCount === 0 || emitterCount === 0) {
  console.error(
    `generator-gates: expected both generate-*.ts and emit-*.ts scripts, found ` +
      `${generatorCount} and ${emitterCount} — refusing to vacuously pass.`,
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
