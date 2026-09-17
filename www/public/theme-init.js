// openElement Theme Initialization - L2 (browser API)
// Runs before page render to prevent FOUC (Flash of Unstyled Content).
// Reads saved theme from localStorage, falling back to prefers-color-scheme.
// The public site is a violet, cinematic Web Standards Lab; light remains a
// fully supported reading mode and the system preference wins when nothing
// is saved.
(function () {
  if (typeof document === 'undefined') return;

  let saved;
  try {
    saved = localStorage.getItem('open-theme');
  } catch {
    // localStorage may be blocked in private browsing or restricted contexts
  }

  let prefersDark = false;
  try {
    prefersDark = globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  } catch {
    // matchMedia may be unavailable in old WebViews
  }

  const theme = saved || (prefersDark ? 'dark' : 'light');
  try {
    document.documentElement.setAttribute('data-theme', theme);
    // Synchronous marker proving theme-init ran before first paint.
    document.documentElement.dataset.themeInit = '1';
  } catch {
    // Ignore errors
  }
})();
