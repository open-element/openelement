// Keep the DSD app-shell logo on the current locale even before client upgrade.
(function () {
  function syncLogo() {
    // Locale list mirrors the injected `locales` attribute on open-layout
    // (see _homeHref in app/islands/open-layout.tsx) — public scripts are
    // static assets and cannot import app modules. documentElement.lang is
    // a fallback for pages where the attribute has not been injected yet.
    const layout = document.querySelector('open-layout');
    let locales = [];
    try {
      locales = JSON.parse((layout && layout.getAttribute('locales')) || '[]');
    } catch { /* keep the empty fallback */ }
    const lang = document.documentElement.lang;
    if (lang && locales.indexOf(lang) === -1) locales.push(lang);
    const locale = locales.length
      ? location.pathname.match(new RegExp('^/(' + locales.join('|') + ')(?:/|$)'))
      : null;
    const logo = layout && layout.shadowRoot && layout.shadowRoot.querySelector('a.logo');
    if (logo) logo.setAttribute('href', locale ? `/${locale[1]}/` : '/');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', syncLogo);
  else syncLogo();
  addEventListener('popstate', syncLogo);
})();
