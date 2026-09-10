/**
 * Minimal openElement app with only static routes (0.42.0-alpha.17, #953):
 * no route uses renderIntent: { mode: 'dynamic' }, so the build must not
 * produce a request-time server entry, and `cli/start --mode=preview`
 * must accept the output.
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
      // No app shell: the fixture stays minimal and does not pull @acme/components.
      appShell: false,
      html: {
        title: 'static-only fixture',
      },
    }),
  ],
});
