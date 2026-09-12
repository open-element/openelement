export type ReaderSourceKind = 'fixtures' | 'github' | 'local';

export interface ReaderSource {
  id: string;
  kind: ReaderSourceKind;
  label: string;
  enabled: boolean;
  root?: string;
  repo?: string;
  branch?: string;
  path?: string;
  lastSyncedAt?: string;
  error?: string;
}

export interface LibraryBook {
  id: string;
  sourceId: string;
  title: string;
  author?: string;
  fileName: string;
  path: string;
  url?: string;
  sha?: string;
  mtime?: string;
  pageCount: number;
  summary?: string;
  coverColor: string;
  indexedAt?: string;
  lastOpenedAt?: string;
}

export interface ReaderProgress {
  bookId: string;
  page: number;
  zoom: number;
  updatedAt: string;
}

export interface ReaderNote {
  id: string;
  bookId: string;
  page?: number;
  quote?: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReaderSettings {
  theme: 'light' | 'dark' | 'sepia';
  fontSize: number;
  lineHeight: number;
  measure: number;
}

export interface ReaderSearchResult {
  bookId: string;
  title: string;
  author?: string;
  page?: number;
  snippet: string;
  source: 'book' | 'note' | 'pdf';
}

export type ReaderBook = LibraryBook;
