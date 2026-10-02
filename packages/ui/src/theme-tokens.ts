/**
 * GENERATED — do not edit; source: src/theme-tokens.css via @tailwindcss/cli.
 * Regenerate with: pnpm --filter @openelement/ui run generate:theme-tokens
 */

import { StyleSheet, type StyleSheetLike } from '@openelement/element';

const THEME_TOKEN_CSS = `/*! tailwindcss v4.3.3 | MIT License | https://tailwindcss.com */
@layer theme {
  :root, :host {
    --font-sans: 'JetBrains Mono', monospace;
    --font-serif: 'Instrument Serif', 'Songti SC', 'Noto Serif CJK SC', serif;
    --font-mono: 'JetBrains Mono', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', monospace;
    --spacing: 0.25rem;
    --text-xs: 0.75rem;
    --text-sm: 0.875rem;
    --text-base: 1rem;
    --text-xl: 1.25rem;
    --text-2xl: 1.5rem;
    --text-3xl: 1.875rem;
    --text-4xl: 2.25rem;
    --text-5xl: 3rem;
    --font-weight-normal: 400;
    --font-weight-medium: 500;
    --font-weight-semibold: 600;
    --font-weight-bold: 700;
    --font-weight-extrabold: 800;
    --font-weight-black: 900;
    --radius-md: 0.375rem;
    --radius-lg: 0.5rem;
    --radius-xl: 0.75rem;
    --radius-2xl: 1rem;
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
    --color-destructive: #b12525;
    --color-destructive-subtle: rgba(177, 37, 37, 0.1);
    --color-destructive-foreground: hsl(0 0% 98%);
    --color-border: hsl(240 5.9% 90%);
    --color-input: hsl(240 5.9% 90%);
    --color-ring: hsl(240 5.9% 10%);
    --color-success: #237032;
    --color-success-subtle: rgba(35, 112, 50, 0.1);
    --color-warning: #885b00;
    --color-warning-subtle: rgba(136, 91, 0, 0.1);
    --color-info: #2157cf;
    --color-info-subtle: rgba(33, 87, 207, 0.1);
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
  --color-destructive: #f87171;
  --color-destructive-subtle: rgba(248, 113, 113, 0.15);
  --color-destructive-foreground: hsl(0 0% 98%);
  --color-border: hsl(240 3.7% 15.9%);
  --color-input: hsl(240 3.7% 15.9%);
  --color-ring: hsl(240 4.9% 83.9%);
  --color-success: #4ade80;
  --color-success-subtle: rgba(74, 222, 128, 0.1);
  --color-warning: #fbbf24;
  --color-warning-subtle: rgba(251, 191, 36, 0.1);
  --color-info: #60a5fa;
  --color-info-subtle: rgba(96, 165, 250, 0.1);
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
    --color-destructive-subtle: Canvas;
    --color-destructive-foreground: Canvas;
    --color-border: CanvasText;
    --color-input: CanvasText;
    --color-ring: Highlight;
    --color-success: CanvasText;
    --color-success-subtle: Canvas;
    --color-warning: CanvasText;
    --color-warning-subtle: Canvas;
    --color-info: CanvasText;
    --color-info-subtle: Canvas;
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
