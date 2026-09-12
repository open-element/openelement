import { assertEquals } from '@std/assert';
import { publicAuthError, safeInternalNext } from '../../lib/auth-security.ts';

Deno.test('safeInternalNext accepts only application-relative destinations', () => {
  assertEquals(safeInternalNext('/notes'), '/notes');
  assertEquals(safeInternalNext('/notes?tab=mine#latest'), '/notes?tab=mine#latest');
});

Deno.test('safeInternalNext rejects external, protocol-relative and backslash redirects', () => {
  for (
    const attack of [
      'https://evil.example',
      '//evil.example/path',
      '/\\evil.example',
      '\\evil.example',
      'javascript:alert(1)',
    ]
  ) assertEquals(safeInternalNext(attack), '/notes');
});

Deno.test('safeInternalNext rejects single and double encoded redirect bypasses', () => {
  for (
    const attack of [
      '%2F%2Fevil.example',
      '%252F%252Fevil.example',
      '/%5Cevil.example',
      '/%255Cevil.example',
      '/%00evil',
      '/%2500evil',
      '%E0%A4%A',
    ]
  ) assertEquals(safeInternalNext(attack), '/notes');
});

Deno.test('publicAuthError never reflects provider/session material', () => {
  const secret = 'code=private-code eyJprivate.jwt provider_debug_id=123';
  const message = publicAuthError(new Error(secret));
  assertEquals(message.includes('private-code'), false);
  assertEquals(message.includes('eyJ'), false);
  assertEquals(message.includes('provider_debug_id'), false);
});
