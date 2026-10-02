import { assertEquals, assertNotEquals, assertStringIncludes } from '@std/assert';
import { join } from '@std/path';
import { publicInterfaceShape } from './check-public-interface-snapshot.ts';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

Deno.test('public interface snapshot resolves bare specifiers through explicit paths and flags local any aliases', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opx-test-'));
  try {
    const dep = join(root, 'dep.ts');
    const entry = join(root, 'index.ts');
    await writeFile(dep, 'export interface DepOptions { mode?: string; }\n');
    await writeFile(
      entry,
      "export type { DepOptions } from 'x-dep';\n" +
        "import type { DepOptions } from 'x-dep';\n" +
        'export type LocalOptions = DepOptions & { extra?: number };\n',
    );
    const resolved = await publicInterfaceShape(entry, root, { 'x-dep': [dep] });
    assertEquals(resolved.localAnyTypeAliases, []);
    assertStringIncludes(resolved.publicSymbols.join('\n'), 'DepOptions=type:{mode?:');
    assertStringIncludes(resolved.publicSymbols.join('\n'), 'extra?:');

    const unresolved = await publicInterfaceShape(entry, root);
    assertEquals(unresolved.localAnyTypeAliases, ['LocalOptions']);
    assertStringIncludes(unresolved.publicSymbols.join('\n'), 'LocalOptions=type:any');
  } finally {
    await rm(root, { recursive: true });
  }
});

Deno.test('public interface snapshot follows re-exported type members but ignores function bodies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opx-test-'));
  try {
    const internal = join(root, 'internal.ts');
    const entry = join(root, 'index.ts');
    await writeFile(internal, 'export interface IslandOptions { ssr?: boolean; }\n');
    await writeFile(
      entry,
      "export type { IslandOptions } from './internal.ts';\n" +
        'export function stable(value: string): string { return value; }\n',
    );
    const before = await publicInterfaceShape(entry, root);
    assertStringIncludes(before.publicSymbols.join('\n'), 'IslandOptions=type:{ssr?:');

    await writeFile(internal, 'export interface IslandOptions { ssr?: boolean; dsd?: boolean; }\n');
    const memberChanged = await publicInterfaceShape(entry, root);
    assertNotEquals(memberChanged.publicShapeSha256, before.publicShapeSha256);
    assertStringIncludes(memberChanged.publicSymbols.join('\n'), 'dsd?:');

    await writeFile(
      entry,
      "export type { IslandOptions } from './internal.ts';\n" +
        "export function stable(value: string): string { return value + '!'; }\n",
    );
    const bodyChanged = await publicInterfaceShape(entry, root);
    assertEquals(bodyChanged.publicShapeSha256, memberChanged.publicShapeSha256);
  } finally {
    await rm(root, { recursive: true });
  }
});
