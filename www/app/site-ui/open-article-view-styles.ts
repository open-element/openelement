import { pageStyles } from '../components/page-styles.ts';
import { articleContentStyles } from './article-body.ts';
import { compiledStyle } from './compiled-style.ts';

const articleExtras = `
  .is-hidden { display: none; }
  .article-content blockquote {
    margin: var(--size-4) 0;
    padding: var(--size-1) var(--size-4);
    border: 0;
    border-inline-start: var(--border-size-2) solid var(--violet-8);
    color: var(--text-muted);
    font-family: var(--font-sans);
    font-style: normal;
    font-size: var(--font-size-0);
    line-height: 1.7;
    text-align: start;
  }
  .article-content blockquote p { margin: 0; }
`;

export const openArticleViewStyles = [compiledStyle(
  pageStyles + articleContentStyles('.article-content') + articleExtras,
)];
