/**
 * Workspace/task discovery failure semantics (governance fail-closed).
 *
 * The discovery feeds generate-all and the generator gate; a silently
 * skipped workspace would let both miss the same generators. Every malformed
 * shape must therefore throw with the offending path, never degrade to an
 * empty or partial workspace list.
 */
import { assertEquals, assertRejects } from '@std/assert';
import { dirname, join } from '@std/path';
import { emitterEntries, generatorEntries, readWorkspaces } from './workspace-tasks.ts';

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: 'workspace-tasks-fixture-' });
  for (const [relative, content] of Object.entries(files)) {
    const path = join(root, relative);
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(path, content);
  }
  return root;
}

async function withFixture(
  files: Record<string, string>,
  fn: (root: string) => Promise<void>,
): Promise<void> {
  const root = await fixture(files);
  try {
    await fn(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

const rootConfig = (workspace: unknown) => JSON.stringify({ workspace }, null, 2);
const workspaceConfig = (tasks: unknown) => JSON.stringify({ tasks }, null, 2);

Deno.test('readWorkspaces: reads every member with its task graph', async () => {
  await withFixture({
    'deno.json': rootConfig(['./alpha', './beta']),
    'alpha/deno.json': workspaceConfig({ 'generate:x': 'deno run --allow-read x.ts' }),
    'beta/deno.json': JSON.stringify({}),
  }, async (root) => {
    const workspaces = await readWorkspaces(root);
    assertEquals(workspaces.map((ws) => ws.workspace), ['alpha', 'beta']);
    assertEquals(workspaces[0].tasks['generate:x'], 'deno run --allow-read x.ts');
    assertEquals(workspaces[1].tasks, {});
  });
});

Deno.test('readWorkspaces: malformed root configuration fails closed', async () => {
  const cases: Array<[string, string]> = [
    ['workspace missing', JSON.stringify({})],
    ['workspace not an array', rootConfig('./alpha')],
    ['workspace item not a string', rootConfig([1])],
    ['workspace item empty', rootConfig([''])],
    ['duplicate workspace', rootConfig(['./alpha', './alpha'])],
    ['escaping the repository root', rootConfig(['../evil'])],
  ];
  for (const [label, config] of cases) {
    await withFixture({ 'deno.json': config }, async (root) => {
      await assertRejects(
        () => readWorkspaces(root),
        Error,
        label === 'workspace missing' ? 'workspace' : undefined,
      );
    });
  }
});

Deno.test('readWorkspaces: broken workspaces fail closed with their path', async () => {
  const cases: Array<[string, Record<string, string>]> = [
    ['missing directory', {
      'deno.json': rootConfig(['./alpha']),
    }],
    ['missing deno.json', {
      'deno.json': rootConfig(['./alpha']),
      'alpha/.keep': '',
    }],
    ['invalid JSON', {
      'deno.json': rootConfig(['./alpha']),
      'alpha/deno.json': '{ not json',
    }],
    ['config not an object', {
      'deno.json': rootConfig(['./alpha']),
      'alpha/deno.json': '[]',
    }],
    ['tasks not an object', {
      'deno.json': rootConfig(['./alpha']),
      'alpha/deno.json': JSON.stringify({ tasks: [] }),
    }],
    ['empty task name', {
      'deno.json': rootConfig(['./alpha']),
      'alpha/deno.json': JSON.stringify({ tasks: { '': 'deno run x.ts' } }),
    }],
    ['command not a string', {
      'deno.json': rootConfig(['./alpha']),
      'alpha/deno.json': JSON.stringify({ tasks: { 'generate:x': 1 } }),
    }],
  ];
  for (const [label, files] of cases) {
    await withFixture(files, async (root) => {
      await assertRejects(() => readWorkspaces(root), Error, 'alpha');
      void label;
    });
  }
});

Deno.test('readWorkspaces: duplicate detection uses canonical workspace identity', async () => {
  const duplicateCases: string[][] = [
    ['./alpha', 'alpha'],
    ['alpha', './alpha'],
    ['alpha', 'foo/../alpha'],
    ['./alpha', 'foo/../alpha'],
  ];
  for (const members of duplicateCases) {
    await withFixture({
      'deno.json': rootConfig(members),
      'alpha/deno.json': workspaceConfig({}),
    }, async (root) => {
      await assertRejects(
        () => readWorkspaces(root),
        Error,
        'duplicate workspace identity',
        JSON.stringify(members),
      );
    });
  }
  // Distinct identities still read normally, and the returned label is the
  // canonical repository-relative form.
  await withFixture({
    'deno.json': rootConfig(['./alpha', 'beta']),
    'alpha/deno.json': workspaceConfig({}),
    'beta/deno.json': workspaceConfig({}),
  }, async (root) => {
    const workspaces = await readWorkspaces(root);
    assertEquals(workspaces.map((ws) => ws.workspace), ['alpha', 'beta']);
  });
});

Deno.test('readWorkspaces: failure never degrades into a partial list', async () => {
  await withFixture({
    'deno.json': rootConfig(['./good', './broken']),
    'good/deno.json': workspaceConfig({ 'generate:x': 'deno run --allow-read x.ts' }),
    'broken/deno.json': '{ nope',
  }, async (root) => {
    await assertRejects(
      () => readWorkspaces(root),
      Error,
      'broken',
      'a broken member must reject the whole read, not return [good]',
    );
  });
});

Deno.test('generator and emitter discovery derive from the task graph', async () => {
  await withFixture({
    'deno.json': rootConfig(['./pkg']),
    'pkg/deno.json': workspaceConfig({
      'generate:foo': 'deno run --allow-read --allow-write tools/generate-foo.ts',
      'check:foo': 'deno run --allow-read tools/generate-foo.ts --check',
      'emit:bar': 'deno run --allow-read tools/emit-bar.ts',
      'build': 'deno run --allow-read build.ts',
    }),
  }, async (root) => {
    const workspaces = await readWorkspaces(root);
    assertEquals(generatorEntries(workspaces), [
      { workspace: 'pkg', taskKey: 'generate:foo', script: 'tools/generate-foo.ts' },
    ]);
    assertEquals(emitterEntries(workspaces), [
      { workspace: 'pkg', taskKey: 'emit:bar', script: 'tools/emit-bar.ts' },
    ]);
  });
});

Deno.test('generate-all and generator-gates share the canonical discovery', async () => {
  for (const name of ['generate-all.ts', 'check-generator-gates.ts']) {
    const source = await Deno.readTextFile(new URL(name, import.meta.url));
    if (!source.includes("from './workspace-tasks.ts'")) {
      throw new Error(`${name} must consume ./workspace-tasks.ts, not a private workspace list`);
    }
  }
});
