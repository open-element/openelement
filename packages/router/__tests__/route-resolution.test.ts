import { assertEquals, assertThrows } from '@std/assert';
import { type RouteRecord, RouteTable } from '../src/internal/router/route-table.ts';

Deno.test('duplicate route identities are rejected, explicit and positional alike', () => {
  assertThrows(
    () => new RouteTable([{ path: '/a', id: 'dup' }, { path: '/b', id: 'dup' }]),
    TypeError,
    'Duplicate route identity',
  );
  // Positional identity cannot collide: distinct records get distinct defaults.
  const table = new RouteTable([{ path: '/a' }, { path: '/a' }]);
  assertEquals(table.match('/a')?.id, '0');
});

Deno.test('URL winner precedes method dispatch, including overlapping explicit records', () => {
  const routes = [
    { path: '/products/new', methods: ['GET'] },
    { path: '/products/:id', methods: ['POST'] },
  ];
  const resolution = new RouteTable(routes).resolve('/products/new', '', 'POST');
  assertEquals(resolution.kind, 'method-not-allowed');
  if (resolution.kind === 'method-not-allowed') assertEquals(resolution.allow, ['GET', 'HEAD']);
  assertEquals(
    new RouteTable([...routes].reverse()).resolve('/products/new', '', 'POST').kind,
    'match',
  );
});

Deno.test('query never becomes a path capture', () => {
  const match = new RouteTable([{ path: '/items/:id' }]).match(
    '/items/a%252Fb',
    '?id=query&view=&view=full',
  );
  assertEquals(Object.entries(match?.params ?? {}), [['id', 'a%2Fb']]);
});

Deno.test('resolution snapshots and full URL component patterns preserve URLPattern semantics', () => {
  const routes = [{
    id: 'secure',
    path: '/items/:id',
    pattern: { hostname: 'shop.example', protocol: 'https' },
    methods: ['get'],
  }];
  const table = new RouteTable(routes);
  routes[0].path = '/changed';
  routes[0].methods.push('POST');
  const result = table.resolve(new URL('https://shop.example/items/a%2Fb?q=&q=2'));
  assertEquals(result.kind, 'match');
  if (result.kind === 'match') {
    assertEquals(result.id, 'secure');
    assertEquals(result.params.id, 'a/b');
    assertEquals(result.searchParams.getAll('q'), ['', '2']);
  }
  assertEquals(table.resolve(new URL('https://other.example/items/a')).kind, 'not-found');
  assertEquals(table.resolve('/items/a', '', 'POST').kind, 'not-found');
  assertEquals(
    new RouteTable([{ path: '//a' }]).match(new URL('https://shop.example//a'))?.route.path,
    '//a',
  );
});

Deno.test('path is the only pathname truth: pattern.pathname is rejected, not silently honored', () => {
  // Type level: checked against RouteRecord explicitly, RoutePatternComponents
  // omits pathname — the @ts-expect-error pins that this cannot compile.
  const typed: RouteRecord[] = [{
    path: '/users/:id',
    pattern: {
      // @ts-expect-error pathname is omitted from RoutePatternComponents
      pathname: '/posts/:slug',
      hostname: 'example.com',
    },
  }];
  assertThrows(() => new RouteTable(typed), TypeError, 'only pathname truth');
  // A runtime-only caller (plain JS) is rejected the same way.
  assertThrows(
    () =>
      new RouteTable([{
        path: '/users/:id',
        pattern: { pathname: '/posts/:slug' } as never,
      }]),
    TypeError,
    'only pathname truth',
  );
  // And the surviving components still match with path-owned pathname.
  const table = new RouteTable([{
    path: '/users/:id',
    pattern: { hostname: 'example.com' },
  }]);
  assertEquals(table.match(new URL('https://example.com/users/7'))?.params.id, '7');
  assertEquals(table.match(new URL('https://other.example/users/7')), null);
});
