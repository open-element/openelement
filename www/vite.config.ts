import { join } from 'node:path';
import {
  applyTailwindPreset,
  openElement,
  type TailwindPresetOptions,
} from '@openelement/router/vite';
import { defineConfig, type Plugin, type ResolvedConfig } from 'vite';

// Vite configuration only. Every framework option lives in
// openelement.config.ts (which the plugin reads itself) and the structural
// document-head content lives in app/head.tsx — so the plugin call stays
// `openElement()` with no arguments: framework options have one home.
//
// www is an npm-first consumer; local workspace resolution during dev,
// npm tarballs in production. The Site's own `#site-ui/*` and
// `#generated/blog-data` subpath imports resolve through package.json
// `imports`; these aliases keep the bundler on the same targets even where
// imports-field resolution is not wired up.

/**
 * The Tailwind preset's declared style sources (alpha9 C4, #1507). The theme
 * source is the ui package's real @theme role table (C3 made the recipes and
 * the site read the role names directly), compiled into the bundle's `theme`
 * layer alongside Tailwind's own defaults. No `components` layer and no
 * `@scope` face: the site's own components keep their compiled shadow sheets
 * and the page layer is light DOM, so the plain bundle covers both adoptions.
 */
const TAILWIND_PRESET_OPTIONS: TailwindPresetOptions = {
  theme: ['@openelement/ui/theme.css'],
  // The Site's compiled DSD islands claim their shadow DOM exactly (the
  // compiled-claim walk requires the shadow root's children to equal the
  // Part Program's own nodes), so the per-shadow-template link injection is
  // off: the head link alone reaches every shadow tree — the theme layer is
  // custom properties, which inherit across the shadow boundary.
  injectDsdLinks: false,
};

/**
 * The C2 preset's build-layer delivery, applied from the Site's own pipeline.
 *
 * The preset option (`tailwind`) exists only on the inline `openElement(...)`
 * face today — the `openelement.config.ts` schema does not carry it, and the
 * one-home conflict rule (P6) rejects inline options next to this project's
 * config file. Rather than widen the framework's public config surface from a
 * consumer lane, the Site calls the preset's public entry
 (`applyTailwindPreset`)
 * from a trailing closeBundle hook: rollup runs closeBundle hooks in plugin
 * order, so this runs after the open:build plugin has finished Phase 3 (the
 * SSG render), the island manifests, and the SSR cleanup — the same point
 * the built-in option applies at (packages/router/src/vite/build.ts, the
 * "Tailwind preset" block). When the config-file schema grows the key, this
 * plugin collapses into one `tailwind:` line in openelement.config.ts.
 */
function siteTailwindPreset(): Plugin {
  let config: ResolvedConfig | undefined;
  return {
    name: 'www:tailwind-preset',
    apply: 'build',
    configResolved(resolved) {
      config = resolved;
    },
    async closeBundle() {
      if (!config || config.command !== 'build') return;
      const outDir = join(config.root, config.build.outDir || 'dist');
      await applyTailwindPreset(TAILWIND_PRESET_OPTIONS, config, outDir);
    },
  };
}

export default defineConfig({
  resolve: {
    alias: {
      '#site-ui': new URL('./app/site-ui', import.meta.url).pathname,
      '#generated/blog-data': new URL('./app/data/_generated-blog-data.ts', import.meta.url)
        .pathname,
    },
  },
  base: '/',
  // Keep Vite's automatic JSX transform aligned with the workspace compiler.
  oxc: {
    jsx: {
      runtime: 'automatic',
      importSource: '@openelement/element',
    },
  },
  plugins: [openElement(), siteTailwindPreset()],
});
