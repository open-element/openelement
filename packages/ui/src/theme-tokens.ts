/**
 * GENERATED — do not edit; source: src/theme-tokens.css via @tailwindcss/cli.
 * Regenerate with: pnpm --filter @openelement/ui run generate:theme-tokens
 */

import { StyleSheet, type StyleSheetLike } from '@openelement/element';

const THEME_TOKEN_CSS = `/*! tailwindcss v4.3.3 | MIT License | https://tailwindcss.com */
@layer theme {
  :root, :host {
    --radius: 0.625rem;
    --color-background: hsl(0 0% 100%);
    --color-foreground: hsl(240 10% 3.9%);
    --color-card: hsl(0 0% 100%);
    --color-card-foreground: hsl(240 10% 3.9%);
    --color-popover: hsl(0 0% 100%);
    --color-popover-foreground: hsl(240 10% 3.9%);
    --color-primary: hsl(240 5.9% 10%);
    --color-primary-foreground: hsl(0 0% 98%);
    --color-secondary: hsl(240 4.8% 95.9%);
    --color-secondary-foreground: hsl(240 5.9% 10%);
    --color-muted: hsl(240 4.8% 95.9%);
    --color-muted-foreground: hsl(240 3.8% 46.1%);
    --color-accent: hsl(240 4.8% 95.9%);
    --color-accent-foreground: hsl(240 5.9% 10%);
    --color-destructive: hsl(0 84.2% 60.2%);
    --color-destructive-foreground: hsl(0 0% 98%);
    --color-border: hsl(240 5.9% 90%);
    --color-input: hsl(240 5.9% 90%);
    --color-ring: hsl(240 5.9% 10%);
  }
}
html[data-theme="dark"], .dark, :host([data-theme="dark"]) {
  --color-background: hsl(240 10% 3.9%);
  --color-foreground: hsl(0 0% 98%);
  --color-card: hsl(240 10% 3.9%);
  --color-card-foreground: hsl(0 0% 98%);
  --color-popover: hsl(240 10% 3.9%);
  --color-popover-foreground: hsl(0 0% 98%);
  --color-primary: hsl(0 0% 98%);
  --color-primary-foreground: hsl(240 5.9% 10%);
  --color-secondary: hsl(240 3.7% 15.9%);
  --color-secondary-foreground: hsl(0 0% 98%);
  --color-muted: hsl(240 3.7% 15.9%);
  --color-muted-foreground: hsl(240 5% 64.9%);
  --color-accent: hsl(240 3.7% 15.9%);
  --color-accent-foreground: hsl(0 0% 98%);
  --color-destructive: hsl(0 62.8% 30.6%);
  --color-destructive-foreground: hsl(0 0% 98%);
  --color-border: hsl(240 3.7% 15.9%);
  --color-input: hsl(240 3.7% 15.9%);
  --color-ring: hsl(240 4.9% 83.9%);
}
@media (forced-colors: active) {
  :root, :host, html[data-theme="dark"], .dark, :host([data-theme="dark"]) {
    --color-background: Canvas;
    --color-foreground: CanvasText;
    --color-card: Canvas;
    --color-card-foreground: CanvasText;
    --color-popover: Canvas;
    --color-popover-foreground: CanvasText;
    --color-primary: ButtonText;
    --color-primary-foreground: ButtonFace;
    --color-secondary: ButtonFace;
    --color-secondary-foreground: ButtonText;
    --color-muted: Canvas;
    --color-muted-foreground: GrayText;
    --color-accent: ButtonFace;
    --color-accent-foreground: ButtonText;
    --color-destructive: CanvasText;
    --color-destructive-foreground: Canvas;
    --color-border: CanvasText;
    --color-input: CanvasText;
    --color-ring: Highlight;
  }
}
`;

/**
 * The @theme-derived role sheet as one constructable sheet: a
 * `@layer theme { :root, :host }` block (light values), the unlayered dark
 * union `html[data-theme="dark"], .dark, :host([data-theme="dark"])`, and
 * the forced-colors tier. The same sheet serves document-level adoption and
 * shadow-root adoption; the dark union carries all three dark signals because
 * class/attribute selectors cannot cross the shadow boundary (C0 spike).
 */
export const themeTokenSheet: StyleSheetLike = new StyleSheet();
themeTokenSheet.replaceSync(THEME_TOKEN_CSS);
