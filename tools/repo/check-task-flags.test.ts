/**
 * Task-wiring tripwire for release tasks.
 *
 * Deno 2.9 rejects a repeated `--allow-run=<name>` flag ("cannot be used
 * multiple times"), so a task that spells two programs as separate
 * `--allow-run=x --allow-run=y` flags starts nothing and silently fails the
 * whole `release:check` chain. These tests read the real task definitions,
 * not internal functions, and fail if a duplicated flag or a bypassed task
 * is reintroduced.
 */
import { assert, assertEquals } from '@std/assert';
import { dirname, join } from '@std/path';
import { REQUIRED_PACKED_CONSUMERS } from './candidate-evidence.ts';

const repoRoot = join(dirname(new URL(import.meta.url).pathname), '..', '..');

interface TaskFileShape {
  tasks?: Record<string, string>;
}

async function tasks(path: string): Promise<Record<string, string>> {
  return (JSON.parse(await Deno.readTextFile(join(repoRoot, path))) as TaskFileShape).tasks ?? {};
}

const TASK_FILES = [
  'deno.json',
  'tools/repo/deno.json',
  'tools/release/deno.json',
  'packages/element/deno.json',
  'packages/router/deno.json',
  'packages/ui/deno.json',
  'packages/create/deno.json',
  'apps/site/deno.json',
];

Deno.test('task wiring: no single deno invocation repeats a --allow-run flag', async () => {
  for (const path of TASK_FILES) {
    for (const [name, command] of Object.entries(await tasks(path))) {
      // Tasks chain `deno run <outer flags> run-in.ts -- deno run <inner flags>`
      // (sometimes with `&&`); a repeated flag is only fatal within one
      // invocation, so count per deno invocation.
      for (const subCommand of command.split('&&')) {
        for (const part of subCommand.split(/\s--\s/)) {
          const repeats = [...part.matchAll(/--allow-run(?:\s|=|$)/g)].length;
          assert(
            repeats <= 1,
            `${path}#${name}: --allow-run appears ${repeats} times in one invocation; ` +
              `Deno 2.9 rejects repeated flags (combine programs as --allow-run=a,b)`,
          );
        }
      }
    }
  }
});

Deno.test('task wiring: release:registry-check uses one scoped run flag and runs', async () => {
  const command = (await tasks('tools/repo/deno.json'))['release:registry-check'];
  assert(command, 'release:registry-check must exist');
  assert(
    command.includes('--allow-run=git,npm'),
    'release:registry-check must combine git and npm into one --allow-run flag',
  );
  const result = await new Deno.Command(Deno.execPath(), {
    args: ['task', '--cwd', 'tools/repo', 'release:registry-check'],
    cwd: repoRoot,
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
  assertEquals(result.success, true, `release:registry-check failed:\n${output}`);
  assert(output.includes('Release state check passed'), output);
});

Deno.test('task wiring: release:check invokes the registry task, not an internal script', async () => {
  const command = (await tasks('deno.json'))['release:check'];
  assert(command, 'release:check must exist');
  assert(
    command.includes('tools/repo#release:registry-check'),
    'release:check must call the release:registry-check task',
  );
  assert(
    !command.includes('check-release-state-machine.ts'),
    'release:check must not bypass the task by calling the internal script',
  );
  assert(
    command.includes('tools/release#gate:packed') &&
      command.includes('tools/release#publish:npm:dry-run'),
    'release:check must still run the packed gate and publish dry-run',
  );
});

Deno.test('task wiring: gate:source generates site data before typecheck', async () => {
  const gateSource = (await tasks('tools/repo/deno.json'))['gate:source'];
  assert(gateSource, 'gate:source must exist');
  const generate = gateSource.indexOf('tools/repo#generate:api-reference');
  const typecheck = gateSource.indexOf('tools/repo#typecheck');
  assert(generate !== -1, 'gate:source must generate the API reference');
  assert(typecheck !== -1, 'gate:source must typecheck');
  assert(
    generate < typecheck,
    'gate:source must generate site data before the typecheck that imports it ' +
      '(check-content-examples.ts imports _generated-api-reference.ts)',
  );
  assert(
    gateSource.includes('tools/repo#generate:site-content-data'),
    'gate:source must generate the site content data on a clean clone',
  );
});

Deno.test('task wiring: gate:packed covers every required packed consumer', async () => {
  const gatePacked = (await tasks('tools/release/deno.json'))['gate:packed'];
  assert(gatePacked, 'gate:packed must exist');
  for (const consumer of REQUIRED_PACKED_CONSUMERS) {
    assert(
      gatePacked.includes(consumer),
      `gate:packed must run the required packed consumer ${consumer}; ` +
        `update the gate or the canonical REQUIRED_PACKED_CONSUMERS list`,
    );
  }
});

Deno.test('task wiring: the release workflow qualifies through the official task', async () => {
  const workflow = await Deno.readTextFile(
    join(repoRoot, '.github/workflows/autoflow-release.yml'),
  );
  assert(
    /run:\s*deno task release:check\b/.test(workflow),
    'the release workflow must call `deno task release:check`',
  );
});
