import { expect, test } from 'vitest';
import { validateHeaderValue } from 'node:http';
import {
  createSiteRedirectMiddleware,
  siteRedirectSources,
  type SiteRedirect,
} from '../lib/site-redirects.ts';

const redirects: SiteRedirect[] = [
  { from: '/architecture/islands', to: '/guide/islands-and-ssr', status: 301 },
  {
    from: '/architecture/benchmark',
    to: '/architecture#measured-output',
    toZh: '/architecture#实测输出',
    status: 301,
  },
];

function request(url: string | undefined) {
  const headers = new Map<string, string>();
  const result = { statusCode: 200, ended: false, headers };
  let nextCalled = false;
  createSiteRedirectMiddleware(redirects)(
    { url } as never,
    {
      setHeader: (name: string, value: string) => {
        validateHeaderValue(name, value);
        headers.set(name, value);
      },
      end: () => (result.ended = true),
      get statusCode() {
        return result.statusCode;
      },
      set statusCode(value: number) {
        result.statusCode = value;
      },
    } as never,
    () => {
      nextCalled = true;
    },
  );
  return { ...result, nextCalled };
}

test('deployment redirect sources include both exact slash forms per locale', () => {
  expect(siteRedirectSources(redirects[0])).toEqual([
    '/architecture/islands',
    '/architecture/islands/',
  ]);
  expect(siteRedirectSources(redirects[0], '/zh')).toEqual([
    '/zh/architecture/islands',
    '/zh/architecture/islands/',
  ]);
});

test('site dev redirects accept slash variants and retain locale, query and fragment targets', () => {
  for (const path of ['/architecture/islands', '/architecture/islands/']) {
    const result = request(`${path}?source=legacy`);
    expect(result.statusCode).toBe(301);
    expect(result.headers.get('Location')).toBe('/guide/islands-and-ssr/?source=legacy');
    expect(result.ended).toBe(true);
  }

  const zh = request('/zh/architecture/benchmark/?q=1');
  expect(zh.statusCode).toBe(301);
  expect(zh.headers.get('Location')).toBe(
    '/zh/architecture/?q=1#%E5%AE%9E%E6%B5%8B%E8%BE%93%E5%87%BA',
  );

  const en = request('/architecture/benchmark');
  expect(en.headers.get('Location')).toBe('/architecture/#measured-output');
});

test('site dev redirect middleware passes unrelated and missing URLs through', () => {
  expect(request('/guide/getting-started').nextCalled).toBe(true);
  expect(request(undefined).nextCalled).toBe(true);
  expect(request('http://[').nextCalled).toBe(true);
});

test('site dev consumer writes Unicode fragment redirects as valid Node Location headers', () => {
  const response = request('/zh/architecture/benchmark');
  expect(response.statusCode).toBe(301);
  expect(response.headers.get('Location')).toBe(
    '/zh/architecture/#%E5%AE%9E%E6%B5%8B%E8%BE%93%E5%87%BA',
  );
});
