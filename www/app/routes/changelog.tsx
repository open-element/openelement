/** Changelog route: request projection over the generated CHANGELOG.md archive. */
import { definePage } from '@openelement/router';
import { trustedHtml, type TrustedHtml } from '@openelement/element';
import '@openelement/ui/open-button';
import { siteHead } from '#site-ui/head.ts';
import { contentLocale } from '#site-ui/locale.ts';
import { localizePath } from '#site-ui/link.ts';
import { changelogArchiveHtml } from '../data/_generated-changelog-archive.ts';
import '#site-ui/open-reading-shell.tsx';
import '../islands/open-page-rail.tsx';
import '#site-ui/open-artifact-panel.tsx';
import {
  COMMON_PUBLISHED_LABEL,
  COMMON_PUBLISHED_VERSION,
  PUBLISHED_LATEST_SHARED,
  REGISTRY_NOTE,
} from '../data/version.ts';

export const meta = { section: '', label: 'Changelog', order: 20 };

// Registry-derived prose: every sentence below is built from the same tracked
// truth the register renders (data/version.ts ← release-state.json), and states
// only what that truth can prove. The former "stable <x> line covers a, b, c"
// sentence derived its version from element's `latest` dist-tag, which stopped
// being the stable line when the 1.0 prerelease line began publishing onto
// `latest` — so it claimed a stable 1.0 line that does not exist. Stable-line
// history now stays where it is recorded (the archive and release-state.json),
// and the live register speaks only of the dist-tags it carries.
const sharedLatestBare = (PUBLISHED_LATEST_SHARED ?? '').replace(/^v/, '');

const content = {
  en: {
    headTitle: 'Changelog',
    headDescription:
      'The openElement release register — current per-package npm dist-tags — plus the repository CHANGELOG.md historical archive. Machine-checked release truth lives in docs/release/release-state.json.',
    eyebrow: 'Changelog',
    pageTitle: 'The register, then the archive.',
    lede: 'The register reflects the current per-package npm dist-tags. The archive below renders the repository CHANGELOG.md unchanged; machine-checked release truth lives in docs/release/release-state.json.',
    metaPrefix: 'Current per-package npm latest:',
    metaSuffix: '.',
    railLabels: ['Published', 'Stable line', 'Withdrawn', 'Historical archive'],
    publishedIntro:
      'The project follows Keep a Changelog and SemVer. Historical entries preserve older names where they describe older releases; current docs use the openElement contract.',
    stampCurrent: 'Current',
    regCurrentSummary:
      COMMON_PUBLISHED_VERSION === null
        ? sharedLatestBare === ''
          ? 'There is no common complete version: the published packages\u2019 npm latest values differ — see the per-package register above.'
          : `There is no common complete version: every published package\u2019s npm latest is the same prerelease, ${sharedLatestBare}.`
        : `Every published package serves the common stable version ${COMMON_PUBLISHED_VERSION}.`,
    stableHeading: 'Stable line',
    stableBody: `No stable release covers every published package. The stable lines and the packages each one covered are recorded in the archive below and machine-checked in docs/release/release-state.json. The static, request-time, and Universal WC SSR contracts remain frozen under ADR-0119, ADR-0122, and ADR-0135; ADR-0140 admits compatible patches without scheduling a 0.44 feature train.`,
    withdrawnHeading: 'Withdrawn partial artifacts',
    withdrawnBody:
      'The npm 0.41.0-era beta.1–beta.3 artifacts — published under the 0.41 line before its stable cut — are withdrawn partial releases: never a supported product line, never an upgrade path. The v0.44.0-beta.2.2 prerelease on dist-tag beta is also partial: element, create, and ui published; Router never did, so it is not a complete-surface release.',
    footnote:
      '※ The withdrawn 0.41.0-era npm beta.1–beta.3 partial artifacts stay withdrawn from the active release story. History is kept, not rewritten.',
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
    eyebrow: '更新日志',
    pageTitle: '先登记表，再归档。',
    lede: '登记表反映当前各包的 npm dist-tags。下方归档原样渲染仓库 CHANGELOG.md；机器校验的发布真值见 docs/release/release-state.json。',
    metaPrefix: '当前各包的 npm latest 分别为：',
    metaSuffix: '。',
    railLabels: ['已发布', '稳定线', '已撤回', '历史归档'],
    publishedIntro:
      '本项目遵循 Keep a Changelog 与 SemVer。历史条目在描述旧版本时保留旧名称；当前文档使用 openElement 契约。',
    stampCurrent: '当前',
    regCurrentSummary:
      COMMON_PUBLISHED_VERSION === null
        ? sharedLatestBare === ''
          ? '不存在共同完整版本：各发布包的 npm latest 互不相同——见上方逐包登记表。'
          : `不存在共同完整版本：各发布包的 npm latest 同为预发布版本 ${sharedLatestBare}。`
        : `全部发布包都已提供共同稳定版本 ${COMMON_PUBLISHED_VERSION}。`,
    stableHeading: '稳定线',
    stableBody: `没有任何 stable 版本覆盖全部发布包。各条稳定线及其覆盖范围记录在下方归档中，并由 docs/release/release-state.json 机器校验。静态、请求时与 Universal WC SSR 契约继续受 ADR-0119、ADR-0122 和 ADR-0135 冻结；ADR-0140 允许兼容 patch，但不预排 0.44 功能列车。`,
    withdrawnHeading: '已撤回的残缺产物',
    withdrawnBody:
      'npm 上 0.41.0 时代的 beta.1–beta.3 产物——在 0.41 线正式版之前发布——是已撤回的残缺发布：既非受支持的产品线，也不构成升级路径。dist-tag beta 上的 v0.44.0-beta.2.2 预发布同样是残缺发布：element、create、ui 已发布，Router 从未发布，因此它不是覆盖全部包的发布。',
    footnote:
      '※ 已撤回的 0.41.0 时代 npm beta.1–beta.3 残缺产物在活跃发布叙事中保持撤回状态。历史被保留，不被改写。',
    archiveSource:
      '以下内容原样渲染自仓库 <a href="https://github.com/open-element/openelement/blob/main/CHANGELOG.md">CHANGELOG.md</a>。当前发布真值由 <a href="https://github.com/open-element/openelement/blob/main/docs/release/release-state.json">docs/release/release-state.json</a> 机器校验；当前 npm dist-tags 摘要见上方登记表。',
    langNotice: '归档正文以英文原文发布（English original）。',
    navRoadmap: 'Roadmap',
    navGettingStarted: '快速开始',
  },
} as const;

/**
 * The archive body is the English original on every locale: disclose that
 * with the same lang-notice pattern the blog route uses
 * (www/app/routes/blog/[slug].tsx), and carry the content language on the
 * wrapper since this module owns the outer container. The rendered HTML
 * itself comes from the generated module
 * (www/tools/generate-site-content-data.ts) — the same build-time markdown
 * pipeline as the article collections, so a missing CHANGELOG.md fails
 * generation instead of shipping a fallback page, and no renderer or
 * filesystem access runs at request time.
 */
function changelogArchiveDocument(copy: { archiveSource: string; langNotice: string }): string {
  const notice =
    copy.langNotice === ''
      ? ''
      : `<p class="lang-notice" role="note" style="max-width:640px;margin:0 0 calc(var(--spacing) * 4);padding:calc(var(--spacing) * 2) calc(var(--spacing) * 3);border-inline-start:calc(var(--spacing) * 0.5) solid var(--color-ring);color:var(--color-muted-foreground);font-size:var(--text-sm);line-height:1.65;">${copy.langNotice}</p>`;
  return `<p class="archive-source">${copy.archiveSource}</p>${notice}<div lang="en">${changelogArchiveHtml}</div>`;
}

/**
 * The changelog page as a server function page (alpha15 server architecture):
 * the route module's own exported TSX function, lowered by the compiler into
 * a generative HTML constructor. The page hook class (`page-changelog`) scopes
 * the former component sheet's authored rules in the linked document
 * stylesheet.
 */
export function PageChangelog(props: {
  eyebrow: string;
  pageTitle: string;
  lede: string;
  metaPrefix: string;
  registryNote: string;
  metaSuffix: string;
  railItems: Array<{ id: string; href: string; label: string; depth: string }>;
  publishedIntro: string;
  stampCurrent: string;
  regCurrentSummary: string;
  stableHeading: string;
  commonVersionLabel: string;
  stableBody: string;
  withdrawnHeading: string;
  withdrawnBody: string;
  footnote: string;
  changelogHtml: TrustedHtml;
  roadmapHref: string;
  roadmapLabel: string;
  gettingStartedHref: string;
  gettingStartedLabel: string;
  locale: string;
}) {
  return (
    <div class='page-changelog' data-pagefind-body>
      <open-reading-shell meta rail footer locale={props.locale}>
        <div slot='meta'>
          <p class='mb-4 flex flex-wrap items-baseline gap-2 font-mono text-(length:--text-xs) leading-[1.72] font-extrabold tracking-[0.1em] text-muted-foreground uppercase'>
            <span>Project</span>
            <span>/</span>
            <span class='text-primary'>{props.eyebrow}</span>
          </p>
          <h1 class='m-0 font-sans text-[clamp(2.1rem,4.6vw,3.4rem)] leading-[1.05] font-extrabold tracking-[-0.035em] wrap-break-word text-balance text-foreground'>
            {props.pageTitle}
          </h1>
          <p class='mt-4 max-w-[640px] text-[clamp(var(--text-base),1.4vw,var(--text-xl))] leading-[1.65] text-muted-foreground'>
            {props.lede}
          </p>
          <p class='mt-4 text-(length:--text-sm) leading-[1.72] text-muted-foreground'>
            {props.metaPrefix}{' '}
            <code class='rounded-md border border-[color-mix(in_srgb,var(--color-primary)_18%,var(--color-border))] bg-muted px-2 py-1 font-mono text-(length:--text-xs) text-primary'>
              {props.registryNote}
            </code>
            {props.metaSuffix}
          </p>
        </div>
        <div slot='rail'>
          <open-page-rail items={props.railItems} locale={props.locale}></open-page-rail>
        </div>
        <p
          id='published'
          class='my-2 text-sm leading-[1.72] text-foreground min-[901px]:text-(length:--text-base)'
        >
          {props.publishedIntro}
        </p>
        <div class='mt-8 mb-10 border-t border-border' aria-label='Release register'>
          <div class='border-b border-border bg-primary/14 p-5 shadow-[inset_4px_0_0_var(--color-primary)]'>
            <div class='flex flex-wrap items-baseline gap-3'>
              <span class='text-[clamp(1.9rem,3.4vw,2.8rem)] leading-none font-extrabold tracking-[-0.02em] text-foreground'>
                {props.commonVersionLabel}
              </span>
              <span class='rounded-md bg-primary px-3 py-1 text-(length:--text-xs) font-bold tracking-[0.08em] text-primary-foreground uppercase'>
                {props.stampCurrent}
              </span>
            </div>
            <p class='mt-2 max-w-[640px] truncate text-(length:--text-xs) leading-normal text-muted-foreground'>
              {props.regCurrentSummary}
            </p>
          </div>
        </div>
        <section id='candidate'>
          <h2 class='mt-10 mb-4 border-b border-b-border pb-2 text-(length:--text-2xl) leading-[1.12] font-extrabold text-foreground min-[481px]:text-(length:--text-4xl) min-[901px]:text-(length:--text-5xl)'>
            {props.stableHeading}
          </h2>
          <p class='my-2 text-sm leading-[1.72] text-foreground min-[901px]:text-(length:--text-base)'>
            {props.stableBody}
          </p>
        </section>
        <section id='withdrawn'>
          <h2 class='mt-10 mb-4 border-b border-b-border pb-2 text-(length:--text-2xl) leading-[1.12] font-extrabold text-foreground min-[481px]:text-(length:--text-4xl) min-[901px]:text-(length:--text-5xl)'>
            {props.withdrawnHeading}
          </h2>
          <p class='my-2 text-sm leading-[1.72] text-foreground min-[901px]:text-(length:--text-base)'>
            {props.withdrawnBody}
          </p>
        </section>
        <p class='my-2 text-(length:--text-xs) leading-[1.72] text-muted-foreground'>
          {props.footnote}
        </p>
        <div
          id='historical'
          class='changelog-content'
          innerHTML={props.changelogHtml}
          trustedHtml
        />
        <div
          slot='footer'
          class='mt-10 flex flex-col justify-between gap-3 border-t border-border pt-4 min-[901px]:flex-row'
        >
          <open-button class='no-underline' variant='ghost' size='sm' href={props.roadmapHref}>
            {props.roadmapLabel}
          </open-button>
          <open-button
            class='no-underline'
            variant='ghost'
            size='sm'
            href={props.gettingStartedHref}
          >
            {props.gettingStartedLabel}
          </open-button>
        </div>
      </open-reading-shell>
    </div>
  );
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
      changelogHtml: trustedHtml(changelogArchiveDocument(text)),
      roadmapHref: localizePath('/roadmap', resolved),
      roadmapLabel: text.navRoadmap,
      gettingStartedHref: localizePath('/guide/getting-started', resolved),
      gettingStartedLabel: text.navGettingStarted,
      locale: resolved,
    };
  },
});
