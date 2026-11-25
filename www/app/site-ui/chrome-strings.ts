/**
 * Bilingual chrome copy for the long-form reading components
 * (open-reading-shell, open-page-rail). Kept out of open-layout-navigation.ts:
 * that module is the layout policy home, while these strings belong to the
 * reading components' own landmark/outline chrome. English strings are the
 * pre-i18n literals — e2e landmarks pin them, so they must not change.
 */
export function readingChromeStrings(locale: string): {
  onThisPage: string;
  overview: string;
  pageNavigation: string;
  breadcrumb: string;
  sectionAnchor: string;
  previous: string;
  next: string;
  appliesTo: string;
  updated: string;
  freshnessSeparator: string;
} {
  if (locale === 'zh') {
    return {
      onThisPage: '本页目录',
      overview: '概览',
      pageNavigation: '页面导航',
      breadcrumb: '面包屑',
      sectionAnchor: '链接到本节',
      previous: '上一篇',
      next: '下一篇',
      appliesTo: '适用于',
      updated: '更新于',
      freshnessSeparator: ' · ',
    };
  }
  return {
    onThisPage: 'On this page',
    overview: 'Overview',
    pageNavigation: 'Page navigation',
    breadcrumb: 'Breadcrumb',
    sectionAnchor: 'Link to this section',
    previous: 'Previous',
    next: 'Next',
    appliesTo: 'Applies to',
    updated: 'Updated',
    freshnessSeparator: ' · ',
  };
}

/**
 * Freshness-row date display: en keeps the ISO stamp, zh renders
 * 2026年9月18日. Malformed input falls back to the raw string — a display
 * helper must never throw the page.
 */
export function formatFreshnessDate(iso: string, locale: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!parts) return iso;
  if (locale === 'zh') return `${parts[1]}年${Number(parts[2])}月${Number(parts[3])}日`;
  return iso;
}
/**
 * Search chrome copy, server-rendered by the open-search island in the page
 * locale (html lang contract). English strings are pinned verbatim by
 * www/e2e/search.spec.ts — do not reword them without updating that spec.
 * Dynamic messages (empty state, no-results, index-missing) stay in
 * open-search-controller.ts: they are produced at search time, not SSR.
 */
export function searchChromeStrings(locale: string): {
  triggerLabel: string;
  dialogLabel: string;
  inputLabel: string;
  placeholder: string;
  resultsLabel: string;
  emptyMessage: string;
} {
  if (locale === 'zh') {
    return {
      triggerLabel: '搜索',
      dialogLabel: '搜索',
      inputLabel: '搜索文档',
      placeholder: '搜索文档…',
      resultsLabel: '搜索结果',
      emptyMessage: '输入至少 2 个字符以搜索',
    };
  }
  return {
    triggerLabel: 'Search',
    dialogLabel: 'Search',
    inputLabel: 'Search documentation',
    placeholder: 'Search documentation...',
    resultsLabel: 'Search results',
    emptyMessage: 'Type at least 2 characters to search',
  };
}
