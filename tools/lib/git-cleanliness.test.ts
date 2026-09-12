import { assertEquals } from '@std/assert';
import { filterNonEvidenceDirty, parsePorcelainPath } from './git-cleanliness.ts';

Deno.test('git cleanliness parses renamed and ordinary porcelain paths', () => {
  assertEquals(parsePorcelainPath(' M tools/a.ts'), 'tools/a.ts');
  assertEquals(parsePorcelainPath('R  old.ts -> docs/release/new.ts'), 'docs/release/new.ts');
});

Deno.test('git cleanliness uses one normalized evidence allowlist', () => {
  assertEquals(
    filterNonEvidenceDirty([
      ' M docs/release/evidence.md',
      ' M www/app/data/_generated-release.ts',
      ' M deno.lock',
      ' M tools/real-change.ts',
    ].join('\n')),
    [' M tools/real-change.ts'],
  );
});
