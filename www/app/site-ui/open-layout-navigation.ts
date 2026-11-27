import { localizePathIn } from './link.ts';
import { normalizeLocalePath } from './i18n.ts';
import { normalizeSiteHref } from './site-url.ts';
import { SITE_DEFAULT_LOCALE } from '../../site-config.ts';

const SAFE_URL_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:', 'sms:']);

/** The public repository behind every page of this Site (footer + header link). */
export const REPOSITORY_URL = 'https://github.com/open-element/openelement';

const LOCALE_LABELS: Record<string, string> = { en: '中文', zh: 'English' };

/** Generated nav data leaves the project-links group nameless; label it. */
export const FALLBACK_SECTION = 'Project';

export interface NavItem {
  path?: string;
  href?: string;
  label: string;
  /** zh label from the content collection frontmatter (or the static map). */
  labelZh?: string;
}

export interface NavSection {
  section: string;
  /** zh group heading; falls back to `section` when absent. */
  sectionZh?: string;
  items: NavItem[];
}

export interface HeaderNavLink {
  href: string;
  label: string;
  labelZh?: string;
}

/** Project a bilingual label pair onto the render locale (en default). */
function localizedLabel(label: string, labelZh: string | undefined, locale: string): string {
  return locale === 'zh' ? (labelZh ?? label) : label;
}

export function isSafeLayoutUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith('//')) return false;
  if (
    trimmed.startsWith('/') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../')
  )
    return true;

  try {
    const parsed = new URL(trimmed, 'https://openelement.org/');
    return SAFE_URL_SCHEMES.has(parsed.protocol);
  } catch {
    return false;
  }
}

export function isExternalLayoutUrl(url: string): boolean {
  try {
    const parsed = new URL(url, 'https://openelement.org/');
    return parsed.origin !== 'https://openelement.org' && SAFE_URL_SCHEMES.has(parsed.protocol);
  } catch {
    return false;
  }
}

export function localizeLayoutPath(
  path: string,
  locale: string,
  locales: string[],
  defaultLocale: string,
): string {
  // Same rule as the in-content links (localizePathIn): non-site-root-relative
  // targets — external URLs, mailto:/tel:, anchors — pass through unchanged.
  // The chrome builders pre-check isSafeLayoutUrl before reaching here.
  return localizePathIn(path, locale, locales, defaultLocale);
}

/**
 * Href emission for the chrome: the locale math above plus the outward
 * trailing-slash form (owner decision D-02). Kept separate from
 * localizeLayoutPath because current-page comparisons compare identity paths.
 */
function layoutSiteHref(
  path: string,
  locale: string,
  locales: string[],
  defaultLocale: string,
): string {
  return normalizeSiteHref(localizePathIn(path, locale, locales, defaultLocale));
}

/** Route identity for comparisons: strip a canonical trailing slash (not root). */
function bareIdentity(path: string): string {
  return path === '/' ? path : path.replace(/\/+$/, '');
}

export function showsDocumentationSidebar(currentPath: string, locales: string[]): boolean {
  // SSG may pass a bare route identity while Vite passes the locale-prefixed request path.
  const { path } = normalizeLocalePath(currentPath, {
    locales,
    defaultLocale: SITE_DEFAULT_LOCALE,
  });
  return (
    path !== '/' &&
    path !== '/404' &&
    path !== '/404.html' &&
    path !== '/blog' &&
    !path.startsWith('/blog/')
  );
}

export function localeSwitchPath(
  currentPath: string,
  currentLocale: string,
  locales: string[],
  defaultLocale: string,
): string {
  const other = locales.find((locale) => locale !== currentLocale) || currentLocale;
  const bare = normalizeLocalePath(currentPath, { locales, defaultLocale }).path;
  // A route pattern (/:slug) can arrive when the resolved request path is
  // unavailable; a literal ":slug" must never land in an href, so the switch
  // target degrades to the deepest static ancestor (/articles/:slug -> /articles).
  const segments = bare.split('/').filter(Boolean);
  const staticSegments: string[] = [];
  for (const segment of segments) {
    if (segment.startsWith(':') || segment.startsWith('[')) break;
    staticSegments.push(segment);
  }
  const safeBare =
    staticSegments.length === segments.length
      ? bare
      : staticSegments.length > 0
        ? `/${staticSegments.join('/')}`
        : '/';
  return layoutSiteHref(safeBare, other, locales, defaultLocale);
}

export function localeSwitchLabel(currentLocale: string): string {
  return LOCALE_LABELS[currentLocale] || currentLocale;
}

/**
 * The sr-only completion of the locale switch's visible label.
 *
 * The label names the TARGET locale ("English" on a zh page, "中文" on an en
 * page), so the note must be written in the language the reader is reading now
 * — and the two branches were swapped: a zh page announced the English sentence
 * "Switch to English", which both repeated the label's own word and put an
 * English string on a Chinese page, while the en page carried the Chinese one.
 * Each branch now states, in its own language, what the target edition covers.
 */
export function localeSwitchScopeNote(currentLocale: string): string {
  return currentLocale === 'zh' ? '查看本页的英文版本。' : 'View this page in Chinese.';
}

export function globalNavSections(items: NavSection[]): NavSection[] {
  return items.map((section) =>
    section.section ? section : { ...section, section: FALLBACK_SECTION },
  );
}

export function mobileSectionRoot(href: string, locales: string[]): string {
  const segments = href.split('/').filter(Boolean);
  const start = locales.length > 1 && locales.includes(segments[0]) ? 1 : 0;
  return segments.length > start + 1 ? `/${segments[start]}` : href;
}

// ─── Compiled-shell chrome builders (#1317) ────────────────────────────────
//
// The compiled open-layout render may only read this.<property> signals, so
// every derived chrome value is precomputed here from the plain shell
// properties (navItems/currentPath/locale/locales passed by the adapter) and
// consumed through computed fields. The compiler admits module-scope calls
// inside computed factories, so these pure functions are the one policy home
// for sidebar/header/footer derivation — the pre-refactor behavior restored
// on the compiled model.

export interface DecoratedHeaderNavLink {
  key: string;
  href: string;
  label: string;
  current: 'page' | 'location' | undefined;
}

export interface SidebarRow {
  key: string;
  kind: string;
  heading: string;
  href: string | null;
  label: string;
  current: 'page' | false;
  rel: string | false;
  /** A section row renders its heading; a link row renders its link. The cell
   *  the row does not carry is present but `hidden`, so both list sites keep
   *  one flat row Block and the variant stays a data fact. */
  headingHidden: boolean;
  linkHidden: boolean;
}

export interface FooterLink {
  key: string;
  href: string;
  label: string;
}

export interface FooterColumnModel {
  label: string;
  links: FooterLink[];
}

export type FooterColumnId = 'docs' | 'project';

const EXTERNAL_REL = 'noopener noreferrer';

/** Mark the active header link; external targets are never current. */
export function decorateHeaderNav(
  links: readonly HeaderNavLink[],
  currentPath: string,
  locale: string,
  locales: readonly string[],
): DecoratedHeaderNavLink[] {
  const localeList = [...locales];
  const defaultLocale = localeList[0] || 'en';
  const bare = normalizeLocalePath(currentPath || '/', {
    locales: localeList,
    defaultLocale,
  }).path;
  const localizedCurrent = localizeLayoutPath(bare, locale, localeList, defaultLocale);
  const currentIdentity = bareIdentity(localizedCurrent);
  const docsIdentity = localizeLayoutPath('/docs', locale, localeList, defaultLocale);
  const docsRoute =
    bare.startsWith('/guide/') ||
    bare === '/architecture' ||
    bare.startsWith('/architecture/') ||
    bare === '/reference' ||
    bare === '/errors';
  return links.map((link) => {
    const raw = typeof link.href === 'string' && isSafeLayoutUrl(link.href) ? link.href.trim() : '';
    const external = isExternalLayoutUrl(raw);
    // Router 1.0 leaves the shell nav contract to the consumer, so this Site
    // builder owns localization (the router still localizes homeHref).
    const href = external ? raw : raw ? layoutSiteHref(raw, locale, localeList, defaultLocale) : '';
    const hrefIdentity = bareIdentity(href);
    let current: DecoratedHeaderNavLink['current'];
    if (!external && href) {
      if (currentIdentity === hrefIdentity) current = 'page';
      else if (
        (hrefIdentity === docsIdentity && docsRoute) ||
        (hrefIdentity !== '/' && currentIdentity.startsWith(`${hrefIdentity}/`))
      ) {
        current = 'location';
      }
    }
    return {
      key: href || link.label,
      href,
      label: localizedLabel(link.label, link.labelZh, locale),
      current,
    };
  });
}

/**
 * Flatten the generated navSections tree into a single keyed row list for the
 * compiled each-Block: one heading row per section, one link row per item.
 * The compiler grammar does not admit nested list Blocks, so section
 * grouping is carried by row.kind and rendered through one flat Block on
 * both the desktop sidebar and the mobile disclosure panel.
 */
export function buildSidebarRows(
  sections: readonly NavSection[],
  currentPath: string,
  locale: string,
  locales: readonly string[],
): SidebarRow[] {
  const localeList = [...locales];
  const defaultLocale = localeList[0] || 'en';
  const barePath = normalizeLocalePath(currentPath || '/', {
    locales: localeList,
    defaultLocale,
  }).path;
  // Items localize their targets; compare against the localized current path
  // (currentPath arrives as the canonical bare route path from the adapter).
  const localizedCurrent = localizeLayoutPath(barePath, locale, localeList, defaultLocale);
  const currentIdentity = bareIdentity(localizedCurrent);
  const rows: SidebarRow[] = [];
  for (const section of globalNavSections([...sections])) {
    rows.push({
      key: `section:${section.section}`,
      kind: 'section',
      heading: localizedLabel(section.section, section.sectionZh, locale),
      href: null,
      label: '',
      current: false,
      rel: false,
      headingHidden: false,
      linkHidden: true,
    });
    for (const item of section.items) {
      const raw = item.href || item.path || '';
      const safe = raw && isSafeLayoutUrl(raw) ? raw.trim() : '';
      const external = safe !== '' && isExternalLayoutUrl(safe);
      const href = external
        ? safe
        : safe
          ? layoutSiteHref(safe, locale, localeList, defaultLocale)
          : null;
      rows.push({
        key: `link:${safe || item.label}`,
        kind: 'link',
        heading: '',
        href,
        label: localizedLabel(item.label, item.labelZh, locale),
        current:
          !external && href !== null && bareIdentity(href) === currentIdentity ? 'page' : false,
        rel: external ? EXTERNAL_REL : false,
        headingHidden: true,
        linkHidden: false,
      });
    }
  }
  return rows;
}

interface FooterColumnSource {
  labels: Record<string, string>;
  links: ReadonlyArray<{ path: string; en: string; zh: string }>;
}

const FOOTER_COLUMNS: Record<FooterColumnId, FooterColumnSource> = {
  docs: {
    labels: { en: 'Docs', zh: '文档' },
    links: [
      { path: '/docs', en: 'Documentation', zh: '文档首页' },
      { path: '/guide/getting-started', en: 'Getting Started', zh: '快速开始' },
      { path: '/reference', en: 'API Reference', zh: 'API 参考' },
      { path: '/errors', en: 'Error Codes', zh: '错误码' },
    ],
  },
  project: {
    labels: { en: 'Project', zh: '项目' },
    links: [
      { path: '/blog', en: 'Blog', zh: '博客' },
      { path: '/changelog', en: 'Changelog', zh: '更新日志' },
      { path: '/contributing', en: 'Contributing', zh: '参与贡献' },
      { path: '/roadmap', en: 'Roadmap', zh: '路线图' },
    ],
  },
};

/** One footer column with localized labels and locale-prefixed targets. */
export function footerColumn(
  locale: string,
  locales: readonly string[],
  id: FooterColumnId,
): FooterColumnModel {
  const source = FOOTER_COLUMNS[id];
  const localeList = [...locales];
  const defaultLocale = localeList[0] || 'en';
  const zh = locale === 'zh';
  return {
    label: source.labels[locale] ?? source.labels.en,
    links: source.links.map((link) => ({
      key: link.path,
      href: layoutSiteHref(link.path, locale, localeList, defaultLocale),
      label: zh ? link.zh : link.en,
    })),
  };
}

/** Bilingual shell-chrome UI strings. */
export function layoutChromeStrings(locale: string): {
  sidebarLabel: string;
  sidebarToggle: string;
  footerCopyright: string;
  footerLicense: string;
  skipToMain: string;
  menuOpen: string;
  menuClose: string;
  themeToggleLabel: string;
  themeSystemLabel: string;
  themeSystemDescription: string;
  /** Label for the group that states the current light, dark, or system mode. */
  themeGroupLabel: string;
  themeGroupLight: string;
  themeGroupDark: string;
  themeGroupSystem: string;
  menuLabel: string;
  primaryNavLabel: string;
  mobileNavLabel: string;
  menuAppearanceLabel: string;
  repositoryLabel: string;
} {
  if (locale === 'zh') {
    return {
      sidebarLabel: '文档导航',
      sidebarToggle: '浏览文档',
      footerCopyright: '© 2026 openElement',
      footerLicense: 'MIT 许可证',
      skipToMain: '跳到主要内容',
      menuOpen: '打开导航',
      menuClose: '关闭导航',
      themeToggleLabel: '切换主题',
      themeSystemLabel: '跟随系统',
      themeSystemDescription: '恢复跟随操作系统的浅色或深色设置。',
      themeGroupLabel: '主题：跟随系统',
      themeGroupLight: '主题：浅色',
      themeGroupDark: '主题：深色',
      themeGroupSystem: '主题：跟随系统',
      menuLabel: '导航',
      primaryNavLabel: '主导航',
      mobileNavLabel: '移动端导航',
      menuAppearanceLabel: '外观',
      repositoryLabel: 'GitHub 仓库（在新标签页打开）',
    };
  }
  return {
    sidebarLabel: 'Documentation navigation',
    sidebarToggle: 'Browse documentation',
    footerCopyright: '© 2026 openElement',
    footerLicense: 'MIT License',
    skipToMain: 'Skip to main content',
    menuOpen: 'Open navigation',
    menuClose: 'Close navigation',
    themeToggleLabel: 'Toggle theme',
    themeSystemLabel: 'Follow system',
    themeSystemDescription: 'Resume following your operating system’s light or dark setting.',
    themeGroupLabel: 'Theme: follow system',
    themeGroupLight: 'Theme: light',
    themeGroupDark: 'Theme: dark',
    themeGroupSystem: 'Theme: follow system',
    menuLabel: 'Navigation',
    primaryNavLabel: 'Primary navigation',
    mobileNavLabel: 'Mobile navigation',
    menuAppearanceLabel: 'Appearance',
    repositoryLabel: 'GitHub repository (opens in a new tab)',
  };
}
