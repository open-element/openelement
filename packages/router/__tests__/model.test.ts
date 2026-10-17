import { expect, test } from 'vitest';
import { createRequestContext, resolveRequestEnv } from '../src/model.ts';

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

test('resolveRequestEnv is the single env precedence chain (M-R2)', () => {
  // Runtime bindings win, then the per-event env, then the mount options.
  expect(resolveRequestEnv({ stage: 'runtime' }, { stage: 'event' }, { stage: 'options' })).toEqual(
    { stage: 'runtime' },
  );
  expect(resolveRequestEnv(undefined, { stage: 'event' }, { stage: 'options' })).toEqual({
    stage: 'event',
  });
  expect(resolveRequestEnv(undefined, undefined, { stage: 'options' })).toEqual({
    stage: 'options',
  });
  expect(resolveRequestEnv(undefined, undefined, undefined)).toEqual(undefined);
  // `??` semantics: an explicitly-passed empty env is a configuration, not
  // a missing link — it must not fall through to the next candidate.
  expect(resolveRequestEnv({}, { stage: 'event' })).toEqual({});
});
