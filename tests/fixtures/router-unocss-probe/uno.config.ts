/**
 * The application's UnoCSS configuration, loaded through the official
 * `@unocss/config` loader (`loadConfig`, resolved from the installed `unocss`
 * package). The router never re-implements any of it.
 *
 * `presetWind4` is the dialect this fixture authors its class tokens in
 * (`bg-primary/14`, `focus-visible:outline-ring`, `size-[38px]`), and the
 * engine compiles them here exactly as Tailwind 4 does. The token/theme source
 * is the fixture's own plain-CSS file (Open Props), not a package's `@theme`
 * sheet: an admitted `@theme` source is refused by the adapter, by design.
 *
 * The `theme.colors` map is the one place the role names the components use
 * meet the token variables the token source declares. It is ordinary UnoCSS
 * configuration, so a consumer may replace it without touching the framework.
 */
import { defineConfig, presetWind4 } from 'unocss';

export default defineConfig({
  presets: [presetWind4()],
  theme: {
    colors: {
      background: 'var(--color-background)',
      foreground: 'var(--color-foreground)',
      primary: 'var(--color-primary)',
      'primary-foreground': 'var(--color-primary-foreground)',
      border: 'var(--color-border)',
      muted: 'var(--color-muted)',
      ring: 'var(--color-ring)',
      destructive: 'var(--color-destructive)',
    },
  },
});
