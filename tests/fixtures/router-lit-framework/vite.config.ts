/**
 * app-flow-lit — Lit renderer fixture (Beta.2.2, #1339).
 *
 * Same application shape as the native notes flow, with page rendering swapped
 * onto the explicitly-configured lit renderer: pages are LitElement classes
 * default-exported via defineLitPage() from @openelement/router/lit, rendered
 * server-side by @lit-labs/ssr (DSD) and hydrated by @lit-labs/ssr-client.
 * Routing, loaders, actions (ADR-0120), form enhancement and morphing are the
 * shared framework machinery — only the page renderer forks.
 *
 * renderer: 'lit' supports layout: false only (the compiled layout path is
 * rejected by the build); the fixture stays minimal and layout-free.
 */
import { openElement } from '@openelement/router/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  oxc: {
    jsx: {
      runtime: 'automatic',
      importSource: '@openelement/element',
    },
  },
  plugins: [
    ...openElement({
      renderer: 'lit',
      routesDir: 'app/routes',
      islandsDir: 'app/islands',
      layout: false,
      head: {
        title: 'app-flow-lit fixture',
      },
    }),
  ],
});
