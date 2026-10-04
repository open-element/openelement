import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import { type RouteRecord, RouteTable } from '../src/internal/router/route-table.ts';

test('duplicate route identities are rejected, explicit and positional alike', () => {
  assertThrowsIncludes(
    () =>
      new RouteTable([
        { path: '/a', id: 'dup' },
        { path: '/b', id: 'dup' },
      ]),
    TypeError,
    'Duplicate route identity',
  );
  // Positional identity cannot collide: distinct records get distinct defaults.
  const table = new RouteTable([{ path: '/a' }, { path: '/a' }]);
  expect(table.match('/a')?.id).toEqual('0');
});

test('URL winner precedes method dispatch, including overlapping explicit records', () => {
  const routes = [
    { path: '/products/new', methods: ['GET'] },
    { path: '/products/:id', methods: ['POST'] },
  ];
  const resolution = new RouteTable(routes).resolve('/products/new', '', 'POST');
  expect(resolution.kind).toEqual('method-not-allowed');
  if (resolution.kind === 'method-not-allowed') expect(resolution.allow).toEqual(['GET', 'HEAD']);
  expect(new RouteTable([...routes].reverse()).resolve('/products/new', '', 'POST').kind).toEqual(
    'match',
  );
});

test('query never becomes a path capture', () => {
  const match = new RouteTable([{ path: '/items/:id' }]).match(
    '/items/a%252Fb',
    '?id=query&view=&view=full',
  );
  expect(Object.entries(match?.params ?? {})).toEqual([['id', 'a%2Fb']]);
});

test('resolution snapshots and full URL component patterns preserve URLPattern semantics', () => {
  const routes = [
    {
      id: 'secure',
      path: '/items/:id',
      pattern: { hostname: 'shop.example', protocol: 'https' },
      methods: ['get'],
    },
  ];
  const table = new RouteTable(routes);
  routes[0].path = '/changed';
  routes[0].methods.push('POST');
  const result = table.resolve(new URL('https://shop.example/items/a%2Fb?q=&q=2'));
  expect(result.kind).toEqual('match');
  if (result.kind === 'match') {
    expect(result.id).toEqual('secure');
    expect(result.params.id).toEqual('a/b');
    expect(result.searchParams.getAll('q')).toEqual(['', '2']);
  }
  expect(table.resolve(new URL('https://other.example/items/a')).kind).toEqual('not-found');
  expect(table.resolve('/items/a', '', 'POST').kind).toEqual('not-found');
  expect(
    new RouteTable([{ path: '//a' }]).match(new URL('https://shop.example//a'))?.route.path,
  ).toEqual('//a');
});

test('path is the only pathname truth: pattern.pathname is rejected, not silently honored', () => {
  // Type level: checked against RouteRecord explicitly, RoutePatternComponents
  // omits pathname — the @ts-expect-error pins that this cannot compile.
  const typed: RouteRecord[] = [
    {
      path: '/users/:id',
      pattern: {
        // @ts-expect-error pathname is omitted from RoutePatternComponents
        pathname: '/posts/:slug',
        hostname: 'example.com',
      },
    },
  ];
  assertThrowsIncludes(() => new RouteTable(typed), TypeError, 'only pathname truth');
  // A runtime-only caller (plain JS) is rejected the same way.
  assertThrowsIncludes(
    () =>
      new RouteTable([
        {
          path: '/users/:id',
          pattern: { pathname: '/posts/:slug' } as never,
        },
      ]),
    TypeError,
    'only pathname truth',
  );
  // And the surviving components still match with path-owned pathname.
  const table = new RouteTable([
    {
      path: '/users/:id',
      pattern: { hostname: 'example.com' },
    },
  ]);
  expect(table.match(new URL('https://example.com/users/7'))?.params.id).toEqual('7');
  expect(table.match(new URL('https://other.example/users/7'))).toEqual(null);
});
