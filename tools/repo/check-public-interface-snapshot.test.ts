import { assertEquals, assertNotEquals, assertStringIncludes } from '@std/assert';
import { join } from '@std/path';
import { publicInterfaceShape } from './check-public-interface-snapshot.ts';

Deno.test('public interface snapshot follows re-exported type members but ignores function bodies', async () => {
  const root = await Deno.makeTempDir();
  try {
    const internal = join(root, 'internal.ts');
    const entry = join(root, 'index.ts');
    await Deno.writeTextFile(internal, 'export interface IslandOptions { ssr?: boolean; }\n');
    await Deno.writeTextFile(
      entry,
      "export type { IslandOptions } from './internal.ts';\n" +
        'export function stable(value: string): string { return value; }\n',
    );
    const before = await publicInterfaceShape(entry, root);
    assertStringIncludes(before.publicSymbols.join('\n'), 'IslandOptions=type:{ssr?:');

    await Deno.writeTextFile(
      internal,
      'export interface IslandOptions { ssr?: boolean; dsd?: boolean; }\n',
    );
    const memberChanged = await publicInterfaceShape(entry, root);
    assertNotEquals(memberChanged.publicShapeSha256, before.publicShapeSha256);
    assertStringIncludes(memberChanged.publicSymbols.join('\n'), 'dsd?:');

    await Deno.writeTextFile(
      entry,
      "export type { IslandOptions } from './internal.ts';\n" +
        "export function stable(value: string): string { return value + '!'; }\n",
    );
    const bodyChanged = await publicInterfaceShape(entry, root);
    assertEquals(bodyChanged.publicShapeSha256, memberChanged.publicShapeSha256);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
