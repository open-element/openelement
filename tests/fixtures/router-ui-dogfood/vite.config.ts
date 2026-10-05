/**
 * @openelement/ui dogfood qualification fixture (#1226, v0.44 Beta.2).
 *
 * An app consuming @openelement/ui the way an external consumer does: the
 * package enters through `packageIslands` (WC Package Protocol manifest) and
 * plain page markup, never through fixture-private shims. Every route is
 * static prerendered, so each page exercises the real compile -> SSR/DSD ->
 * serve -> hydrate path; interactive evidence lives in e2e/*.spec.ts.
 *
 * Tailwind preset (alpha9 C2 #1505, ON by default since C5 twin removal):
 * this fixture is the preset-ON proof car — the @theme role table
 * (@openelement/ui/theme.css) ships through the preset's linked,
 * layer-ordered bundle and the head emission is link-not-inline. The
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
import { manifest } from '@openelement/ui/manifest';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: '@openelement/element',
  },
  plugins: [
    openElement({
      routesDir: 'app/routes',
      islandsDir: 'app/islands',
      componentsDir: 'app/components',
      // No app shell: the fixture isolates the ui primitives.
      appShell: false,
      packageIslands: ['@openelement/ui'],
      head: {
        title: 'ui dogfood fixture',
      },
      tailwind: {
        theme: [
          '@openelement/ui/theme.css',
          // The ui recipes live OUTSIDE this bundle (compiled DSD sheets), so
          // the Tailwind compile cannot see their var(--spacing)/--text-*/
          // --radius-* usages and tree-shakes the default scale the roles
          // sit on — first ON-state e2e surfaced it as 0-width controls.
          // Import the installed Tailwind theme verbatim (the scale
          // authority, css-smoke's doctrine) so the component-only app gets
          // the full scale, not just the roles.
          'tailwindcss/theme.css',
        ],
        // C3: the recipes read the @theme roles directly — no components
        // layer is needed, the roles ARE the component sheet.
        // The @scope light-DOM face, one block per declared ui tag.
        scopeTags: manifest.declarations.map((declaration) => declaration.tagName),
        // The ui components are compiled DSD elements that claim their
        // shadow DOM exactly (the compiled-claim walk requires the shadow
        // root's children to equal the Part Program's own nodes — an
        // injected trailing link is structural drift, e2e-verified on
        // firefox). Same opt-out as the www site: the head link alone
        // reaches every shadow tree, because the theme layer is custom
        // properties, which inherit across the shadow boundary.
        injectDsdLinks: false,
      },
    }),
  ],
});
