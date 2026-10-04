import { expect, test } from 'vitest';
import { createRequestContext } from '../src/model.ts';

test('request context normalizes Web Request details', () => {
  const context = createRequestContext({
    request: new Request('https://example.test/notes/42?tab=reader', { method: 'POST' }),
    params: { id: '42' },
    env: { stage: 'test' },
    platform: { runtime: 'node' },
  });

  expect(context.path).toEqual('/notes/42');
  expect(context.method).toEqual('POST');
  expect(context.params).toEqual({ id: '42' });
  expect(context.searchParams.get('tab')).toEqual('reader');
  expect(context.env).toEqual({ stage: 'test' });
  expect(context.platform).toEqual({ runtime: 'node' });
});

test('request context defaults optional params', () => {
  const context = createRequestContext({
    request: new Request('https://example.test/freeform'),
  });

  expect(context.path).toEqual('/freeform');
  expect(context.method).toEqual('GET');
  expect(context.params).toEqual({});
  expect(context.platform).toEqual(undefined);
});
