/**
 * Non-root-base delivery fixture (alpha15 S lane, S-C2/S-12).
 *
 * Every other CSS fixture runs at `base: '/'`. This one builds the SAME
 * delivery contract at a path prefix (`/sub/`): the emitted asset URLs, the
 * marked `<link>` resources (document head for light roots, the DSD template
 * for shadow roots), the request-time server's streamed original head, and the
 * three-engine no-JS computed styles must all carry the configured base —
 * `e2e/base-path.spec.ts` asserts that over real HTTP.
 *
 * The server half is the standard build output served the way a path-mounted
 * deployment serves it: the prefix is stripped before the tree is resolved
 * (the same rule the dev channel's host delegation applies), while every URL
 * the browser sees keeps the base.
 */
import { openElement } from '@openelement/router/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/sub/',
  oxc: {
    jsx: {
      runtime: 'automatic',
      importSource: '@openelement/element',
    },
  },
  plugins: [
    ...openElement({
      routesDir: 'app/routes',
      islandsDir: 'app/islands',
      layout: false,
      head: {
        title: 'base-path fixture',
      },
    }),
  ],
});
