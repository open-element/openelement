/**
 * The UnoCSS probe fixture (alpha15 stage 2B).
 *
 * It is the acceptance surface for "a real second engine, replacing the first
 * without touching the core":
 *
 * - the ENGINE is UnoCSS, through its own configuration file
 *   (`uno.config.ts`, resolved by the official `@unocss/config` loader);
 * - the THEME SOURCE is Open Props — a token package with no relationship to
 *   any utility generator — declared in `app/styles/tokens.css` and imported
 *   into the document sheet through `unocss.theme`;
 * - the COMPONENTS author ordinary `tailwind4`-dialect utilities in their
 *   compiled sources, and the compiled candidates reach the engine through the
 *   same framework channel Tailwind uses.
 *
 * Framework options have ONE home: `openelement.config.ts`. `openElement()` is
 * called with no arguments, exactly as the starter template does.
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
  plugins: [...openElement()],
});
