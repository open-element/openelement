import { expect, test } from 'vitest';
import { filterNonEvidenceDirty, parsePorcelainPath } from './git-cleanliness.ts';

test('git cleanliness parses renamed and ordinary porcelain paths', () => {
  expect(parsePorcelainPath(' M tools/a.ts')).toEqual('tools/a.ts');
  expect(parsePorcelainPath('R  old.ts -> docs/release/new.ts')).toEqual('docs/release/new.ts');
});

test('git cleanliness uses one normalized evidence allowlist', () => {
  expect(
    filterNonEvidenceDirty(
      [
        ' M docs/release/evidence.md',
        ' M www/app/data/_generated-release.ts',
        ' M pnpm-lock.yaml',
        ' M tools/real-change.ts',
      ].join('\n'),
    ),
  ).toEqual([' M tools/real-change.ts']);
});
