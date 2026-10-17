/**
 * @openelement/ui dogfood qualification fixture (#1226, v0.44 Beta.2).
 *
 * An app consuming @openelement/ui the way an external consumer does: the
 * package enters through `packageIslands` (WC Package Protocol manifest) and
 * plain page markup, never through fixture-private shims. Every route is
 * static prerendered, so each page exercises the real compile -> SSR/DSD ->
 * serve -> hydrate path; interactive evidence lives in e2e/*.spec.ts.
 *
 * Tailwind entry (alpha9 C2 #1505, ON by default since C5 twin removal):
 * this fixture is the entry-ON proof car — the @theme role table
 * (@openelement/ui/theme.css) compiles through the official pipeline into
 * the head-linked document stylesheet. The
 * ui package no longer embeds any scale values (the theme-tokens twin is
 * deleted), so there is no inline fallback sheet anymore: a preset-less
 * consumer writes its own role table instead (the OFF contract,
 * packages/ui/CUSTOMIZATION.md "Value delivery") — which is exactly why the
 * fixture cannot regress to OFF and stay styled.
 *
 * Since C3 (#1506) the recipes read the theme roles directly, so no
 * components-layer source is configured — the @theme roles are the only
 * sheet.
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
    openElement({
      routesDir: 'app/routes',
      islandsDir: 'app/islands',
      // No layout: the fixture isolates the ui primitives.
      layout: false,
      packageIslands: ['@openelement/ui'],
      head: {
        title: 'ui dogfood fixture',
      },
      tailwind: {
        theme: [
          '@openelement/ui/theme.css',
          // The ui recipes live OUTSIDE this entry (compiled DSD sheets), so
          // the Tailwind compile cannot see their var(--spacing)/--text-*/
          // --radius-* usages and tree-shakes the default scale the roles
          // sit on — first ON-state e2e surfaced it as 0-width controls.
          // Import the installed Tailwind theme verbatim (the scale
          // authority, css-smoke's doctrine) so the component-only app gets
          // the full scale, not just the roles.
          'tailwindcss/theme.css',
        ],
        // C3: the recipes read the @theme roles directly — no components
        // layer is needed, the roles ARE the component sheet. The compiled
        // stylesheet ships as the content-hashed document stylesheet the
        // head links (dev serves the same compile at
        // /.openElement/tailwind.css); the custom properties inherit across
        // every shadow boundary, so no per-template link is needed.
      },
    }),
  ],
});
