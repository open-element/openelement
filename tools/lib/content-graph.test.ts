/** Content Graph schema, validation, determinism and query tests (#1157). */
import { assertEquals } from '@std/assert';
import {
  type ContentGraph,
  docRoutes,
  type GraphEntry,
  localeAvailability,
  searchRecords,
  seoEntries,
  serializeContentGraph,
  validateContentGraph,
} from './content-graph.ts';

function entry(partial: Partial<GraphEntry> & { id: string }): GraphEntry {
  return {
    kind: 'article',
    locale: 'en',
    source: { path: 'content/x.md' },
    alternates: [],
    references: [],
    fingerprint: `fp-${partial.id}`,
    data: {},
    ...partial,
  };
}

function graph(entries: GraphEntry[]): ContentGraph {
  return { version: 1, generated: 'deterministic', entries };
}

const OPTIONS = { routes: ['/', '/guide/a', '/guide/b'], locales: ['en', 'zh'] };

Deno.test('serializeContentGraph: entry order and payload key order do not change bytes', () => {
  const a = entry({
    id: 'article:guide/a:en',
    route: '/guide/a',
    data: { title: 'A', order: 2, lede: 'first' },
  });
  const b = entry({ id: 'article:guide/b:en', route: '/guide/b', data: { title: 'B' } });
  const forward = serializeContentGraph(graph([a, b]));
  const reordered = serializeContentGraph(graph([
    { ...b, data: { title: 'B' } },
    { ...a, data: { lede: 'first', order: 2, title: 'A' } },
  ]));
  assertEquals(forward, reordered);
  assertEquals(forward, serializeContentGraph(JSON.parse(forward)));
});

Deno.test('serializeContentGraph: alternates and references are sorted', () => {
  const source = serializeContentGraph(graph([
    entry({
      id: 'article:guide/a:en',
      route: '/guide/a',
      alternates: [{ locale: 'zh', id: 'article:guide/a:zh' }],
      references: [
        { kind: 'route', target: '/guide/b', line: 9 },
        { kind: 'entry', target: 'article:guide/b:en', line: 3 },
      ],
    }),
    entry({
      id: 'article:guide/a:zh',
      locale: 'zh',
      route: '/guide/a',
      alternates: [{ locale: 'en', id: 'article:guide/a:en' }],
    }),
    entry({ id: 'article:guide/b:en', route: '/guide/b' }),
  ]));
  const again = serializeContentGraph(JSON.parse(source));
  assertEquals(source, again);
  const entryIndex = source.indexOf('"kind": "entry"');
  const routeIndex = source.indexOf('"kind": "route"');
  assertEquals(entryIndex !== -1 && entryIndex < routeIndex, true);
});

Deno.test('validateContentGraph: duplicate ids fail closed', () => {
  const failures = validateContentGraph(
    graph([entry({ id: 'article:guide/a:en' }), entry({ id: 'article:guide/a:en' })]),
    OPTIONS,
  );
  assertEquals(failures.length, 1);
  assertEquals(failures[0].message.includes('duplicate entry id'), true);
});

Deno.test('validateContentGraph: broken entry and route references fail closed', () => {
  const failures = validateContentGraph(
    graph([
      entry({
        id: 'article:guide/a:en',
        references: [
          { kind: 'entry', target: 'article:guide/missing:en', line: 4 },
          { kind: 'route', target: '/no-such-route' },
          { kind: 'route', target: '/guide/b' },
        ],
      }),
      entry({ id: 'article:guide/b:en', route: '/guide/b' }),
    ]),
    OPTIONS,
  );
  assertEquals(failures.length, 2);
  assertEquals(failures[0].message.includes("'article:guide/missing:en' at line 4"), true);
  assertEquals(failures[1].message.includes("'/no-such-route'"), true);
});

Deno.test('validateContentGraph: a route reference to an entry route resolves', () => {
  const failures = validateContentGraph(
    graph([
      entry({
        id: 'article:guide/a:en',
        references: [{ kind: 'route', target: '/guide/b' }],
      }),
      entry({ id: 'article:guide/b:en', route: '/guide/b' }),
    ]),
    { routes: [], locales: ['en', 'zh'] },
  );
  assertEquals(failures, []);
});

Deno.test('validateContentGraph: orphan non-default locale fails closed', () => {
  const failures = validateContentGraph(
    graph([entry({ id: 'article:guide/a:zh', locale: 'zh', source: { path: 'a.zh.md' } })]),
    OPTIONS,
  );
  assertEquals(failures.length, 1);
  assertEquals(failures[0].message.includes('orphan zh entry'), true);
});

Deno.test('validateContentGraph: false, mistyped, asymmetric and untranslated alternates fail', () => {
  const paired = (fingerprintA: string, fingerprintB: string, backlink = true) => [
    entry({
      id: 'article:guide/a:en',
      fingerprint: fingerprintA,
      alternates: [{ locale: 'zh', id: 'article:guide/a:zh' }],
    }),
    entry({
      id: 'article:guide/a:zh',
      locale: 'zh',
      fingerprint: fingerprintB,
      alternates: backlink ? [{ locale: 'en', id: 'article:guide/a:en' }] : [],
    }),
  ];

  // Missing alternate target.
  let failures = validateContentGraph(
    graph([entry({
      id: 'article:guide/a:en',
      alternates: [{ locale: 'zh', id: 'article:guide/a:zh' }],
    })]),
    OPTIONS,
  );
  assertEquals(failures.some((f) => f.message.includes('false locale alternate')), true);

  // Wrong locale on the alternate target.
  failures = validateContentGraph(
    graph([
      entry({
        id: 'article:guide/a:en',
        alternates: [{ locale: 'zh', id: 'article:guide/b:en' }],
      }),
      entry({ id: 'article:guide/b:en' }),
    ]),
    OPTIONS,
  );
  assertEquals(failures.some((f) => f.message.includes("entry locale is 'en', not 'zh'")), true);

  // Asymmetric pair.
  failures = validateContentGraph(graph(paired('fp-en', 'fp-zh', false)), OPTIONS);
  assertEquals(failures.some((f) => f.message.includes('asymmetric locale alternate')), true);

  // Byte-identical "translation".
  failures = validateContentGraph(graph(paired('same', 'same')), OPTIONS);
  assertEquals(failures.some((f) => f.message.includes('byte-identical')), true);

  // A symmetric, translated pair passes.
  failures = validateContentGraph(graph(paired('fp-en', 'fp-zh')), OPTIONS);
  assertEquals(failures, []);
});

Deno.test('queries: docRoutes, localeAvailability, searchRecords and seoEntries', () => {
  const g = graph([
    entry({
      id: 'article:guide/a:en',
      route: '/guide/a',
      alternates: [{ locale: 'zh', id: 'article:guide/a:zh' }],
      data: { title: 'Alpha', lede: 'first guide' },
    }),
    entry({
      id: 'article:guide/a:zh',
      locale: 'zh',
      route: '/guide/a',
      alternates: [{ locale: 'en', id: 'article:guide/a:en' }],
      data: { title: '甲' },
    }),
    entry({ id: 'article:guide/b:en', route: '/guide/b', data: { title: 'Beta' } }),
    entry({ id: 'release:v0.44.0-beta.1', kind: 'release', data: { title: 'v0.44.0-beta.1' } }),
  ]);

  assertEquals(
    docRoutes(g, ['en', 'zh']),
    [
      { route: '/guide/a', locale: 'en', id: 'article:guide/a:en' },
      { route: '/guide/a', locale: 'zh', id: 'article:guide/a:zh' },
      { route: '/zh/guide/a', locale: 'zh', id: 'article:guide/a:zh' },
      { route: '/guide/b', locale: 'en', id: 'article:guide/b:en' },
    ].sort((x, y) => x.route.localeCompare(y.route)),
  );

  assertEquals(localeAvailability(g), {
    '/guide/a': ['en', 'zh'],
    '/guide/b': ['en'],
  });

  assertEquals(searchRecords(g).map((record) => [record.route, record.locale, record.title]), [
    ['/guide/a', 'en', 'Alpha'],
    ['/guide/a', 'zh', '甲'],
    ['/guide/b', 'en', 'Beta'],
  ]);

  const seo = seoEntries(g, ['en', 'zh']);
  assertEquals(seo.length, 3);
  assertEquals(seo[0], {
    route: '/guide/a',
    locale: 'en',
    title: 'Alpha',
    description: 'first guide',
    alternates: { en: '/guide/a', zh: '/zh/guide/a' },
  });
  assertEquals(seo[1], {
    route: '/guide/b',
    locale: 'en',
    title: 'Beta',
    description: '',
    alternates: { en: '/guide/b' },
  });
  assertEquals(seo[2].route, '/zh/guide/a');
  assertEquals(seo[2].title, '甲');
});
