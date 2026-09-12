import pdfParse from 'pdf-parse';

import type {
  LibraryBook,
  ReaderNote,
  ReaderProgress,
  ReaderSearchResult,
  ReaderSource,
} from './types.ts';
import { indexBook, loadSearchIndex, search as searchPdfIndex } from './search.ts';

const GITHUB_API = 'https://api.github.com/repos';
const GITHUB_RAW = 'https://raw.githubusercontent.com';

interface SearchIndexJob {
  promise: Promise<void>;
}

const searchIndexJobs = new Map<string, SearchIndexJob>();

export interface ReaderStorePaths {
  cacheDir: string;
  booksDir: string;
  fixturesDir: string;
  fixturesJson: URL;
}

interface ReaderState {
  sources: ReaderSource[];
  books: LibraryBook[];
  notes: ReaderNote[];
  progress: Record<string, ReaderProgress>;
}

interface GithubContentItem {
  type: string;
  name: string;
  path: string;
  sha: string;
  download_url?: string;
}

const DEFAULT_SOURCE: ReaderSource = {
  id: 'fixtures',
  kind: 'fixtures',
  label: 'Classic PDF fixtures',
  enabled: true,
  root: 'fixtures/books',
};

function stateFile(paths: ReaderStorePaths): string {
  return `${paths.cacheDir}/state.json`;
}

function now(): string {
  return new Date().toISOString();
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(
    /^-|-$/g,
    '',
  ) ||
    'item';
}

function stableBookId(sourceId: string, path: string): string {
  // Slug each path segment separately and join with '--' so nested paths keep
  // their depth: 'a/b-c' and 'a-b/c' would otherwise both slug to 'a-b-c' and
  // share the same id — and the same `${id}.pdf` cache file for GitHub
  // sources (see githubPdfBooks below).
  const segments = path.replace(/\.pdf$/i, '').split('/').map(slug);
  return `${slug(sourceId)}-${segments.join('--')}`;
}

function colorFor(value: string): string {
  const palette = [
    '#375a4f',
    '#7c3f3f',
    '#435b7a',
    '#7a5b2f',
    '#5f4a7a',
    '#4d6470',
  ];
  let hash = 0;
  for (const ch of value) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length];
}

function titleFromFile(fileName: string): string {
  return fileName.replace(/\.pdf$/i, '').replace(/[-_]+/g, ' ').replace(
    /\b\w/g,
    (m) => m.toUpperCase(),
  );
}

function ensureDir(path: string): void {
  Deno.mkdirSync(path, { recursive: true });
}

function readJsonFile<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(Deno.readTextFileSync(path)) as T;
  } catch {
    return fallback;
  }
}

function writeJsonFile(path: string, data: unknown): void {
  Deno.mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
  Deno.writeTextFileSync(path, JSON.stringify(data, null, 2));
}

function loadFixtureBooks(paths: ReaderStorePaths): LibraryBook[] {
  const raw = readJsonFile<Array<Record<string, unknown>>>(
    paths.fixturesJson.pathname,
    [],
  );
  return raw.map((book) => {
    const fileName = String(book.fileName ?? '');
    return {
      id: String(book.id ?? stableBookId('fixtures', fileName)),
      sourceId: 'fixtures',
      title: String(book.title ?? titleFromFile(fileName)),
      author: typeof book.author === 'string' ? book.author : undefined,
      fileName,
      path: `${paths.fixturesDir.replace(/\/$/, '')}/${fileName}`,
      url: `/api/books/${String(book.id ?? stableBookId('fixtures', fileName))}/file`,
      pageCount: Number(book.pageCount ?? 1),
      summary: typeof book.summary === 'string' ? book.summary : undefined,
      coverColor: String(book.coverColor ?? colorFor(fileName)),
      indexedAt: typeof book.indexedAt === 'string' ? book.indexedAt : undefined,
    };
  }).filter((book) => book.fileName.endsWith('.pdf'));
}

function loadState(paths: ReaderStorePaths): ReaderState {
  const state = readJsonFile<Partial<ReaderState>>(stateFile(paths), {});
  const sources = state.sources?.length ? state.sources : [{ ...DEFAULT_SOURCE }];
  const storedBooks = state.books ?? [];
  const fixtureBooks = loadFixtureBooks(paths);
  const fixtureIds = new Set(fixtureBooks.map((book) => book.id));
  return {
    sources,
    books: [
      ...fixtureBooks,
      ...storedBooks.filter((book) => book.sourceId !== 'fixtures' && !fixtureIds.has(book.id)),
    ],
    notes: state.notes ?? [],
    progress: state.progress ?? {},
  };
}

function saveState(paths: ReaderStorePaths, state: ReaderState): void {
  writeJsonFile(stateFile(paths), state);
}

export function listSources(paths: ReaderStorePaths): ReaderSource[] {
  return loadState(paths).sources;
}

export function listBooks(paths: ReaderStorePaths): LibraryBook[] {
  return loadState(paths).books;
}

export function getBook(
  paths: ReaderStorePaths,
  bookId: string,
): LibraryBook | null {
  return listBooks(paths).find((book) => book.id === bookId) ?? null;
}

export function addSource(
  paths: ReaderStorePaths,
  input: Partial<ReaderSource>,
): ReaderSource {
  const state = loadState(paths);
  const kind = input.kind === 'github' || input.kind === 'local' ? input.kind : 'local';
  const label = String(
    input.label || input.repo || input.root || `${kind} source`,
  ).trim();
  const id = slug(input.id || `${kind}-${label}`);
  const source: ReaderSource = {
    id,
    kind,
    label,
    enabled: input.enabled ?? true,
    root: input.root,
    repo: input.repo,
    branch: input.branch || 'main',
    path: input.path,
  };
  const nextSources = state.sources.filter((item) => item.id !== id);
  nextSources.push(source);
  saveState(paths, { ...state, sources: nextSources });
  return source;
}

async function parsePdfMetadata(
  path: string,
): Promise<{ pageCount: number; summary?: string }> {
  try {
    const parsed = await pdfParse(await Deno.readFile(path));
    return {
      pageCount: parsed.numpages || 1,
      summary: parsed.text.replace(/\s+/g, ' ').trim().slice(0, 180),
    };
  } catch {
    return { pageCount: 1 };
  }
}

async function localPdfBooks(source: ReaderSource): Promise<LibraryBook[]> {
  if (!source.root) return [];
  const books: LibraryBook[] = [];
  const ignoredDirs = new Set(['.git', 'node_modules']);

  async function walk(dir: string): Promise<void> {
    for await (const entry of Deno.readDir(dir)) {
      if (entry.name.startsWith('.')) continue;
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory) {
        if (!ignoredDirs.has(entry.name)) await walk(path);
        continue;
      }
      if (!entry.isFile || !entry.name.toLowerCase().endsWith('.pdf')) continue;
      const stat = await Deno.stat(path);
      const relativePath = path.slice(source.root!.replace(/\/$/, '').length + 1);
      const metadata = await parsePdfMetadata(path);
      books.push({
        id: stableBookId(source.id, relativePath),
        sourceId: source.id,
        title: titleFromFile(entry.name),
        fileName: entry.name,
        path,
        pageCount: metadata.pageCount,
        summary: metadata.summary,
        coverColor: colorFor(`${source.id}:${relativePath}`),
        mtime: stat.mtime?.toISOString(),
      });
    }
  }

  await walk(source.root);
  return books;
}

async function listGithubPdfItems(
  source: ReaderSource,
  dirPath = source.path ? source.path.replace(/^\/|\/$/g, '') : '',
): Promise<GithubContentItem[]> {
  if (!source.repo) return [];
  const branch = source.branch || 'main';
  const contentPath = dirPath ? `/${dirPath}` : '';
  const apiUrl = `${GITHUB_API}/${source.repo}/contents${contentPath}?ref=${branch}`;
  const res = await fetch(apiUrl);
  if (!res.ok) {
    throw new Error(`GitHub source failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  const items = Array.isArray(data) ? data as GithubContentItem[] : [data as GithubContentItem];
  const pdfs: GithubContentItem[] = [];
  for (const item of items) {
    if (item.type === 'dir') {
      pdfs.push(...await listGithubPdfItems(source, item.path));
    } else if (item.type === 'file' && item.name.toLowerCase().endsWith('.pdf')) {
      pdfs.push(item);
    }
  }
  return pdfs;
}

async function githubPdfBooks(
  paths: ReaderStorePaths,
  source: ReaderSource,
  existingBooks: LibraryBook[],
): Promise<LibraryBook[]> {
  if (!source.repo) return [];
  const branch = source.branch || 'main';
  const pdfItems = await listGithubPdfItems(source);
  const existingById = new Map(existingBooks.map((book) => [book.id, book]));
  const books: LibraryBook[] = [];
  for (const item of pdfItems) {
    const id = stableBookId(source.id, item.path);
    const fileName = `${id}.pdf`;
    const destPath = `${paths.booksDir}/${fileName}`;
    const cached = existingById.get(id);
    if (!fileExists(destPath) || cached?.sha !== item.sha) {
      const rawUrl = item.download_url ??
        `${GITHUB_RAW}/${source.repo}/${branch}/${item.path}`;
      const fileRes = await fetch(rawUrl);
      if (fileRes.ok) {
        ensureDir(paths.booksDir);
        await Deno.writeFile(
          destPath,
          new Uint8Array(await fileRes.arrayBuffer()),
        );
      } else if (!fileExists(destPath)) {
        throw new Error(
          `GitHub PDF download failed: ${fileRes.status} ${fileRes.statusText}`,
        );
      }
    }
    if (!fileExists(destPath)) {
      throw new Error(`GitHub PDF cache missing: ${item.path}`);
    }
    const metadata = await parsePdfMetadata(destPath);
    books.push({
      id,
      sourceId: source.id,
      title: titleFromFile(item.name),
      fileName,
      path: destPath,
      url: `/api/books/${id}/file`,
      sha: item.sha,
      pageCount: metadata.pageCount,
      summary: metadata.summary,
      coverColor: colorFor(`${source.id}:${item.path}`),
    });
  }
  return books;
}

function fileExists(path: string): boolean {
  try {
    return Deno.statSync(path).isFile;
  } catch {
    return false;
  }
}

export async function syncSource(
  paths: ReaderStorePaths,
  sourceId: string,
): Promise<{ source: ReaderSource; books: LibraryBook[] }> {
  ensureDir(paths.cacheDir);
  ensureDir(paths.booksDir);
  const state = loadState(paths);
  const source = state.sources.find((item) => item.id === sourceId);
  if (!source) throw new Error(`Unknown source: ${sourceId}`);
  let books: LibraryBook[] = [];
  let nextSource: ReaderSource = { ...source, error: undefined };
  let synced = false;
  try {
    if (source.kind === 'fixtures') {
      books = loadFixtureBooks(paths);
    } else if (source.kind === 'local') {
      books = await localPdfBooks(source);
    } else if (source.kind === 'github') {
      books = await githubPdfBooks(paths, source, state.books);
    }
    nextSource = { ...nextSource, lastSyncedAt: now() };
    synced = true;
  } catch (err) {
    nextSource = {
      ...nextSource,
      error: err instanceof Error ? err.message : String(err),
    };
    throw err;
  } finally {
    const latest = loadState(paths);
    const sources = latest.sources.map((item) => item.id === sourceId ? nextSource : item);
    const nextBooks = synced
      ? [...latest.books.filter((book) => book.sourceId !== sourceId), ...books]
      : latest.books;
    const nextState = { ...latest, sources, books: nextBooks };
    saveState(paths, nextState);
  }
  for (const book of books) {
    if (book.path) {
      await indexBook(book.path, book.id, paths.cacheDir);
    }
  }
  return { source: nextSource, books };
}

export function saveProgress(
  paths: ReaderStorePaths,
  progress: ReaderProgress,
): ReaderProgress {
  const state = loadState(paths);
  const next = { ...progress, updatedAt: now() };
  saveState(paths, {
    ...state,
    progress: { ...state.progress, [progress.bookId]: next },
    books: state.books.map((book) =>
      book.id === progress.bookId ? { ...book, lastOpenedAt: next.updatedAt } : book
    ),
  });
  return next;
}

export function listNotes(
  paths: ReaderStorePaths,
  bookId?: string,
): ReaderNote[] {
  const notes = loadState(paths).notes;
  return bookId ? notes.filter((note) => note.bookId === bookId) : notes;
}

export function addNote(
  paths: ReaderStorePaths,
  input: { bookId: string; page?: number; quote?: string; text: string },
): ReaderNote {
  const state = loadState(paths);
  const createdAt = now();
  const note: ReaderNote = {
    id: crypto.randomUUID(),
    bookId: input.bookId,
    page: input.page,
    quote: input.quote,
    text: input.text,
    createdAt,
    updatedAt: createdAt,
  };
  saveState(paths, { ...state, notes: [note, ...state.notes] });
  return note;
}

export function deleteNote(paths: ReaderStorePaths, noteId: string): void {
  const state = loadState(paths);
  saveState(paths, {
    ...state,
    notes: state.notes.filter((note) => note.id !== noteId),
  });
}

export function exportNotesMarkdown(paths: ReaderStorePaths): string {
  const state = loadState(paths);
  const bookMap = new Map(state.books.map((book) => [book.id, book]));
  return state.notes.map((note) => {
    const book = bookMap.get(note.bookId);
    const lines = [
      '---',
      `bookId: ${note.bookId}`,
      `bookTitle: ${book?.title ?? note.bookId}`,
      book?.author ? `author: ${book.author}` : undefined,
      note.page ? `page: ${note.page}` : undefined,
      `createdAt: ${note.createdAt}`,
      'tags: [open-reader]',
      '---',
      '',
      note.quote ? note.quote.split('\n').map((line) => `> ${line}`).join('\n') : undefined,
      note.quote ? '' : undefined,
      note.text,
      '',
      `[Back to reader](open-reader://books/${note.bookId}${
        note.page ? `?page=${note.page}` : ''
      })`,
      '',
    ].filter((line) => line !== undefined);
    return lines.join('\n');
  }).join('\n');
}

function searchIndexJobKey(paths: ReaderStorePaths, book: LibraryBook): string {
  return `${paths.cacheDir}:${book.id}`;
}

async function ensureBookSearchIndex(
  paths: ReaderStorePaths,
  book: LibraryBook,
): Promise<void> {
  if (!book.path) return;
  const key = searchIndexJobKey(paths, book);
  const existing = searchIndexJobs.get(key);
  if (existing) {
    await existing.promise;
    return;
  }
  const latestIndex = loadSearchIndex(paths.cacheDir);
  if (typeof latestIndex[book.id] === 'string') return;

  const job: SearchIndexJob = {
    promise: (async () => {
      await indexBook(book.path, book.id, paths.cacheDir);
    })(),
  };
  searchIndexJobs.set(key, job);
  try {
    await job.promise;
  } finally {
    if (searchIndexJobs.get(key) === job) searchIndexJobs.delete(key);
  }
}

async function ensureSearchIndex(paths: ReaderStorePaths, books: LibraryBook[]): Promise<void> {
  const index = loadSearchIndex(paths.cacheDir);
  const missing = books.filter((book) => book.path && typeof index[book.id] !== 'string');
  if (missing.length === 0) return;
  await Promise.all(missing.map((book) => ensureBookSearchIndex(paths, book)));
}

export async function searchLibrary(
  paths: ReaderStorePaths,
  query: string,
): Promise<ReaderSearchResult[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const state = loadState(paths);
  await ensureSearchIndex(paths, state.books);
  const results: ReaderSearchResult[] = [];
  for (const book of state.books) {
    const haystack = [book.title, book.author, book.fileName, book.summary]
      .filter(Boolean).join(' ')
      .toLowerCase();
    if (haystack.includes(q)) {
      results.push({
        bookId: book.id,
        title: book.title,
        author: book.author,
        snippet: book.summary || book.fileName,
        source: 'book',
      });
    }
  }
  for (const note of state.notes) {
    const haystack = [note.quote, note.text].filter(Boolean).join(' ')
      .toLowerCase();
    if (haystack.includes(q)) {
      const book = state.books.find((item) => item.id === note.bookId);
      results.push({
        bookId: note.bookId,
        title: book?.title ?? note.bookId,
        author: book?.author,
        page: note.page,
        snippet: note.text,
        source: 'note',
      });
    }
  }
  for (const hit of searchPdfIndex(query, paths.cacheDir)) {
    const book = state.books.find((item) => item.id === hit.bookId);
    results.push({
      bookId: hit.bookId,
      title: book?.title ?? hit.bookId,
      author: book?.author,
      page: hit.page,
      snippet: hit.snippet,
      source: 'pdf',
    });
  }
  return results.slice(0, 30);
}

export function getProgress(
  paths: ReaderStorePaths,
  bookId: string,
): ReaderProgress | null {
  return loadState(paths).progress[bookId] ?? null;
}
