import { assertEquals } from '@std/assert';
import { packageSetFailures } from './check-package-surface.ts';

Deno.test('packageSetFailures accepts the exact retained set regardless of order', () => {
  assertEquals(packageSetFailures(['b', 'a'], ['a', 'b']), []);
});

Deno.test('packageSetFailures reports missing and unowned packages', () => {
  assertEquals(packageSetFailures(['element', 'ui'], ['element', 'app']), [
    'missing retained package: app',
    'unowned workspace package: ui',
  ]);
});
