import { assertEquals, assertRejects } from '@std/assert';
import { join } from '@std/path';
import { readClientEntryFromManifest } from '../src/vite/build.ts';

Deno.test('readClientEntryFromManifest reads client entry asynchronously', async () => {
  const dir = await Deno.makeTempDir();
  try {
    const path = join(dir, 'manifest.json');
    await Deno.writeTextFile(
      path,
      JSON.stringify({
        'virtual:open-client': { file: 'assets/client-a1b2.js' },
      }),
    );
    assertEquals(await readClientEntryFromManifest(path), 'assets/client-a1b2.js');
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test('readClientEntryFromManifest fails when manifest lacks client entry', async () => {
  const dir = await Deno.makeTempDir();
  try {
    const path = join(dir, 'manifest.json');
    await Deno.writeTextFile(path, JSON.stringify({ shared: { file: 'shared.js' } }));
    await assertRejects(
      () => readClientEntryFromManifest(path),
      Error,
      'no open-client-entry',
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
