// GENERATED FILE — do not edit.
// Source: packages/ui/src/theme-contract.ts
// Search intent key: www/app/site-ui/open-search-shared.ts
// Generator: www/tools/generate-theme-init.ts (--check enforces byte equality).
(function () {
  'use strict';
  if (typeof document === 'undefined') return;

  const exports = {};
  const module = { exports: exports };
Object.defineProperty(exports, "__esModule", { value: true });
exports.THEME_STORAGE_KEY = void 0;
exports.isSiteTheme = isSiteTheme;
exports.resolveSiteTheme = resolveSiteTheme;
exports.applyDocumentTheme = applyDocumentTheme;
exports.THEME_STORAGE_KEY = 'open-theme';
function isSiteTheme(value) {
    return value === 'light' || value === 'dark';
}
function resolveSiteTheme(saved, prefersLight) {
    if (isSiteTheme(saved))
        return saved;
    return prefersLight ? 'light' : 'dark';
}
function applyDocumentTheme(root, theme) {
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
  const contract = module.exports;

  let saved = null;
  try {
    saved = localStorage.getItem(contract.THEME_STORAGE_KEY);
  } catch {
    // localStorage may be blocked in private browsing or restricted contexts.
  }

  let prefersLight = false;
  try {
    const matchMedia = globalThis.matchMedia;
    if (typeof matchMedia === 'function') {
      prefersLight = matchMedia.call(globalThis, '(prefers-color-scheme: light)').matches === true;
    }
  } catch {
    // matchMedia may be unavailable or throw in old/embedded WebViews.
  }

  const theme = contract.resolveSiteTheme(saved, prefersLight);
  contract.applyDocumentTheme(document.documentElement, theme);

  // The theme control's three-state surface (H3) and the search shortcut's
  // per-platform label (H4) are both first-paint facts: record them here, next
  // to the theme write, so CSS can paint the right state without a post-
  // hydration swap. A saved explicit choice is a mode; anything else follows
  // the OS, exactly as resolveSiteTheme treats it.
  try {
    document.documentElement.dataset.themeMode =
      saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    // The mode marker is presentation only.
  }

  let platform = 'other';
  try {
    const platformName = typeof navigator === 'undefined' ? '' : String(navigator.platform || '');
    const userAgent = typeof navigator === 'undefined' ? '' : String(navigator.userAgent || '');
    if (/Mac|iPhone|iPad|iPod/.test(platformName) || /Macintosh/.test(userAgent)) {
      platform = 'apple';
    }
  } catch {
    // Fall back to the portable shortcut label.
  }
  try {
    document.documentElement.dataset.platform = platform;
  } catch {
    // The platform marker is presentation only.
  }

  // The rendered search button is interactive before the module entry can
  // start framework replay. Retain only the intent on that particular host.
  if (typeof customElements !== 'undefined' && !customElements.get('open-search')) {
    const intent = Symbol.for("openelement.site.search-open-intent");
    const rememberSearch = (event) => {
      if (!event.isTrusted || event.button !== 0 || customElements.get('open-search')) return;
      const trigger = event.target instanceof Element && event.target.closest('button[part="trigger"]');
      const host = trigger && trigger.closest('open-search');
      if (host) host[intent] = true;
    };
    document.addEventListener('click', rememberSearch, true);
    customElements.whenDefined('open-search').then(() => {
      document.removeEventListener('click', rememberSearch, true);
    });
  }

  // JavaScript is available. The linked stylesheet keys the no-JS
  // presentation (hidden inert controls, the static counter) to the absence
  // of this marker, so it must be written before first paint, not by an
  // island that may never load. theme-init is the one eager script.
  try {
    document.documentElement.dataset.js = '1';
  } catch {
    // Byte-string fallback: the stylesheet treats a missing marker as no-JS.
  }

  try {
    // Synchronous marker proving theme-init ran before first paint.
    document.documentElement.dataset.themeInit = '1';
  } catch {
    // Ignore errors: the marker is diagnostic only.
  }
})();
