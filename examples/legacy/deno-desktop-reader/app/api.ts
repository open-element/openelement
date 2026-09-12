import type {
  LibraryBook,
  ReaderNote,
  ReaderProgress,
  ReaderSearchResult,
  ReaderSource,
} from './types.ts';

export interface BookDetails {
  book: LibraryBook;
  progress: ReaderProgress | null;
  notes: ReaderNote[];
}

async function requestJson<T>(
  path: string,
  init?: RequestInit,
  fallback?: T,
): Promise<T> {
  try {
    const res = await fetch(path, init);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json() as T;
  } catch (err) {
    console.warn('[reader-api] request failed', { path, err });
    if (fallback !== undefined) return fallback;
    throw err;
  }
}

export function listBooks(): Promise<LibraryBook[]> {
  return requestJson('/api/books', undefined, []);
}

export function getBookDetails(bookId: string): Promise<BookDetails | null> {
  return requestJson<BookDetails | null>(
    `/api/books/${encodeURIComponent(bookId)}`,
    undefined,
    null,
  );
}

export function listSources(): Promise<ReaderSource[]> {
  return requestJson('/api/sources', undefined, []);
}

export function addSource(input: Partial<ReaderSource>): Promise<ReaderSource> {
  return requestJson('/api/sources', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function syncSource(sourceId: string): Promise<{
  source: ReaderSource;
  books: LibraryBook[];
}> {
  return requestJson(`/api/sources/${encodeURIComponent(sourceId)}/sync`, {
    method: 'POST',
  });
}

export function searchLibrary(query: string): Promise<ReaderSearchResult[]> {
  return requestJson(
    `/api/search?q=${encodeURIComponent(query)}`,
    undefined,
    [],
  );
}

export function listNotes(bookId?: string): Promise<ReaderNote[]> {
  return requestJson(
    bookId ? `/api/notes?bookId=${encodeURIComponent(bookId)}` : '/api/notes',
    undefined,
    [],
  );
}

export function saveNote(input: {
  bookId: string;
  page?: number;
  quote?: string;
  text: string;
}): Promise<ReaderNote> {
  return requestJson('/api/notes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function deleteNote(noteId: string): Promise<{ deleted: true }> {
  return requestJson(`/api/notes/${encodeURIComponent(noteId)}`, {
    method: 'DELETE',
  });
}

export function saveProgress(input: {
  bookId: string;
  page: number;
  zoom: number;
}): Promise<ReaderProgress> {
  return requestJson(
    `/api/books/${encodeURIComponent(input.bookId)}/progress`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ page: input.page, zoom: input.zoom }),
    },
  );
}
