/** @jsxImportSource @openelement/element */
import { element, OpenElement, property } from '@openelement/element';
import type { ReaderProgress, ReaderSource } from '../app/types.ts';
import { getBookDetails, listBooks, listSources, syncSource } from '../app/api.ts';
import { navigate } from '../router.ts';
import BookCard from '../components/BookCard.tsx';
import type { LibraryBook } from '../app/types.ts';

export interface BookshelfData {
  books: LibraryBook[];
  progressByBook: Record<string, ReaderProgress>;
  sources: ReaderSource[];
}

export async function loader(): Promise<BookshelfData> {
  const [books, sources] = await Promise.all([listBooks(), listSources()]);
  const progressByBook: Record<string, ReaderProgress> = {};
  await Promise.all(books.map(async (book) => {
    const details = await getBookDetails(book.id);
    if (details?.progress) progressByBook[book.id] = details.progress;
  }));
  return { books, progressByBook, sources };
}

export async function action(
  ctx: { formData?: FormData },
): Promise<{ synced?: string; error?: string }> {
  const sourceId = String(ctx.formData?.get('source-id') ?? 'fixtures');
  try {
    await syncSource(sourceId);
    return { synced: sourceId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export const tagName = 'reader-bookshelf';

@element('reader-bookshelf', { root: 'shadow-open' })
export default class BookshelfPage extends OpenElement {
  @property({ reflect: false, attribute: false })
  sourceModalOpen = false;

  setSourceModal(open: boolean): void {
    this.sourceModalOpen = open;
  }

  render() {
    const data = (this as unknown) as BookshelfPage & BookshelfData;
    const actionData = (this as unknown as { actionData?: { synced?: string; error?: string } })
      .actionData;
    const books = data.books || [];
    const sources = data.sources || [];

    if (books.length === 0) {
      return (
        <main class='reader-main'>
          <div class='page-header'>
            <div class='page-header-text'>
              <h1>书架</h1>
              <p>暂无图书，请添加书源或同步数据</p>
            </div>
          </div>
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
              <path d='M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z' />
              <path d='M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z' />
            </svg>
            <p class='empty-state-title'>书架是空的</p>
            <p class='empty-state-hint'>同步示例数据源或添加本地文件夹，开始阅读。</p>
            <form style='margin-top: 16px;'>
              <input type='hidden' name='source-id' value='fixtures' />
              <open-button type='submit' variant='primary'>同步示例数据</open-button>
            </form>
          </div>
          {sources.length > 0 && (
            <section class='source-section'>
              <h2 class='section-title'>
                书源
                <span class='count'>{sources.length} 个</span>
              </h2>
              <div class='source-list'>
                {sources.map((source) => (
                  <form key={source.id} class='source-card'>
                    <div class='source-card-info'>
                      <span>{source.label}</span>
                      <small>
                        {source.kind}
                        {source.lastSyncedAt
                          ? ` · ${new Date(source.lastSyncedAt).toLocaleDateString()}`
                          : ''}
                      </small>
                    </div>
                    <input type='hidden' name='source-id' value={source.id} />
                    <open-button type='submit' size='sm' variant='ghost'>同步</open-button>
                  </form>
                ))}
              </div>
            </section>
          )}
        </main>
      );
    }

    const readingBooks = books.filter((b) => data.progressByBook[b.id]?.page > 1);
    const otherBooks = books.filter((b) =>
      !data.progressByBook[b.id] || data.progressByBook[b.id].page <= 1
    );

    return (
      <main class='reader-main'>
        <style>
          {`
          .source-manage-button::part(control) {
            background: transparent;
            border: 1px solid var(--border-strong);
            border-radius: 8px;
            color: var(--text-secondary);
            cursor: pointer;
            font: 650 13px/1 var(--font-sans);
            min-height: 34px;
            padding: 8px 13px;
          }
          .source-manage-button:hover::part(control) {
            background: var(--bg-hover);
            color: var(--text-primary);
          }
          .sources-overlay {
            align-items: flex-end;
            background: rgba(20,20,20,.08);
            display: flex;
            inset: 0;
            justify-content: flex-start;
            padding: 0 0 18px 300px;
            position: fixed;
            z-index: 40;
          }
          .sources-dialog {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 10px;
            box-shadow: 0 24px 70px rgba(0,0,0,.16);
            display: grid;
            grid-template-columns: 150px minmax(280px, 1fr);
            max-width: 520px;
            min-height: 250px;
            overflow: hidden;
            width: min(520px, calc(100vw - 48px));
          }
          .sources-head {
            align-items: center;
            border-bottom: 1px solid var(--border);
            display: flex;
            grid-column: 1 / -1;
            justify-content: space-between;
            padding: 14px 18px;
          }
          .sources-head h2 {
            font: 650 14px/1 var(--font-sans);
            margin: 0;
          }
          .sources-close::part(control) {
            background: transparent;
            border: 0;
            color: var(--text-muted);
            cursor: pointer;
            font-size: 20px;
          }
          .sources-tabs {
            background: var(--bg-inset);
            border-right: 1px solid var(--border);
            display: grid;
            gap: 4px;
            align-content: start;
            padding: 14px;
          }
          .sources-tabs button {
            background: transparent;
            border: 0;
            border-radius: 8px;
            color: var(--text-secondary);
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            padding: 9px 10px;
            text-align: left;
          }
          .sources-tabs button.active {
            background: var(--brand-soft);
            color: var(--brand);
          }
          .sources-body {
            padding: 18px;
          }
          .source-add-card::part(control) {
            align-items: center;
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 8px;
            color: inherit;
            cursor: pointer;
            display: grid;
            gap: 12px;
            grid-template-columns: 36px 1fr auto;
            margin-bottom: 10px;
            padding: 12px;
            text-align: left;
            width: 100%;
          }
          .source-add-card:hover::part(control) {
            border-color: var(--brand);
          }
          .source-add-card .source-add-icon {
            align-items: center;
            background: var(--bg-muted);
            border-radius: 8px;
            display: flex;
            height: 36px;
            justify-content: center;
            width: 36px;
          }
          .source-add-card strong {
            display: block;
            font-size: 13px;
          }
          .source-add-card small {
            color: var(--text-muted);
          }
          .sources-footer {
            align-items: center;
            display: flex;
            grid-column: 1 / -1;
            justify-content: space-between;
            padding: 12px 18px 18px;
          }
          .sources-primary::part(control) {
            background: var(--brand);
            border: 0;
            border-radius: 8px;
            color: var(--text-on-brand);
            cursor: pointer;
            font: 650 13px/1 var(--font-sans);
            padding: 11px 18px;
          }
        `}
        </style>
        <div class='page-header'>
          <div class='page-header-text'>
            <h1>书架</h1>
            <p>共 {books.length} 本图书</p>
          </div>
          <div class='page-header-actions'>
            <open-button
              class='source-manage-button'
              type='button'
              onClick={() => this.setSourceModal(true)}
            >
              管理书源
            </open-button>
          </div>
        </div>

        {actionData?.synced && <p class='toast-inline'>已同步 {actionData.synced}。</p>}
        {actionData?.error && <p class='form-error'>{actionData.error}</p>}

        {readingBooks.length > 0 && (
          <>
            <h2 class='section-title'>
              最近阅读
              <span class='count'>{readingBooks.length} 本</span>
            </h2>
            <section class='book-grid' aria-label='正在阅读'>
              {readingBooks.map((book) => (
                <BookCard
                  key={book.id}
                  book={book}
                  progress={data.progressByBook[book.id] ?? null}
                  onNavigate={(id) => navigate(`/books/${id}`)}
                />
              ))}
            </section>
          </>
        )}

        {otherBooks.length > 0 && (
          <>
            <h2 class='section-title'>
              全部图书
              <span class='count'>{otherBooks.length} 本</span>
            </h2>
            <section class='book-grid' aria-label='书架'>
              {otherBooks.map((book) => (
                <BookCard
                  key={book.id}
                  book={book}
                  progress={data.progressByBook[book.id] ?? null}
                  onNavigate={(id) => navigate(`/books/${id}`)}
                />
              ))}
            </section>
          </>
        )}

        {sources.length > 0 && (
          <section class='source-section'>
            <h2 class='section-title'>
              书源
              <span class='count'>{sources.length} 个</span>
              <span class='section-actions'>
                <open-button
                  class='source-manage-button'
                  type='button'
                  onClick={() => this.setSourceModal(true)}
                >
                  + 添加
                </open-button>
              </span>
            </h2>
            <div class='source-list'>
              {sources.map((source) => (
                <form key={source.id} class='source-card'>
                  <div class='source-card-info'>
                    <span>{source.label}</span>
                    <small>
                      {source.kind}
                      {source.lastSyncedAt
                        ? ` · ${new Date(source.lastSyncedAt).toLocaleDateString()}`
                        : ''}
                    </small>
                  </div>
                  <input type='hidden' name='source-id' value={source.id} />
                  <open-button type='submit' size='sm' variant='ghost'>同步</open-button>
                </form>
              ))}
            </div>
          </section>
        )}

        {sources.length === 0 && (
          <section class='source-section'>
            <h2 class='section-title'>
              书源
              <span class='count'>0 个</span>
              <span class='section-actions'>
                <form>
                  <input type='hidden' name='source-id' value='fixtures' />
                  <open-button type='submit' variant='outline' size='sm'>同步示例数据</open-button>
                </form>
              </span>
            </h2>
            <p class='source-section-hint'>还没有书源，请添加或同步数据源以获取图书。</p>
          </section>
        )}

        {sources.length === 0 && books.length === 0 && (
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
              <path d='M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z' />
              <path d='M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z' />
            </svg>
            <p class='empty-state-title'>书架是空的</p>
            <p class='empty-state-hint'>同步示例数据源或添加本地文件夹，开始阅读。</p>
          </div>
        )}
        {this.sourceModalOpen && (
          <div
            class='sources-overlay'
            onClick={() => this.setSourceModal(false)}
          >
            <section class='sources-dialog' onClick={(event: Event) => event.stopPropagation()}>
              <div class='sources-head'>
                <h2>Sources</h2>
                <open-button
                  class='sources-close'
                  type='button'
                  variant='ghost'
                  onClick={() => this.setSourceModal(false)}
                >
                  ×
                </open-button>
              </div>
              <div class='sources-tabs'>
                <button class='active' type='button'>
                  All Sources <span>{sources.length}</span>
                </button>
                <button type='button'>
                  Local <span>{sources.filter((s) => s.kind === 'local').length}</span>
                </button>
                <button type='button'>
                  GitHub <span>{sources.filter((s) => s.kind === 'github').length}</span>
                </button>
              </div>
              <div class='sources-body'>
                <p class='search-result-meta'>Add a new source</p>
                <open-button
                  class='source-add-card'
                  type='button'
                  variant='ghost'
                  onClick={() => navigate('/settings')}
                >
                  <span class='source-add-icon'>▣</span>
                  <span>
                    <strong>Local Folder</strong>
                    <small>Add documents from your computer</small>
                  </span>
                  <span>›</span>
                </open-button>
                <open-button
                  class='source-add-card'
                  type='button'
                  variant='ghost'
                  onClick={() => navigate('/settings')}
                >
                  <span class='source-add-icon'>⌘</span>
                  <span>
                    <strong>GitHub Repository</strong>
                    <small>Add documents from a GitHub repository</small>
                  </span>
                  <span>›</span>
                </open-button>
              </div>
              <div class='sources-footer'>
                <small class='search-result-meta'>Learn more about sources ↗</small>
                <open-button
                  class='sources-primary'
                  type='button'
                  variant='primary'
                  onClick={() => navigate('/settings')}
                >
                  Browse Sources
                </open-button>
              </div>
            </section>
          </div>
        )}
      </main>
    );
  }
}
