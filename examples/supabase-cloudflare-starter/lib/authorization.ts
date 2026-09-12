import { notFound } from '@openelement/app';

export interface AuthenticatedIdentity {
  id: string;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
}

/** Authorization trusts issuer-controlled app_metadata, never user_metadata. */
export function hasAdminRole(user: AuthenticatedIdentity | null | undefined): boolean {
  return user?.app_metadata?.role === 'admin';
}

/** Denial rides the framework 404 channel: a raw thrown Response is not
 * translated by the request-time server and would surface as a 500. */
export function requireAdmin(
  user: AuthenticatedIdentity | null | undefined,
): asserts user is AuthenticatedIdentity {
  if (!hasAdminRole(user)) notFound('Not found');
}
