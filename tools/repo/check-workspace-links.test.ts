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
  // The B2 conversion made every fixture a named (private) workspace member;
  // the four published consumer packages must always be among the named
  // members, and the private fixture names must never collide with them.
  const names = real.map((member) => member.name).sort();
  for (const published of [
    '@openelement/create',
    '@openelement/element',
    '@openelement/router',
    '@openelement/ui',
  ]) {
    assert(names.includes(published), `named members must include ${published}`);
  }
  assert(
    real.filter((member) => names.includes(member.name) && member.dir.startsWith('packages/'))
      .length === 4,
    'exactly the four consumer packages live under packages/',
  );
  // A member without a node_modules entry is skipped by the shadow check, so
  // the private fixture members are harmless additions.
});
