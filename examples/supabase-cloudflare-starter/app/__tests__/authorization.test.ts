import { assert, assertEquals, assertThrows } from '@std/assert';
import { isOpenElementNotFound } from '@openelement/app';
import { hasAdminRole, requireAdmin } from '../../lib/authorization.ts';

Deno.test('admin authorization trusts app_metadata.role only', () => {
  assertEquals(hasAdminRole({ id: '1', app_metadata: { role: 'admin' } }), true);
  assertEquals(hasAdminRole({ id: '1', app_metadata: { role: 'member' } }), false);
  assertEquals(hasAdminRole(null), false);
});

Deno.test('user-writable metadata can never grant admin', () => {
  const forged = { id: 'attacker', app_metadata: {}, user_metadata: { role: 'admin' } };
  assertEquals(hasAdminRole(forged), false);
  const error = assertThrows(() => requireAdmin(forged));
  assert(isOpenElementNotFound(error));
});
