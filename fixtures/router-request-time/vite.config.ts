/**
 * Minimal openElement app proving request-time rendering (0.42.0-alpha.1):
 * routes with renderIntent: { mode: 'dynamic' } are excluded from prerendering
 * and served per-request through dist/server/index.js.
 *
 * No client-script workaround: the generated request-time server entry injects
 * the island client entry into request-time HTML itself (framework fix), so
 * islands hydrate here exactly like on prerendered pages.
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
      // No app shell: the fixture stays minimal and does not pull @acme/components.
      appShell: false,
      html: {
        title: 'request-time fixture',
      },
      // ADR-0123 item 2 (#858): fetch middleware contract proof. Both
      // middlewares are self-contained (their sources are inlined into the
      // generated entry). The parity contract test asserts the onion order
      // and the short-circuit behave identically in dev and in the built
      // server entry.
      middleware: {
        use: [
          async (_request, next) => {
            const response = await next();
            response.headers.append('x-fixture-middleware', 'outer');
            return response;
          },
          async (request, next) => {
            if (new URL(request.url).searchParams.has('mw-short')) {
              return new Response('fixture short-circuit', { status: 418 });
            }
            const response = await next();
            response.headers.append('x-fixture-middleware', 'inner');
            return response;
          },
        ],
      },
    }),
  ],
});
