import { normalizeLocalePath } from '@openelement/app/i18n';

const SAFE_URL_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:', 'sms:']);
const LOCALE_LABELS: Record<string, string> = { en: '中文', zh: 'English' };
const SECTION_MAP: Readonly<Record<string, readonly string[]>> = {
  '/guide': ['Quick Start', 'Guide', 'Core', 'Production'],
  '/architecture': ['Principles', 'Reference'],
  '/blog': ['History'],
  '/apilist': ['Reference'],
  '/roadmap': ['History', 'Project'],
  '/changelog': ['History', 'Project'],
  '/contributing': ['History', 'Project'],
};

/** Generated nav data leaves the project-links group nameless; label it. */
const FALLBACK_SECTION = 'Project';

export interface NavItem {
  path?: string;
  href?: string;
  label: string;
}

export interface NavSection {
  section: string;
  items: NavItem[];
}

export interface HeaderNavLink {
  href: string;
  label: string;
}

export function isSafeLayoutUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith('//')) return false;
  if (
    trimmed.startsWith('/') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../')
  ) return true;

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
  if (isSafeLayoutUrl(path) && /^https?:/i.test(path)) return path;
  if (locale === defaultLocale) return path;
  return normalizeLocalePath(`/${locale}${path === '/' ? '' : path}`, {
    locales,
    defaultLocale,
  }).localizedPath;
}

export function localeSwitchPath(
  currentPath: string,
  currentLocale: string,
  locales: string[],
  defaultLocale: string,
): string {
  const other = locales.find((locale) => locale !== currentLocale) || currentLocale;
  const bare = normalizeLocalePath(currentPath, { locales, defaultLocale }).path;
  return localizeLayoutPath(bare, other, locales, defaultLocale);
}

export function localeSwitchLabel(currentLocale: string): string {
  return LOCALE_LABELS[currentLocale] || currentLocale;
}

export function localeSwitchScopeNote(currentLocale: string): string {
  return currentLocale === 'zh'
    ? 'Switch to English'
    : '中文翻译目前覆盖 Guide 层；其他层的页面仍为英文。';
}

export function filterNavSections(items: NavSection[], currentPath: string): NavSection[] {
  const named = items.map((section) =>
    section.section ? section : { ...section, section: FALLBACK_SECTION }
  );
  for (const [prefix, sections] of Object.entries(SECTION_MAP)) {
    if (currentPath.startsWith(prefix)) {
      return named.filter((section) => sections.includes(section.section));
    }
  }
  return named;
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
  current: 'page' | false;
}

export interface SidebarRow {
  key: string;
  kind: string;
  heading: string;
  href: string | false;
  label: string;
  current: 'page' | false;
  rel: string | false;
}

export interface FooterLink {
  key: string;
  href: string;
  label: string;
  rel: string | false;
}

export interface FooterColumnModel {
  label: string;
  links: FooterLink[];
}

export type FooterColumnId = 'product' | 'resources' | 'company' | 'legal';

const EXTERNAL_REL = 'noopener noreferrer';

/** Mark the active header link; external targets are never current. */
export function decorateHeaderNav(
  links: readonly HeaderNavLink[],
  currentPath: string,
  locale: string,
  locales: readonly string[],
): DecoratedHeaderNavLink[] {
  // The adapter pre-localizes header hrefs but passes the canonical (bare)
  // route path — and request-time paths may still carry the locale prefix.
  // Normalize to one localized form before comparing.
  const localeList = [...locales];
  const defaultLocale = localeList[0] || 'en';
  const bare = normalizeLocalePath(currentPath || '/', {
    locales: localeList,
    defaultLocale,
  }).path;
  const localizedCurrent = localizeLayoutPath(bare, locale, localeList, defaultLocale);
  return links.map((link) => {
    const href = typeof link.href === 'string' && isSafeLayoutUrl(link.href) ? link.href : '';
    const external = isExternalLayoutUrl(href);
    const isCurrent = !external && href !== '' &&
      (localizedCurrent === href || (href !== '/' && localizedCurrent.startsWith(`${href}/`)));
    return {
      key: href || link.label,
      href,
      label: link.label,
      current: isCurrent ? 'page' : false,
    };
  });
}

/**
 * Flatten the generated navSections tree into a single keyed row list for the
 * compiled each-Region: one heading row per section, one link row per item.
 * The compiler grammar does not admit nested list Regions, so section
 * grouping is carried by row.kind and rendered through one flat Region on
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
  const rows: SidebarRow[] = [];
  for (const section of filterNavSections([...sections], barePath)) {
    rows.push({
      key: `section:${section.section}`,
      kind: 'section',
      heading: section.section,
      href: false,
      label: '',
      current: false,
      rel: false,
    });
    for (const item of section.items) {
      const raw = item.href || item.path || '';
      const safe = raw && isSafeLayoutUrl(raw) ? raw.trim() : '';
      const external = safe !== '' && isExternalLayoutUrl(safe);
      const href = external
        ? safe
        : safe
        ? localizeLayoutPath(safe, locale, localeList, defaultLocale)
        : false;
      rows.push({
        key: `link:${safe || item.label}`,
        kind: 'link',
        heading: '',
        href,
        label: item.label,
        current: !external && href !== false && href === localizedCurrent ? 'page' : false,
        rel: external ? EXTERNAL_REL : false,
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
  product: {
    labels: { en: 'Product', zh: '产品' },
    links: [
      { path: '/guide/core-concepts', en: 'Elements', zh: '元素' },
      { path: '/architecture/design-system', en: 'UI', zh: '设计体系' },
      { path: '/architecture/architecture', en: 'Framework', zh: '框架' },
      { path: '/architecture/standards-registry', en: 'Protocols', zh: '协议' },
    ],
  },
  resources: {
    labels: { en: 'Resources', zh: '资源' },
    links: [
      { path: '/guide/getting-started', en: 'Guide', zh: '指南' },
      { path: '/guide/api', en: 'API', zh: 'API' },
      { path: '/architecture/architecture', en: 'Architecture', zh: '架构' },
      { path: '/blog', en: 'Blog', zh: '博客' },
    ],
  },
  company: {
    labels: { en: 'Company', zh: '项目' },
    links: [
      { path: 'https://github.com/open-element/openelement', en: 'GitHub', zh: 'GitHub' },
      { path: '/roadmap', en: 'Roadmap', zh: '路线图' },
      { path: '/changelog', en: 'Changelog', zh: '更新日志' },
    ],
  },
  legal: {
    labels: { en: 'Legal', zh: '法律' },
    links: [
      {
        path: 'https://github.com/open-element/openelement/blob/main/LICENSE',
        en: 'MIT License',
        zh: 'MIT 许可证',
      },
      { path: '/contributing', en: 'Contributing', zh: '参与贡献' },
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
    links: source.links.map((link) => {
      const external = isExternalLayoutUrl(link.path);
      return {
        key: link.path,
        href: external
          ? link.path
          : localizeLayoutPath(link.path, locale, localeList, defaultLocale),
        label: zh ? link.zh : link.en,
        rel: external ? EXTERNAL_REL : false,
      };
    }),
  };
}

/** Bilingual shell-chrome UI strings (landmark labels, disclosures, tagline). */
export function layoutChromeStrings(locale: string): {
  sidebarLabel: string;
  sidebarToggle: string;
  footerTagline: string;
} {
  if (locale === 'zh') {
    return {
      sidebarLabel: '文档导航',
      sidebarToggle: '文档',
      footerTagline: '基于 OpenElement 构建 —— Web Components 原生应用框架',
    };
  }
  return {
    sidebarLabel: 'Documentation navigation',
    sidebarToggle: 'Documentation',
    footerTagline: '',
  };
}
