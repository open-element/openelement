/**
 * Smoke tests for route components.
 * Tests verify route exports and compile-time authoring contracts without
 * executing the removed runtime JSX factory.
 */

import { assertEquals, assertFalse, assertStringIncludes } from '@std/assert';

// ─── Minimal DOM mock for Deno test environment ──────────────────
// Covers only the DOM APIs the route components actually touch:
// an HTMLElement base class for the OpenElement page classes, and an
// in-memory customElements registry for Shoelace and the retained autonomous
// Preact islands. Compiled pages are registered by the adapter delivery entry.

class MockElement {
  tagName: string;

  constructor(tag = 'mock-element') {
    this.tagName = tag.toUpperCase();
  }
}

// deno-lint-ignore no-explicit-any
(globalThis as any).HTMLElement = MockElement;
/** In-memory registry backing the customElements mock. */
const definedCustomElements = new Map<string, CustomElementConstructor>();
// deno-lint-ignore no-explicit-any
(globalThis as any).customElements = {
  get: (tagName: string) => definedCustomElements.get(tagName),
  define: (tagName: string, ctor: CustomElementConstructor) => {
    definedCustomElements.set(tagName, ctor);
  },
};

Deno.test('Bookshelf route exports a function', async () => {
  const mod = await import('../../routes/index.tsx');
  assertEquals(typeof mod.default, 'function');
});

Deno.test('Reading route exports a function', async () => {
  const mod = await import('../../routes/books/[id].tsx');
  assertEquals(typeof mod.default, 'function');
});

Deno.test('Notes route exports a function', async () => {
  const mod = await import('../../routes/notes.tsx');
  assertEquals(typeof mod.default, 'function');
});

Deno.test('Search route exports a function', async () => {
  const mod = await import('../../routes/search.tsx');
  assertEquals(typeof mod.default, 'function');
});

Deno.test('Settings route exports a function', async () => {
  const mod = await import('../../routes/settings.tsx');
  assertEquals(typeof mod.default, 'function');
});

Deno.test('Settings action adds and immediately syncs a source', async () => {
  const mod = await import('../../routes/settings.tsx');
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url === '/api/sources') {
      return Promise.resolve(
        new Response(
          JSON.stringify({ id: 'local-papers', kind: 'local', label: 'Papers' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    }
    if (url === '/api/sources/local-papers/sync') {
      return Promise.resolve(
        new Response(
          JSON.stringify({ source: { id: 'local-papers' }, books: [{ id: 'paper-1' }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    }
    return Promise.resolve(new Response('not found', { status: 404 }));
  }) as typeof fetch;

  try {
    const formData = new FormData();
    formData.set('kind', 'local');
    formData.set('label', 'Papers');
    formData.set('root', '/tmp/papers');
    const result = await mod.action({ formData });
    assertEquals(result, { added: 'local-papers', synced: 1 });
    assertEquals(calls, [
      'POST /api/sources',
      'POST /api/sources/local-papers/sync',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('Settings source form submits only through the route action (#1064)', async () => {
  const source = await Deno.readTextFile(new URL('../../routes/settings.tsx', import.meta.url));
  assertStringIncludes(source, "<form class='source-form'>");
  // A JSX onSubmit would re-run addSource/syncSource on top of the route
  // action dispatched by the open-button submit (#1064).
  assertFalse(source.includes('onSubmit='));
});

Deno.test('WC Interop route exports a function', async () => {
  const mod = await import('../../routes/wc-interop.tsx');
  assertEquals(typeof mod.default, 'function');
});

Deno.test('WC Interop route renders third-party, OpenElement UI, and island tags', async () => {
  const source = await Deno.readTextFile(new URL('../../routes/wc-interop.tsx', import.meta.url));
  const expectedTags = [
    'sl-button',
    'open-button',
    'open-card',
    'open-input',
    'sync-status-island',
  ];
  for (const tag of expectedTags) assertStringIncludes(source, `<${tag}`);
});

Deno.test('Shoelace sl-button registers via route side-effect import', async () => {
  await import('../../routes/wc-interop.tsx');
  assertEquals(typeof customElements.get('sl-button'), 'function');
});

Deno.test('Reader Preact islands register deterministic custom elements', async () => {
  await Promise.all([
    import('../../islands/pdf-reader-island.tsx'),
    import('../../islands/search-box-island.tsx'),
    import('../../islands/sync-status-island.tsx'),
  ]);

  assertEquals(typeof customElements.get('pdf-reader-island'), 'function');
  assertEquals(typeof customElements.get('search-box-island'), 'function');
  assertEquals(typeof customElements.get('sync-status-island'), 'function');
});

Deno.test('Bookshelf action surfaces sync errors instead of throwing', async () => {
  const mod = await import('../../routes/index.tsx');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response('boom', { status: 500 }));

  try {
    const result = await mod.action({ formData: new FormData() });
    assertEquals(typeof result.error, 'string');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('Bookshelf uses compiled registration and no legacy rerender hook', async () => {
  const source = await Deno.readTextFile(new URL('../../routes/index.tsx', import.meta.url));
  assertStringIncludes(source, "@element('reader-bookshelf'");
  assertFalse(source.includes('customElements.define'));
  assertFalse(source.includes('this.update()'));
});
