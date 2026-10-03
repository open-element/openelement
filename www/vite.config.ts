import { openElement } from '@openelement/router/vite';
import { defineConfig } from 'vite';

// Vite configuration only. Every framework option lives in
// openelement.config.ts (which the plugin reads itself) and the structural
// document-head content lives in app/head.tsx — so the plugin call stays
// `openElement()` with no arguments: framework options have one home.
//
// www is an npm-first consumer; local workspace resolution during dev,
// npm tarballs in production. The Site's own `#site-ui/*` and
// `#generated/blog-data` subpath imports resolve through package.json
// `imports`; these aliases keep the bundler on the same targets even where
// imports-field resolution is not wired up.

export default defineConfig({
  resolve: {
    alias: {
      '#site-ui': new URL('./app/site-ui', import.meta.url).pathname,
      '#generated/blog-data': new URL('./app/data/_generated-blog-data.ts', import.meta.url)
        .pathname,
    },
  },
  base: '/',
  // Keep Vite's automatic JSX transform aligned with the workspace compiler.
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: '@openelement/element',
  },
  plugins: openElement(),
});
