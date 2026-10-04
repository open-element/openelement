import { articleContentStyles } from '../site-ui/article-body.ts';
import { compiledStyle } from '../site-ui/compiled-style.ts';
import { crumbStyles, pageStyles } from './page-styles.ts';

export const pageBlogPostStyles = [
  compiledStyle(
    pageStyles +
      articleContentStyles('.blog-content') +
      `
    :host { display: block; }
    .is-hidden { display: none; }
    ${crumbStyles}
    .crumb a { color: var(--color-muted-foreground); text-decoration: none; }
    .crumb a:hover { color: var(--color-primary); }
    .post-title { margin: 0; color: var(--color-foreground); font-family: var(--font-serif); font-style: italic; font-weight: 400; font-size: clamp(2.4rem, 5.5vw, 4.4rem); line-height: 1.02; letter-spacing: -0.01em; overflow-wrap: break-word; text-wrap: balance; }
    .post-lede { max-width: 640px; margin: calc(var(--spacing) * 4) 0 0; color: var(--color-muted-foreground); font-size: clamp(var(--text-base), 1.4vw, var(--text-xl)); line-height: 1.65; }
    .post-lede:empty { display: none; }
    .lang-notice { max-width: 640px; margin: calc(var(--spacing) * 4) 0 0; padding: calc(var(--spacing) * 2) calc(var(--spacing) * 3); border-inline-start: calc(var(--spacing) * 0.5) solid var(--color-ring); color: var(--color-muted-foreground); font-size: var(--text-sm); line-height: 1.65; }
    .lang-notice:empty { display: none; }
    .post-meta { display: flex; flex-wrap: wrap; gap: calc(var(--spacing) * 2); margin: calc(var(--spacing) * 4) 0 0; color: var(--color-muted-foreground); font-family: var(--font-mono); font-size: var(--text-xs); letter-spacing: 0.06em; text-transform: uppercase; }
    .next-dispatch { display: grid; gap: calc(var(--spacing) * 3); margin-top: calc(var(--spacing) * 10); padding-top: calc(var(--spacing) * 6); border-top: 1px solid var(--color-border); }
    .next-label { color: var(--color-muted-foreground); font-family: var(--font-mono); font-size: var(--text-xs); font-weight: var(--font-weight-extrabold); letter-spacing: 0.16em; text-transform: uppercase; }
    .next-dispatch a { color: var(--color-foreground); font-family: var(--font-serif); font-size: clamp(1.7rem, 3.2vw, 2.6rem); line-height: 1.05; text-decoration: none; }
    .next-dispatch a:hover { color: var(--color-primary); }
    .not-found { text-align: center; padding: calc(var(--spacing) * 12) calc(var(--spacing) * 4); color: var(--color-muted-foreground); }
  `,
  ),
];
