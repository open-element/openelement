import { assertEquals } from '@std/assert';
import { absoluteTime, formatCount, relativeTime, stripHtml } from '../format.ts';

Deno.test('relativeTime formats recent timestamps', () => {
  const now = new Date().toISOString();
  assertEquals(relativeTime(now), 'now');
});

Deno.test('relativeTime formats minutes', () => {
  const ts = new Date(Date.now() - 3 * 60 * 1000).toISOString();
  assertEquals(relativeTime(ts), '3m');
});

Deno.test('relativeTime formats hours', () => {
  const ts = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  assertEquals(relativeTime(ts), '2h');
});

Deno.test('relativeTime formats days', () => {
  const ts = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  assertEquals(relativeTime(ts), '1d');
});

Deno.test('formatCount abbreviates large numbers', () => {
  assertEquals(formatCount(999), '999');
  assertEquals(formatCount(1500), '1.5K');
  assertEquals(formatCount(1_000_000), '1M');
});

Deno.test('stripHtml removes tags', () => {
  assertEquals(stripHtml('<p>Hello world</p>'), 'Hello world');
});

Deno.test('absoluteTime returns locale string', () => {
  const str = absoluteTime('2026-07-06T10:00:00.000Z');
  assertEquals(typeof str, 'string');
  assertEquals(str.length > 0, true);
});
