import { assertEquals } from '@std/assert';
import { createRequestContext } from '../src/model.ts';

Deno.test('request context normalizes Web Request details', () => {
  const context = createRequestContext({
    request: new Request('https://example.test/notes/42?tab=reader', { method: 'POST' }),
    params: { id: '42' },
    env: { stage: 'test' },
    platform: { runtime: 'node' },
  });

  assertEquals(context.path, '/notes/42');
  assertEquals(context.method, 'POST');
  assertEquals(context.params, { id: '42' });
  assertEquals(context.searchParams.get('tab'), 'reader');
  assertEquals(context.env, { stage: 'test' });
  assertEquals(context.platform, { runtime: 'node' });
});

Deno.test('request context defaults optional params', () => {
  const context = createRequestContext({
    request: new Request('https://example.test/freeform'),
  });

  assertEquals(context.path, '/freeform');
  assertEquals(context.method, 'GET');
  assertEquals(context.params, {});
  assertEquals(context.platform, undefined);
});
