import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../../tests/lib/vitest-asserts.ts';
import { isOpenElementNotFound } from '@openelement/router';
import { hasAdminRole, requireAdmin } from '../../lib/authorization.ts';

test('admin authorization trusts app_metadata.role only', () => {
  expect(hasAdminRole({ id: '1', app_metadata: { role: 'admin' } })).toEqual(true);
  expect(hasAdminRole({ id: '1', app_metadata: { role: 'member' } })).toEqual(false);
  expect(hasAdminRole(null)).toEqual(false);
});

test('user-writable metadata can never grant admin', () => {
  const forged = { id: 'attacker', app_metadata: {}, user_metadata: { role: 'admin' } };
  expect(hasAdminRole(forged)).toEqual(false);
  const error = assertThrowsIncludes(() => requireAdmin(forged));
  expect(isOpenElementNotFound(error)).toBeTruthy();
});
