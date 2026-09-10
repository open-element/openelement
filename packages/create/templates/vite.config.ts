import { openElement } from '@openelement/adapter-vite';
import { defineConfig } from 'vite';
import deno from '@deno/vite-plugin';

// Design tokens (from Open Props) plus the global baseline. `--brand` must
// stay aligned with the ui package tokens (`--violet-6` in
// a consumer-owned design-system stylesheet).
//
// v0.44 styling model: the compiled serializer never inlines styles into SSR
// output; `static styles` sheets apply when an element activates client-side.
// Page classes are not registered client-side, so page rules live here in the
// document baseline, scoped under each page's host tag (pages use light
// roots). The app shell and islands carry their own `static styles` and are
// styled as soon as they hydrate.
const globalStyle =
  '<style>:root{--paper:#faf9f6;--ink:#1c1b17;--ink-2:#5b594f;--line:#e5e2d8;--gray-0:#f8f9fa;--gray-1:#f1f3f5;--gray-3:#dee2e6;--gray-5:#adb5bd;--gray-7:#495057;--gray-9:#212529;--brand:#8262db;--brand-2:#4f8ef7;--size-1:4px;--size-2:8px;--size-3:12px;--size-4:16px;--border-size-1:1px;--radius-2:8px;--radius-3:14px;--font-sans:system-ui,-apple-system,sans-serif;--font-serif:ui-serif,Georgia,"Times New Roman",serif;--font-mono:ui-monospace,SFMono-Regular,Menlo,monospace;--font-size-0:0.875rem;--font-weight-5:500;--shadow-1:0 1px 3px 0 rgb(0 0 0 / 0.08);--shadow-2:0 10px 28px rgb(80 70 160 / 0.12)}' +
  'body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--font-sans);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}' +
  '::selection{background:#8262db2e}' +
  // Home page (index-page)
  'index-page{display:block}' +
  'index-page .hero{padding:2.5rem 0 1rem}' +
  'index-page .eyebrow{color:var(--brand);font-weight:600;font-size:0.78rem;letter-spacing:0.14em;text-transform:uppercase}' +
  'index-page h1{font-family:var(--font-serif);font-size:3rem;line-height:1.12;letter-spacing:-0.015em;margin:0.75rem 0 1.25rem;font-weight:700}' +
  'index-page .lede{font-size:1.15rem;line-height:1.75;color:var(--ink-2);max-width:58ch;margin:0}' +
  'index-page .lede code{font-size:0.85em}' +
  'index-page .more{display:inline-block;margin-top:1.5rem;font-weight:600}' +
  'index-page .demo{margin-top:2.75rem;border:1px solid var(--line);border-radius:8px;padding:1.25rem 1.5rem}' +
  'index-page .demo .label{color:var(--ink-2);font-size:0.8rem;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 0.9rem}' +
  'index-page .recent{margin-top:3rem}' +
  'index-page .recent h2{font-family:var(--font-serif);letter-spacing:-0.01em;margin:0 0 0.25rem}' +
  'index-page .recent .sub{color:var(--ink-2);font-size:0.925rem;margin:0 0 1.5rem}' +
  'index-page .recent .sub code{font-size:0.85em}' +
  // Shared post-list rules (home teaser + blog index)
  'index-page .posts,blog-index .posts{list-style:none;padding:0;margin:0;border-top:1px solid var(--line)}' +
  'index-page .post,blog-index .post{display:block;padding:1.15rem 0;border-bottom:1px solid var(--line);color:inherit;text-decoration:none}' +
  'index-page a.post:hover .title,blog-index a.post:hover .title{color:var(--brand)}' +
  'index-page .post .title,blog-index .post .title{display:block;font-family:var(--font-serif);font-size:1.3rem;font-weight:700;letter-spacing:-0.01em;color:var(--ink);transition:color 0.15s ease}' +
  'index-page .post .meta,blog-index .post .meta{display:block;margin-top:0.3rem;font-size:0.85rem;color:var(--ink-2)}' +
  'index-page .post .excerpt,blog-index .post .excerpt{display:block;margin-top:0.45rem;color:var(--ink-2);line-height:1.6}' +
  'index-page a{color:var(--brand);text-decoration:none}' +
  'index-page a:hover{text-decoration:underline}' +
  // Blog index (blog-index)
  'blog-index{display:block}' +
  'blog-index .eyebrow{color:var(--brand);font-weight:600;font-size:0.78rem;letter-spacing:0.14em;text-transform:uppercase}' +
  'blog-index h1{font-family:var(--font-serif);letter-spacing:-0.015em;margin:0.5rem 0}' +
  'blog-index .sub{color:var(--ink-2);font-size:0.925rem;margin:0 0 1.5rem}' +
  'blog-index .sub code{font-size:0.85em}' +
  'blog-index a{color:var(--brand);text-decoration:none}' +
  // Blog post page (blog-welcome)
  'blog-welcome{display:block}' +
  'blog-welcome h1{font-family:var(--font-serif);font-size:2.4rem;line-height:1.15;letter-spacing:-0.015em;margin:0.5rem 0}' +
  'blog-welcome .meta{color:var(--ink-2);font-size:0.9rem;margin-top:0;padding-bottom:1.5rem;border-bottom:1px solid var(--line)}' +
  'blog-welcome a{color:var(--brand);text-decoration:none}' +
  'blog-welcome .post-body{line-height:1.8;font-size:1.05rem}' +
  'blog-welcome .post-body h2{font-family:var(--font-serif);margin:2.5rem 0 0.75rem;letter-spacing:-0.01em}' +
  'blog-welcome .post-body p{margin:1rem 0}' +
  'blog-welcome .post-body code{font-family:var(--font-mono,ui-monospace,Menlo,monospace);font-size:0.85em;background:#f1efe8;border:1px solid var(--line);padding:0.1em 0.4em;border-radius:5px}' +
  // Freshness proof (freshness-page)
  'freshness-page{display:block;max-width:800px;margin:2rem auto;padding:0 1rem}' +
  'freshness-page p{color:var(--ink-2)}' +
  // Styled 404 (el-404)
  'el-404{display:block}' +
  'el-404 h1{font-family:var(--font-serif);font-size:2.4rem;letter-spacing:-0.015em;margin:0.75rem 0 0.5rem;font-weight:700}' +
  'el-404 p{color:var(--ink-2);line-height:1.6}' +
  'el-404 a{color:var(--brand);font-weight:600;text-decoration:none}' +
  'el-404 a:hover{text-decoration:underline}' +
  // Contact form (contact-page)
  'contact-page{display:block}' +
  'contact-page h1{font-family:var(--font-serif);font-size:2.4rem;letter-spacing:-0.015em;margin:0.75rem 0 0.5rem;font-weight:700}' +
  'contact-page .sub{color:var(--ink-2);line-height:1.6;max-width:52ch;margin:0 0 1.75rem}' +
  'contact-page form{display:flex;gap:0.6rem;flex-wrap:wrap}' +
  'contact-page input{font:inherit;min-width:16rem;padding:0.55rem 0.8rem;color:var(--ink);border:1px solid var(--line);border-radius:6px;background:#fff;transition:border-color 0.15s ease,box-shadow 0.15s ease}' +
  'contact-page input:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px #8262db2e}' +
  'contact-page button{font:inherit;font-weight:600;padding:0.55rem 1.1rem;cursor:pointer;border:1px solid var(--brand);border-radius:6px;background:var(--brand);color:#fff;transition:opacity 0.15s ease}' +
  'contact-page button:hover{opacity:0.88}' +
  'contact-page #error{color:#c92a2a;margin:1rem 0 0}' +
  'contact-page #error:empty,contact-page #thanks:empty{display:none}' +
  'contact-page #thanks{color:var(--brand);font-weight:600;margin:1rem 0 0}' +
  '</style>';

export default defineConfig({
  plugins: [
    openElement({
      html: { title: 'My openElement App' },
      appShell: {
        tagName: 'app-shell',
        import: './app/islands/app-shell.tsx',
        props: {
          siteName: 'My openElement App',
        },
      },
      inject: {
        headFragments: [
          globalStyle,
        ],
      },
    }),
    deno(),
  ],
});
