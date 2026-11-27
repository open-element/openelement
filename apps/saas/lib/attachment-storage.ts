import { ATTACHMENT_BUCKET } from './cloudflare-queues.ts';
import { serviceRoleConnection, type ServiceRoleEnv } from './service-role.ts';

function objectPath(key: string): string {
  const segments = key.split('/');
  if (
    segments.length !== 2 ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error('Invalid attachment object key');
  }
  return segments.map(encodeURIComponent).join('/');
}

export async function uploadAttachment(env: ServiceRoleEnv, key: string, file: File) {
  const { url, headers } = serviceRoleConnection(env);
  const body = new FormData();
  body.append('cacheControl', '0');
  body.append('', file);
  const response = await fetch(`${url}/storage/v1/object/${ATTACHMENT_BUCKET}/${objectPath(key)}`, {
    method: 'POST',
    headers: { ...headers, 'x-upsert': 'false' },
    body,
    redirect: 'error',
    signal: AbortSignal.timeout(60_000),
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error('Attachment upload failed');
}

export async function removeAttachment(env: ServiceRoleEnv, key: string) {
  const { url, headers } = serviceRoleConnection(env);
  const response = await fetch(`${url}/storage/v1/object/${ATTACHMENT_BUCKET}`, {
    method: 'DELETE',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ prefixes: [key] }),
    redirect: 'error',
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error('Attachment removal failed');
}

export function downloadAttachment(env: ServiceRoleEnv, key: string) {
  const { url, headers } = serviceRoleConnection(env);
  return fetch(`${url}/storage/v1/object/authenticated/${ATTACHMENT_BUCKET}/${objectPath(key)}`, {
    headers,
    redirect: 'error',
    cache: 'no-store',
  });
}
