import { assertEquals } from '@std/assert';
import { authRequestAllowed } from '../../lib/rate-limit.ts';

Deno.test('auth rate limit uses the Cloudflare binding and client address', async () => {
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
  assertEquals(allowed, false);
  assertEquals(key, 'login:192.0.2.1');
});

Deno.test('local development has no fake process-local limiter', async () => {
  assertEquals(await authRequestAllowed({}, new Request('http://localhost/login'), 'login'), true);
});

Deno.test('production rate-limit binding errors fail closed', async () => {
  const allowed = await authRequestAllowed(
    {
      AUTH_RATE_LIMITER: { limit: () => Promise.reject(new Error('provider detail')) },
    },
    new Request('https://app.test/login'),
    'login',
  );
  assertEquals(allowed, false);
});
