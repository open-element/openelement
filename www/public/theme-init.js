// GENERATED FILE — do not edit.
// Source: packages/ui/src/theme-contract.ts
// Generator: www/tools/generate-theme-init.ts (--check enforces byte equality).
(function () {
  if (typeof document === 'undefined') return;

  const exports = {};
  const module = { exports: exports };
"use strict";
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

  try {
    // Synchronous marker proving theme-init ran before first paint.
    document.documentElement.dataset.themeInit = '1';
  } catch {
    // Ignore errors: the marker is diagnostic only.
  }
})();
