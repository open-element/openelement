import { test } from 'vitest';
import { assertThrowsIncludes } from '../../tests/lib/vitest-asserts.ts';
import { assertCompatibilityDate } from './compatibility-date.ts';

test('compatibility date accepts a current project date', () => {
  assertCompatibilityDate('2026-06-12', new Date('2026-07-15T12:00:00Z'));
});

test('compatibility date rejects future and stale dates', () => {
  assertThrowsIncludes(
    () => assertCompatibilityDate('2026-07-16', new Date('2026-07-15T12:00:00Z')),
    Error,
    'future',
  );
  assertThrowsIncludes(
    () => assertCompatibilityDate('2025-01-01', new Date('2026-07-15T12:00:00Z')),
    Error,
    'maximum',
  );
});
