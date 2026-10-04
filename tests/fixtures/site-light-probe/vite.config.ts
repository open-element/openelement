/**
 * Minimal light-mode probe fixture (#1148 / ADR-0142).
 *
 * Moved out of www: the probe is an acceptance fixture for the compiled
 * light-root rendering path, not a public Site surface. It keeps the exact
 * SSR -> delayed-upgrade shape the browser matrix proves (light-root page,
 * light-root island, real public package exports) without any Site shell,
 * navigation, or content collections.
 *
 * Build: pnpm --dir tests/fixtures/site-light-probe run build
 * E2E:   pnpm --dir tests/fixtures/site-light-probe run e2e:browsers
 */
import { openElement } from '@openelement/router/vite';
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
      appShell: false,
      head: {
        title: 'site-light-probe fixture',
      },
    }),
  ],
});
