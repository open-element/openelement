/**
 * Bilingual chrome copy for the long-form reading components
 * (open-reading-shell, open-page-rail). Kept out of open-layout-navigation.ts:
 * that module is the app-shell policy home, while these strings belong to the
 * reading components' own landmark/outline chrome. English strings are the
 * pre-i18n literals — e2e landmarks pin them, so they must not change.
 */
export function readingChromeStrings(locale: string): {
  onThisPage: string;
  overview: string;
  pageNavigation: string;
} {
  if (locale === 'zh') {
    return {
      onThisPage: '本页目录',
      overview: '概览',
      pageNavigation: '页面导航',
    };
  }
  return {
    onThisPage: 'On this page',
    overview: 'Overview',
    pageNavigation: 'Page navigation',
  };
}
