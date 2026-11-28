import { definePage } from '@openelement/router';
import '@openelement/ui/open-button';
import '../site-ui/open-standards-visual.tsx';
import '#site-ui/open-artifact-panel.tsx';
import '#site-ui/open-section-frame.tsx';
import '#site-ui/open-reading-shell.tsx';
import '../islands/open-page-rail.tsx';
import { OPENELEMENT_VERSION, PUBLISHED_LATEST, sourceLineNote } from '../data/version.ts';
import { siteHead } from '#site-ui/head.ts';
import { siteHref } from '#site-ui/site-url.ts';
import { contentLocale } from '#site-ui/locale.ts';
import type { SiteLocale } from '../../site-config.ts';

export const meta = { section: '', label: 'Roadmap', order: 10 };
// Strategic anchors: Web Components-native, static-first application framework.

type TimelineEntry = {
  version: string;
  theme: string;
  copy: string;
  state: 'stable' | 'baseline' | 'next' | 'planned';
  stamp?: 'CURRENT' | 'BASELINE' | 'NEXT';
  status?: string;
};

interface RoadmapTimelineItem {
  key: string;
  rowClass: string;
  version: string;
  theme: string;
  stampClass: string;
  stampLabel: string;
  copy: string;
  status: string;
}

/**
 * One rendered row: the route's per-item class fields (`tl-row tl-<state>`,
 * `stamp stamp-<kind>`) split into the data attributes the row's
 * `group-data-[…]` utilities match. The compiler admits only static class
 * literals and `{item.<field>}` attribute slots, so a per-item variant must
 * travel as data — the split lives in the props projector because attribute
 * slots cannot carry expressions.
 */
interface RoadmapRow extends RoadmapTimelineItem {
  state: string;
  stampKind: string;
}

interface RoadmapListItem {
  key: string;
  value: string;
}

const entries: Record<SiteLocale, TimelineEntry[]> = {
  en: [
    {
      version: 'Current source',
      theme: 'Function pages and compiled islands',
      copy: 'Author routes as server functions. The compiler generates the Custom Element lifecycle and binds interaction to server-rendered HTML. Static output and request-time rendering use the same route model.',
      state: 'baseline',
      stamp: 'BASELINE',
    },
    {
      version: 'Planned',
      theme: 'Reusable component packages',
      copy: 'Validate composition across independently built packages, including props, children, state and published Custom Element entry points.',
      state: 'planned',
    },
    {
      version: 'Planned',
      theme: 'Component-level streaming',
      copy: 'Evaluate deferred component subtrees, including bounded work, cancellation, CSS and script loading, and HTML fallbacks.',
      state: 'planned',
    },
    {
      version: 'v1.0 RC / Stable',
      theme: 'Release qualification',
      copy: 'Qualify real applications, packed installs and security before freezing public contracts.',
      state: 'planned',
    },
  ],
  zh: [
    {
      version: '当前源码',
      theme: '函数页面与编译型 island',
      copy: '以服务端函数编写路由。编译器生成 Custom Element 生命周期，并将交互绑定到服务端输出的 HTML。静态输出和请求时渲染使用同一套路由模型。',
      state: 'baseline',
      stamp: 'BASELINE',
    },
    {
      version: '规划中',
      theme: '可复用的组件包',
      copy: '验证独立构建的包之间如何组合，覆盖 props、children、状态与已发布的 Custom Element 入口。',
      state: 'planned',
    },
    {
      version: '规划中',
      theme: '组件级流式渲染',
      copy: '评估组件子树的延迟交付，包括工作量限制、取消、CSS 与脚本投递，以及 HTML 回退。',
      state: 'planned',
    },
    {
      version: 'v1.0 RC / Stable',
      theme: '发布验证',
      copy: '在冻结公开契约前，验证真实应用、安装发布包与安全性。',
      state: 'planned',
    },
  ],
};

const content = {
  en: {
    headTitle: 'Roadmap',
    headDescription: `openElement’s current capabilities and planned work toward v1.0.`,
    pageTitle: 'Roadmap',
    heroLede: 'See what you can use in the current checkout and what is planned for v1.0.',
    railItems:
      '[{"id":"release-line","label":"Release line"},{"id":"product-boundary","label":"Product boundary"},{"id":"decision-matrix","label":"Decision matrix"},{"id":"system-visual","label":"System visual"}]',
    architecture: 'Architecture',
    freezeBadge: OPENELEMENT_VERSION,
    nowTitle: 'Source and npm',
    nowCopy: sourceLineNote('en'),
    registryLabel: 'Per-package npm latest:',
    releaseLineIndex: '01 / release line',
    releaseLineTitle: 'Current work and future milestones',
    releaseLineCopy:
      'Milestones have no scheduled dates. Release candidates and stable releases each require application, installation and security validation.',
    timelineAria: 'Roadmap release line',
    stamps: {
      CURRENT: 'CURRENT',
      BASELINE: 'BASELINE',
      NEXT: 'NEXT',
    } as Record<'CURRENT' | 'BASELINE' | 'NEXT', string>,
    designRuleTitle: 'Design rule',
    designRuleText:
      'openElement uses standard HTTP, HTML-first delivery, and native Custom Elements. Layouts compose server pages, and third-party elements follow the interoperability contract.',
    boundaryIndex: '02 / product boundary',
    boundaryTitle: 'Scope is explicit.',
    boundaryCopy:
      'Current capability, excluded promises and the visual contract are kept separate.',
    inProductTitle: 'In product',
    inProductItems: [
      'JSX-first application API',
      'Declarative Shadow DOM rendering',
      'Routes, layouts, content, islands, and i18n',
      'Loaders and actions with progressive-enhancement forms',
      'CSRF floor on the action surface',
      'Nitro server output (Node + Workers) and SPA mode',
      'Locale-prefixed routing with Document and head ownership',
      'Verified package and release boundaries',
    ],
    outScopeTitle: 'Out of current scope',
    outScopeItems: [
      'Framework-owned sessions and data caching',
      'Component package registry',
      'Generic auth, ORM, or database platform claims',
    ],
    siteRuleTitle: 'Design rule',
    siteRuleText:
      'The public site is a working demonstration of the framework\u2019s static-first output.',
    matrixIndex: '03 / decision matrix',
    matrixTitle: 'Roadmap language stays inside the product boundary.',
    matrixCopy: 'Ship, prove and freeze are evidence states rather than marketing labels.',
    shipLabel: 'Ship',
    shipCopy: 'Only public contracts reflected in docs, generated pages, and package surfaces.',
    proveLabel: 'Prove',
    proveCopy: 'Use CI, build checks, and docs scans as release evidence before expanding claims.',
    freezeLabel: 'Freeze',
    freezeCopy:
      'Move toward v1.0 after the element, application and build contracts are stable, readable, and boring to verify.',
    visualIndex: '04 / system visual',
    visualTitle: 'The package graph is part of the release artifact.',
    visualCopy:
      'Published package ownership and the public architecture must remain mechanically identical.',
    packageMatrixLabel: 'package matrix',
    // Accessible name for the package matrix visual: authored per locale so the
    // zh page never announces the component's English default (T10 R2).
    packageGraphLabel: 'package graph',
    productBoundaryMeta: 'product boundary',
    releaseDisciplineLabel: 'release discipline',
    v10PostureMeta: 'v1.0 posture',
    noDriftLabel: 'No drift',
    noDriftCopy: 'Marketing language, docs, package exports, and CI gates must agree.',
    noGhostsLabel: 'Package compatibility',
    noGhostsCopy: 'Verify the published package set in a real consumer before release.',
    noFogLabel: 'Scope in the open',
    noFogCopy:
      'Users should understand what is shipped, current, planned, and explicitly out of scope.',
    changelog: 'Changelog',
    deployment: 'Deployment',
  },
  zh: {
    headTitle: '路线图',
    headDescription: `openElement 当前能力与通往 v1.0 的规划。`,
    pageTitle: '路线图',
    heroLede: '了解当前源码可用的功能，以及 v1.0 的后续计划。',
    railItems:
      '[{"id":"release-line","label":"发布线"},{"id":"product-boundary","label":"产品边界"},{"id":"decision-matrix","label":"决策矩阵"},{"id":"system-visual","label":"系统图示"}]',
    architecture: '架构',
    freezeBadge: OPENELEMENT_VERSION,
    nowTitle: '源码与 npm',
    nowCopy: sourceLineNote('zh'),
    registryLabel: '各包 npm latest：',
    releaseLineIndex: '01 / 发布线',
    releaseLineTitle: '当前工作与后续里程碑',
    releaseLineCopy: '里程碑尚未排期。候选版本和稳定版各自需要通过真实应用、安装与安全验证。',
    timelineAria: 'Roadmap 发布线',
    stamps: {
      CURRENT: '当前',
      BASELINE: '基线',
      NEXT: '下一个',
    } as Record<'CURRENT' | 'BASELINE' | 'NEXT', string>,
    designRuleTitle: '设计规则',
    designRuleText:
      'openElement 基于标准 HTTP、HTML 优先交付和原生 Custom Elements。Layout 负责组合服务端页面，第三方元素遵循互操作契约。',
    boundaryIndex: '02 / 产品边界',
    boundaryTitle: '范围是明确的。',
    boundaryCopy: '当前能力、被排除的承诺与视觉契约，分开陈述。',
    inProductTitle: '产品内',
    inProductItems: [
      'JSX 优先的应用 API',
      'Declarative Shadow DOM 渲染',
      '路由、布局、内容、island 与 i18n',
      'loader 与 action，配合渐进增强表单',
      'action 面的 CSRF 地板',
      'Nitro 服务端输出（Node + Workers）与 SPA 模式',
      '带 locale 前缀的路由，以及 Document 与 head 归属',
      '经过验证的包与发布边界',
    ],
    outScopeTitle: '当前范围之外',
    outScopeItems: [
      '框架内置 session 与数据缓存',
      '组件包注册表',
      '通用的 auth、ORM 或数据库平台宣称',
    ],
    siteRuleTitle: '设计规则',
    siteRuleText: '官网即框架 static-first 产出的活体示范。',
    matrixIndex: '03 / 决策矩阵',
    matrixTitle: 'Roadmap 语言不越过产品边界。',
    matrixCopy: 'Ship、prove 与 freeze 是证据状态，不是营销标签。',
    shipLabel: 'Ship',
    shipCopy: '只有反映在文档、生成页面与包能力面上的公开契约。',
    proveLabel: 'Prove',
    proveCopy: '在扩大宣称之前，以 CI、构建检查与文档扫描作为发布证据。',
    freezeLabel: 'Freeze',
    freezeCopy:
      '当 element、application 与 build 三层契约稳定、可读、验证起来平淡无奇之后，再迈向 v1.0。',
    visualIndex: '04 / 系统图示',
    visualTitle: '包图是发布产物的一部分。',
    visualCopy: '已发布的包归属与公开架构必须保持机械一致。',
    packageMatrixLabel: '包矩阵',
    packageGraphLabel: '包依赖图',
    productBoundaryMeta: '产品边界',
    releaseDisciplineLabel: '发布纪律',
    v10PostureMeta: 'v1.0 姿态',
    noDriftLabel: '不漂移',
    noDriftCopy: '营销语言、文档、包导出与 CI 门禁必须一致。',
    noGhostsLabel: '包兼容性',
    noGhostsCopy: '发布前用实际应用验证打包后的依赖组合。',
    noFogLabel: '边界公开',
    noFogCopy: '用户应能看懂什么是已发布、当前、规划中，以及明确排除在范围之外的。',
    changelog: '更新日志',
    deployment: '部署',
  },
};

/** The page-roadmap class scopes site-chrome.css; row data attributes select variants. */
export function RoadmapPage(props: {
  metadata: { breadcrumb: string; title: string; lede: string };
  railItems: Array<{ id: string; href: string; label: string; depth: string }>;
  locale: string;
  architectureHref: string;
  changelogHref: string;
  deploymentHref: string;
  releaseLineIndex: string;
  releaseLineTitle: string;
  releaseLineCopy: string;
  freezeBadge: string;
  nowTitle: string;
  nowCopy: string;
  registryLabel: string;
  registryNote: string;
  timelineAria: string;
  rows: Array<{
    key: string;
    state: string;
    stampKind: string;
    version: string;
    theme: string;
    stampLabel: string;
    copy: string;
    status: string;
  }>;
  designRuleTitle: string;
  designRuleText: string;
  boundaryIndex: string;
  boundaryTitle: string;
  boundaryCopy: string;
  inProductTitle: string;
  inProductItems: Array<{ key: string; value: string }>;
  outScopeTitle: string;
  outScopeItems: Array<{ key: string; value: string }>;
  siteRuleTitle: string;
  siteRuleText: string;
  matrixIndex: string;
  matrixTitle: string;
  matrixCopy: string;
  shipLabel: string;
  shipCopy: string;
  proveLabel: string;
  proveCopy: string;
  freezeLabel: string;
  freezeCopy: string;
  visualIndex: string;
  visualTitle: string;
  visualCopy: string;
  packageMatrixLabel: string;
  packageGraphLabel: string;
  productBoundaryMeta: string;
  releaseDisciplineLabel: string;
  v10PostureMeta: string;
  noDriftLabel: string;
  noDriftCopy: string;
  noGhostsLabel: string;
  noGhostsCopy: string;
  noFogLabel: string;
  noFogCopy: string;
  architecture: string;
  changelog: string;
  deployment: string;
}) {
  return (
    // The retired host box carried `display: block` (the page root is a div
    // now) and `color: var(--color-foreground)`, which the root div restates
    // as the `text-foreground` utility — site-chrome.css keeps only the
    // timeline/truth rules under this page hook class.
    <div class='page-roadmap text-foreground' data-pagefind-body>
      <open-reading-shell meta rail footer metadata={props.metadata} locale={props.locale}>
        <div slot='rail'>
          <open-page-rail items={props.railItems} locale={props.locale}></open-page-rail>
        </div>

        <section id='release-line'>
          <open-section-frame>
            <span slot='index'>{props.releaseLineIndex}</span>
            <span slot='title'>{props.releaseLineTitle}</span>
            <span slot='copy'>{props.releaseLineCopy}</span>
            <div class='mt-5 mb-6 px-5 py-4 border border-border rounded-lg'>
              {/* Retired ui open-badge → plain HTML+CSS recipe (#1557): the
                  warning-tone wash the component painted, inline. */}
              <span>{props.freezeBadge}</span>
              <p class='mt-3 mb-2 text-foreground font-bold leading-[1.3]'>{props.nowTitle}</p>
              <p class='m-0 text-muted-foreground text-(length:--text-sm) leading-(--leading-normal)'>
                {props.nowCopy}
              </p>
              {/* The per-package registry truth the band's claims derive from,
                  printed beside them: the status text names no version of its
                  own, so the reader can check every package against the note. */}
              <p class='m-0 mt-2 text-muted-foreground text-(length:--text-xs) leading-(--leading-normal)'>
                {props.registryLabel} <code>{props.registryNote}</code>
              </p>
            </div>
            <div class='grid grid-cols-[minmax(0,1fr)] gap-[clamp(1.5rem,4vw,3rem)] items-start min-[1121px]:grid-cols-[minmax(0,1fr)_minmax(260px,0.34fr)]'>
              <div class='timeline relative grid' role='group' aria-label={props.timelineAria}>
                {props.rows.map((phase) => (
                  <div
                    class='group relative pt-4 pb-4 ps-6 min-[641px]:ps-8'
                    data-state={phase.state}
                    data-stamp={phase.stampKind}
                    key={phase.key}
                  >
                    <span
                      class='tl-node absolute start-0 top-8 size-2 group-data-[state=stable]:bg-primary group-data-[state=baseline]:bg-primary group-data-[state=next]:border-2 group-data-[state=next]:border-primary group-data-[state=next]:bg-background group-data-[state=planned]:border-2 group-data-[state=planned]:border-[color-mix(in_srgb,var(--color-ring)_55%,transparent)]'
                      aria-hidden='true'
                    ></span>
                    <div class='flex flex-wrap items-baseline gap-x-4 gap-y-3'>
                      <span class='text-foreground text-[length:clamp(1.5rem,2.4vw,2.35rem)] font-[800] leading-none tracking-[-0.02em] group-data-[state=next]:text-primary group-data-[state=planned]:text-transparent group-data-[state=planned]:[-webkit-text-stroke:1.5px_color-mix(in_srgb,var(--color-ring)_55%,transparent)]'>
                        {phase.version}
                      </span>
                      <span class='px-3 py-1 rounded-md text-(length:--text-xs) font-bold tracking-[0.08em] uppercase empty:hidden group-data-[stamp=current]:bg-primary group-data-[stamp=current]:text-primary-foreground group-data-[stamp=next]:border group-data-[stamp=next]:border-primary group-data-[stamp=next]:text-primary group-data-[stamp=baseline]:bg-primary group-data-[stamp=baseline]:text-primary-foreground'>
                        {phase.stampLabel}
                      </span>
                      <span class='text-primary font-serif text-[length:clamp(1.05rem,1.35vw,1.3rem)] italic font-[400] group-data-[state=planned]:text-ring'>
                        {phase.theme}
                      </span>
                    </div>
                    <p class='text-muted-foreground text-(length:--text-sm) leading-(--leading-normal) max-w-[540px] mt-2 mb-0'>
                      {phase.copy}
                    </p>
                    <span class='text-muted-foreground text-(length:--text-xs) tracking-[0.1em] uppercase empty:hidden'>
                      {phase.status}
                    </span>
                  </div>
                ))}
              </div>
              <aside class='p-5 static min-[1121px]:sticky top-[calc(var(--nav-height)_+_calc(var(--spacing)*6))] border border-[color-mix(in_srgb,var(--color-ring)_45%,transparent)] rounded-lg bg-primary-foreground shadow-[inset_calc(var(--spacing)*1)_0_0_var(--color-primary)]'>
                <p class='text-primary font-mono text-(length:--text-xs) font-extrabold tracking-normal uppercase mb-3'>
                  {props.designRuleTitle}
                </p>
                <p class='text-muted-foreground text-(length:--text-sm) leading-(--leading-normal) mb-0'>
                  {props.designRuleText}
                </p>
              </aside>
            </div>
          </open-section-frame>
        </section>

        <section id='product-boundary'>
          <open-section-frame>
            <span slot='index'>{props.boundaryIndex}</span>
            <span slot='title'>{props.boundaryTitle}</span>
            <span slot='copy'>{props.boundaryCopy}</span>
            {/* One composition, not three cards (owner direction 2026-11-27):
                three equal columns on a shared baseline grid, separated by
                hairlines. The eyebrow, title and body rows live on the grid
                (subgrid), so the titles sit on one line across the columns at
                every width where they stand side by side, even if an eyebrow
                wraps. Geometry: .page-roadmap .boundary-grid, site-chrome.css. */}
            <div class='boundary-grid'>
              <div class='boundary-col'>
                <h3 class='boundary-title'>{props.inProductTitle}</h3>
                <ul class='boundary-list'>
                  {props.inProductItems.map((item) => (
                    <li key={item.key}>{item.value}</li>
                  ))}
                </ul>
              </div>

              <div class='boundary-col'>
                <h3 class='boundary-title'>{props.outScopeTitle}</h3>
                <ul class='boundary-list'>
                  {props.outScopeItems.map((item) => (
                    <li key={item.key}>{item.value}</li>
                  ))}
                </ul>
              </div>

              <div class='boundary-col'>
                <h3 class='boundary-title'>{props.siteRuleTitle}</h3>
                <p class='boundary-body'>{props.siteRuleText}</p>
              </div>
            </div>
          </open-section-frame>
        </section>

        <section id='decision-matrix'>
          <open-section-frame>
            <span slot='index'>{props.matrixIndex}</span>
            <span slot='title'>{props.matrixTitle}</span>
            <span slot='copy'>{props.matrixCopy}</span>
            <div class='grid border-t border-t-border'>
              <div class='grid grid-cols-[minmax(0,1fr)] gap-2 py-4 border-b border-b-border min-[641px]:grid-cols-[minmax(148px,0.22fr)_minmax(0,1fr)] min-[641px]:gap-4 last:[border-bottom:0]'>
                <span class='text-primary font-mono text-(length:--text-xs) font-extrabold tracking-normal uppercase'>
                  {props.shipLabel}
                </span>
                <span class='text-muted-foreground text-(length:--text-sm) leading-(--leading-normal)'>
                  {props.shipCopy}
                </span>
              </div>
              <div class='grid grid-cols-[minmax(0,1fr)] gap-2 py-4 border-b border-b-border min-[641px]:grid-cols-[minmax(148px,0.22fr)_minmax(0,1fr)] min-[641px]:gap-4 last:[border-bottom:0]'>
                <span class='text-primary font-mono text-(length:--text-xs) font-extrabold tracking-normal uppercase'>
                  {props.proveLabel}
                </span>
                <span class='text-muted-foreground text-(length:--text-sm) leading-(--leading-normal)'>
                  {props.proveCopy}
                </span>
              </div>
              <div class='grid grid-cols-[minmax(0,1fr)] gap-2 py-4 border-b border-b-border min-[641px]:grid-cols-[minmax(148px,0.22fr)_minmax(0,1fr)] min-[641px]:gap-4 last:[border-bottom:0]'>
                <span class='text-primary font-mono text-(length:--text-xs) font-extrabold tracking-normal uppercase'>
                  {props.freezeLabel}
                </span>
                <span class='text-muted-foreground text-(length:--text-sm) leading-(--leading-normal)'>
                  {props.freezeCopy}
                </span>
              </div>
            </div>
          </open-section-frame>
        </section>

        <section id='system-visual'>
          <open-section-frame>
            <span slot='index'>{props.visualIndex}</span>
            <span slot='title'>{props.visualTitle}</span>
            <span slot='copy'>{props.visualCopy}</span>
            <div class='grid grid-cols-[minmax(0,1fr)] gap-4 min-[1121px]:grid-cols-2 items-start'>
              <open-artifact-panel>
                <span slot='label'>{props.packageMatrixLabel}</span>
                <span slot='meta'>{props.productBoundaryMeta}</span>
                <open-standards-visual
                  variant='packages'
                  emphasis='high'
                  motion='auto'
                  label={props.packageGraphLabel}
                ></open-standards-visual>
              </open-artifact-panel>
              <open-artifact-panel>
                <span slot='label'>{props.releaseDisciplineLabel}</span>
                <span slot='meta'>{props.v10PostureMeta}</span>
                <ul class='grid gap-2 m-0 p-0 list-none'>
                  <li class='grid grid-cols-[minmax(0,1fr)] gap-2 py-4 border-b border-b-border min-[641px]:grid-cols-[minmax(110px,0.32fr)_minmax(0,1fr)] min-[641px]:gap-4 last:[border-bottom:0]'>
                    <strong class='text-primary font-mono text-(length:--text-xs) font-extrabold tracking-normal uppercase'>
                      {props.noDriftLabel}
                    </strong>
                    <span class='text-muted-foreground text-(length:--text-sm) leading-(--leading-normal)'>
                      {props.noDriftCopy}
                    </span>
                  </li>
                  <li class='grid grid-cols-[minmax(0,1fr)] gap-2 py-4 border-b border-b-border min-[641px]:grid-cols-[minmax(110px,0.32fr)_minmax(0,1fr)] min-[641px]:gap-4 last:[border-bottom:0]'>
                    <strong class='text-primary font-mono text-(length:--text-xs) font-extrabold tracking-normal uppercase'>
                      {props.noGhostsLabel}
                    </strong>
                    <span class='text-muted-foreground text-(length:--text-sm) leading-(--leading-normal)'>
                      {props.noGhostsCopy}
                    </span>
                  </li>
                  <li class='grid grid-cols-[minmax(0,1fr)] gap-2 py-4 border-b border-b-border min-[641px]:grid-cols-[minmax(110px,0.32fr)_minmax(0,1fr)] min-[641px]:gap-4 last:[border-bottom:0]'>
                    <strong class='text-primary font-mono text-(length:--text-xs) font-extrabold tracking-normal uppercase'>
                      {props.noFogLabel}
                    </strong>
                    <span class='text-muted-foreground text-(length:--text-sm) leading-(--leading-normal)'>
                      {props.noFogCopy}
                    </span>
                  </li>
                </ul>
              </open-artifact-panel>
            </div>
          </open-section-frame>
        </section>

        <nav
          class='flex flex-wrap gap-3 w-[min(1180px,calc(100%_-_3rem))] mt-[clamp(2.5rem,6vh,4.5rem)] mx-auto mb-0 pb-[clamp(2.5rem,6vh,4rem)]'
          slot='footer'
        >
          <open-button href={props.architectureHref}>{props.architecture}</open-button>
          <open-button href={props.changelogHref}>{props.changelog}</open-button>
          <open-button href={props.deploymentHref}>{props.deployment}</open-button>
        </nav>
      </open-reading-shell>
    </div>
  );
}

export default definePage(RoadmapPage, {
  head({ locale }) {
    const resolved = contentLocale(locale ?? 'en');
    const copy = content[resolved];
    return siteHead({
      route: '/roadmap',
      locale: resolved,
      title: copy.headTitle,
      description: copy.headDescription,
    });
  },
  props({ locale }) {
    const resolved = contentLocale(locale ?? 'en');
    const t = content[resolved];
    const timeline = entries[resolved].map((phase) => {
      return {
        key: phase.theme,
        rowClass: `tl-row tl-${phase.state}`,
        version: phase.version,
        theme: phase.theme,
        stampClass: phase.stamp ? `stamp stamp-${phase.stamp.toLowerCase()}` : 'stamp',
        stampLabel: phase.stamp ? t.stamps[phase.stamp] : '',
        copy: phase.copy,
        status: phase.status ?? '',
      };
    });
    // The rows the markup renders: the per-item class strings decoded into
    // the data attributes the timeline's group-data-[…] utilities match. The
    // compiler admits only static class literals and {item.<field>} attribute
    // slots, so the split is projected here — attribute slots cannot carry
    // expressions.
    const rows: RoadmapRow[] = timeline.map((row) => ({
      ...row,
      state: row.rowClass.slice('tl-row tl-'.length),
      stampKind: row.stampClass.slice('stamp stamp-'.length),
    }));
    const listItems = (items: string[]): RoadmapListItem[] =>
      items.map((value) => ({
        key: value,
        value,
      }));

    return {
      metadata: {
        breadcrumb: 'Project',
        title: t.pageTitle,
        lede: t.heroLede,
      },
      railItems: (JSON.parse(t.railItems) as Array<{ id: string; label: string }>).map((item) => ({
        id: item.id,
        href: `#${item.id}`,
        label: item.label,
        depth: '2',
      })),
      releaseLineIndex: t.releaseLineIndex,
      releaseLineTitle: t.releaseLineTitle,
      releaseLineCopy: t.releaseLineCopy,
      freezeBadge: t.freezeBadge,
      nowTitle: t.nowTitle,
      nowCopy: t.nowCopy,
      registryLabel: t.registryLabel,
      registryNote: Object.entries(PUBLISHED_LATEST)
        .map(([name, version]) => `${name.replace('@openelement/', '')} ${version}`)
        .join(' · '),
      timelineAria: t.timelineAria,
      rows,
      designRuleTitle: t.designRuleTitle,
      designRuleText: t.designRuleText,
      boundaryIndex: t.boundaryIndex,
      boundaryTitle: t.boundaryTitle,
      boundaryCopy: t.boundaryCopy,
      inProductTitle: t.inProductTitle,
      inProductItems: listItems(t.inProductItems),
      outScopeTitle: t.outScopeTitle,
      outScopeItems: listItems(t.outScopeItems),
      siteRuleTitle: t.siteRuleTitle,
      siteRuleText: t.siteRuleText,
      matrixIndex: t.matrixIndex,
      matrixTitle: t.matrixTitle,
      matrixCopy: t.matrixCopy,
      shipLabel: t.shipLabel,
      shipCopy: t.shipCopy,
      proveLabel: t.proveLabel,
      proveCopy: t.proveCopy,
      freezeLabel: t.freezeLabel,
      freezeCopy: t.freezeCopy,
      visualIndex: t.visualIndex,
      visualTitle: t.visualTitle,
      visualCopy: t.visualCopy,
      packageMatrixLabel: t.packageMatrixLabel,
      packageGraphLabel: t.packageGraphLabel,
      productBoundaryMeta: t.productBoundaryMeta,
      releaseDisciplineLabel: t.releaseDisciplineLabel,
      v10PostureMeta: t.v10PostureMeta,
      noDriftLabel: t.noDriftLabel,
      noDriftCopy: t.noDriftCopy,
      noGhostsLabel: t.noGhostsLabel,
      noGhostsCopy: t.noGhostsCopy,
      noFogLabel: t.noFogLabel,
      noFogCopy: t.noFogCopy,
      architecture: t.architecture,
      changelog: t.changelog,
      deployment: t.deployment,
      locale: resolved,
      architectureHref: siteHref('/architecture', resolved),
      changelogHref: siteHref('/changelog', resolved),
      deploymentHref: siteHref('/guide/deployment', resolved),
    };
  },
});
