// openelement.config.ts — the UnoCSS engine selection (alpha15 stage 2B).
//
// `unocss` is the sibling of `tailwind`: same shape, same meaning. Declaring
// it here selects UnoCSS as this application's style engine, and the `theme`
// sources it names are the token files the document sheet carries. The engine
// half — presets, the role→variable map, shortcuts — lives in `uno.config.ts`,
// which the router loads through the official `@unocss/config` loader and
// never re-interprets.
//
// Declaring BOTH `tailwind` and `unocss` fails the build closed: the entry has
// exactly one compiling engine.
import { defineConfig } from '@openelement/router';

export default defineConfig({
  unocss: {
    // Open Props is a token source, not a class compiler: the sheet carries it
    // verbatim, and the utilities' values come from the roles it defines.
    theme: ['app/styles/tokens.css'],
  },
  head: {
    title: 'openElement × UnoCSS probe',
    description:
      'The UnoCSS engine probe: real engine, independent token source, shadow + document delivery.',
  },
});
