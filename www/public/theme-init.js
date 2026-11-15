// openElement Theme Initialization - L2 (browser API)
// Runs before page render to prevent FOUC (Flash of Unstyled Content).
// Reads saved theme from localStorage, falling back to prefers-color-scheme.
// The public site is a violet, cinematic Web Standards Lab; light remains a
// fully supported reading mode and the system preference wins when nothing
// (or nothing valid) is saved.
(function () {
  if (typeof document === 'undefined') return;

  let saved;
  try {
    saved = localStorage.getItem('open-theme');
  } catch {
    // localStorage may be blocked in private browsing or restricted contexts
  }

  let prefersLight = false;
  try {
    prefersLight = globalThis.matchMedia?.('(prefers-color-scheme: light)').matches ?? false;
  } catch {
    // matchMedia may be unavailable in old WebViews
  }

  // Same acceptance rule as OpenThemeToggle.initTheme()
  // (packages/ui/src/open-theme-toggle.tsx): only the exact 'light' | 'dark'
  // saved values are honored; anything else under the key falls back to
  // prefers-color-scheme, and with no light preference the default is
  // 'dark' — the toggle's no-preference default. This parity is the
  // html[data-theme] broadcast seam registered in docs/architecture/seams.md;
  // www/__tests__/site-theme-and-gaze-seams.test.ts holds both writers to it.
  const theme = saved === 'light' || saved === 'dark' ? saved : prefersLight ? 'light' : 'dark';
  try {
    document.documentElement.setAttribute('data-theme', theme);
    // Synchronous marker proving theme-init ran before first paint.
    document.documentElement.dataset.themeInit = '1';
  } catch {
    // Ignore errors
  }
})();
