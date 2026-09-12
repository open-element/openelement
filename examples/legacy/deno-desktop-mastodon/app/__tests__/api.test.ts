import { assertEquals, assertFalse } from '@std/assert';
import {
  fetchAccount,
  fetchAccountStatuses,
  fetchPublicTimeline,
  fetchStatus,
  fetchStatusContext,
} from '../api.ts';

const FIXTURES_DIR = new URL('../../fixtures/', import.meta.url).pathname;

async function withMockServer(
  handler: (req: Request) => Response | Promise<Response>,
  fn: (baseUrl: string) => Promise<void>,
) {
  const server = Deno.serve({ port: 0 }, handler);
  try {
    const addr = server.addr as Deno.NetAddr;
    await fn(`http://${addr.hostname}:${addr.port}`);
  } finally {
    await server.shutdown();
  }
}

async function backupAndRestore(file: string, fn: () => Promise<void>) {
  const original = `${file}.orig`;
  await Deno.rename(file, original);
  try {
    await fn();
  } finally {
    await Deno.rename(original, file);
  }
}

async function withTempFile(file: string, content: string, fn: () => Promise<void>) {
  const original = `${file}.orig`;
  await Deno.rename(file, original);
  await Deno.writeTextFile(file, content);
  try {
    await fn();
  } finally {
    await Deno.remove(file);
    await Deno.rename(original, file);
  }
}

Deno.test('fetchPublicTimeline returns fixture statuses', async () => {
  Deno.env.delete('MASTODON_LIVE');
  const result = await fetchPublicTimeline({ instance: 'mastodon.social', timeline: 'public' });
  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(Array.isArray(result.data), true);
  assertEquals(result.data.length >= 1, true);
  assertEquals(typeof result.data[0].id, 'string');
});

Deno.test('fetchAccount returns fixture account', async () => {
  Deno.env.delete('MASTODON_LIVE');
  const result = await fetchAccount({ instance: 'mastodon.social', acct: 'admin@mastodon.social' });
  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(result.data.username, 'admin');
});

Deno.test('fetchStatus returns fixture status', async () => {
  Deno.env.delete('MASTODON_LIVE');
  const result = await fetchStatus({ instance: 'mastodon.social', id: '111111111111111111' });
  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(result.data.id, '111111111111111111');
});

Deno.test('fetchPublicTimeline returns http error on 429 rate limit', async () => {
  Deno.env.set('MASTODON_LIVE', 'true');
  await withMockServer((req) => {
    const url = new URL(req.url);
    if (url.pathname === '/api/v1/timelines/public') {
      return new Response('Rate limit exceeded', { status: 429 });
    }
    return new Response('Not found', { status: 404 });
  }, async (baseUrl) => {
    const result = await fetchPublicTimeline({ instance: baseUrl, timeline: 'public' });
    assertFalse(result.ok);
    if (result.ok) return;
    assertEquals(result.error.type, 'http');
    assertEquals(result.error.status, 429);
  });
});

Deno.test('fetchAccount returns http error on 500 server error', async () => {
  Deno.env.set('MASTODON_LIVE', 'true');
  await withMockServer((req) => {
    const url = new URL(req.url);
    if (url.pathname === '/api/v1/accounts/lookup') {
      return new Response('Internal Server Error', { status: 500 });
    }
    return new Response('Not found', { status: 404 });
  }, async (baseUrl) => {
    const result = await fetchAccount({ instance: baseUrl, acct: 'admin@mastodon.social' });
    assertFalse(result.ok);
    if (result.ok) return;
    assertEquals(result.error.type, 'http');
    assertEquals(result.error.status, 500);
  });
});

Deno.test('fetchAccountStatuses propagates lookup failure', async () => {
  Deno.env.set('MASTODON_LIVE', 'true');
  await withMockServer((req) => {
    const url = new URL(req.url);
    if (url.pathname === '/api/v1/accounts/lookup') {
      return new Response('Not found', { status: 404 });
    }
    return new Response('unexpected', { status: 500 });
  }, async (baseUrl) => {
    const result = await fetchAccountStatuses({ instance: baseUrl, acct: 'nobody@example.com' });
    assertFalse(result.ok);
    if (result.ok) return;
    assertEquals(result.error.type, 'http');
    assertEquals(result.error.status, 404);
  });
});

Deno.test('fetchStatus returns http error on 404', async () => {
  Deno.env.set('MASTODON_LIVE', 'true');
  await withMockServer((req) => {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/v1/statuses/')) {
      return new Response('Not found', { status: 404 });
    }
    return new Response('unexpected', { status: 500 });
  }, async (baseUrl) => {
    const result = await fetchStatus({ instance: baseUrl, id: 'missing' });
    assertFalse(result.ok);
    if (result.ok) return;
    assertEquals(result.error.type, 'http');
    assertEquals(result.error.status, 404);
  });
});

Deno.test('fetchStatusContext returns http error on 403', async () => {
  Deno.env.set('MASTODON_LIVE', 'true');
  await withMockServer((req) => {
    const url = new URL(req.url);
    if (url.pathname.endsWith('/context')) {
      return new Response('Forbidden', { status: 403 });
    }
    return new Response('unexpected', { status: 500 });
  }, async (baseUrl) => {
    const result = await fetchStatusContext({ instance: baseUrl, id: '1' });
    assertFalse(result.ok);
    if (result.ok) return;
    assertEquals(result.error.type, 'http');
    assertEquals(result.error.status, 403);
  });
});

Deno.test('fetchPublicTimeline returns network error on unreachable host', async () => {
  Deno.env.set('MASTODON_LIVE', 'true');
  const result = await fetchPublicTimeline({
    instance: 'http://localhost:1',
    timeline: 'public',
  });
  assertFalse(result.ok);
  if (result.ok) return;
  assertEquals(result.error.type, 'network');
});

Deno.test('fetchPublicTimeline returns configuration error when fixture is missing', async () => {
  Deno.env.delete('MASTODON_LIVE');
  const timelineFixture = `${FIXTURES_DIR}/timeline.json`;
  await backupAndRestore(timelineFixture, async () => {
    const result = await fetchPublicTimeline({ instance: 'mastodon.social', timeline: 'public' });
    assertFalse(result.ok);
    if (result.ok) return;
    assertEquals(result.error.type, 'configuration');
  });
});

Deno.test('fetchPublicTimeline returns configuration error on invalid fixture JSON', async () => {
  Deno.env.delete('MASTODON_LIVE');
  const timelineFixture = `${FIXTURES_DIR}/timeline.json`;
  await withTempFile(timelineFixture, 'not valid json {', async () => {
    const result = await fetchPublicTimeline({ instance: 'mastodon.social', timeline: 'public' });
    assertFalse(result.ok);
    if (result.ok) return;
    assertEquals(result.error.type, 'configuration');
  });
});
