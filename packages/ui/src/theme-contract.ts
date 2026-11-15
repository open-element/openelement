/**
 * @openelement/ui — the theme contract.
 *
 * The single owner of the document's `data-theme` attribute (P8,
 * `docs/architecture/seams.md` row "html[data-theme] broadcast"). Two systems
 * consume it and neither writes the attribute itself:
 *
 *   the pre-paint boot script `www/public/theme-init.js` — generated from THIS
 *     module by `www/tools/generate-theme-init.ts`, because the file is a
 *     classic synchronous script and cannot import a module at runtime;
 *   `open-theme-toggle.tsx` — delegates its document write to
 *     `applyDocumentTheme` instead of calling `setAttribute` itself.
 *
 * "One owner" is enforced two ways: this is the only `setAttribute` call site
 * for the attribute, and `applyDocumentTheme` is idempotent — a second call
 * with the value already in place is a no-op, so hydrating the toggle after
 * the pre-paint script cannot produce a duplicate DOM mutation.
 *
 * Zero imports on purpose: the generator transpiles this file standalone, so
 * every symbol must be self-contained.
 */

/** The two themes the broadcast seam carries. */
export type SiteTheme = 'light' | 'dark';

/** The localStorage key both consumers read. */
export const THEME_STORAGE_KEY = 'open-theme';

/**
 * The minimal document surface the writer touches. Deliberately structural so
 * the pre-paint script can pass `document.documentElement` and tests can pass
 * a plain object.
 */
export interface ThemeDocument {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  style?: { colorScheme?: string } | null;
}

/** Whether a value is one of the two accepted theme names. */
export function isSiteTheme(value: unknown): value is SiteTheme {
  return value === 'light' || value === 'dark';
}

/**
 * The one acceptance rule: an exact saved `light`/`dark` wins; anything else
 * (missing, blocked storage, legacy truthy garbage) falls back to the system
 * preference; with no light preference the default is `dark` — the toggle's
 * documented no-preference default.
 */
export function resolveSiteTheme(
  saved: string | null | undefined,
  prefersLight: boolean,
): SiteTheme {
  if (isSiteTheme(saved)) return saved;
  return prefersLight ? 'light' : 'dark';
}

/**
 * Apply the theme to the document root — the ONLY writer of
 * `html[data-theme]`.
 *
 * Returns whether anything was written. A theme that is already in place
 * writes nothing (no attribute mutation, no style write), which is what makes
 * the two consumers idempotent together: pre-paint wins the first write and
 * hydration is a no-op instead of a second mutation.
 */
export function applyDocumentTheme(root: ThemeDocument, theme: SiteTheme): boolean {
  let changed = false;
  if (root.getAttribute('data-theme') !== theme) {
    root.setAttribute('data-theme', theme);
    changed = true;
  }
  if (root.style && root.style.colorScheme !== theme) {
    root.style.colorScheme = theme;
    changed = true;
  }
  return changed;
}
