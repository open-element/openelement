/**
 * Minimal openElement app proving the complete Native Framework Mode
 * application flow (Beta.2.2 #1339): a notes app with a static home page
 * (build-time data), request-time list/detail/create/edit pages, the
 * ADR-0120 action protocol with native validation, the ADR-0129
 * response-header channel, loader notFound(), and a styled 404.
 *
 * No client-script workaround: the generated request-time server entry injects
 * the island client entry into request-time HTML itself, so the counter island
 * hydrates on dynamic pages exactly like on prerendered pages.
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
      routesDir: 'app/routes',
      islandsDir: 'app/islands',
      componentsDir: 'app/components',
      // No app shell: the fixture stays minimal and does not pull @openelement/ui.
      appShell: false,
      html: {
        title: 'app-flow-native fixture',
      },
    }),
  ],
});
