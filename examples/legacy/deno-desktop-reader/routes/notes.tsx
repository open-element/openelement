/** @jsxImportSource @openelement/element */
import { element, OpenElement } from '@openelement/element';
import type { LibraryBook, ReaderNote } from '../app/types.ts';
import { deleteNote, listBooks, listNotes } from '../app/api.ts';
import { navigate } from '../router.ts';

export interface NotesData {
  allNotes: ReaderNote[];
  books: LibraryBook[];
}

export async function loader(): Promise<NotesData> {
  const [allNotes, books] = await Promise.all([listNotes(), listBooks()]);
  return { allNotes, books };
}

export async function action(
  ctx: { formData?: FormData },
): Promise<{ deleted?: string; error?: string }> {
  const noteId = String(ctx.formData?.get('note-id') ?? '');
  if (!noteId) return { error: '缺少笔记 ID。' };
  await deleteNote(noteId);
  return { deleted: noteId };
}

export const tagName = 'reader-notes';

@element('reader-notes', { root: 'shadow-open' })
export default class NotesPage extends OpenElement {
  render() {
    const data = (this as unknown) as NotesPage & NotesData;
    const actionData = (this as unknown as { actionData?: { deleted?: string; error?: string } })
      .actionData;
    const allNotes = data.allNotes || [];
    const books = data.books || [];

    if (allNotes.length === 0) {
      return (
        <main class='reader-main'>
          <div class='page-header'>
            <div class='page-header-text'>
              <h1>笔记</h1>
              <p>所有图书的笔记会按书分组显示在这里</p>
            </div>
          </div>
          {actionData?.deleted && <p class='toast-inline'>笔记已删除。</p>}
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
              <path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' />
              <polyline points='14 2 14 8 20 8' />
              <line x1='9' y1='13' x2='15' y2='13' />
              <line x1='9' y1='17' x2='13' y2='17' />
            </svg>
            <p class='empty-state-title'>还没有笔记</p>
            <p class='empty-state-hint'>在阅读页右侧的笔记面板中写下想法，保存后会出现在这里。</p>
          </div>
        </main>
      );
    }

    const grouped = new Map<
      string,
      { book: LibraryBook; notes: ReaderNote[] }
    >();
    for (const note of allNotes) {
      const book = books.find((b) => b.id === note.bookId);
      if (!book) continue;
      if (!grouped.has(book.id)) {
        grouped.set(book.id, { book, notes: [] });
      }
      grouped.get(book.id)!.notes.push(note);
    }

    return (
      <main class='reader-main'>
        <div class='page-header'>
          <div class='page-header-text'>
            <h1>笔记</h1>
            <p>共 {allNotes.length} 条笔记，按书分组</p>
          </div>
          <div class='page-header-actions'>
            <open-button
              variant='ghost'
              onClick={() => {
                location.href = '/api/notes/export.md';
              }}
            >
              导出 Markdown
            </open-button>
          </div>
        </div>

        {actionData?.deleted && <p class='toast-inline'>笔记已删除。</p>}
        {actionData?.error && <p class='form-error'>{actionData.error}</p>}

        <div class='notes-list'>
          {Array.from(grouped.values()).map(({ book, notes }) => (
            <div class='notes-book-section' key={book.id}>
              <h2 class='notes-book-title'>
                {book.title}
                <span class='count'>{notes.length} 条</span>
              </h2>
              {notes.map((note) => (
                <div class='note-card' key={note.id}>
                  {note.quote && (
                    <blockquote class='note-quote-preview'>
                      {note.quote}
                    </blockquote>
                  )}
                  <p class='note-text-preview'>{note.text}</p>
                  <p class='note-meta'>
                    第 {note.page ?? 1} 页 · {new Date(note.createdAt).toLocaleDateString()}
                  </p>
                  <div class='note-actions'>
                    <open-button
                      size='sm'
                      variant='ghost'
                      onClick={() => navigate(`/books/${book.id}?page=${note.page ?? 1}`)}
                    >
                      跳转页面 →
                    </open-button>
                    <form class='inline-form'>
                      <input type='hidden' name='note-id' value={note.id} />
                      <open-button size='sm' variant='ghost' type='submit'>
                        删除
                      </open-button>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </main>
    );
  }
}
