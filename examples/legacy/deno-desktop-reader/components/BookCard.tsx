/** @jsxImportSource @openelement/element */
import type { ReaderBook, ReaderProgress } from '../app/types.ts';
import BookCover from './BookCover.tsx';

export interface BookCardProps {
  key?: string;
  book: ReaderBook;
  progress?: ReaderProgress | null;
  onNavigate: (bookId: string) => void;
}

export default function BookCard({ book, progress, onNavigate }: BookCardProps) {
  const percent = progress
    ? Math.min(100, Math.round((progress.page / Math.max(book.pageCount, 1)) * 100))
    : 0;
  const isReading = progress && progress.page > 1;

  return (
    <article
      class='book-card'
      onClick={() => onNavigate(book.id)}
    >
      <div class='book-cover-wrap'>
        <BookCover bookId={book.id} title={book.title} author={book.author} />
      </div>
      <div class='book-meta'>
        <h2 class='book-title'>{book.title}</h2>
        {book.author && <p class='book-author'>{book.author}</p>}
        <p class='book-summary'>{book.summary ?? book.fileName}</p>
        <div class='book-foot'>
          <span>{book.pageCount} 页</span>
          {isReading && <span class='progress-pct'>已读 {percent}%</span>}
        </div>
        {isReading && (
          <div class='progress-block'>
            <div class='progress-bar'>
              <span style={{ width: `${percent}%` }} />
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
