/**
 * @openelement/ui - theme token carrier (hand-maintained).
 *
 * The two authored sources live in CSS files; this module only carries their
 * verbatim text so the tokens reach every consumer as plain TypeScript:
 * npm/JSR consumers cannot import CSS from a dependency at runtime, and the
 * site build evaluates this module both under plain node (www/tools) and
 * inside the SSG bundle — an fs read or a bundler-only ?raw import would
 * break one of the two.
 *
 *   src/theme.css             — the role table (single source of roles, P6)
 *   src/semantic-tokens.css   — the alias layer (retired names → roles)
 *
 * THEME_CSS and ALIAS_CSS below are byte-identical copies of those files.
 * The ui suite fails closed on divergence (css-smoke drift test): edit the
 * .css files, then mirror the edit here.
 */

import { StyleSheet, type StyleSheetLike } from '@openelement/element';

const THEME_CSS = `/* ═══════════════════════════════════════════════════════════════════════
   @theme-derived token table — the single source of design roles (#1504).

   This file is the compiled, hand-evaluated form of the #1503 @theme draft:
   shadcn semantic roles seated on the Tailwind v4 default scale. Rules it
   obeys (umbrella rulings, do not relitigate in C1):

   - Role values are expressed with Tailwind v4 default theme variables
     (var(--color-<ramp>-<step>)); no role carries a color literal.
   - The scale layer carries 0 authored values: every scale declaration is
     the verbatim Tailwind v4 default (source: tailwindlabs/tailwindcss
     v4.1.16 packages/tailwindcss/theme.css, MIT). Only the ramp steps some
     token in this package references are carried.
   - Dark pairs follow the shadcn v4 convention; the '.dark' selector is
     re-pointed at this repo's theme mechanism
     (:root[data-theme='dark'], :host([data-theme='dark'])) because no
     Tailwind build compiles @custom-variant here yet.
   - One deliberate divergence from the shadcn default palette: light
     --color-destructive sits on red-700, not red-600 — red-600 clears 4.5:1
     on the background but drops to ~3.8:1 on the 10% badge wash of itself
     that open-badge paints; red-700 clears both (measured in the ui suite).

   C2 handoff: when Tailwind 4.x is installed, this file's scale layer is
   replaced by the real '@theme' block and the role declarations move into
   it verbatim; role names are the migration contract, not this file's
   selector shape.
   ═══════════════════════════════════════════════════════════════════════ */

:root,
:host {
  /* ── Scales layer: Tailwind v4 defaults, verbatim (0 authored lines) ── */

  --spacing: 0.25rem;

  --radius-xs: 0.125rem;
  --radius-sm: 0.25rem;
  --radius-md: 0.375rem;
  --radius-lg: 0.5rem;
  --radius-xl: 0.75rem;
  --radius-2xl: 1rem;
  --radius-3xl: 1.5rem;
  --radius-4xl: 2rem;

  --shadow-2xs: 0 1px rgb(0 0 0 / 0.05);
  --shadow-xs: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  --shadow-sm: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);
  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
  --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
  --shadow-xl: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1);
  --shadow-2xl: 0 25px 50px -12px rgb(0 0 0 / 0.25);

  --ease-in: cubic-bezier(0.4, 0, 1, 1);
  --ease-out: cubic-bezier(0, 0, 0.2, 1);
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);

  --font-sans:
    ui-sans-serif, system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol',
    'Noto Color Emoji';
  --font-serif: ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif;
  --font-mono:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
    monospace;

  --font-weight-thin: 100;
  --font-weight-extralight: 200;
  --font-weight-light: 300;
  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;
  --font-weight-extrabold: 800;
  --font-weight-black: 900;

  --text-xs: 0.75rem;
  --text-xs--line-height: calc(1 / 0.75);
  --text-sm: 0.875rem;
  --text-sm--line-height: calc(1.25 / 0.875);
  --text-base: 1rem;
  --text-base--line-height: calc(1.5 / 1);
  --text-lg: 1.125rem;
  --text-lg--line-height: calc(1.75 / 1.125);
  --text-xl: 1.25rem;
  --text-xl--line-height: calc(1.75 / 1.25);
  --text-2xl: 1.5rem;
  --text-2xl--line-height: calc(2 / 1.5);
  --text-3xl: 1.875rem;
  --text-3xl--line-height: calc(2.25 / 1.875);
  --text-4xl: 2.25rem;
  --text-4xl--line-height: calc(2.5 / 2.25);
  --text-5xl: 3rem;
  --text-5xl--line-height: 1;
  --text-6xl: 3.75rem;
  --text-6xl--line-height: 1;
  --text-7xl: 4.5rem;
  --text-7xl--line-height: 1;
  --text-8xl: 6rem;
  --text-8xl--line-height: 1;
  --text-9xl: 8rem;
  --text-9xl--line-height: 1;

  --leading-tight: 1.25;
  --leading-snug: 1.375;
  --leading-normal: 1.5;
  --leading-relaxed: 1.625;
  --leading-loose: 2;

  --tracking-tighter: -0.05em;
  --tracking-tight: -0.025em;
  --tracking-normal: 0em;
  --tracking-wide: 0.025em;
  --tracking-wider: 0.05em;
  --tracking-widest: 0.1em;

  --default-transition-duration: 150ms;
  --default-transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);

  /* ── Color scales layer: the ramp steps some token below or in the
     semantic alias layer references, verbatim TW4 v4.1.16 ── */
  --color-white: #fff;

  --color-zinc-50: oklch(98.5% 0 0);
  --color-zinc-100: oklch(96.7% 0.001 286.375);
  --color-zinc-200: oklch(92% 0.004 286.32);
  --color-zinc-300: oklch(87.1% 0.006 286.286);
  --color-zinc-400: oklch(70.5% 0.015 286.067);
  --color-zinc-500: oklch(55.2% 0.016 285.938);
  --color-zinc-600: oklch(44.2% 0.017 285.786);
  --color-zinc-700: oklch(37% 0.013 285.805);
  --color-zinc-800: oklch(27.4% 0.006 286.033);
  --color-zinc-900: oklch(21% 0.006 285.885);
  --color-zinc-950: oklch(14.1% 0.005 285.823);

  --color-violet-50: oklch(96.9% 0.016 293.756);
  --color-violet-100: oklch(94.3% 0.029 294.588);
  --color-violet-200: oklch(89.4% 0.057 293.283);
  --color-violet-300: oklch(81.1% 0.111 293.571);
  --color-violet-400: oklch(70.2% 0.183 293.541);
  --color-violet-500: oklch(60.6% 0.25 292.717);
  --color-violet-600: oklch(54.1% 0.281 293.009);
  --color-violet-700: oklch(49.1% 0.27 292.581);
  --color-violet-800: oklch(43.2% 0.232 292.759);
  --color-violet-900: oklch(38% 0.189 293.745);
  --color-violet-950: oklch(28.3% 0.141 291.089);

  --color-red-400: oklch(70.4% 0.191 22.216);
  --color-red-600: oklch(57.7% 0.245 27.325);
  --color-red-700: oklch(50.5% 0.213 27.518);
  --color-red-950: oklch(25.8% 0.092 26.042);

  --color-green-400: oklch(79.2% 0.209 151.711);
  --color-green-700: oklch(52.7% 0.154 150.069);
  --color-green-800: oklch(44.8% 0.119 151.328);

  --color-amber-400: oklch(82.8% 0.189 84.429);
  --color-amber-500: oklch(76.9% 0.188 70.08);
  --color-amber-700: oklch(55.5% 0.163 48.998);
  --color-amber-800: oklch(47.3% 0.137 46.201);

  --color-blue-400: oklch(70.7% 0.165 254.624);
  --color-blue-700: oklch(48.8% 0.243 264.376);

  --color-indigo-500: oklch(58.5% 0.233 277.117);
  --color-sky-400: oklch(74.6% 0.16 232.661);
  --color-sky-500: oklch(68.5% 0.169 237.323);
  --color-emerald-400: oklch(76.5% 0.177 163.223);
  --color-emerald-500: oklch(69.6% 0.17 162.48);
  --color-rose-400: oklch(71.2% 0.194 13.428);
  --color-rose-500: oklch(64.5% 0.246 16.439);

  /* ── shadcn semantic roles (light), over the TW4 default scale.
     Violet-anchored roles (the brand reads violet); neutral surfaces stay
     zinc so the page base keeps its near-neutral paper feel. ── */

  --color-background: var(--color-white);
  --color-foreground: var(--color-zinc-950);

  --color-card: var(--color-white);
  --color-card-foreground: var(--color-zinc-950);

  --color-popover: var(--color-white);
  --color-popover-foreground: var(--color-zinc-950);

  --color-primary: var(--color-violet-700);
  --color-primary-foreground: var(--color-violet-50);

  --color-secondary: var(--color-violet-100);
  --color-secondary-foreground: var(--color-violet-900);

  --color-muted: var(--color-zinc-100);
  --color-muted-foreground: var(--color-zinc-600);

  --color-accent: var(--color-violet-100);
  --color-accent-foreground: var(--color-violet-900);

  --color-destructive: var(--color-red-700);
  --color-destructive-foreground: var(--color-white);

  --color-border: var(--color-violet-200);
  --color-input: var(--color-violet-200);
  --color-ring: var(--color-violet-500);

  --color-chart-1: var(--color-violet-500);
  --color-chart-2: var(--color-sky-500);
  --color-chart-3: var(--color-emerald-500);
  --color-chart-4: var(--color-amber-500);
  --color-chart-5: var(--color-rose-500);
}

/* Dark pairs (shadcn v4 convention, selector re-pointed — see header). */
:root[data-theme='dark'],
:host([data-theme='dark']) {
  --color-background: var(--color-zinc-950);
  --color-foreground: var(--color-zinc-50);

  --color-card: var(--color-zinc-900);
  --color-card-foreground: var(--color-zinc-50);

  --color-popover: var(--color-zinc-900);
  --color-popover-foreground: var(--color-zinc-50);

  --color-primary: var(--color-violet-400);
  --color-primary-foreground: var(--color-violet-950);

  --color-secondary: var(--color-zinc-800);
  --color-secondary-foreground: var(--color-zinc-100);

  --color-muted: var(--color-zinc-800);
  --color-muted-foreground: var(--color-zinc-400);

  --color-accent: var(--color-zinc-800);
  --color-accent-foreground: var(--color-zinc-100);

  --color-destructive: var(--color-red-400);
  --color-destructive-foreground: var(--color-red-950);

  --color-border: var(--color-zinc-800);
  --color-input: var(--color-zinc-800);
  --color-ring: var(--color-violet-400);

  --color-chart-1: var(--color-violet-400);
  --color-chart-2: var(--color-sky-400);
  --color-chart-3: var(--color-emerald-400);
  --color-chart-4: var(--color-amber-400);
  --color-chart-5: var(--color-rose-400);
}

/* Forced-colors layer: every role re-seats on a system color. The mapping is
   theme-independent (the UA owns the palette in forced-colors mode); the
   duplicate dark pair exists so both selectors stay total if a UA applies
   author dark resolution before forcing. Values are system keywords — no
   author color survives the forcing. */
@media (forced-colors: active) {
  :root {
    --color-background: Canvas;
    --color-foreground: CanvasText;
    --color-card: Canvas;
    --color-card-foreground: CanvasText;
    --color-popover: Canvas;
    --color-popover-foreground: CanvasText;
    --color-primary: ButtonText;
    --color-primary-foreground: Canvas;
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
    --color-chart-1: LinkText;
    --color-chart-2: Mark;
    --color-chart-3: GrayText;
    --color-chart-4: Highlight;
    --color-chart-5: CanvasText;
  }
  :root[data-theme='dark'],
  :host([data-theme='dark']) {
    --color-background: Canvas;
    --color-foreground: CanvasText;
    --color-card: Canvas;
    --color-card-foreground: CanvasText;
    --color-popover: Canvas;
    --color-popover-foreground: CanvasText;
    --color-primary: ButtonText;
    --color-primary-foreground: Canvas;
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
    --color-chart-1: LinkText;
    --color-chart-2: Mark;
    --color-chart-3: GrayText;
    --color-chart-4: Highlight;
    --color-chart-5: CanvasText;
  }
}
`;

const ALIAS_CSS = `/**
 * @openelement/ui - semantic alias layer (hand-maintained).
 *
 * Every retired token name the component recipes and the reference site still
 * consume is aliased here onto the shadcn roles of 'theme.css' — this file
 * defines NO roles of its own and carries no color literals. The recipes keep
 * their old names on purpose: renaming them is C3 work (#1504 umbrella), and
 * this layer is what lets the eleven components render unchanged in the
 * meantime.
 *
 * DELETION CONDITION: when C3 renames the component recipes and the site
 * sources onto the role names, this whole layer (including the raw ramp
 * aliases and their dark mirrors) is deleted with no replacement. Do not add
 * new consumers of these names.
 *
 * Structure: the :host structural fallback is host-exclusive (display/
 * containment must never land on <html>); everything else selects
 * :root, :host so one sheet serves document adoption and shadow adoption.
 */

:host {
  display: block;
  min-height: 1px;
  contain: layout style;
}

:root,
:host {
  /* ── surfaces & ink → roles ── */
  --bg-base: var(--color-background);
  --bg-surface: var(--color-muted); /* BREAK: violet-tinted mix → neutral muted */
  --bg-card: var(--color-card);
  --bg-elevated: var(--color-popover);
  --bg-muted: var(--color-muted);
  --bg-hover: var(--color-accent);
  --text-primary: var(--color-foreground);
  /* BREAK: the site's 3-step ink ladder collapses onto shadcn's 2 slots. */
  --text-secondary: var(--color-muted-foreground);
  --text-muted: var(--color-muted-foreground);
  --border: var(--color-border); /* BREAK: neutral gray → violet-tinted border */
  --border-hover: color-mix(in srgb, var(--color-foreground) 25%, var(--color-border));

  /* ── brand → primary family ── */
  --brand: var(--color-primary);
  --brand-hover: color-mix(in srgb, var(--color-primary) 80%, var(--color-foreground));
  --brand-light: var(--color-violet-400); /* static: identical in both themes */
  --brand-pale: color-mix(in srgb, var(--color-primary) 16%, transparent);
  --brand-subtle: color-mix(in srgb, var(--color-primary) 14%, transparent);
  --brand-glow: color-mix(in srgb, var(--color-primary) 23%, transparent);
  --brand-deep: var(--color-violet-950); /* dark pair below */
  --on-brand: var(--color-primary-foreground);
  --focus-ring: var(--color-ring);

  /* ── code surfaces: the retired sheet kept code blocks dark in BOTH
     themes; the static mapping preserves that (no flip needed) ── */
  --bg-code: var(--color-zinc-950);
  --code-text: var(--color-zinc-200);
  --code-border: var(--color-zinc-700);

  /* ── status inks: each clears the 4.5:1 AA floor on its background AND on
     the 10% wash of itself the badge paints (measured in the ui suite).
     Light steps sit one darker than the nearest TW4 default for exactly
     that floor; dark steps flip lighter. ── */
  --error: var(--color-destructive);
  --error-subtle: color-mix(in srgb, var(--error) 10%, transparent);
  --success: var(--color-green-800); /* dark pair below */
  --success-subtle: color-mix(in srgb, var(--success) 10%, transparent);
  --warning: var(--color-amber-800); /* dark pair below */
  --warning-subtle: color-mix(in srgb, var(--warning) 10%, transparent);
  --info: var(--color-blue-700); /* dark pair below */
  --info-subtle: color-mix(in srgb, var(--info) 10%, transparent);

  /* ── raw ramp aliases (theme-aware). BREAK by construction: the retired
     13-step ramps re-seat on the TW4 11-step ramps, nearest step. These are
     the last consumers of raw ramp names; they die with the C3 rename. ── */
  --gray-0: var(--color-zinc-50);
  --gray-1: var(--color-zinc-100);
  --gray-2: var(--color-zinc-200);
  --gray-3: var(--color-zinc-200);
  --gray-4: var(--color-zinc-300);
  --gray-6: var(--color-zinc-500);
  --gray-7: var(--color-zinc-700);
  --gray-8: var(--color-zinc-800);
  --gray-9: var(--color-zinc-900);
  --gray-10: var(--color-zinc-900);
  --gray-11: var(--color-zinc-950);
  --gray-12: var(--color-zinc-950);
  --violet-0: var(--color-violet-50);
  --violet-1: var(--color-violet-100);
  --violet-2: var(--color-violet-200);
  --violet-3: var(--color-violet-300);
  --violet-4: var(--color-violet-400);
  --violet-5: var(--color-violet-500);
  --violet-6: var(--color-violet-600);
  --violet-7: var(--color-violet-700);
  --violet-8: var(--color-violet-800);
  --violet-10: var(--color-violet-950);
  --violet-11: var(--color-violet-950); /* BREAK: top steps collapse onto 950 */
  --violet-12: var(--color-violet-950);
  --indigo-6: var(--color-indigo-500);

  /* ── spacing: the retired px steps are exact 4px multiples of the TW4 base
     — zero visual change ── */
  --size-1: calc(var(--spacing) * 1);
  --size-2: calc(var(--spacing) * 2);
  --size-3: calc(var(--spacing) * 3);
  --size-4: calc(var(--spacing) * 4);
  --size-5: calc(var(--spacing) * 5);
  --size-6: calc(var(--spacing) * 6);
  --size-7: calc(var(--spacing) * 7);
  --size-8: calc(var(--spacing) * 8);
  --size-9: calc(var(--spacing) * 9);
  --size-10: calc(var(--spacing) * 10);
  --size-12: calc(var(--spacing) * 12);
  --size-16: calc(var(--spacing) * 16);

  /* ── radius (md/lg/xl are value-identical to the retired tuned steps) ── */
  --radius-1: var(--radius-md); /* 6px exact */
  --radius-2: var(--radius-lg); /* 8px exact */
  --radius-3: var(--radius-xl); /* 12px exact */
  --radius-4: var(--radius-2xl); /* BREAK: 20px → 16px */
  --radius-round: calc(infinity * 1px); /* TW4 rounded-full idiom */
  --badge-radius: var(--radius-md);
  --btn-radius: var(--radius-md);
  --card-radius: var(--radius-md);
  --surface-radius: var(--radius-lg);
  --overlay-radius: var(--radius-xl);
  --ui-control-radius: var(--radius-md);

  /* ── typography (00..3 exact; 4..6 BREAK to the TW4 steps above them) ── */
  --font-size-00: var(--text-xs);
  --font-size-0: var(--text-sm);
  --font-size-1: var(--text-base);
  --font-size-2: var(--text-xl);
  --font-size-3: var(--text-2xl);
  --font-size-4: var(--text-4xl); /* BREAK: 2rem → 2.25rem */
  --font-size-5: var(--text-5xl); /* BREAK: 2.5rem → 3rem */
  --font-size-6: var(--text-6xl); /* BREAK: 3.125rem → 3.75rem */
  --font-weight-4: var(--font-weight-normal);
  --font-weight-5: var(--font-weight-medium);
  --font-weight-6: var(--font-weight-semibold);
  --font-weight-7: var(--font-weight-bold);
  --font-weight-8: var(--font-weight-extrabold);
  --font-weight-9: var(--font-weight-black);
  --font-lineheight-1: var(--leading-tight); /* BREAK: 0.95 → 1.25 */
  --font-lineheight-2: var(--leading-snug); /* was referenced but undefined in the retired sheet */
  --font-lineheight-3: var(--leading-normal); /* 1.5 exact */
  --font-lineheight-4: var(--leading-relaxed); /* BREAK: 1.75 → 1.625 */
  --font-letterspacing-2: var(--tracking-normal); /* 0 exact */
  --font-letterspacing-4: var(--tracking-wider); /* BREAK: 0.04em → 0.05em */
  --font-letterspacing-5: var(--tracking-widest); /* BREAK: 0.08em → 0.1em */

  /* ── borders ── */
  --border-size-1: calc(var(--spacing) * 0.25); /* 1px exact */
  --border-size-2: calc(var(--spacing) * 0.5); /* 2px exact */
  --border-size-3: calc(var(--spacing) * 1); /* was referenced but undefined; 4px */

  /* ── motion ── */
  --motion-fast: var(--default-transition-duration); /* BREAK: 160 → 150ms */
  --duration-2: var(--default-transition-duration); /* BREAK: 200 → 150ms */
  --motion-standard: var(--ease-out); /* BREAK: (.2,.8,.2,1) → TW4 out */
  --ease-2: var(--ease-in-out);
  --ease-3: var(--ease-out);

  /* ── focus geometry (spacing-derived: exact) ── */
  --focus-size: calc(var(--spacing) * 0.5); /* 2px */
  --focus-offset: calc(var(--spacing) * 0.75); /* 3px */

  /* ── shadows ── */
  --shadow-1: var(--shadow-sm); /* value-identical to the retired tuned shadow */
  --shadow-2: var(--shadow-2xl); /* BREAK: loses the 60px violet-tinted bloom */
  --shadow-color: var(--color-zinc-950);
  --overlay-shadow: var(--shadow-2xl); /* BREAK: 90px bloom → TW4 2xl */
  --surface-shadow: var(--shadow-2xl); /* BREAK: same */

  /* ── badge recipe ── */
  --badge-font-size: var(--text-xs);
  --badge-padding-x: calc(var(--spacing) * 2);
  --badge-padding-y: calc(var(--spacing) * 0.5);

  /* ── ui-control family (formulas re-derived from roles) ── */
  --ui-control-text: var(--color-foreground);
  --ui-control-bg: color-mix(in srgb, var(--color-popover) 78%, transparent);
  --ui-control-border: color-mix(in srgb, var(--color-border) 72%, var(--color-primary));
  --ui-control-border-hover: color-mix(in srgb, var(--color-violet-400) 74%, var(--color-border));
  --ui-control-highlight: inset 0 1px 0 color-mix(in srgb, var(--color-white) 12%, transparent);

  /* ── surface family (formulas re-derived from roles) ── */
  --surface-glass: linear-gradient(
    145deg,
    color-mix(in srgb, var(--color-primary) 9%, var(--color-card)),
    color-mix(in srgb, var(--color-card) 90%, transparent)
  );
  --surface-overlay: color-mix(in srgb, var(--color-popover) 92%, transparent);
  --surface-border: color-mix(in srgb, var(--color-border) 78%, var(--color-primary));
  --surface-border-strong: color-mix(in srgb, var(--border-hover) 62%, var(--color-primary));
  --surface-highlight: inset 0 1px 0 color-mix(in srgb, var(--color-white) 8%, transparent);
}

/* Dark pairs for the aliases whose retired dark value isn't derivable by a
   theme-agnostic formula: status inks flip to lighter steps; the mirrored
   dark ramps translate to their own TW4 steps. */
:root[data-theme='dark'],
:host([data-theme='dark']) {
  --brand-deep: var(--color-violet-100);
  --success: var(--color-green-400);
  --warning: var(--color-amber-400);
  --info: var(--color-blue-400);

  /* dark-side ramp aliases (the retired dark ramp mirrored the light ramp) */
  --gray-0: var(--color-zinc-950);
  --gray-1: var(--color-zinc-950);
  --gray-2: var(--color-zinc-900);
  --gray-3: var(--color-zinc-900);
  --gray-4: var(--color-zinc-800);
  --gray-6: var(--color-zinc-500);
  --gray-7: var(--color-zinc-400);
  --gray-8: var(--color-zinc-300);
  --gray-9: var(--color-zinc-200);
  --gray-10: var(--color-zinc-200);
  --gray-11: var(--color-zinc-100);
  --gray-12: var(--color-zinc-50);
  --violet-0: var(--color-violet-950);
  --violet-1: var(--color-violet-950);
  --violet-2: var(--color-violet-950);
  --violet-3: var(--color-violet-900);
  --violet-4: var(--color-violet-800);
  --violet-5: var(--color-violet-700);
  --violet-6: var(--color-violet-600);
  --violet-7: var(--color-violet-500);
  --violet-8: var(--color-violet-400);
  --violet-10: var(--color-violet-200);
  --violet-11: var(--color-violet-100);
  --violet-12: var(--color-violet-50);
}
`;

/** Both sources concatenated: the deployable token sheet text. */
export const themeTokenCss: string = THEME_CSS + ALIAS_CSS;

/**
 * The full token set as one constructable sheet. The token blocks select
 * ':root, :host', so the same sheet serves a document-level adoption and a
 * shadow-root adoption; only the structural fallback is :host-exclusive.
 */
export const themeTokenSheet: StyleSheetLike = new StyleSheet();
themeTokenSheet.replaceSync(themeTokenCss);
