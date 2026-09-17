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
  breadcrumb: string;
  sectionAnchor: string;
  previous: string;
  next: string;
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
  };
}

/**
 * Homepage chrome copy that used to be hard-coded English literals in
 * page-home.tsx. Everything already flowing through the route's locale-aware
 * props (scene leads, spec labels, strategy/output/reference lists) stays
 * there; this dictionary only covers what the component itself owned.
 */
export function homeStrings(locale: string): {
  eyebrow: string;
  registryPrefix: string;
  packagesValue: string;
  enginesValue: string;
  depsValue: string;
  outputValue: string;
  badgeRuntime: string;
  badgeAuthoring: string;
  sceneElementIndex: string;
  sceneDsdIndex: string;
  sceneIslandsIndex: string;
  sceneOutputIndex: string;
  sceneBeginIndex: string;
  floodServer: string;
  floodBrowser: string;
} {
  if (locale === 'zh') {
    return {
      eyebrow: 'OpenElement — Web 标准实验室',
      registryPrefix: '公开注册表 — ',
      packagesValue: '四个包',
      enginesValue: 'CI 中 3 个',
      depsValue: 'element 为零',
      outputValue: 'DSD 一等公民',
      badgeRuntime: '无框架运行时',
      badgeAuthoring: 'JSX + BASIC',
      sceneElementIndex: '§1 — Element',
      sceneDsdIndex: '§2 — 声明式 Shadow DOM',
      sceneIslandsIndex: '§3 — Islands',
      sceneOutputIndex: '§4 — 输出',
      sceneBeginIndex: '§5 — 开始',
      floodServer: '服务端 · text/html',
      floodBrowser: '浏览器 · 就地升级',
    };
  }
  return {
    eyebrow: 'OpenElement — Web Standards Lab',
    registryPrefix: 'public registry — ',
    packagesValue: 'four packages',
    enginesValue: '3 in CI',
    depsValue: 'zero in element',
    outputValue: 'DSD first-class',
    badgeRuntime: 'NO FRAMEWORK RUNTIME',
    badgeAuthoring: 'JSX + BASIC',
    sceneElementIndex: '§1 — Element',
    sceneDsdIndex: '§2 — Declarative Shadow DOM',
    sceneIslandsIndex: '§3 — Islands',
    sceneOutputIndex: '§4 — Output',
    sceneBeginIndex: '§5 — Begin',
    floodServer: 'Server · text/html',
    floodBrowser: 'Browser · upgrades in place',
  };
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
