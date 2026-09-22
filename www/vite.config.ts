import { openElement } from '@openelement/router/vite';
import { registerOpenUi } from '@openelement/ui';
import { defineConfig } from 'vite';

// Vite configuration only. Every framework option lives in
// openelement.config.ts (which the plugin reads itself) and the structural
// document-head content lives in app/head.tsx — so the plugin call stays
// `openElement()` with no arguments: framework options have exactly one home.
//
// www is an npm-first consumer; local workspace resolution during dev,
// npm tarballs in production. No resolve.alias needed for the framework. The
// Site's own `@openelement/site-ui` alias is a Vite concern and stays here.

export default defineConfig({
  resolve: {
    alias: {
      '@openelement/site-ui': new URL('./app/site-ui', import.meta.url).pathname,
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
registerOpenUi();
