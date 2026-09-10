/**
 * app-flow-lit — Lit renderer fixture (Beta.2.2, #1339).
 *
 * Same application shape as the native notes flow, with page rendering swapped
 * onto the explicitly-configured lit renderer: pages are LitElement classes
 * default-exported via defineLitPage() from @openelement/app/lit, rendered
 * server-side by @lit-labs/ssr (DSD) and hydrated by @lit-labs/ssr-client.
 * Routing, loaders, actions (ADR-0120), form enhancement and morphing are the
 * shared framework machinery — only the page renderer forks.
 *
 * renderer: 'lit' supports appShell: false only (the compiled shell path is
 * rejected by the build); the fixture stays minimal and shell-free.
 */
import { openElement } from '@openelement/adapter-vite';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: '@openelement/element',
  },
  plugins: [
    ...openElement({
      renderer: 'lit',
      routesDir: 'app/routes',
      islandsDir: 'app/islands',
      componentsDir: 'app/components',
      appShell: false,
      html: {
        title: 'app-flow-lit fixture',
      },
    }),
  ],
});
