import { articleContentStyles } from '../site-ui/article-body.ts';
import { compiledStyle } from '../site-ui/compiled-style.ts';
import { pageStyles } from './page-styles.ts';

export const pageBlogPostStyles = [compiledStyle(
  pageStyles + articleContentStyles('.blog-content') + `
    :host { display: block; }
    .is-hidden { display: none; }
    .crumb { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--size-2); margin: 0 0 var(--size-4); color: var(--text-muted); font-family: var(--font-mono); font-size: var(--font-size-00); font-weight: var(--font-weight-8); letter-spacing: 0.1em; text-transform: uppercase; }
    .crumb a { color: var(--text-muted); text-decoration: none; }
    .crumb a:hover { color: var(--brand); }
    .crumb .crumb-sep { color: color-mix(in srgb, var(--text-muted) 55%, transparent); }
    .crumb .crumb-current { color: var(--violet-8); }
    .post-title { margin: 0; color: var(--text-primary); font-family: var(--font-serif); font-style: italic; font-weight: 400; font-size: clamp(2.4rem, 5.5vw, 4.4rem); line-height: 1.02; letter-spacing: -0.01em; overflow-wrap: break-word; text-wrap: balance; }
    .post-lede { max-width: 640px; margin: var(--size-4) 0 0; color: var(--text-secondary); font-size: clamp(var(--font-size-1), 1.4vw, var(--font-size-2)); line-height: 1.65; }
    .post-lede:empty { display: none; }
    .lang-notice { max-width: 640px; margin: var(--size-4) 0 0; padding: var(--size-2) var(--size-3); border-inline-start: var(--border-size-2) solid var(--violet-5); color: var(--text-secondary); font-size: var(--font-size-0); line-height: 1.65; }
    .lang-notice:empty { display: none; }
    .post-meta { display: flex; flex-wrap: wrap; gap: var(--size-2); margin: var(--size-4) 0 0; color: var(--text-muted); font-family: var(--font-mono); font-size: var(--font-size-00); letter-spacing: 0.06em; text-transform: uppercase; }
    .next-dispatch { display: grid; gap: var(--size-3); margin-top: var(--size-11); padding-top: var(--size-6); border-top: 1px solid var(--border); }
    .next-label { color: var(--text-muted); font-family: var(--font-mono); font-size: var(--font-size-00); font-weight: var(--font-weight-8); letter-spacing: 0.16em; text-transform: uppercase; }
    .next-dispatch a { color: var(--text-primary); font-family: var(--font-serif); font-size: clamp(1.7rem, 3.2vw, 2.6rem); line-height: 1.05; text-decoration: none; }
    .next-dispatch a:hover { color: var(--violet-8); }
    .not-found { text-align: center; padding: var(--size-12) var(--size-4); color: var(--text-secondary); }
  `,
)];
