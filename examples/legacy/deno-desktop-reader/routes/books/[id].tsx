/** @jsxImportSource @openelement/element */
import { element, OpenElement, property } from '@openelement/element';
import type { LibraryBook, ReaderNote, ReaderProgress } from '../../app/types.ts';
import { getBookDetails, listBooks, saveNote } from '../../app/api.ts';
import { navigate } from '../../router.ts';

export interface ReadingData {
  book: LibraryBook | null;
  notes: ReaderNote[];
  progress: ReaderProgress | null;
  page: number;
  zoom: number;
  totalPages: number;
  library: LibraryBook[];
  progressByBook: Record<string, ReaderProgress>;
}

export interface ReadingActionData {
  saved?: boolean;
  error?: string;
}

function readPage(params: Record<string, string>): number {
  const pageParam = parseInt(params.page || '1', 10);
  return isNaN(pageParam) || pageParam < 1 ? 1 : pageParam;
}

function readZoom(progress: ReaderProgress | null | undefined): number {
  const zoom = progress?.zoom ?? 1;
  return Math.min(2.5, Math.max(0.5, zoom));
}

function readFormPage(
  formData: FormData | undefined,
  fallbackParams: Record<string, string>,
): number {
  const formPage = String(formData?.get('note-page') ?? '');
  return readPage({ page: formPage || fallbackParams.page || '1' });
}

export function loader(
  ctx: { params: Record<string, string> },
): Promise<ReadingData> {
  const bookId = ctx.params.id;
  const page = readPage(ctx.params);
  const hasPageParam = Boolean(ctx.params.page);
  return Promise.all([getBookDetails(bookId), listBooks()]).then(async ([details, library]) => {
    const progressByBook: Record<string, ReaderProgress> = {};
    await Promise.all(library.map(async (item) => {
      const itemDetails = await getBookDetails(item.id);
      if (itemDetails?.progress) progressByBook[item.id] = itemDetails.progress;
    }));
    return {
      book: details?.book ?? null,
      notes: details?.notes ?? [],
      progress: details?.progress ?? null,
      page: hasPageParam ? page : details?.progress?.page ?? page,
      zoom: readZoom(details?.progress),
      totalPages: details?.book.pageCount ?? 0,
      library,
      progressByBook,
    };
  });
}

// No route action: the note form's open-button is type='button' and calls
// requestSubmit(), and native submit events are not composed, so they cannot
// cross the shadow root — submissions are handled by #submitNoteForm below.
export const tagName = 'reader-reading';

@element('reader-reading', { root: 'shadow-open' })
export default class ReadingPage extends OpenElement {
  @property({ reflect: false, attribute: false, type: Number })
  currentPage = 1;

  @property({ reflect: false, attribute: false })
  noteTab: 'write' | 'saved' = 'write';

  @property({ reflect: false, attribute: false })
  pendingQuote = '';

  @property({ reflect: false, attribute: false, type: Object })
  noteFeedback: ReadingActionData | undefined;
  #progressHandler = (event: Event) => {
    const detail = (event as CustomEvent<{ bookId?: string; page?: number }>).detail;
    const bookId = (this as unknown as ReadingPage & ReadingData).book?.id;
    if (!bookId || detail?.bookId !== bookId || !detail.page) return;
    this.currentPage = detail.page;
    const input = this.shadowRoot?.querySelector<HTMLInputElement>('input[name="note-page"]');
    if (input) input.value = String(detail.page);
  };
  #noteRequestHandler = (event: Event) => {
    const detail =
      (event as CustomEvent<{ bookId?: string; page?: number; quote?: string }>).detail;
    const data = (this as unknown) as ReadingPage & ReadingData;
    if (!data.book || detail?.bookId !== data.book.id) return;
    this.currentPage = detail.page || this.currentPage || data.page || 1;
    this.pendingQuote = detail.quote?.trim() || `第 ${this.currentPage} 页`;
    this.noteTab = 'write';
    requestAnimationFrame(() => {
      const quote = this.shadowRoot?.querySelector<HTMLTextAreaElement>(
        'textarea[name="note-quote"]',
      );
      const note = this.shadowRoot?.querySelector<HTMLTextAreaElement>(
        'textarea[name="note-text"]',
      );
      const input = this.shadowRoot?.querySelector<HTMLInputElement>('input[name="note-page"]');
      if (input) input.value = String(this.currentPage);
      if (quote && !quote.value.trim()) quote.value = this.pendingQuote;
      note?.focus();
    });
  };

  override connectedCallback(): void {
    const data = (this as unknown) as ReadingPage & ReadingData;
    this.currentPage = data.page || 1;
    super.connectedCallback();
    globalThis.addEventListener('reader-progress-change', this.#progressHandler);
    globalThis.addEventListener('reader-note-request', this.#noteRequestHandler);
  }

  override disconnectedCallback(): void {
    globalThis.removeEventListener('reader-progress-change', this.#progressHandler);
    globalThis.removeEventListener('reader-note-request', this.#noteRequestHandler);
    super.disconnectedCallback();
  }

  #selectNoteTab(tab: 'write' | 'saved'): void {
    this.noteTab = tab;
  }

  async #submitNoteForm(event: Event): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const formData = new FormData(form);
    const data = (this as unknown) as ReadingPage & ReadingData;
    const noteText = String(formData.get('note-text') ?? '').trim();
    const quote = String(formData.get('note-quote') ?? '').trim();
    if (!data.book) return;
    if (!noteText) {
      this.noteFeedback = { error: '请先写下你的想法。' };
      return;
    }

    try {
      await saveNote({
        bookId: data.book.id,
        page: readFormPage(formData, { page: String(this.currentPage || data.page || 1) }),
        quote,
        text: noteText,
      });
      const details = await getBookDetails(data.book.id);
      data.notes = details?.notes ?? data.notes ?? [];
      this.pendingQuote = '';
      this.noteFeedback = { saved: true };
      this.noteTab = 'saved';
      form.reset();
    } catch (err) {
      this.noteFeedback = {
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  render() {
    const data = (this as unknown) as ReadingPage & ReadingData;
    const actionData = this.noteFeedback;
    const book = data.book;
    const page = data.page;
    const zoom = data.zoom;
    const totalPages = data.totalPages;
    const notes = data.notes || [];
    const library = data.library || [];
    const progressByBook = data.progressByBook || {};

    if (!book) {
      return (
        <main class='reader-main'>
          <div class='page-header'>
            <div class='page-header-text'>
              <h1>图书未找到</h1>
              <p>该书可能已被删除或尚未同步</p>
            </div>
            <div class='page-header-actions'>
              <open-button variant='ghost' onClick={() => navigate('/')}>
                ← 返回书架
              </open-button>
            </div>
          </div>
        </main>
      );
    }

    return (
      <main class='reader-focus-shell'>
        <style>
          {`
          .reader-focus-shell {
            box-sizing: border-box;
            display: grid;
            grid-template-columns: 280px minmax(0, 1fr) 300px;
            height: calc(100vh - 56px);
            margin: 0;
            overflow: hidden;
            width: 100%;
          }
          .reader-library-rail,
          .reader-annotation-rail {
            background: color-mix(in srgb, var(--bg-card) 94%, transparent);
            border-color: var(--border);
            box-sizing: border-box;
            min-height: 0;
            overflow: auto;
            padding: 24px 20px;
          }
          .reader-library-rail { border-right: 1px solid var(--border); }
          .reader-annotation-rail { border-left: 1px solid var(--border); }
          .rail-heading {
            align-items: center;
            display: flex;
            justify-content: space-between;
            margin-bottom: 22px;
          }
          .rail-heading h2 {
            font: 650 15px/1.2 var(--font-sans);
            margin: 0;
          }
          .rail-round-button {
            align-items: center;
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 999px;
            color: var(--text-secondary);
            cursor: pointer;
            display: inline-flex;
            height: 30px;
            justify-content: center;
            width: 30px;
          }
          .rail-book {
            align-items: center;
            background: transparent;
            border: 0;
            border-radius: 10px;
            color: inherit;
            cursor: pointer;
            display: grid;
            gap: 14px;
            grid-template-columns: 74px minmax(0, 1fr);
            margin-bottom: 18px;
            padding: 8px;
            text-align: left;
            width: 100%;
          }
          .rail-book:hover,
          .rail-book.current { background: var(--bg-muted); }
          .rail-cover {
            align-items: center;
            aspect-ratio: 0.68;
            background: var(--cover, #2f6f45);
            border-radius: 4px;
            box-shadow: 0 10px 26px rgba(0,0,0,.12);
            color: white;
            display: flex;
            font: 700 13px/1.2 var(--font-serif);
            justify-content: center;
            padding: 10px;
            text-align: center;
          }
          .rail-book-title {
            color: var(--text-primary);
            font: 650 14px/1.3 var(--font-sans);
            margin: 0 0 6px;
          }
          .rail-book-author {
            color: var(--text-muted);
            font-size: 12px;
            margin: 0 0 10px;
          }
          .rail-progress {
            background: var(--border);
            border-radius: 999px;
            height: 3px;
            overflow: hidden;
            width: 100%;
          }
          .rail-progress span {
            background: var(--brand);
            display: block;
            height: 100%;
          }
          .reader-stage {
            background: radial-gradient(circle at 50% 30%, rgba(7,193,96,.035), transparent 32%), var(--bg-base);
            box-sizing: border-box;
            min-width: 0;
            overflow: auto;
            padding: 0 34px 34px;
            position: relative;
          }
          .reader-book-header {
            align-items: center;
            border-bottom: 1px solid var(--border);
            display: flex;
            height: 56px;
            justify-content: center;
            margin: 0 -34px 24px;
            position: sticky;
            top: 0;
            z-index: 5;
            background: color-mix(in srgb, var(--bg-base) 92%, transparent);
            backdrop-filter: blur(14px);
          }
          .reader-book-header h1 {
            font: 650 15px/1.2 var(--font-sans);
            margin: 0;
          }
          .reader-book-header p {
            color: var(--text-muted);
            font-size: 12px;
            margin: 4px 0 0;
            text-align: center;
          }
          .reader-pdf-wrap {
            margin: 0 auto;
            max-width: min(920px, 100%);
          }
          .reader-floating-search {
            align-items: center;
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 999px;
            box-shadow: 0 14px 40px rgba(0,0,0,.1);
            bottom: 26px;
            color: var(--text-muted);
            cursor: pointer;
            display: flex;
            gap: 12px;
            left: 50%;
            max-width: 520px;
            padding: 14px 20px;
            position: sticky;
            transform: translateX(-50%);
            width: min(520px, calc(100% - 40px));
          }
          .annotation-tabs {
            border-bottom: 1px solid var(--border);
            display: flex;
            gap: 24px;
            margin: -4px -20px 18px;
            padding: 0 20px;
          }
          .annotation-tab {
            background: transparent;
            border: 0;
            border-bottom: 2px solid transparent;
            color: var(--text-muted);
            cursor: pointer;
            font: 650 13px/1 var(--font-sans);
            padding: 0 0 14px;
          }
          .annotation-tab.active {
            border-bottom-color: var(--brand);
            color: var(--brand);
          }
          .annotation-search {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 8px;
            color: var(--text-muted);
            font-size: 13px;
            margin-bottom: 18px;
            padding: 11px 12px;
          }
          .note-panel {
            background: transparent;
            border: 0;
            box-shadow: none;
            margin: 0;
          }
          .note-panel-tabs { display: none; }
          .note-panel-body { padding: 0; }
          .note-card.compact {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 8px;
            margin-bottom: 14px;
            padding: 14px;
          }
          .note-card.compact blockquote {
            border-left: 0;
            color: var(--text-primary);
            font-family: var(--font-sans);
            font-size: 14px;
            font-style: normal;
            margin: 0 0 10px;
            padding: 0;
          }
          .note-card.compact p {
            color: var(--text-secondary);
            font-size: 13px;
          }
          .new-note-button {
            background: transparent;
            border: 1px solid var(--brand);
            border-radius: 8px;
            color: var(--brand);
            cursor: pointer;
            font: 650 13px/1 var(--font-sans);
            margin-top: 14px;
            padding: 12px;
            width: 100%;
          }
          @media (max-width: 1100px) {
            .reader-focus-shell { grid-template-columns: minmax(0, 1fr); height: auto; }
            .reader-library-rail, .reader-annotation-rail { display: none; }
          }
        `}
        </style>
        <aside class='reader-library-rail' aria-label='Library'>
          <div class='rail-heading'>
            <h2>Library</h2>
            <button class='rail-round-button' type='button' onClick={() => navigate('/settings')}>
              +
            </button>
          </div>
          {library.map((item) => {
            const progress = progressByBook[item.id];
            const pct = progress
              ? Math.round((progress.page / Math.max(1, item.pageCount)) * 100)
              : 0;
            return (
              <button
                class={`rail-book ${item.id === book.id ? 'current' : ''}`}
                type='button'
                key={item.id}
                onClick={() => navigate(`/books/${item.id}`)}
              >
                <span class='rail-cover' style={`--cover:${item.coverColor}`}>{item.title}</span>
                <span>
                  <p class='rail-book-title'>{item.title}</p>
                  {item.author && <p class='rail-book-author'>{item.author}</p>}
                  <span class='rail-progress'>
                    <span style={`width:${pct}%`} />
                  </span>
                </span>
              </button>
            );
          })}
        </aside>

        <section class='reader-stage'>
          <div class='reader-book-header'>
            <div>
              <h1>{book.title}</h1>
              {book.author && <p>{book.author}</p>}
            </div>
          </div>

          {actionData?.saved && <p class='toast-inline'>笔记已保存。</p>}
          {actionData?.error && <p class='form-error'>{actionData.error}</p>}

          <div class='reader-pdf-wrap'>
            <section class='pdf-surface' aria-label='PDF reader'>
              <pdf-reader-island
                book-id={book.id}
                src={`/api/books/${book.id}/file`}
                page={String(page)}
                zoom={String(zoom)}
                pages={String(totalPages)}
              />
            </section>
          </div>

          <button class='reader-floating-search' type='button' onClick={() => navigate('/search')}>
            <span>⌕</span>
            <span>Search books, notes, annotations...</span>
            <kbd>⌘ K</kbd>
          </button>
        </section>

        <aside class='reader-annotation-rail' aria-label='Annotations'>
          <div class='annotation-tabs'>
            <button class='annotation-tab active' type='button'>Annotations</button>
            <button class='annotation-tab' type='button' onClick={() => navigate('/notes')}>
              Notebook
            </button>
          </div>
          <div class='annotation-search'>⌕ Search annotations</div>
          <section class='note-panel'>
            <div class='note-panel-tabs'>
              <button
                class={`note-panel-tab ${this.noteTab === 'write' ? 'active' : ''}`}
                type='button'
                onClick={() => this.#selectNoteTab('write')}
              >
                写笔记
              </button>
              <button
                class={`note-panel-tab ${this.noteTab === 'saved' ? 'active' : ''}`}
                type='button'
                onClick={() => this.#selectNoteTab('saved')}
              >
                已保存 ({notes.length})
              </button>
            </div>
            <div class='note-panel-body'>
              {this.noteTab === 'write'
                ? (
                  <form onSubmit={(event: Event) => void this.#submitNoteForm(event)}>
                    <input
                      type='hidden'
                      name='note-page'
                      value={String(this.currentPage || page)}
                    />
                    <label>引用段落</label>
                    <textarea
                      name='note-quote'
                      rows={3}
                      value={this.pendingQuote}
                      placeholder='粘贴你想标注的段落……'
                    />

                    <label>你的想法</label>
                    <textarea
                      name='note-text'
                      rows={4}
                      placeholder='写下你的想法……'
                    />

                    <open-button
                      type='button'
                      variant='primary'
                      onClick={(event: Event) =>
                        ((event.currentTarget as HTMLElement).closest('form') as
                          | HTMLFormElement
                          | null)
                          ?.requestSubmit()}
                    >
                      保存笔记
                    </open-button>
                  </form>
                )
                : notes.length > 0
                ? (
                  <div class='saved-note-list'>
                    {notes.map((note) => (
                      <article class='note-card compact' key={note.id}>
                        {note.quote && <blockquote>{note.quote}</blockquote>}
                        <p>{note.text}</p>
                        <div class='note-card-footer'>
                          <small>
                            第 {note.page ?? 1} 页 · {new Date(note.createdAt).toLocaleDateString()}
                          </small>
                          <open-button
                            size='sm'
                            variant='ghost'
                            onClick={() => navigate(`/books/${book.id}?page=${note.page ?? 1}`)}
                          >
                            跳转
                          </open-button>
                        </div>
                      </article>
                    ))}
                  </div>
                )
                : (
                  <div class='empty-state compact'>
                    <p class='empty-state-title'>还没有笔记</p>
                    <p class='empty-state-hint'>切回写笔记，保存后会出现在这里。</p>
                  </div>
                )}
            </div>
          </section>
          <button
            class='new-note-button'
            type='button'
            onClick={() => this.#selectNoteTab('write')}
          >
            + New Note
          </button>
        </aside>
      </main>
    );
  }
}
