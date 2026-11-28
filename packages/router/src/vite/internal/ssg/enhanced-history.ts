// The marker survives reloads after same-document enhanced navigation (#578).
const ENHANCED_NAVIGATION_KEY = 'openelement:enhanced-nav';

export function markEnhancedNavigation(win: Window): void {
  try {
    win.sessionStorage.setItem(ENHANCED_NAVIGATION_KEY, '1');
  } catch {
    // Storage may be unavailable.
  }
}

/** Reconcile history even when the restored document has no enhanced form. */
export function installEnhancedHistoryReload(win: Window): void {
  function reloadEnhancedLocation(): void {
    try {
      if (win.sessionStorage.getItem(ENHANCED_NAVIGATION_KEY) === '1') win.location.reload();
    } catch {
      // Storage may be unavailable.
    }
  }

  win.addEventListener('popstate', reloadEnhancedLocation);
  win.addEventListener('pageshow', (event) => {
    if (event.persisted) reloadEnhancedLocation();
  });
}
