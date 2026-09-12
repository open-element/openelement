import pdfParse from 'pdf-parse';

export interface SearchResult {
  bookId: string;
  page: number;
  snippet: string;
}

const indexWriteQueues = new Map<string, Promise<void>>();

/**
 * Rough chars-per-page assumption for page estimation. The search index
 * stores each book as a single flat string (pdf-parse concatenates all
 * pages, losing page boundaries), so hit positions can only be mapped to
 * an approximate page number. ~3000 chars is a typical average for a
 * text-dense PDF page.
 */
const APPROX_CHARS_PER_PAGE = 3000;

function defaultIndexDir(): string {
  return (Deno.env.get('HOME') ?? Deno.env.get('USERPROFILE') ?? '/tmp') +
    '/.open-reader';
}

function queueIndexWrite(indexDir: string, write: () => Promise<void>): Promise<void> {
  const previous = indexWriteQueues.get(indexDir) ?? Promise.resolve();
  const next = previous.then(write, write);
  // Store `next` itself (not a derived promise) so the cleanup below can
  // actually match; callers observe rejections on the returned promise.
  indexWriteQueues.set(indexDir, next);
  return next.finally(() => {
    if (indexWriteQueues.get(indexDir) === next) indexWriteQueues.delete(indexDir);
  });
}

/**
 * Extract text from PDF using pdf-parse and save to search index.
 */
export async function indexBook(
  pdfPath: string,
  bookId: string,
  indexDir?: string,
): Promise<void> {
  const dir = indexDir ?? defaultIndexDir();
  let text: string;

  try {
    const data = new Uint8Array(await Deno.readFile(pdfPath));
    const parsed = await pdfParse(data);
    text = parsed.text;
  } catch (err) {
    console.warn(`[search] indexBook failed for ${bookId}:`, err);
    return;
  }

  await queueIndexWrite(dir, async () => {
    const index = loadSearchIndex(dir);
    index[bookId] = text;
    await saveSearchIndex(dir, index);
  });
}

/**
 * Search the index by query (case-insensitive substring match).
 */
export function search(
  query: string,
  indexDir?: string,
): SearchResult[] {
  const dir = indexDir ?? defaultIndexDir();
  const index = loadSearchIndex(dir);
  const lower = query.toLowerCase();
  const results: SearchResult[] = [];

  for (const [bookId, text] of Object.entries(index)) {
    if (typeof text !== 'string') continue;
    const lowerText = text.toLowerCase();
    let pos = 0;
    while ((pos = lowerText.indexOf(lower, pos)) !== -1) {
      const start = Math.max(0, pos - 40);
      const end = Math.min(lowerText.length, pos + query.length + 40);
      const snippet = text.substring(start, end).trim();
      // Estimated page, not exact: the index has no page boundaries (see
      // APPROX_CHARS_PER_PAGE).
      const page = Math.floor(pos / APPROX_CHARS_PER_PAGE) + 1;
      results.push({
        bookId,
        page,
        snippet,
      });
      pos += query.length;
    }
  }

  return results;
}

/**
 * Load the search index from ~/.open-reader/search-index.json.
 */
export function loadSearchIndex(
  indexDir?: string,
): Record<string, string> {
  const dir = indexDir ?? defaultIndexDir();
  const indexFile = `${dir}/search-index.json`;
  try {
    const raw = Deno.readTextFileSync(indexFile);
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Save the search index to ~/.open-reader/search-index.json.
 */
export function saveSearchIndex(
  indexDir: string,
  index: Record<string, string>,
): Promise<void> {
  const indexFile = `${indexDir}/search-index.json`;
  return Deno.mkdir(indexDir, { recursive: true })
    .then(() => Deno.writeTextFile(indexFile, JSON.stringify(index, null, 2)));
}
