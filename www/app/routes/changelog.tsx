/** Changelog route: request projection and build-time Markdown loading. */
import { definePage } from '@openelement/app';
import { trustedHtml } from '@openelement/element';
import { sanitizeHtml } from '@openelement/element/sanitize';
import { siteHead } from '@openelement/site-ui/head.ts';
import { contentLocale } from '@openelement/site-ui/locale.ts';
import { localizePath } from '@openelement/site-ui/link.ts';
import { marked } from 'marked';
import PageChangelog from '../components/page-changelog.tsx';
import { PUBLISHED_PACKAGE_VERSION, PUBLISHED_STABLE_VERSION } from '../data/version.ts';

export const meta = { section: '', label: 'Changelog', order: 20 };

const content = {
  en: {
    headTitle: 'Changelog',
    headDescription:
      'Published, candidate, withdrawn and historical release evidence for openElement — every line evidenced.',
    eyebrow: 'Changelog',
    pageTitle: 'Every line, evidenced.',
    lede: 'Published, candidate, withdrawn and historical release evidence for OpenElement.',
    metaPrefix: 'The currently published package line is',
    metaSuffix: '.',
    railLabels: ['Published', 'Stable line', 'Withdrawn', 'Historical archive'],
    publishedIntro:
      'The project follows Keep a Changelog and SemVer. Historical entries preserve older names where they describe older releases; current docs use the openElement contract.',
    stampCurrent: 'Current',
    regCurrentSummary:
      'The published five-package line — unified product and website surface, sealed export seams.',
    regArchiveNote: 'archive →',
    regGhostSummary: 'The eleven-package era — JSR-only, before the collapse. Historical record.',
    stableHeading: 'Stable line',
    stableBody:
      'is the published stable maintenance baseline on the 0.43 track. The static, request-time, and Universal WC SSR contracts remain frozen under ADR-0119, ADR-0122, and ADR-0135; ADR-0140 admits compatible bug, security, runtime, documentation, and release-truth patches without scheduling a 0.44 feature train.',
    withdrawnHeading: 'Withdrawn partial artifacts',
    withdrawnBody:
      'The npm 0.41.0-era beta.1–beta.3 artifacts — published under the 0.41 line before its stable cut — are withdrawn partial releases: never a supported product line, never an upgrade path. The current v0.44.0-beta.2.2 prerelease on dist-tag beta is a separate, unrelated line.',
    footnote:
      '※ The withdrawn 0.41.0-era npm beta.1–beta.3 partial artifacts stay withdrawn from the active release story. History is kept, not rewritten.',
    loadError:
      '<p>Unable to load the changelog. Read it on <a href="https://github.com/open-element/openelement/blob/main/CHANGELOG.md">GitHub</a>.</p>',
    navRoadmap: 'Roadmap',
    navGettingStarted: 'Getting Started',
  },
  zh: {
    headTitle: '更新日志',
    headDescription: 'openElement 已发布、候选、已撤回与历史版本的发布证据——每一行皆有证据。',
    eyebrow: 'Changelog',
    pageTitle: '每一行，皆有证据。',
    lede: 'openElement 已发布、候选、已撤回与历史版本的发布证据。',
    metaPrefix: '当前发布的包线版本为',
    metaSuffix: '。',
    railLabels: ['已发布', '稳定线', '已撤回', '历史归档'],
    publishedIntro:
      '本项目遵循 Keep a Changelog 与 SemVer。历史条目在描述旧版本时保留旧名称；当前文档使用 openElement 契约。',
    stampCurrent: '当前',
    regCurrentSummary: '已发布的五包线——统一的产品与网站接口面，封口的导出边界。',
    regArchiveNote: '归档 →',
    regGhostSummary: '十一包时代——仅限 JSR，在收拢之前。历史记录。',
    stableHeading: '稳定线',
    stableBody:
      '是 0.43 轨道上已发布的稳定维护基线。静态、请求时与 Universal WC SSR 契约继续受 ADR-0119、ADR-0122 和 ADR-0135 冻结；ADR-0140 允许兼容的 bug、安全、运行时、文档与发布真值 patch，但不预排 0.44 功能列车。',
    withdrawnHeading: '已撤回的残缺产物',
    withdrawnBody:
      'npm 上 0.41.0 时代的 beta.1–beta.3 产物——在 0.41 线正式版之前发布——是已撤回的残缺发布：既非受支持的产品线，也不构成升级路径。当前 dist-tag beta 上的 v0.44.0-beta.2.2 预发布是独立的线路，与它们无关。',
    footnote:
      '※ 已撤回的 0.41.0 时代 npm beta.1–beta.3 残缺产物在活跃发布叙事中保持撤回状态。历史被保留，不被改写。',
    loadError:
      '<p>无法加载 changelog。请到 <a href="https://github.com/open-element/openelement/blob/main/CHANGELOG.md">GitHub</a> 阅读。</p>',
    navRoadmap: 'Roadmap',
    navGettingStarted: '快速开始',
  },
} as const;

function loadChangelogHtml(loadError: string): string {
  let changelogPath: URL | undefined;
  let cursor = new URL('.', import.meta.url);
  for (let depth = 0; depth < 8 && !changelogPath; depth++) {
    const candidate = new URL('CHANGELOG.md', cursor);
    try {
      Deno.statSync(candidate);
      changelogPath = candidate;
    } catch {
      cursor = new URL('../', cursor);
    }
  }
  try {
    if (!changelogPath) throw new Error('CHANGELOG.md not found');
    const markdown = Deno.readTextFileSync(changelogPath)
      .replace(/^#\s+Changelog\s*\n/, '')
      // CHANGELOG.md links are repository-relative so they resolve on GitHub;
      // on the built site they would 404 (#1159 link truth), so project them
      // onto the canonical GitHub tree before rendering.
      .replaceAll(
        '](./',
        '](https://github.com/open-element/openelement/tree/main/',
      );
    return sanitizeHtml(marked.parse(markdown, { async: false }) as string);
  } catch {
    return loadError;
  }
}

export default definePage(PageChangelog, {
  head({ locale }) {
    const resolved = contentLocale(locale ?? 'en');
    const copy = content[resolved];
    return siteHead({
      route: '/changelog',
      locale: resolved,
      title: copy.headTitle,
      description: copy.headDescription,
    });
  },
  props({ locale }) {
    const resolved = contentLocale(locale ?? 'en');
    const text = content[resolved];
    const ids = ['published', 'candidate', 'withdrawn', 'historical'];
    return {
      eyebrow: text.eyebrow,
      pageTitle: text.pageTitle,
      lede: text.lede,
      metaPrefix: text.metaPrefix,
      metaSuffix: text.metaSuffix,
      publishedIntro: text.publishedIntro,
      stampCurrent: text.stampCurrent,
      regCurrentSummary: text.regCurrentSummary,
      regArchiveNote: text.regArchiveNote,
      regGhostSummary: text.regGhostSummary,
      stableHeading: text.stableHeading,
      stableBody: text.stableBody,
      withdrawnHeading: text.withdrawnHeading,
      withdrawnBody: text.withdrawnBody,
      footnote: text.footnote,
      packageVersion: PUBLISHED_PACKAGE_VERSION,
      stableVersion: PUBLISHED_STABLE_VERSION,
      railItems: ids.map((id, index) => ({
        id,
        href: `#${id}`,
        label: text.railLabels[index] ?? id,
        depth: '2',
      })),
      changelogHtml: trustedHtml(loadChangelogHtml(text.loadError)),
      roadmapHref: localizePath('/roadmap', resolved),
      roadmapLabel: text.navRoadmap,
      gettingStartedHref: localizePath('/guide/getting-started', resolved),
      gettingStartedLabel: text.navGettingStarted,
    };
  },
});
