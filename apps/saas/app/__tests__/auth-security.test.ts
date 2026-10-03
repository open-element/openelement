import { expect, test } from 'vitest';
import { publicAuthError, safeInternalNext } from '../../lib/auth-security.ts';

test('safeInternalNext accepts only application-relative destinations', () => {
  expect(safeInternalNext('/notes')).toEqual('/notes');
  expect(safeInternalNext('/notes?tab=mine#latest')).toEqual('/notes?tab=mine#latest');
});

test('safeInternalNext rejects external, protocol-relative and backslash redirects', () => {
  for (const attack of [
    'https://evil.example',
    '//evil.example/path',
    '/\\evil.example',
    '\\evil.example',
    'javascript:alert(1)',
  ])
    expect(safeInternalNext(attack)).toEqual('/notes');
});

test('safeInternalNext rejects single and double encoded redirect bypasses', () => {
  for (const attack of [
    '%2F%2Fevil.example',
    '%252F%252Fevil.example',
    '/%5Cevil.example',
    '/%255Cevil.example',
    '/%00evil',
    '/%2500evil',
    '%E0%A4%A',
  ])
    expect(safeInternalNext(attack)).toEqual('/notes');
});

test('publicAuthError never reflects provider/session material', () => {
  const secret = 'code=private-code eyJprivate.jwt provider_debug_id=123';
  const message = publicAuthError(new Error(secret));
  expect(message.includes('private-code')).toEqual(false);
  expect(message.includes('eyJ')).toEqual(false);
  expect(message.includes('provider_debug_id')).toEqual(false);
});
