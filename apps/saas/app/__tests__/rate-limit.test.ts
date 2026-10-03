import { expect, test } from 'vitest';
import { authRequestAllowed } from '../../lib/rate-limit.ts';

test('auth rate limit uses the Cloudflare binding and client address', async () => {
  let key = '';
  const allowed = await authRequestAllowed(
    {
      AUTH_RATE_LIMITER: {
        limit: (options) => {
          key = options.key;
          return Promise.resolve({ success: false });
        },
      },
    },
    new Request('https://app.test/login', { headers: { 'cf-connecting-ip': '192.0.2.1' } }),
    'login',
  );
  expect(allowed).toEqual(false);
  expect(key).toEqual('login:192.0.2.1');
});

test('local development has no fake process-local limiter', async () => {
  expect(await authRequestAllowed({}, new Request('http://localhost/login'), 'login')).toEqual(
    true,
  );
});

test('production rate-limit binding errors fail closed', async () => {
  const allowed = await authRequestAllowed(
    {
      AUTH_RATE_LIMITER: { limit: () => Promise.reject(new Error('provider detail')) },
    },
    new Request('https://app.test/login'),
    'login',
  );
  expect(allowed).toEqual(false);
});
