import { assertEquals } from '@std/assert';
import { normalizeActionFailure, normalizeLoaderFailure } from '../src/internal/action-error.ts';

Deno.test('action failures expose a stable page error and hide production details', () => {
  const messages: unknown[][] = [];
  const result = normalizeActionFailure(
    new Error('database password=/private/secret'),
    false,
    (...args) => messages.push(args),
  );

  assertEquals(result, { error: 'Action failed' });
  assertEquals(messages, [['action failed']]);
});

Deno.test('action failures retain the original error only in development logs', () => {
  const messages: unknown[][] = [];
  const error = new Error('save failed');
  const result = normalizeActionFailure(error, true, (...args) => messages.push(args));

  assertEquals(result, { error: 'Action failed' });
  assertEquals(messages, [['action failed:', error]]);
});

Deno.test('loader failures expose a stable page error and hide production details (#676)', () => {
  const messages: unknown[][] = [];
  const result = normalizeLoaderFailure(
    new Error('database password=/private/secret'),
    false,
    (...args) => messages.push(args),
  );

  assertEquals(result, { error: 'Loader failed' });
  assertEquals(messages, [['loader failed']]);
});

Deno.test('loader failures retain the original error only in development logs (#676)', () => {
  const messages: unknown[][] = [];
  const error = new Error('fetch failed');
  const result = normalizeLoaderFailure(error, true, (...args) => messages.push(args));

  assertEquals(result, { error: 'Loader failed' });
  assertEquals(messages, [['loader failed:', error]]);
});
