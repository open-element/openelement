// openelement.config.ts — the framework options of the official Site.
//
// The Vite configuration owns only Vite concerns (base, resolve.alias, the
// oxc JSX transform); everything the framework reads lives here. The
// plugin call in vite.config.ts is therefore plain `openElement()`.
//
// Two channels feed the document <head>:
//   - `head.scripts` below: external scripts, structured (src/defer), so the
//     framework serializes the tags and the Site never hand-writes markup;
//   - `app/head.tsx`: structural content a URL list cannot express (meta tags,
//     icons, feed links, inline critical CSS).
import { defineConfig } from '@openelement/router';
import { SITE_BUDGET } from './site-budget.ts';
import { SITE_DEFAULT_LOCALE, SITE_LOCALES } from './site-config.ts';
import { SITE_FONT_SOURCES } from './site-fonts.ts';
import { headerNav, navSections } from './app/data/_generated-nav-data.ts';

export default defineConfig({
  // The framework's documented defaults, stated explicitly: the Site pins its
  // source roots so a future default change cannot silently move them. The
  // tokens/app-shell/head conventions resolve under the shared base of the
  // three roots, which is `app` — where app/head.tsx lives.
  dirs: {
    routes: 'app/routes',
    islands: 'app/islands',
    components: 'app/components',
  },
  // The document title is deliberately NOT set here: the framework's default is
  // already `openElement`, and every Site page declares its own title through
  // the page descriptor head (www/app/site-ui/head.ts), which is the only
  // meaning <title> should carry. Setting it here would additionally emit the
  // site-level og:title/og:site_name pair, which the page-level head owns.
  head: {
    // All scripts are same-origin. theme-init is inlined instead of requested;
    // goatcounter was removed (unreachable from CN networks, cost a console
    // error + best-practices points on every page). Code highlighting compiles
    // into the page HTML at build time (www/lib/markdown.ts) — no highlighting
    // script ships or runs in the browser (issue #1552 retired the vendored
    // Prism runtime).
    scripts: [{ src: '/theme-init.js' }],
  },
  // The shell's tag name (`open-layout`) is derived from the import's basename.
  appShell: {
    import: './app/islands/open-layout.tsx',
    props: {
      footerText: 'Built with OpenElement — Web Components-native application framework',
      // Router 1.0 keeps the app-shell nav contract in the consumer: the Site
      // projects its route-meta nav tree into the shell (Nav items are
      // static; the router injects currentPath/locale per route).
      navItems: navSections,
      headerNav,
    },
  },
  // Listing the UI package admits its island modules AND derives the SSR
  // externalization list: a package whose islands the build renders must be
  // bundled, not imported at run time. There is no separate `ssr` key.
  packageIslands: ['@openelement/ui'],
  viewTransition: true,
  // The Tailwind preset (alpha9 C2 #1505; moved here from a build-only
  // consumer plugin in the alpha.13 F lane): the framework compiles the
  // declared sources into one bundle and delivers it on BOTH channels — dev
  // serves the compile from /.openElement/tailwind-preset/entry.css and links
  // it in the document head, the build emits the same compile as the
  // layer-ordered /assets/open-tailwind.css after the SSG render.
  //
  // The theme source is the ui package's real @theme role table (C3 made the
  // recipes and the site read the role names directly), compiled into the
  // bundle's `theme` layer alongside Tailwind's own defaults. No `components`
  // layer and no `@scope` face: the site's own components keep their compiled
  // shadow sheets and the page layer is light DOM, so the plain bundle covers
  // both adoptions.
  //
  // The self-hosted @font-face faces (www/site-fonts.ts, the H lane's
  // replacement for #1554's four jsDelivr stylesheet links) ride the same
  // bundle: the declared fontsource stylesheets compile in, their woff2 files
  // emit as content-hashed assets beside the bundle and the bundle's url()
  // references are rewritten to those shipped names — the #1535 path this
  // preset already owns for compile-referenced assets. One linked same-origin
  // stylesheet carries theme + fonts, so no font request can leave the
  // origin and no CDN outage can stall first paint.
  tailwind: {
    theme: ['@openelement/ui/theme.css', ...SITE_FONT_SOURCES],
    // The Site's compiled DSD islands claim their shadow DOM exactly (the
    // compiled-claim walk requires the shadow root's children to equal the
    // Part Program's own nodes), so the per-shadow-template link injection is
    // off: the head link alone reaches every shadow tree — the theme layer is
    // custom properties, which inherit across the shadow boundary.
    injectDsdLinks: false,
  },
  speculation: true,
  // One shared official-Site SLO (www/site-budget.ts): the build manifest
  // reports against exactly these values.
  build: {
    manifestBudget: SITE_BUDGET,
  },
  // The Site's generated data modules (app/data/_generated-*) are untracked
  // build inputs, regenerated by `pnpm --dir www run generate:content`
  // (article collections and blog) and `pnpm --dir www run
  // generate:api-reference` from www/lib/content.ts + lib/blog.ts.
  i18n: {
    locales: [...SITE_LOCALES],
    defaultLocale: SITE_DEFAULT_LOCALE,
  },
});
