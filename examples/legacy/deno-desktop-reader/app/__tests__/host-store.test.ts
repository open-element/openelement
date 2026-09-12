import { assert, assertEquals } from '@std/assert';
import {
  addNote,
  addSource,
  exportNotesMarkdown,
  listBooks,
  listSources,
  type ReaderStorePaths,
  saveProgress,
  searchLibrary,
  syncSource,
} from '../host-store.ts';

async function makePaths(): Promise<ReaderStorePaths> {
  const root = await Deno.makeTempDir({ prefix: 'open-reader-test-' });
  const fixturesDir = `${root}/fixtures`;
  await Deno.mkdir(fixturesDir, { recursive: true });
  await Deno.copyFile(
    new URL('../../fixtures/books/metamorphosis.pdf', import.meta.url),
    `${fixturesDir}/sample.pdf`,
  );
  const fixturesJson = new URL(`file://${root}/fixtures.json`);
  await Deno.writeTextFile(
    fixturesJson,
    JSON.stringify([
      {
        id: 'sample',
        title: 'Sample PDF',
        author: 'Reader Test',
        fileName: 'sample.pdf',
        pageCount: 3,
        summary: 'Kafka fixture',
        coverColor: '#375a4f',
      },
    ]),
  );
  return {
    cacheDir: `${root}/cache`,
    booksDir: `${root}/cache/books`,
    fixturesDir,
    fixturesJson,
  };
}

Deno.test('host store loads fixture source and books from clean cache', async () => {
  const paths = await makePaths();
  const sources = listSources(paths);
  const books = listBooks(paths);
  assertEquals(sources[0].id, 'fixtures');
  assertEquals(books.length, 1);
  assertEquals(books[0].sourceId, 'fixtures');
});

Deno.test('host store syncs local source PDFs into library', async () => {
  const paths = await makePaths();
  const localRoot = await Deno.makeTempDir({ prefix: 'open-reader-local-' });
  await Deno.copyFile(
    new URL('../../fixtures/books/heart-of-darkness.pdf', import.meta.url),
    `${localRoot}/alpha-paper.pdf`,
  );
  const source = await addSource(paths, {
    kind: 'local',
    label: 'Local Papers',
    root: localRoot,
  });
  const result = await syncSource(paths, source.id);
  assertEquals(result.books.length, 1);
  assertEquals(result.books[0].title, 'Alpha Paper');
  assert(listBooks(paths).some((book) => book.sourceId === source.id));
});

Deno.test('host store syncs local source PDFs recursively', async () => {
  const paths = await makePaths();
  const localRoot = await Deno.makeTempDir({ prefix: 'open-reader-local-recursive-' });
  await Deno.mkdir(`${localRoot}/nested/deeper`, { recursive: true });
  await Deno.copyFile(
    new URL('../../fixtures/books/frankenstein.pdf', import.meta.url),
    `${localRoot}/nested/deeper/frankenstein-copy.pdf`,
  );
  const source = await addSource(paths, {
    kind: 'local',
    label: 'Nested Papers',
    root: localRoot,
  });
  const result = await syncSource(paths, source.id);
  assertEquals(result.books.length, 1);
  assertEquals(result.books[0].id, 'local-nested-papers-nested--deeper--frankenstein-copy');
});

Deno.test('host store keeps nested path depth in book ids (no slug collision)', async () => {
  const paths = await makePaths();
  const localRoot = await Deno.makeTempDir({ prefix: 'open-reader-collision-' });
  await Deno.mkdir(`${localRoot}/a`, { recursive: true });
  await Deno.mkdir(`${localRoot}/a-b`, { recursive: true });
  await Deno.copyFile(
    new URL('../../fixtures/books/heart-of-darkness.pdf', import.meta.url),
    `${localRoot}/a/b-c.pdf`,
  );
  await Deno.copyFile(
    new URL('../../fixtures/books/frankenstein.pdf', import.meta.url),
    `${localRoot}/a-b/c.pdf`,
  );
  const source = await addSource(paths, {
    kind: 'local',
    label: 'Colliding Papers',
    root: localRoot,
  });
  const result = await syncSource(paths, source.id);
  // Previously both paths slugged to the same id: 'a/b-c' and 'a-b/c' both
  // collapsed to 'a-b-c'.
  assertEquals(result.books.map((book) => book.id).sort(), [
    'local-colliding-papers-a--b-c',
    'local-colliding-papers-a-b--c',
  ]);
});

Deno.test('host store skips unchanged GitHub PDFs by sha', async () => {
  const paths = await makePaths();
  const pdfBytes = await Deno.readFile(
    new URL('../../fixtures/books/metamorphosis.pdf', import.meta.url),
  );
  const originalFetch = globalThis.fetch;
  let downloadCount = 0;

  globalThis.fetch = ((input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/contents')) {
      return Promise.resolve(
        new Response(
          JSON.stringify([
            { type: 'file', name: 'root.pdf', path: 'root.pdf', sha: 'sha-root' },
          ]),
          { status: 200 },
        ),
      );
    }
    downloadCount++;
    return Promise.resolve(new Response(pdfBytes, { status: 200 }));
  }) as typeof fetch;

  try {
    const source = await addSource(paths, {
      kind: 'github',
      label: 'GitHub PDFs',
      repo: 'owner/repo',
      branch: 'main',
    });
    await syncSource(paths, source.id);
    await syncSource(paths, source.id);
    assertEquals(downloadCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('host store preserves existing books when source sync fails', async () => {
  const paths = await makePaths();
  const localRoot = await Deno.makeTempDir({ prefix: 'open-reader-local-fail-' });
  await Deno.copyFile(
    new URL('../../fixtures/books/heart-of-darkness.pdf', import.meta.url),
    `${localRoot}/before-failure.pdf`,
  );
  const source = await addSource(paths, {
    kind: 'local',
    label: 'Fragile Local',
    root: localRoot,
  });
  await syncSource(paths, source.id);
  await Deno.remove(localRoot, { recursive: true });

  let failed = false;
  try {
    await syncSource(paths, source.id);
  } catch {
    failed = true;
  }

  assertEquals(failed, true);
  assert(listBooks(paths).some((book) => book.sourceId === source.id));
  assert(listSources(paths).some((item) => item.id === source.id && item.error));
});

Deno.test('host store does not add GitHub books when PDF download fails', async () => {
  const paths = await makePaths();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = ((input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/contents')) {
      return Promise.resolve(
        new Response(
          JSON.stringify([
            { type: 'file', name: 'missing.pdf', path: 'missing.pdf', sha: 'sha-missing' },
          ]),
          { status: 200 },
        ),
      );
    }
    return Promise.resolve(new Response('not found', { status: 404, statusText: 'Not Found' }));
  }) as typeof fetch;

  try {
    const source = await addSource(paths, {
      kind: 'github',
      label: 'Broken GitHub PDFs',
      repo: 'owner/repo',
      branch: 'main',
    });
    let failed = false;
    try {
      await syncSource(paths, source.id);
    } catch {
      failed = true;
    }

    assertEquals(failed, true);
    assertEquals(listBooks(paths).some((book) => book.sourceId === source.id), false);
    assert(listSources(paths).some((item) => item.id === source.id && item.error));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('host store preserves notes added while a source sync is in flight', async () => {
  const paths = await makePaths();
  const pdfBytes = await Deno.readFile(
    new URL('../../fixtures/books/metamorphosis.pdf', import.meta.url),
  );
  const originalFetch = globalThis.fetch;
  let releaseContents!: () => void;
  const contentsReady = new Promise<void>((resolve) => {
    releaseContents = resolve;
  });

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/contents')) {
      await contentsReady;
      return new Response(
        JSON.stringify([
          { type: 'file', name: 'root.pdf', path: 'root.pdf', sha: 'sha-root' },
        ]),
        { status: 200 },
      );
    }
    return new Response(pdfBytes, { status: 200 });
  }) as typeof fetch;

  try {
    const source = addSource(paths, {
      kind: 'github',
      label: 'Slow GitHub PDFs',
      repo: 'owner/repo',
      branch: 'main',
    });
    const syncing = syncSource(paths, source.id);
    addNote(paths, {
      bookId: 'sample',
      page: 1,
      text: 'Written while syncing',
    });
    releaseContents();
    await syncing;

    const hits = await searchLibrary(paths, 'Written while syncing');
    assert(hits.some((hit) => hit.source === 'note'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('host store persists progress, notes, and Obsidian-friendly markdown', async () => {
  const paths = await makePaths();
  saveProgress(paths, {
    bookId: 'sample',
    page: 2,
    zoom: 1.2,
    updatedAt: new Date().toISOString(),
  });
  addNote(paths, {
    bookId: 'sample',
    page: 2,
    quote: 'Gregor',
    text: 'Remember this.',
  });
  const markdown = exportNotesMarkdown(paths);
  assert(markdown.includes('tags: [open-reader]'));
  assert(markdown.includes('page: 2'));
  assert(markdown.includes('Remember this.'));
});

Deno.test('host store searches metadata and notes', async () => {
  const paths = await makePaths();
  addNote(paths, {
    bookId: 'sample',
    page: 1,
    text: 'A private marginalia hit',
  });
  const titleHits = await searchLibrary(paths, 'sample');
  const noteHits = await searchLibrary(paths, 'marginalia');
  assert(titleHits.some((hit) => hit.source === 'book'));
  assert(noteHits.some((hit) => hit.source === 'note'));
});

Deno.test('host store searches PDF text on first query', async () => {
  const paths = await makePaths();
  const hits = await searchLibrary(paths, 'Gregor');
  assert(hits.some((hit) => hit.source === 'pdf' && hit.bookId === 'sample'));
});

Deno.test('host store handles concurrent first PDF searches', async () => {
  const paths = await makePaths();
  const [first, second] = await Promise.all([
    searchLibrary(paths, 'Gregor'),
    searchLibrary(paths, 'Gregor'),
  ]);

  assert(first.some((hit) => hit.source === 'pdf' && hit.bookId === 'sample'));
  assert(second.some((hit) => hit.source === 'pdf' && hit.bookId === 'sample'));
});
