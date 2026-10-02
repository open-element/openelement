import { pageStyles } from '../components/page-styles.ts';
import { articleContentStyles } from './article-body.ts';
import { compiledStyle } from './compiled-style.ts';

const articleExtras = `
  .is-hidden { display: none; }
  .nf-code {
    font-family: var(--font-mono);
    font-size: var(--text-5xl);
    color: var(--color-muted-foreground);
  }
  .article-content blockquote {
    margin: calc(var(--spacing) * 4) 0;
    padding: calc(var(--spacing) * 1) calc(var(--spacing) * 4);
    border: 0;
    border-inline-start: 2px solid var(--color-primary);
    color: var(--color-muted-foreground);
    font-family: var(--font-sans);
    font-style: normal;
    font-size: var(--text-sm);
    line-height: 1.7;
    text-align: start;
  }
  .article-content blockquote p { margin: 0; }
`;

export const openArticleViewStyles = [
  compiledStyle(pageStyles + articleContentStyles('.article-content') + articleExtras),
];
