/**
 * Prism initialization — deferred script.
 *
 * Primary highlighting is handled by <open-code-block> components via
 * connectedCallback. This script is a fallback that handles any bare
 * <pre><code> in the light DOM that isn't inside a <open-code-block>.
 */
(function () {
  // Cap the Prism re-poll: on CDN failure we give up after ~5s instead of
  // polling forever — bare <pre><code> simply stays unhighlighted.
  const MAX_RETRIES = 100;
  let retries = 0;
  const init = function () {
    if (typeof Prism === 'undefined') {
      if (retries++ < MAX_RETRIES) setTimeout(init, 50);
      return;
    }
    // Add default language class + highlight bare <pre><code> in light DOM
    document.querySelectorAll('pre code').forEach(function (el) {
      let hasLang = false;
      for (let i = 0; i < el.classList.length; i++) {
        if (el.classList[i].indexOf('language-') === 0) {
          hasLang = true;
          break;
        }
      }
      if (!hasLang) el.classList.add('language-typescript');
    });
    Prism.highlightAll();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
