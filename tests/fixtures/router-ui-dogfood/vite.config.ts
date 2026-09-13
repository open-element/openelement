/**
 * @openelement/ui dogfood qualification fixture (#1226, v0.44 Beta.2).
 *
 * An app consuming @openelement/ui the way an external consumer does: the
 * package enters through `packageIslands` (WC Package Protocol manifest) and
 * plain page markup, never through fixture-private shims. Every route is
 * static prerendered, so each page exercises the real compile -> SSR/DSD ->
 * serve -> hydrate path; interactive evidence lives in e2e/*.spec.ts.
 */
import { openElement } from '@openelement/router/vite';
import { openPropsTokenSheet } from '@openelement/ui';
import { defineConfig } from 'vite';

// Token sheet as document CSS so the ui recipes resolve their variables on
// first paint (same pattern www uses; shadow trees inherit from :root).
const tokenCSS = [...openPropsTokenSheet.cssRules]
  .map((rule) => rule.cssText)
  .join('\n')
  .replace(/:host\s*\{/g, ':root, :host {');

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
      // No app shell: the fixture isolates the ui primitives.
      appShell: false,
      packageIslands: ['@openelement/ui'],
      ssr: {
        noExternal: ['@openelement/ui'],
      },
      html: {
        title: 'ui dogfood fixture',
      },
      inject: {
        headFragments: [`<style>${tokenCSS}</style>`],
      },
    }),
  ],
});
