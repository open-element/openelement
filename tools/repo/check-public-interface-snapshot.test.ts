import { expect, test } from 'vitest';
import { join } from 'node:path';
import { publicInterfaceShape } from './check-public-interface-snapshot.ts';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

test('public interface snapshot resolves bare specifiers through explicit paths and flags local any aliases', async () => {
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
    expect(resolved.localAnyTypeAliases).toEqual([]);
    expect(resolved.publicSymbols.join('\n')).toContain('DepOptions=type:{mode?:');
    expect(resolved.publicSymbols.join('\n')).toContain('extra?:');

    const unresolved = await publicInterfaceShape(entry, root);
    expect(unresolved.localAnyTypeAliases).toEqual(['LocalOptions']);
    expect(unresolved.publicSymbols.join('\n')).toContain('LocalOptions=type:any');
  } finally {
    await rm(root, { recursive: true });
  }
});

test('public interface snapshot follows re-exported type members but ignores function bodies', async () => {
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
    expect(before.publicSymbols.join('\n')).toContain('IslandOptions=type:{ssr?:');

    await writeFile(internal, 'export interface IslandOptions { ssr?: boolean; dsd?: boolean; }\n');
    const memberChanged = await publicInterfaceShape(entry, root);
    expect(memberChanged.publicShapeSha256).not.toEqual(before.publicShapeSha256);
    expect(memberChanged.publicSymbols.join('\n')).toContain('dsd?:');

    await writeFile(
      entry,
      "export type { IslandOptions } from './internal.ts';\n" +
        "export function stable(value: string): string { return value + '!'; }\n",
    );
    const bodyChanged = await publicInterfaceShape(entry, root);
    expect(bodyChanged.publicShapeSha256).toEqual(memberChanged.publicShapeSha256);
  } finally {
    await rm(root, { recursive: true });
  }
});
