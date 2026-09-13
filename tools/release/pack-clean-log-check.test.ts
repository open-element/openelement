import { assertEquals } from '@std/assert';
import { checkPackCleanLogs, scanPackLog } from './pack-clean-log-check.ts';

Deno.test('pack clean-log: flags every warning token and ignores clean output', () => {
  assertEquals(scanPackLog('  71 modules collected\nDry run ok\n'), []);
  const hits = scanPackLog(
    "Could not generate types for 'x.ts'. Types will not be included for this module.\n" +
      'error[missing-explicit-type]: missing explicit type\n' +
      'some slow type warning here\n',
  );
  assertEquals(hits.map((hit) => hit.token), [
    'Could not generate types',
    'error[',
    'warning',
  ]);
});

Deno.test('pack clean-log: per-package results carry logs and exit codes', async () => {
  const dir = await Deno.makeTempDir({ prefix: 'pack-clean-log-' });
  try {
    const results = await checkPackCleanLogs(dir, (pkgDir: string) =>
      Promise.resolve({
        code: pkgDir.endsWith('bad') ? 1 : 0,
        output: pkgDir.endsWith('bad') ? "Could not generate types for 'x'." : 'clean',
      }));
    assertEquals(results.length, 4);
    for (const result of results) {
      assertEquals(result.hits.length, 0);
      assertEquals(result.code, 0);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
