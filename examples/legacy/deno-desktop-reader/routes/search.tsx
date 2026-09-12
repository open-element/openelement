/** @jsxImportSource @openelement/element */
import { element, OpenElement } from '@openelement/element';
import type { ReaderSearchResult } from '../app/types.ts';
import { searchLibrary } from '../app/api.ts';
import { navigate } from '../router.ts';

export interface SearchData {
  query: string;
  results: ReaderSearchResult[];
}

function readSearchQuery(params: Record<string, string>): string {
  const fromRouter = (params.q || '').trim();
  if (fromRouter) return fromRouter;

  if (typeof location === 'undefined') return '';
  return (new URL(location.href).searchParams.get('q') || '').trim();
}

export function loader(
  ctx: { params: Record<string, string> },
): Promise<SearchData> {
  const query = readSearchQuery(ctx.params);
  if (!query) return Promise.resolve({ query, results: [] });
  return searchLibrary(query).then((results) => ({ query, results }));
}

export const tagName = 'reader-search';

const SOURCE_LABEL: Record<string, string> = {
  book: '书名',
  note: '笔记',
  pdf: 'PDF 全文',
};

@element('reader-search', { root: 'shadow-open' })
export default class SearchPage extends OpenElement {
  render() {
    const data = (this as unknown) as SearchPage & SearchData;
    const query = data.query || '';
    const results = data.results || [];

    return (
      <main class='reader-main'>
        <div class='page-header'>
          <div class='page-header-text'>
            <h1>搜索</h1>
            <p>在书名、作者、笔记和 PDF 全文中查找</p>
          </div>
        </div>

        <div class='search-box-wrapper'>
          <search-box-island query={query} />
        </div>

        {!query && (
          <div class='empty-state'>
            <svg
              width='48'
              height='48'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='1.5'
              stroke-linecap='round'
              stroke-linejoin='round'
            >
              <circle cx='11' cy='11' r='8' />
              <path d='m21 21-4.35-4.35' />
            </svg>
            <p class='empty-state-title'>开始搜索</p>
            <p class='empty-state-hint'>输入关键词后按回车，结果会显示在这里。</p>
          </div>
        )}

        {query && results.length === 0 && (
          <div class='empty-state'>
            <svg
              width='48'
              height='48'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='1.5'
              stroke-linecap='round'
              stroke-linejoin='round'
            >
              <circle cx='11' cy='11' r='8' />
              <path d='m21 21-4.35-4.35' />
              <path d='M8 11h6' />
            </svg>
            <p class='empty-state-title'>未找到结果</p>
            <p class='empty-state-hint'>没有与「{query}」相关的内容，试试其他关键词。</p>
          </div>
        )}

        {query && results.length > 0 && (
          <>
            <p class='search-term'>找到 {results.length} 个与「{query}」相关的结果</p>
            <div class='search-results'>
              {results.map((result, i) => (
                <div
                  class='search-result'
                  key={`${result.source}:${result.bookId}:${result.page ?? 0}:${i}`}
                  onClick={() =>
                    navigate(
                      `/books/${result.bookId}${result.page ? `?page=${result.page}` : ''}`,
                    )}
                >
                  <p class='search-result-meta'>
                    {SOURCE_LABEL[result.source] || result.source}
                    {result.page ? ` · 第 ${result.page} 页` : ''}
                  </p>
                  <h2 class='search-result-title'>{result.title}</h2>
                  {result.author && <p class='search-result-author'>{result.author}</p>}
                  <p class='search-result-snippet'>{result.snippet}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    );
  }
}
