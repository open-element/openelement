/**
 * @openelement/router/document — resolved Document seam tests (Beta.2.2, #1326).
 *
 * The seam is the single place page meaning (title/description/meta/
 * canonical/alternates/locale) is resolved before either serializer runs.
 * These tests pin the resolution policy: static and resolver heads, field
 * validation, normalized link ordering, locale propagation, and purity.
 * End-to-end proof that both serializers emit the resolved document lives in
 * the app-flow-native / app-flow-lit fixture matrices.
 */

import { assertEquals, assertThrows } from '@std/assert';
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

Deno.test('resolvePageDocument: a static head passes through with normalized links in order', () => {
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
  assertEquals(document, {
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

Deno.test('resolvePageDocument: a resolver receives the request-scoped context', () => {
  interface NoteData {
    note: { title: string };
  }
  const context = ctx({
    data: { note: { title: 'First note' } },
    params: { id: 'n1' },
    locale: 'zh',
  });
  let received: PagePropsContext | undefined;
  const document = resolvePageDocument(
    (c) => {
      received = c;
      const data = c.data as NoteData | undefined;
      return {
        title: data?.note.title ?? 'Note',
        canonical: `https://example.com/notes/${c.params.id}`,
      };
    },
    context,
  );
  assertEquals(received, context);
  assertEquals(document.title, 'First note');
  assertEquals(document.lang, 'zh');
  assertEquals(document.links, [
    { rel: 'canonical', href: 'https://example.com/notes/n1' },
  ]);
});

Deno.test('resolvePageDocument: an undefined head resolves to an empty document carrying the locale', () => {
  assertEquals(resolvePageDocument(undefined, ctx({ locale: 'en' })), {
    lang: 'en',
    links: [],
  });
  assertEquals(resolvePageDocument(undefined, ctx()), { links: [] });
});

Deno.test('resolvePageDocument: malformed heads fail loudly', () => {
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
    assertThrows(
      () => resolvePageDocument(head as PageHead, ctx()),
      Error,
      '[openElement] resolvePageDocument:',
      name,
    );
  }
});

Deno.test('resolvePageDocument: resolution is pure, deterministic, and does not mutate its input', () => {
  const head: PageHead = {
    title: 'Notes',
    canonical: 'https://example.com/notes',
    alternates: [{ href: 'https://example.com/zh/notes', hreflang: 'zh' }],
  };
  const snapshot = structuredClone(head);
  const first = resolvePageDocument(head, ctx());
  const second = resolvePageDocument(head, ctx());
  assertEquals(first, second);
  assertEquals(head, snapshot);
});

Deno.test('resolvePageDocument: the resolver runs once per resolution, not per field', () => {
  let calls = 0;
  resolvePageDocument(
    () => {
      calls += 1;
      return { title: 'Counted' };
    },
    ctx(),
  );
  assertEquals(calls, 1);
});
