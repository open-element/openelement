/**
 * Workspace/script discovery failure semantics (governance fail-closed).
 *
 * The discovery feeds generate-all and the generator gate; a silently
 * skipped workspace would let both miss the same generators. Every malformed
 * shape must therefore throw with the offending path, never degrade to an
 * empty or partial workspace list. The B2 manifest conversion moved the
 * discovery source from the root deno.json workspace list to the
 * pnpm-workspace.yaml globs + per-member package.json scripts.
 */
import { assert, assertEquals, assertRejects } from '@std/assert';
import { dirname, join } from '@std/path';
import { emitterEntries, generatorEntries, readWorkspaces } from './workspace-tasks.ts';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

async function fixture(files: Record<string, string>): Promise<string> {
  // Canonicalize the root so the tests exercise the duplicate logic itself,
  // not a platform accident (macOS /var is a symlink to /private/var; Linux
  // /tmp is canonical — the symlink test passed for the wrong reason there).
  const root = await realpath(await mkdtemp(join(tmpdir(), 'workspace-tasks-fixture-')));
  for (const [relative, content] of Object.entries(files)) {
    const path = join(root, relative);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
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
    await rm(root, { recursive: true });
  }
}

const workspaceManifest = (scripts: unknown) => JSON.stringify({ scripts }, null, 2);

Deno.test('readWorkspaces: reads every member with its script graph', async () => {
  await withFixture(
    {
      'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
      'packages/alpha/package.json': workspaceManifest({
        'generate:x': 'deno run --allow-read x.ts',
      }),
      'packages/beta/package.json': JSON.stringify({ name: 'beta' }),
    },
    async (root) => {
      const workspaces = await readWorkspaces(root);
      assertEquals(
        workspaces.map((ws) => ws.workspace),
        ['packages/alpha', 'packages/beta'],
      );
      assertEquals(workspaces[0].tasks['generate:x'], 'deno run --allow-read x.ts');
      assertEquals(workspaces[1].tasks, {});
    },
  );
});

Deno.test('readWorkspaces: malformed pnpm-workspace.yaml fails closed', async () => {
  const cases: Array<[string, string]> = [
    ['packages list missing', 'foo: bar\n'],
    ['packages list empty', 'packages: []\n'],
    ['empty packages entry', 'packages:\n  - packages/*\n  -\n'],
  ];
  for (const [label, config] of cases) {
    await withFixture({ 'pnpm-workspace.yaml': config }, async (root) => {
      await assertRejects(
        () => readWorkspaces(root),
        Error,
        label === 'packages list missing' ? 'packages' : undefined,
      );
    });
  }
});

Deno.test('readWorkspaces: broken workspaces fail closed with their path', async () => {
  const cases: Array<[Record<string, string>]> = [
    [
      {
        'pnpm-workspace.yaml': 'packages:\n  - packages/alpha\n',
      },
    ],
    [
      {
        'pnpm-workspace.yaml': 'packages:\n  - packages/alpha\n',
        'packages/alpha/.keep': '',
      },
    ],
    [
      {
        'pnpm-workspace.yaml': 'packages:\n  - packages/alpha\n',
        'packages/alpha/package.json': '{ not json',
      },
    ],
    [
      {
        'pnpm-workspace.yaml': 'packages:\n  - packages/alpha\n',
        'packages/alpha/package.json': '[]',
      },
    ],
    [
      {
        'pnpm-workspace.yaml': 'packages:\n  - packages/alpha\n',
        'packages/alpha/package.json': JSON.stringify({ scripts: [] }),
      },
    ],
    [
      {
        'pnpm-workspace.yaml': 'packages:\n  - packages/alpha\n',
        'packages/alpha/package.json': JSON.stringify({ scripts: { '': 'deno run x.ts' } }),
      },
    ],
    [
      {
        'pnpm-workspace.yaml': 'packages:\n  - packages/alpha\n',
        'packages/alpha/package.json': JSON.stringify({ scripts: { 'generate:x': 1 } }),
      },
    ],
  ];
  for (const [files] of cases) {
    await withFixture(files, async (root) => {
      await assertRejects(() => readWorkspaces(root), Error, 'alpha');
    });
  }
});

Deno.test('readWorkspaces: duplicate detection uses canonical workspace identity', async () => {
  const duplicateCases: string[][] = [
    ['alpha', 'alpha'],
    ['./alpha', 'alpha'],
    ['alpha', 'foo/../alpha'],
  ];
  for (const members of duplicateCases) {
    await withFixture(
      {
        'pnpm-workspace.yaml': `packages:\n  - ${members[0]}\n  - ${members[1]}\n`,
        'alpha/package.json': workspaceManifest({}),
      },
      async (root) => {
        await assertRejects(
          () => readWorkspaces(root),
          Error,
          'duplicate workspace identity',
          JSON.stringify(members),
        );
      },
    );
  }
  // Distinct identities still read normally, and the returned label is the
  // canonical repository-relative form.
  await withFixture(
    {
      'pnpm-workspace.yaml': 'packages:\n  - alpha\n  - beta\n',
      'alpha/package.json': workspaceManifest({}),
      'beta/package.json': workspaceManifest({}),
    },
    async (root) => {
      const workspaces = await readWorkspaces(root);
      assertEquals(
        workspaces.map((ws) => ws.workspace),
        ['alpha', 'beta'],
      );
    },
  );
});

Deno.test('readWorkspaces: failure never degrades into a partial list', async () => {
  await withFixture(
    {
      'pnpm-workspace.yaml': 'packages:\n  - good\n  - broken\n',
      'good/package.json': workspaceManifest({ 'generate:x': 'deno run --allow-read x.ts' }),
      'broken/package.json': '{ nope',
    },
    async (root) => {
      await assertRejects(
        () => readWorkspaces(root),
        Error,
        'broken',
        'a broken member must reject the whole read, not return [good]',
      );
    },
  );
});

Deno.test('generator and emitter discovery derive from the script graph', async () => {
  await withFixture(
    {
      'pnpm-workspace.yaml': 'packages:\n  - pkg\n',
      'pkg/package.json': workspaceManifest({
        'generate:foo': 'deno run --allow-read --allow-write tools/generate-foo.ts',
        'check:foo': 'deno run --allow-read tools/generate-foo.ts --check',
        'emit:bar': 'deno run --allow-read tools/emit-bar.ts',
        build: 'deno run --allow-read build.ts',
      }),
    },
    async (root) => {
      const workspaces = await readWorkspaces(root);
      assertEquals(generatorEntries(workspaces), [
        { workspace: 'pkg', taskKey: 'generate:foo', script: 'tools/generate-foo.ts' },
      ]);
      assertEquals(emitterEntries(workspaces), [
        { workspace: 'pkg', taskKey: 'emit:bar', script: 'tools/emit-bar.ts' },
      ]);
    },
  );
});

Deno.test('generate-all and generator-gates share the canonical discovery', async () => {
  for (const name of ['generate-all.ts', 'check-generator-gates.ts']) {
    const source = await readFile(new URL(name, import.meta.url), 'utf8');
    if (!source.includes("from './workspace-tasks.ts'")) {
      throw new Error(`${name} must consume ./workspace-tasks.ts, not a private workspace list`);
    }
  }
});

Deno.test('readWorkspaces: symlinked members resolving to one directory are duplicates', async () => {
  await withFixture(
    {
      'pnpm-workspace.yaml': 'packages:\n  - alpha\n  - alias\n',
      'alpha/package.json': workspaceManifest({}),
    },
    async (root) => {
      await symlink(join(root, 'alpha'), join(root, 'alias'), 'dir');
      await assertRejects(() => readWorkspaces(root), Error, 'duplicate workspace identity');
    },
  );
});

Deno.test('readWorkspaces: diagnostics use repository-relative paths', async () => {
  await withFixture(
    {
      'pnpm-workspace.yaml': 'packages:\n  - alpha\n',
    },
    async (root) => {
      const error = await assertRejects(() => readWorkspaces(root), Error);
      const message = (error as Error).message;
      assertEquals(message.includes(root), false, `message leaks the checkout path: ${message}`);
      assert(message.includes('alpha'), `message lacks the member path: ${message}`);
    },
  );
});
