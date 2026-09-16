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
      // ADR-0123 item 2 (#858): fetch middleware contract proof. Module
      // form (Alpha.1): each entry is a path to a module default-exporting a
      // WinterCG Middleware; the generated entry imports the modules, so the
      // middleware closes over module scope and imports a local helper plus a
      // third-party package (see app/middleware/). The parity contract test
      // asserts the onion order, the dependency proof and the short-circuit
      // behave identically in dev and in the built server entry.
      middleware: {
        // Strict CSP with a per-request nonce (Alpha.1 closure): every
        // framework-generated <script> must carry the response nonce or the
        // browser blocks it. 'strict-dynamic' lets the nonced island client
        // entry import its chunks without an allowlist. Static prerendered
        // pages get the policy-only <meta> fallback (nonces are impossible
        // in static files — the SSG fail-closed guard).
        csp: {
          nonce: true,
          policy:
            "default-src 'self'; script-src 'strict-dynamic'; style-src 'self' 'unsafe-inline'",
        },
        use: ['./app/middleware/outer.ts', './app/middleware/inner.ts'],
      },
    }),
  ],
});
