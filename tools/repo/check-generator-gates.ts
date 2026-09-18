/**
 * Fail closed when a generator ships without a wired drift check.
 *
 * Derives everything from the filesystem and the task graph — no list:
 *   1. every tools/repo/generate-*.ts (except *.test.ts and generate-all.ts
 *      itself — the enumerator cannot enumerate itself) is a generator;
 *   2. a generator passes only with a task whose command runs the same
 *      script with --check;
 *   3. that --check task must appear in gate:source.
 * Any failure prints script / missing check task / gate-wiring columns and
 * exits non-zero. Zero generators is an error, never a vacuous pass.
 */
import { fromFileUrl, join } from '@std/path';

const toolsDir = fromFileUrl(new URL('.', import.meta.url));
const denoJson = JSON.parse(await Deno.readTextFile(join(toolsDir, 'deno.json'))) as {
  tasks?: Record<string, string>;
};
const tasks = denoJson.tasks ?? {};

const scripts: string[] = [];
for await (const entry of Deno.readDir(toolsDir)) {
  if (!entry.isFile) continue;
  if (!entry.name.startsWith('generate-')) continue;
  if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;
  if (entry.name === 'generate-all.ts') continue;
  scripts.push(entry.name);
}
scripts.sort();

if (scripts.length === 0) {
  console.error('generator-gates: no generate-*.ts scripts found — refusing to vacuously pass.');
  Deno.exit(1);
}

const gate = tasks['gate:source'] ?? '';
const gateSteps = new Set(gate.split(/\s+/));
const rows: Array<{ script: string; checkTask: string; inGate: string }> = [];
for (const script of scripts) {
  const checkTask = Object.keys(tasks).find((key) =>
    tasks[key].includes(script) && tasks[key].includes('--check')
  ) ?? '(none)';
  // gate:source references tools/repo tasks as tools/repo#<key>.
  const inGate = checkTask !== '(none)' && gateSteps.has(`tools/repo#${checkTask}`) ? 'yes' : 'NO';
  rows.push({ script, checkTask, inGate });
}

const bad = rows.filter((row) => row.checkTask === '(none)' || row.inGate === 'NO');
console.log('script | check task | in gate:source');
for (const row of rows) console.log(`${row.script} | ${row.checkTask} | ${row.inGate}`);
if (bad.length > 0) {
  console.error(
    `generator-gates: ${bad.length} generator(s) without a wired drift check:\n` +
      bad.map((row) => `  ${row.script} (check: ${row.checkTask}, gate: ${row.inGate})`).join('\n'),
  );
  Deno.exit(1);
}
console.log(`generator-gates: ${scripts.length} generator(s) all carry a wired drift check.`);
