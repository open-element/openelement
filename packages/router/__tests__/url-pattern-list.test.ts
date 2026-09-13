import { assertEquals, assertStrictEquals, assertThrows } from '@std/assert';
import { type ListPattern, URLPatternList } from '@openelement/url-pattern-list';
import { URLPatternPolyfillConstructor } from '../src/internal/router/route-table.ts';

/** Build a list from entry pairs (the package registers via addPattern). */
function listFromEntries<T>(
  entries: Iterable<readonly [ListPattern, T]>,
): URLPatternList<T> {
  const list = new URLPatternList<T>();
  for (const [pattern, value] of entries) list.addPattern(pattern, value);
  return list;
}

const constructors = [
  ['polyfill', URLPatternPolyfillConstructor],
  ...('URLPattern' in globalThis ? [['native', globalThis.URLPattern] as const] : []),
] as const;

for (const [name, Pattern] of constructors) {
  Deno.test(`URLPatternList ${name}: complete results and identity against ordered oracle`, () => {
    const patterns = [
      '/',
      '/static',
      '/:id',
      '/a/:first/:second',
      '/assets/:path*',
      '/x/:id(\\d+)',
      '/a{/:id}?',
      '/a/:id+',
      '/a/:id*',
      '/a/\\:literal',
      '/東京',
      '/x/%2F',
      '/shared/prefix/miss',
      '/shared/prefix/:id',
      '/shared/prefix/hit',
      '*',
      '/:__proto__/:constructor',
      '/a//b',
      '/a/',
      '/a/:x([a-z]+)',
    ].map((pathname) => new Pattern({ pathname }));
    patterns.push(new Pattern({ pathname: '/static', search: '', hash: '', port: '' }));
    patterns.push(
      new Pattern({
        protocol: 'https',
        hostname: ':sub.example.com',
        pathname: '/:id',
        search: 'q=:q',
        hash: ':hash',
      }),
    );
    const inputs = [
      '/',
      '/static',
      '/a',
      '/a/b',
      '/a/b/c',
      '/a//b',
      '/a/',
      '/a/:literal',
      '/x/123',
      '/x/abc',
      '/assets',
      '/assets/a/b',
      '/東京',
      '/x/%2F',
      '/x/%252F',
      '/x/%',
      '/shared/prefix/hit',
      '/shared/prefix/no',
      '/missing?q=&q=2#h',
      'https://sub.example.com/a?q=1#h',
    ];
    // Every pair, both orders, including duplicate patterns with distinct values.
    for (const first of patterns) {
      for (const second of patterns) {
        const entries = [[first, {}], [second, {}]] as const;
        const list = listFromEntries(entries);
        for (const input of inputs) {
          const url = new URL(input, 'https://example.com');
          // Upstream-aligned contract: when match() is given a baseURL, exec
          // receives it too, so result.inputs carries the caller's arguments.
          const expected = entries.map(([pattern, value]) => ({
            result: pattern.exec(url.href, 'https://example.com'),
            value,
          })).find((r) => r.result);
          const expectedNoBase = entries.map(([pattern, value]) => ({
            result: pattern.exec(url.href),
            value,
          })).find((r) => r.result);
          const actual = list.match(input, 'https://example.com');
          assertEquals(
            actual?.result ?? null,
            expected?.result ?? null,
            `${name}: ${first.pathname}, ${second.pathname}, ${input}`,
          );
          assertStrictEquals(actual?.value, expected?.value);
          assertEquals(list.match(url)?.result ?? null, expectedNoBase?.result ?? null);
        }
      }
    }
  });

  Deno.test(`URLPatternList ${name}: ignoreCase and empty URL components`, () => {
    const CasePattern = Pattern as unknown as new (
      init: URLPatternInit,
      options: { ignoreCase: boolean },
    ) => URLPattern;
    const entries = [
      [new CasePattern({ pathname: '/Case' }, { ignoreCase: true }), 1],
      [new Pattern({ pathname: '/case', search: '', hash: '', port: '' }), 2],
    ] as const;
    const list = listFromEntries(entries);
    for (
      const input of [
        'https://example.com/case',
        'https://example.com/CASE?q=1',
        'http://example.com:80/case#',
        'http://example.com:81/case',
      ]
    ) {
      const expected = entries.find(([p]) => p.exec(new URL(input).href));
      assertEquals(list.match(input)?.value, expected?.[1]);
      assertEquals(list.match(input)?.result, expected?.[0].exec(new URL(input).href));
    }
  });

  Deno.test(`URLPatternList ${name}: seeded literal/conservative permutations`, () => {
    const seed = 1324;
    let state = seed;
    const next = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
    for (let iteration = 0; iteration < 150; iteration++) {
      const entries = Array.from({ length: 20 }, (_, id) => {
        const pathname = next() % 3 === 0 ? '/shared/:id' : `/shared/${next() % 30}`;
        return [new Pattern({ pathname }), id] as const;
      });
      const input = `https://example.com/shared/${next() % 35}`;
      const mismatch = (candidate: typeof entries) => {
        const actual = listFromEntries(candidate).match(input);
        const expected = candidate.map(([pattern, value]) => ({
          result: pattern.exec(input),
          value,
        }))
          .find((entry) => entry.result);
        return actual?.value !== expected?.value ||
          JSON.stringify(actual?.result) !== JSON.stringify(expected?.result);
      };
      // Deletion shrinking keeps the original input/seed and reduces the route
      // sequence to a 1-minimal reproducer without changing record identities.
      let minimal = entries;
      if (mismatch(entries)) {
        for (let index = 0; index < minimal.length;) {
          const candidate = minimal.filter((_, i) => i !== index);
          if (mismatch(candidate)) {
            minimal = candidate;
            index = 0;
          } else index++;
        }
      }
      assertEquals(
        mismatch(minimal),
        false,
        `seed=${seed} iteration=${iteration} input=${input} patterns=${
          JSON.stringify(minimal.map(([p, value]) => ({ pathname: p.pathname, value })))
        }`,
      );
    }
  });
}

Deno.test('URLPatternList invalid URL boundary is consistent for empty and populated lists', () => {
  for (
    const entries of [[], [[new URLPatternPolyfillConstructor({ pathname: '*' }), 1] as const]]
  ) {
    const list = listFromEntries(entries);
    assertThrows(() => list.match('/relative'), TypeError);
    assertThrows(() => list.match('http://['), TypeError);
    assertEquals(list.match('https://example.com')?.value ?? null, entries.length ? 1 : null);
  }
});

Deno.test('admitted route patterns have consistent native/polyfill observable results', () => {
  for (
    const pathname of [
      '/',
      '/:id',
      '/a/:x*',
      '/a/:x(\\d+)',
      '/a{/:x}?',
      '/東京',
      '/:__proto__',
      '/a//b',
    ]
  ) {
    for (const path of ['/', '/a', '/a/123', '/a/b/c', '/a//b', '/東京', '/%2F', '/%E0%A4%A']) {
      const input = new URL(path, 'https://example.com').href;
      assertEquals(
        new URLPatternPolyfillConstructor({ pathname }).exec(input),
        new URLPattern({ pathname }).exec(input),
        `${pathname} ${input}`,
      );
    }
  }
});
