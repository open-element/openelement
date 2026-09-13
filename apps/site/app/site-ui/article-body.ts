/**
 * article-body.ts — shared long-form article treatment for www routes.
 *
 * Extracted from routes/blog/[slug].tsx so the blog and the guide section
 * render identical prose typography (the guide redesign references the blog
 * as its layout model). `prepareArticle` post-processes compiled markdown
 * HTML: stable heading ids + rail outline, and <pre> → <open-code-block>
 * wrapping (copy button + highlighting).
 *
 * `articleContentStyles(scope)` emits the prose stylesheet scoped to the
 * caller's container class — blog keeps '.blog-content', guide-article uses
 * '.article-content' with its own additions on top.
 */

export type ArticleOutlineItem = Readonly<{ id: string; label: string; level: 2 | 3 }>;

export function prepareArticle(html: string): { html: string; outline: ArticleOutlineItem[] } {
  const outline: ArticleOutlineItem[] = [];
  const seen = new Map<string, number>();
  const withIds = html.replace(
    /<h([23])([^>]*)>([\s\S]*?)<\/h\1>/gi,
    (_match, depth, attrs, body) => {
      // Strip tags to a fixed point, then any angle bracket the tag pattern
      // could not match (e.g. a `<script` fragment with no closing `>`), so
      // the plain-text label can never carry a partial tag into the rail
      // outline (issue 1281).
      let label = String(body);
      for (;;) {
        const stripped = label.replace(/<[^>]+>/g, '');
        if (stripped === label) break;
        label = stripped;
      }
      label = label.replace(/[<>]/g, '').replace(/&[^;]+;/g, ' ').trim();
      const stem = label.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(
        /(^-|-$)/g,
        '',
      ) || 'section';
      const count = seen.get(stem) ?? 0;
      seen.set(stem, count + 1);
      const id = count ? `${stem}-${count + 1}` : stem;
      outline.push({ id, label, level: Number(depth) as 2 | 3 });
      const cleanAttrs = String(attrs).replace(/\s+id=(?:"[^"]*"|'[^']*')/i, '');
      return `<h${depth}${cleanAttrs} id="${id}">${body}</h${depth}>`;
    },
  );
  // Code display goes through open-code-block (copy button + highlighting).
  const withCodeBlocks = withIds.replace(
    /(<pre[\s\S]*?<\/pre>)/gi,
    '<open-code-block>$1</open-code-block>',
  );
  return { html: withCodeBlocks, outline };
}

/** Prose typography shared by blog and guide article bodies. */
export function articleContentStyles(scope: string): string {
  return `
    ${scope} { font-family: var(--font-sans); font-size: var(--font-size-1); line-height: 1.8; color: var(--text-secondary); }
    ${scope} h2, ${scope} h3 { scroll-margin-top: calc(var(--nav-height) + var(--size-4)); }
    ${scope} h2 { margin-top: var(--size-10); color: var(--text-primary); font-family: var(--font-sans); font-size: var(--font-size-4); font-weight: var(--font-weight-8); letter-spacing: -0.02em; text-wrap: balance; }
    ${scope} h3 { margin-top: var(--size-8); color: var(--text-primary); font-family: var(--font-sans); font-size: var(--font-size-2); font-weight: var(--font-weight-8); text-wrap: balance; }
    ${scope} p { margin: var(--size-4) 0; }
    ${scope} ul, ${scope} ol { padding-left: var(--size-6); margin: var(--size-4) 0; }
    ${scope} li { margin: 0.375rem 0; }
    ${scope} strong { color: var(--text-primary); }
    ${scope} code { background: var(--bg-surface); color: var(--text-primary); padding: 0.125rem 0.375rem; border-radius: var(--radius-1); font-size: var(--font-size-0); font-family: var(--font-mono); }
    ${scope} pre { background: var(--surface-code); border: 0.5px solid var(--border); border-radius: var(--radius-2); padding: var(--size-4); overflow-x: auto; margin: var(--size-4) 0; }
    ${scope} pre code { background: none; color: var(--code-text); padding: 0; font-size: var(--font-size-0); line-height: 1.6; }
    ${scope} open-code-block { margin: var(--size-5) 0; }
    ${scope} table { width: 100%; border-collapse: collapse; margin: var(--size-4) 0; font-size: var(--font-size-1); }
    ${scope} th, ${scope} td { padding: var(--size-2) var(--size-3); text-align: left; border-bottom: 0.5px solid var(--border); }
    ${scope} th { background: var(--bg-surface); color: var(--text-secondary); font-weight: var(--font-weight-6); font-size: var(--font-size-overline); text-transform: uppercase; letter-spacing: var(--font-letterspacing-2); }
    ${scope} a { color: var(--brand); text-decoration: none; }
    ${scope} a:hover { text-decoration: underline; }
    ${scope} hr { border: none; border-top: 0.5px solid var(--border); margin: var(--size-8) 0; }
    ${scope} blockquote { margin: var(--size-8) 0; padding: var(--size-6) var(--size-4); border: 0; border-block: 1.5px solid color-mix(in srgb, var(--violet-5) 55%, transparent); color: var(--violet-8); font-family: var(--font-serif); font-style: italic; font-size: clamp(1.5rem, 3vw, 2.2rem); line-height: 1.35; text-align: center; }
    ${scope} blockquote p { margin: 0; }
  `;
}
