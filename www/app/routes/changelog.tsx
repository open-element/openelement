/** Changelog route: request projection and build-time Markdown loading. */
import { definePage } from '@openelement/router';
import { trustedHtml } from '@openelement/element';
import { siteHead } from '@openelement/site-ui/head.ts';
import { contentLocale } from '@openelement/site-ui/locale.ts';
import { localizePath } from '@openelement/site-ui/link.ts';
import { marked } from 'marked';
import PageChangelog from '../components/page-changelog.tsx';
import { COMMON_PUBLISHED_LABEL, REGISTRY_NOTE } from '../data/version.ts';

export const meta = { section: '', label: 'Changelog', order: 20 };

const content = {
  en: {
    headTitle: 'Changelog',
    headDescription:
      'The openElement release register — current per-package npm dist-tags — plus the repository CHANGELOG.md historical archive. Machine-checked release truth lives in docs/release/release-state.json.',
    eyebrow: 'Changelog',
    pageTitle: 'The register, then the archive.',
    lede:
      'The register reflects the current per-package npm dist-tags. The archive below renders the repository CHANGELOG.md unchanged; machine-checked release truth lives in docs/release/release-state.json.',
    metaPrefix: 'Current per-package npm latest:',
    metaSuffix: '.',
    railLabels: ['Published', 'Stable line', 'Withdrawn', 'Historical archive'],
    publishedIntro:
      'The project follows Keep a Changelog and SemVer. Historical entries preserve older names where they describe older releases; current docs use the openElement contract.',
    stampCurrent: 'Current',
    regCurrentSummary:
      "There is no common complete version: element, create, and ui are on 0.43.3 while router's latest is the 0.41.0-alpha.6 prerelease.",
    regArchiveNote: 'archive →',
    regGhostSummary: 'The eleven-package era — JSR-only, before the collapse. Historical record.',
    stableHeading: 'Stable line',
    stableBody:
      'is the stable maintenance line for @openelement/element, @openelement/create, and @openelement/ui only. @openelement/router has no 0.43.x; its npm latest is a 0.41.0 prerelease. No single version is published for all four packages. The static, request-time, and Universal WC SSR contracts remain frozen under ADR-0119, ADR-0122, and ADR-0135; ADR-0140 admits compatible patches without scheduling a 0.44 feature train.',
    withdrawnHeading: 'Withdrawn partial artifacts',
    withdrawnBody:
      'The npm 0.41.0-era beta.1–beta.3 artifacts — published under the 0.41 line before its stable cut — are withdrawn partial releases: never a supported product line, never an upgrade path. The v0.44.0-beta.2.2 prerelease on dist-tag beta is also partial: element, create, and ui published; Router never did, so it is not a four-package release.',
    footnote:
      '※ The withdrawn 0.41.0-era npm beta.1–beta.3 partial artifacts stay withdrawn from the active release story. History is kept, not rewritten.',
    loadError:
      '<p>Unable to load the changelog. Read it on <a href="https://github.com/open-element/openelement/blob/main/CHANGELOG.md">GitHub</a>.</p>',
    archiveSource:
      'Rendered unchanged from the repository <a href="https://github.com/open-element/openelement/blob/main/CHANGELOG.md">CHANGELOG.md</a>. Current release truth is machine-checked in <a href="https://github.com/open-element/openelement/blob/main/docs/release/release-state.json">docs/release/release-state.json</a>; the register above summarizes the current npm dist-tags.',
    langNotice: '',
    navRoadmap: 'Roadmap',
    navGettingStarted: 'Getting Started',
  },
  zh: {
    headTitle: '更新日志',
    headDescription:
      'openElement 发布登记表——当前各包 npm dist-tags——以及仓库 CHANGELOG.md 历史归档。机器校验的发布真值见 docs/release/release-state.json。',
    eyebrow: 'Changelog',
    pageTitle: '先登记表，再归档。',
    lede:
      '登记表反映当前各包的 npm dist-tags。下方归档原样渲染仓库 CHANGELOG.md；机器校验的发布真值见 docs/release/release-state.json。',
    metaPrefix: '当前各包的 npm latest 分别为：',
    metaSuffix: '。',
    railLabels: ['已发布', '稳定线', '已撤回', '历史归档'],
    publishedIntro:
      '本项目遵循 Keep a Changelog 与 SemVer。历史条目在描述旧版本时保留旧名称；当前文档使用 openElement 契约。',
    stampCurrent: '当前',
    regCurrentSummary:
      '不存在共同完整版本：element、create、ui 在 0.43.3，而 router 的 latest 是 0.41.0-alpha.6 预发布。',
    regArchiveNote: '归档 →',
    regGhostSummary: '十一包时代——仅限 JSR，在收拢之前。历史记录。',
    stableHeading: '稳定线',
    stableBody:
      '仅是 @openelement/element、@openelement/create、@openelement/ui 的稳定维护线。@openelement/router 没有 0.43.x；其 npm latest 是 0.41.0 预发布。没有任何单一版本覆盖全部四个包。静态、请求时与 Universal WC SSR 契约继续受 ADR-0119、ADR-0122 和 ADR-0135 冻结；ADR-0140 允许兼容 patch，但不预排 0.44 功能列车。',
    withdrawnHeading: '已撤回的残缺产物',
    withdrawnBody:
      'npm 上 0.41.0 时代的 beta.1–beta.3 产物——在 0.41 线正式版之前发布——是已撤回的残缺发布：既非受支持的产品线，也不构成升级路径。dist-tag beta 上的 v0.44.0-beta.2.2 预发布同样是残缺发布：element、create、ui 已发布，Router 从未发布，因此它不是四包版本。',
    footnote:
      '※ 已撤回的 0.41.0 时代 npm beta.1–beta.3 残缺产物在活跃发布叙事中保持撤回状态。历史被保留，不被改写。',
    loadError:
      '<p>无法加载 changelog。请到 <a href="https://github.com/open-element/openelement/blob/main/CHANGELOG.md">GitHub</a> 阅读。</p>',
    archiveSource:
      '以下内容原样渲染自仓库 <a href="https://github.com/open-element/openelement/blob/main/CHANGELOG.md">CHANGELOG.md</a>。当前发布真值由 <a href="https://github.com/open-element/openelement/blob/main/docs/release/release-state.json">docs/release/release-state.json</a> 机器校验；当前 npm dist-tags 摘要见上方登记表。',
    langNotice: '归档正文以英文原文发布（English original）。',
    navRoadmap: 'Roadmap',
    navGettingStarted: '快速开始',
  },
} as const;

function loadChangelogHtml(
  copy: { loadError: string; archiveSource: string; langNotice: string },
): string {
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
    // CHANGELOG.md is a first-party repository file: trustedHtml trust level.
    // Do not feed untrusted Markdown here without sanitizing it first.
    const archive = marked.parse(markdown, { async: false }) as string;
    // The archive body is the English original on every locale: disclose that
    // with the same lang-notice pattern the blog uses (page-blog-post.tsx),
    // and carry the content language on the wrapper since page-changelog.tsx
    // owns the outer container.
    const notice = copy.langNotice === ''
      ? ''
      : `<p class="lang-notice" role="note" style="max-width:640px;margin:0 0 var(--size-4);padding:var(--size-2) var(--size-3);border-inline-start:var(--border-size-2) solid var(--violet-5);color:var(--text-secondary);font-size:var(--font-size-0);line-height:1.65;">${copy.langNotice}</p>`;
    return `<p class="archive-source">${copy.archiveSource}</p>${notice}<div lang="en">${archive}</div>`;
  } catch {
    return copy.loadError;
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
      registryNote: REGISTRY_NOTE,
      commonVersionLabel: COMMON_PUBLISHED_LABEL,
      railItems: ids.map((id, index) => ({
        id,
        href: `#${id}`,
        label: text.railLabels[index] ?? id,
        depth: '2',
      })),
      changelogHtml: trustedHtml(loadChangelogHtml(text)),
      roadmapHref: localizePath('/roadmap', resolved),
      roadmapLabel: text.navRoadmap,
      gettingStartedHref: localizePath('/guide/getting-started', resolved),
      gettingStartedLabel: text.navGettingStarted,
    };
  },
});
