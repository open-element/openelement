/**
 * @openelement/ui dogfood qualification fixture (#1226, v0.44 Beta.2).
 *
 * An app consuming @openelement/ui the way an external consumer does: the
 * package enters through `packageIslands` (WC Package Protocol manifest) and
 * plain page markup, never through fixture-private shims. Every route is
 * static prerendered, so each page exercises the real compile -> SSR/DSD ->
 * serve -> hydrate path; interactive evidence lives in e2e/*.spec.ts.
 *
 * Tailwind preset (alpha9 C2, #1505): OFF is the fixture's committed state —
 * the token sheet ships inline and no preset artifact exists, byte-identical
 * to the C2 baseline. Setting OE_C2_TAILWIND=1 demonstrates the opt-in seams
 * instead: the token sheet moves into the preset's linked, layer-ordered
 * bundle (`@layer theme, base, components, utilities`) and the DSD/head
 * emission becomes link-not-inline. The two states are the C2 acceptance
 * pair; nothing else in the fixture changes between them.
 */
import { openElement } from '@openelement/router/vite';
import { manifest } from '@openelement/ui/manifest';
import { themeTokenCss } from '@openelement/ui/theme-tokens';
import { defineConfig } from 'vite';

const tailwindPresetEnabled = process.env.OE_C2_TAILWIND === '1';

// Token sheet as document CSS so the ui recipes resolve their variables on
// first paint (same pattern www uses; shadow trees inherit from :root). With
// the preset enabled this inline full-sheet delivery is replaced by the
// preset's linked bundle — the styleText-style full inline is exactly what
// seam 2 forbids while the preset is active.
const tokenCSS = themeTokenCss;

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
      head: {
        title: 'ui dogfood fixture',
      },
      inject: {
        headFragments: tailwindPresetEnabled ? [] : [`<style>${tokenCSS}</style>`],
      },
      tailwind: tailwindPresetEnabled
        ? {
            theme: ['@openelement/ui/theme.css'],
            components: ['@openelement/ui/semantic-tokens.css'],
            // The @scope light-DOM face, one block per delivered ui tag.
            scopeTags: manifest.declarations.map((declaration) => declaration.tagName),
          }
        : undefined,
    }),
  ],
});
