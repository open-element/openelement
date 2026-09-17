import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import {
  findWorkspaceShadowFailures,
  type NodeModulesEntry,
  readWorkspaceMembers,
  type WorkspaceMember,
} from './check-workspace-links.ts';

const members: WorkspaceMember[] = [
  { name: '@openelement/router', dir: 'packages/router' },
  { name: '@openelement/element', dir: 'packages/element' },
];

function entry(name: string, overrides: Partial<NodeModulesEntry> = {}): NodeModulesEntry {
  return { path: name, kind: 'missing', ...overrides };
}

Deno.test('workspace shadow check accepts absent and correctly linked members', () => {
  assertEquals(findWorkspaceShadowFailures(members, []), []);
  assertEquals(
    findWorkspaceShadowFailures(members, [
      entry('@openelement/router', { kind: 'missing' }),
      entry('@openelement/element', {
        kind: 'symlink',
        target: 'packages/element',
      }),
    ]),
    [],
  );
});

Deno.test('workspace shadow check fails on a real directory or file at the member path', () => {
  const [directory] = findWorkspaceShadowFailures(members, [
    entry('@openelement/router', { kind: 'directory' }),
  ]);
  assertStringIncludes(directory, 'node_modules/@openelement/router is a real directory');
  assertStringIncludes(directory, 'packages/router');
  // The message must carry the fix, not just the complaint.
  assertStringIncludes(directory, 'rm -rf node_modules/@openelement/router');

  const [file] = findWorkspaceShadowFailures(members, [
    entry('@openelement/router', { kind: 'file' }),
  ]);
  assertStringIncludes(file, 'is a real file');
});

Deno.test('workspace shadow check fails on links that leave the member or dangle', () => {
  const [outside] = findWorkspaceShadowFailures(members, [
    entry('@openelement/router', { kind: 'symlink', target: 'custom-dist/router' }),
  ]);
  assertStringIncludes(outside, 'outside the workspace member packages/router');

  const [dangling] = findWorkspaceShadowFailures(members, [
    entry('@openelement/router', { kind: 'symlink' }),
  ]);
  assertStringIncludes(dangling, 'dangling symlink');
});

Deno.test('workspace shadow check reads the real workspace member list', async () => {
  const real = await readWorkspaceMembers();
  // Only packages declare a name; app/tool/fixture members do not, and a
  // member without a name has no node_modules path to shadow.
  assertEquals(
    real.map((member) => member.name).sort(),
    ['@openelement/create', '@openelement/element', '@openelement/router', '@openelement/ui'],
  );
  assert(
    real.every((member) => member.dir.startsWith('packages/')),
    'the named members are the four consumer packages',
  );
});
