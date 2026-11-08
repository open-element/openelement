/**
 * @openelement/router/document — resolved Document seam tests (Beta.2.2, #1326).
 *
 * The seam is the single place page meaning (title/description/meta/
 * canonical/alternates/locale) is resolved before the serializer runs.
 * These tests pin the resolution policy: static and resolver heads, field
 * validation, normalized link ordering, locale propagation, and purity.
 * End-to-end proof that the resolved document reaches the emitted HTML lives
 * in the app-flow-native fixture matrix.
 */

import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import { OpenElementError, wrapInDocument } from '@openelement/element';
import { resolvePageDocument } from '../src/document.ts';
import type { PageHead, PagePropsContext } from '../src/index.ts';

function ctx(overrides: Partial<PagePropsContext> = {}): PagePropsContext {
  return {
    data: undefined,
    actionData: undefined,
    params: {},
    route: { path: '/notes' },
    meta: {},
    ...overrides,
  };
}

test('resolvePageDocument: a static head passes through with normalized links in order', () => {
  const document = resolvePageDocument(
    {
      title: 'Notes',
      description: 'All notes',
      meta: [{ name: 'robots', content: 'index' }],
      canonical: 'https://example.com/notes',
      alternates: [
        { href: 'https://example.com/notes', hreflang: 'en' },
        { href: 'https://example.com/zh/notes', hreflang: 'zh' },
      ],
      dangerouslyHeadFragments: ['<meta property="og:type" content="website">'],
    },
    ctx(),
  );
  expect(document).toEqual({
    title: 'Notes',
    description: 'All notes',
    meta: [{ name: 'robots', content: 'index' }],
    dangerouslyHeadFragments: ['<meta property="og:type" content="website">'],
    canonical: 'https://example.com/notes',
    alternates: [
      { href: 'https://example.com/notes', hreflang: 'en' },
      { href: 'https://example.com/zh/notes', hreflang: 'zh' },
    ],
    links: [
      { rel: 'canonical', href: 'https://example.com/notes' },
      { rel: 'alternate', href: 'https://example.com/notes', hreflang: 'en' },
      { rel: 'alternate', href: 'https://example.com/zh/notes', hreflang: 'zh' },
    ],
  });
});

test('resolvePageDocument: a resolver receives the request-scoped context', () => {
  interface NoteData {
    note: { title: string };
  }
  const context = ctx({
    data: { note: { title: 'First note' } },
    params: { id: 'n1' },
    locale: 'zh',
  });
  let received: PagePropsContext | undefined;
  const document = resolvePageDocument((c) => {
    received = c;
    const data = c.data as NoteData | undefined;
    return {
      title: data?.note.title ?? 'Note',
      canonical: `https://example.com/notes/${c.params.id}`,
    };
  }, context);
  expect(received).toEqual(context);
  expect(document.title).toEqual('First note');
  expect(document.lang).toEqual('zh');
  expect(document.links).toEqual([{ rel: 'canonical', href: 'https://example.com/notes/n1' }]);
});

test('resolvePageDocument: an undefined head resolves to an empty document carrying the locale', () => {
  expect(resolvePageDocument(undefined, ctx({ locale: 'en' }))).toEqual({
    lang: 'en',
    links: [],
  });
  expect(resolvePageDocument(undefined, ctx())).toEqual({ links: [] });
});

test('resolvePageDocument: an empty locale never becomes the document language', () => {
  // ADR-0172: the seam stays undefined unless a locale is actually derived;
  // '' is not a locale, so the configured head.lang fallback keeps working.
  expect(resolvePageDocument(undefined, ctx({ locale: '' }))).toEqual({ links: [] });
});

test('resolvePageDocument: malformed heads fail loudly', () => {
  const cases: Array<[string, PageHead | (() => never)]> = [
    ['resolver returning null', (() => null) as never],
    ['resolver returning an array', (() => []) as never],
    ['non-string title', { title: 42 } as unknown as PageHead],
    ['non-string description', { description: 7 } as unknown as PageHead],
    ['non-array meta', { meta: {} } as unknown as PageHead],
    [
      'non-string head fragment',
      { dangerouslyHeadFragments: ['<meta>', 5] } as unknown as PageHead,
    ],
    ['non-string canonical', { canonical: 9 } as unknown as PageHead],
    ['non-array alternates', { alternates: 'x' } as unknown as PageHead],
    ['alternate without href', { alternates: [{ hreflang: 'en' }] } as unknown as PageHead],
    ['alternate with empty href', { alternates: [{ href: '' }] }],
    [
      'alternate with non-string hreflang',
      { alternates: [{ href: 'https://example.com/', hreflang: 3 }] } as unknown as PageHead,
    ],
  ];
  for (const [name, head] of cases) {
    assertThrowsIncludes(
      () => resolvePageDocument(head as PageHead, ctx()),
      Error,
      '[openElement] resolvePageDocument:',
      name,
    );
  }
});

test('resolvePageDocument: resolution is pure, deterministic, and does not mutate its input', () => {
  const head: PageHead = {
    title: 'Notes',
    canonical: 'https://example.com/notes',
    alternates: [{ href: 'https://example.com/zh/notes', hreflang: 'zh' }],
  };
  const snapshot = structuredClone(head);
  const first = resolvePageDocument(head, ctx());
  const second = resolvePageDocument(head, ctx());
  expect(first).toEqual(second);
  expect(head).toEqual(snapshot);
});

test('resolvePageDocument: the resolver runs once per resolution, not per field', () => {
  let calls = 0;
  resolvePageDocument(() => {
    calls += 1;
    return { title: 'Counted' };
  }, ctx());
  expect(calls).toEqual(1);
});

test('resolvePageDocument: dangerouslyHeadFragments rejects <script> (fail-closed, route-data channel)', () => {
  assertThrowsIncludes(
    () =>
      resolvePageDocument(
        ({ data }: PagePropsContext) => ({
          dangerouslyHeadFragments: [
            `<meta name="x" content="${String(data)}"><script>alert(1)</script>`,
          ],
        }),
        ctx({ data: 'user input' }),
      ),
    OpenElementError,
    'must not contain <script>',
  );
});

test('resolvePageDocument: dangerouslyHeadFragments rejects blacklisted CSS in <style>', () => {
  assertThrowsIncludes(
    () =>
      resolvePageDocument(
        {
          dangerouslyHeadFragments: ['<style>@import url("https://evil.example/x.css");</style>'],
        },
        ctx(),
      ),
    OpenElementError,
    'Unsafe CSS',
  );
});

test('resolvePageDocument: dangerouslyHeadFragments accepts benign meta and style', () => {
  const document = resolvePageDocument(
    {
      dangerouslyHeadFragments: [
        '<meta property="og:title" content="Notes">',
        '<style media="print">body { color: black; }</style>',
      ],
    },
    ctx(),
  );
  expect(document.dangerouslyHeadFragments?.length).toEqual(2);
});

test('resolvePageDocument: the JSON-LD channel does not relax the <script> ban on raw fragments', () => {
  // The structured channel is an ADDITIONAL path; the rejected raw channel
  // keeps rejecting every <script> tag, including a well-formed ld+json one.
  assertThrowsIncludes(
    () =>
      resolvePageDocument(
        {
          dangerouslyHeadFragments: [
            '<script type="application/ld+json">{"@type":"WebSite"}</script>',
          ],
        },
        ctx(),
      ),
    OpenElementError,
    'must not contain <script>',
  );
});

test('resolvePageDocument: structured data resolves into normalized JSON-LD documents', () => {
  const head: PageHead = {
    structuredData: [
      {
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline: 'Notes',
        author: { '@type': 'Organization', name: 'openElement' },
        keywords: ['release', 'notes'],
      },
    ],
  };
  const snapshot = structuredClone(head);
  const document = resolvePageDocument(head, ctx());
  expect(document.structuredData).toEqual(head.structuredData);
  expect(head).toEqual(snapshot);
  // The resolved value is an inert copy: a null-prototype tree, so no
  // `__proto__` key can rewrite a prototype on the way to the serializer.
  expect(Object.getPrototypeOf(document.structuredData?.[0])).toEqual(null);
  expect(Object.getPrototypeOf(document.structuredData?.[0].author)).toEqual(null);
});

test('resolvePageDocument: malformed structured data fails loudly', () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const cases: Array<[string, unknown]> = [
    ['non-array structured data', {}],
    [
      'a string entry (an HTML fragment is not a JSON-LD document)',
      '<script type="application/ld+json">{}</script>',
    ],
    ['an array entry', [[{ '@type': 'WebSite' }]]],
    ['a null entry', [null]],
    ['a function value', [{ '@type': 'WebSite', run: () => 1 }]],
    ['an undefined value', [{ '@type': 'WebSite', name: undefined }]],
    ['a bigint value', [{ '@type': 'WebSite', count: 1n }]],
    ['a non-finite number', [{ '@type': 'WebSite', width: Number.NaN }]],
    ['a Date instance', [{ '@type': 'WebSite', datePublished: new Date(0) }]],
    ['a Map instance', [{ '@type': 'WebSite', extra: new Map() }]],
    ['a circular document', [circular]],
  ];
  for (const [name, structuredData] of cases) {
    assertThrowsIncludes(
      () => resolvePageDocument({ structuredData } as unknown as PageHead, ctx()),
      Error,
      '[openElement] resolvePageDocument:',
      name,
    );
  }
});

test('resolvePageDocument: clientScripts ride the resolved document (#1471) and stay pure', () => {
  const descriptors = [{ type: 'module', src: '/client/islands/client.js' }];
  const first = resolvePageDocument(undefined, ctx(), descriptors);
  const second = resolvePageDocument(undefined, ctx(), descriptors);
  expect(first).toEqual({
    links: [],
    clientScripts: [{ type: 'module', src: '/client/islands/client.js' }],
  });
  expect(first).toEqual(second);
  // No scripts handed in: the field stays absent, the document shape is
  // byte-equal to the pre-#1471 contract.
  expect(resolvePageDocument({ title: 'Notes' }, ctx())).toEqual({
    title: 'Notes',
    links: [],
  });
  // The serializer renders the tag at document time; nothing is dropped.
  const html = wrapInDocument('<p>ok</p>', {
    scripts: resolvePageDocument(undefined, ctx(), descriptors).clientScripts,
  });
  expect(
    html.endsWith(
      '<script type="module" src="/client/islands/client.js"></script>\n</body>\n</html>',
    ),
  ).toEqual(true);
});

test('resolvePageDocument + wrapInDocument: the resolved JSON-LD reaches <head> escaped', () => {
  // Composition proof for both serialization paths (the SSG entry and the
  // request-time entry both feed raw values into the same call).
  const document = resolvePageDocument(
    {
      title: 'Notes',
      canonical: 'https://example.com/notes',
      structuredData: [
        {
          '@context': 'https://schema.org',
          '@type': 'BlogPosting',
          headline: 'Notes</script><script>alert(1)</script>',
        },
      ],
    },
    ctx(),
  );
  const html = wrapInDocument('<p>ok</p>', {
    title: document.title,
    links: document.links,
    structuredData: document.structuredData,
  });
  const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
  const open = '<script type="application/ld+json">';
  const start = head.indexOf(open);
  expect(start > 0, head).toEqual(true);
  // Exactly one end tag in the whole document — the framework's own — and no
  // raw script sequence from the payload reaches the markup.
  expect((html.match(/<\/script>/g) ?? []).length).toEqual(1);
  expect(head.includes('<script>alert(1)')).toEqual(false);
  expect(head.includes('</script><script')).toEqual(false);
  const body = head.slice(start + open.length, head.indexOf('</script>', start));
  expect(JSON.parse(body)).toEqual({
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: 'Notes</script><script>alert(1)</script>',
  });
});

// ─── Route-resolved raw fragment allowlist (alpha15 security lane S5) ───
//
// `dangerouslyHeadFragments` is the only raw-head channel reachable from
// request data (loader output, params, query), and it is concatenated into
// `<head>` as authored bytes. The two legacy predicates (script regex + style
// scan) let `</head>`, `<base>`, comments and an EOF-terminated `<script`
// through, so the route channel now admits ONLY top-level meta/link/style
// elements plus inter-element whitespace.

test('resolvePageDocument: dangerouslyHeadFragments rejects markup that can leave the head', () => {
  const escapes = [
    '</head><body><h1>pwned</h1>',
    '<base href="https://evil.example/">',
    '<!-- <meta charset="utf-8">',
    '<script',
    '<iframe src="/x"></iframe>',
    '<object data="/x"></object>',
    '<template><meta charset="utf-8"></template>',
    '<svg><g></g></svg>',
    '<math><mtext></mtext></math>',
    '<div>not a head element</div>',
    'plain text between tags',
    '<meta charset="utf-8"',
  ];
  for (const fragment of escapes) {
    assertThrowsIncludes(
      () => resolvePageDocument({ dangerouslyHeadFragments: [fragment] }, ctx()),
      OpenElementError,
      'head.dangerouslyHeadFragments',
    );
  }
});

test('resolvePageDocument: dangerouslyHeadFragments accepts the meta/link/style allowlist', () => {
  const document = resolvePageDocument(
    {
      dangerouslyHeadFragments: [
        '  <meta property="og:title" content="Notes">\n',
        '<link rel="preload" href="/font.woff2" as="font" crossorigin>',
        '<style media="print">body { color: black; }</style>',
        ' <meta name="x" content="<not markup>"> ',
      ],
    },
    ctx(),
  );
  expect(document.dangerouslyHeadFragments?.length).toEqual(4);
});

// ── JSON-model normalization and optional-field branches ──────────────────
//
// The structured-data copy is fail-closed for values JSON cannot carry, and
// the optional head fields must round-trip whether present or absent.

test('structured data copies null and finite numbers, and nested documents keep them', () => {
  const document = resolvePageDocument(
    {
      structuredData: [{ '@type': 'Thing', missing: null, count: 0, ok: true }],
    },
    ctx(),
  );
  expect(document.structuredData).toEqual([
    { '@type': 'Thing', missing: null, count: 0, ok: true },
  ]);
});

test('structured data rejects non-finite numbers', () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assertThrowsIncludes(
      () => resolvePageDocument({ structuredData: [{ value }] }, ctx()),
      OpenElementError,
      'must be a finite number',
    );
  }
});

test('structured data rejects non-document entries with a named shape', () => {
  for (const [entry, shape] of [
    [null, 'null'],
    [[], 'an array'],
    [42, 'number'],
  ] as const) {
    assertThrowsIncludes(
      () => resolvePageDocument({ structuredData: [entry] }, ctx()),
      OpenElementError,
      `got ${shape}`,
    );
  }
});

test('alternates reject a non-object entry with the index named', () => {
  for (const alternate of [null, [], 'https://example.test/x']) {
    assertThrowsIncludes(
      () => resolvePageDocument({ alternates: [alternate] as never }, ctx()),
      OpenElementError,
      'head.alternates[0] must be an object with an href',
    );
  }
});

test('an alternate without hreflang round-trips without the optional field', () => {
  const document = resolvePageDocument(
    { alternates: [{ href: 'https://example.test/en' }] },
    ctx(),
  );
  expect(document.alternates).toEqual([{ href: 'https://example.test/en' }]);
  expect(document.links).toEqual([{ rel: 'alternate', href: 'https://example.test/en' }]);
});

test('an empty clientScripts list is normalized away', () => {
  const document = resolvePageDocument({ clientScripts: [] }, ctx());
  expect(document.clientScripts).toEqual(undefined);
  expect('clientScripts' in document).toEqual(false);
});
