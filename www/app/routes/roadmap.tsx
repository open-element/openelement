import { definePage } from '@openelement/router';
import '@openelement/ui/open-button';
import '../site-ui/open-standards-visual.tsx';
import '#site-ui/open-artifact-panel.tsx';
import '#site-ui/open-section-frame.tsx';
import '#site-ui/open-reading-shell.tsx';
import '../islands/open-page-rail.tsx';
import {
  COMMON_PUBLISHED_VERSION,
  prereleasePublishStatus,
  REGISTRY_NOTE,
} from '../data/version.ts';
import { siteHead } from '#site-ui/head.ts';
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
      version: 'v1.0.0-alpha.1',
      theme: 'Public Alpha admission',
      copy: 'Start real application use with the public baseline: independently consumable Element and Router with Native/Lit application flows. Element and Router are the public core, Create is the supported entry, UI is experimental. 1.0 Alpha is a fresh baseline with no supported migration from 0.x.',
      state: 'baseline',
      stamp: 'BASELINE',
    },
    {
      version: 'v1.0 RC / Stable',
      theme: 'Separately admitted releases',
      copy: 'Freeze contracts and dependencies after Alpha evidence; require at least fourteen days of RC soak, install/upgrade/security qualification and human GO. Element and Router do not mandate a package count.',
      state: 'planned',
      status: 'unscheduled',
    },
  ],
  zh: [
    {
      version: 'v1.0.0-alpha.1',
      theme: '公开 Alpha 准入',
      copy: '从公开基线开始在真实应用中使用可独立消费的 Element 与 Router，验证 Native/Lit 应用流程。Element 与 Router 是公共核心，Create 是正式入口，UI 为实验性能力。1.0 Alpha 是新基线，不提供从 0.x 的受支持迁移。',
      state: 'baseline',
      stamp: 'BASELINE',
    },
    {
      version: 'v1.0 RC / Stable',
      theme: '分别准入',
      copy: 'Alpha 证据充分后冻结接口与依赖，完成至少十四天 RC 持续运行及安装、升级、安全验证后取得人工 GO。两个产品不强制两个发布包。',
      state: 'planned',
      status: '未定日期',
    },
  ],
};

const content = {
  en: {
    headTitle: 'Roadmap',
    headDescription:
      'The openElement roadmap: the v1.0.0-alpha.1 baseline, the stable 0.43 maintenance baseline and the gated path to v1.0.',
    pageTitle: 'Roadmap',
    heroLede:
      'OpenElement roadmap labels describe the public product surface, tied to package truth, docs truth and CI evidence rather than a wish list.',
    railItems:
      '[{"id":"release-line","label":"Release line"},{"id":"product-boundary","label":"Product boundary"},{"id":"decision-matrix","label":"Decision matrix"},{"id":"system-visual","label":"System visual"}]',
    architecture: 'Architecture',
    freezeBadge: 'Alpha baseline — v1.0.0-alpha.1',
    nowTitle: '0.43.3 remains stable while the 1.0 Alpha baseline lands.',
    nowCopy: (version: string) =>
      `${version} is the published stable maintenance line. 1.0 Alpha is the new baseline: Element and Router as the public core, Create as the supported entry, UI as experimental — with no supported migration from 0.x.`,
    releaseLineIndex: '01 / release line',
    releaseLineTitle: 'From shipped evidence to v1.0 freeze.',
    releaseLineCopy:
      'The line is deliberately narrow: only claims that can survive docs, package exports and build validation stay visible.',
    timelineAria: 'Roadmap release line',
    stamps: {
      CURRENT: 'CURRENT',
      BASELINE: 'BASELINE',
      NEXT: 'NEXT',
    } as Record<'CURRENT' | 'BASELINE' | 'NEXT', string>,
    designRuleTitle: 'Design rule',
    designRuleText:
      'No new package is created by default. Auth, ORM and storage remain recipes — openElement owns the application contract, not service products.',
    boundaryIndex: '02 / product boundary',
    boundaryTitle: 'Scope is explicit.',
    boundaryCopy:
      'Current capability, excluded promises and the visual contract are kept separate.',
    inProductLabel: 'in product',
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
    outScopeLabel: 'out of current scope',
    outScopeTitle: 'Out of current scope',
    outScopeItems: [
      'Hub product language',
      'Registry Hub as a current product promise',
      'RPC, CEM, and interop adapter package promises',
      'Generic auth, ORM, or database platform claims',
      'Old package-count public graph language',
    ],
    siteRuleLabel: 'design rule',
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
    productBoundaryMeta: 'product boundary',
    releaseDisciplineLabel: 'release discipline',
    v10PostureMeta: 'v1.0 posture',
    noDriftLabel: 'No drift',
    noDriftCopy: 'Marketing language, docs, package exports, and CI gates must agree.',
    noGhostsLabel: 'Retired stays retired',
    noGhostsCopy:
      'Archived Hub-era promises and webpack-era shortcuts stay out of the current public product line.',
    noFogLabel: 'Scope in the open',
    noFogCopy:
      'Users should understand what is shipped, current, planned, and explicitly out of scope.',
    changelog: 'Changelog',
    deployment: 'Deployment',
  },
  zh: {
    headTitle: '路线图',
    headDescription:
      'openElement 路线图：v1.0.0-alpha.1 基线、0.43 稳定维护基线，以及通往 v1.0 的门禁路径。',
    pageTitle: 'Roadmap',
    heroLede:
      'OpenElement 的 roadmap 标签描述的是公开产品面，锚定包真相、文档真相与 CI 证据，而不是愿望清单。',
    railItems:
      '[{"id":"release-line","label":"发布线"},{"id":"product-boundary","label":"产品边界"},{"id":"decision-matrix","label":"决策矩阵"},{"id":"system-visual","label":"系统图示"}]',
    architecture: '架构',
    freezeBadge: 'Alpha 基线 — v1.0.0-alpha.1',
    nowTitle: '0.43.3 保持稳定，1.0 Alpha 基线正在落地。',
    nowCopy: (version: string) =>
      `${version} 是已发布的稳定维护线。1.0 Alpha 是新基线：Element 与 Router 为公共核心，Create 为正式入口，UI 为实验性能力，不提供从 0.x 的受支持迁移。`,
    releaseLineIndex: '01 / 发布线',
    releaseLineTitle: '从已交付证据，到 v1.0 冻结。',
    releaseLineCopy: '这条线刻意收窄：只有经得起文档、包导出与构建验证检验的表述，才会留在这里。',
    timelineAria: 'Roadmap 发布线',
    stamps: {
      CURRENT: '当前',
      BASELINE: '基线',
      NEXT: '下一个',
    } as Record<'CURRENT' | 'BASELINE' | 'NEXT', string>,
    designRuleTitle: '设计规则',
    designRuleText:
      '默认不新增包。Auth、ORM 与存储保持为配方——openElement 拥有的是应用契约，不是服务产品。',
    boundaryIndex: '02 / 产品边界',
    boundaryTitle: '范围是明确的。',
    boundaryCopy: '当前能力、被排除的承诺与视觉契约，分开陈述。',
    inProductLabel: '产品内',
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
    outScopeLabel: '当前范围外',
    outScopeTitle: '当前范围之外',
    outScopeItems: [
      'Hub 产品话术',
      'Registry Hub 作为当前产品承诺',
      'RPC、CEM 与互操作 adapter 包的承诺',
      '通用的 auth、ORM 或数据库平台宣称',
      '旧的包数量公开图谱话术',
    ],
    siteRuleLabel: '设计规则',
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
    productBoundaryMeta: '产品边界',
    releaseDisciplineLabel: '发布纪律',
    v10PostureMeta: 'v1.0 姿态',
    noDriftLabel: '不漂移',
    noDriftCopy: '营销语言、文档、包导出与 CI 门禁必须一致。',
    noGhostsLabel: '退役不再回来',
    noGhostsCopy: '已归档的 Hub 时代承诺与 webpack 时代的捷径，一律留在当前公开产品线之外。',
    noFogLabel: '边界公开',
    noFogCopy: '用户应能看懂什么是已发布、当前、规划中，以及明确排除在范围之外的。',
    changelog: '更新日志',
    deployment: '部署',
  },
};

/**
 * The roadmap page as a server function page (alpha15 server architecture):
 * the route module's own exported TSX function, lowered by the compiler into
 * a generative HTML constructor. The page hook class (`page-roadmap`) scopes
 * the former component sheet's authored rules in the linked document
 * stylesheet, and the rows' per-item `data-state`/`data-stamp` slots carry
 * the variant data the sheet's group-data utilities match.
 */
export function RoadmapPage(props: {
  metadata: { breadcrumb: string; title: string; lede: string };
  railItems: Array<{ id: string; href: string; label: string; depth: string }>;
  locale: string;
  releaseLineIndex: string;
  releaseLineTitle: string;
  releaseLineCopy: string;
  freezeBadge: string;
  nowTitle: string;
  nowCopy: string;
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
  inProductLabel: string;
  inProductTitle: string;
  inProductItems: Array<{ key: string; value: string }>;
  outScopeLabel: string;
  outScopeTitle: string;
  outScopeItems: Array<{ key: string; value: string }>;
  siteRuleLabel: string;
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
      <open-reading-shell rail footer metadata={props.metadata} locale={props.locale}>
        <div slot='rail'>
          <open-page-rail items={props.railItems} locale={props.locale}></open-page-rail>
        </div>

        <section id='release-line'>
          <open-section-frame>
            <span slot='index'>{props.releaseLineIndex}</span>
            <span slot='title'>{props.releaseLineTitle}</span>
            <span slot='copy'>{props.releaseLineCopy}</span>
            <div class='mt-5 mb-6 px-5 py-4 border border-border border-s-4 border-s-primary rounded-lg'>
              {/* Retired ui open-badge → plain HTML+CSS recipe (#1557): the
                  warning-tone wash the component painted, inline. */}
              <span>{props.freezeBadge}</span>
              <p class='mt-3 mb-2 text-foreground font-bold leading-[1.3]'>{props.nowTitle}</p>
              <p class='m-0 text-muted-foreground text-(length:--text-sm) leading-(--leading-normal)'>
                {props.nowCopy}
              </p>
            </div>
            <div class='grid grid-cols-[minmax(0,1fr)] gap-[clamp(2rem,6vw,5rem)] [align-items:start] min-[1121px]:grid-cols-[minmax(0,1fr)_minmax(280px,0.38fr)]'>
              <div class='timeline relative grid' aria-label={props.timelineAria}>
                {props.rows.map((phase) => (
                  <div
                    class='group relative pt-5 pb-5 ps-6 min-[641px]:ps-8'
                    data-state={phase.state}
                    data-stamp={phase.stampKind}
                    key={phase.key}
                  >
                    <span
                      class='tl-node absolute start-0 top-8 size-2 group-data-[state=stable]:bg-primary group-data-[state=baseline]:bg-primary group-data-[state=next]:border-2 group-data-[state=next]:border-primary group-data-[state=next]:bg-background group-data-[state=planned]:border-2 group-data-[state=planned]:border-[color-mix(in_srgb,var(--color-ring)_55%,transparent)]'
                      aria-hidden='true'
                    ></span>
                    <div class='flex flex-wrap items-baseline gap-x-4 gap-y-3'>
                      <span class='text-foreground text-[length:clamp(2rem,4.2vw,3.6rem)] font-[800] leading-none tracking-[-0.03em] group-data-[state=next]:text-primary group-data-[state=planned]:text-transparent group-data-[state=planned]:[-webkit-text-stroke:1.5px_color-mix(in_srgb,var(--color-ring)_55%,transparent)]'>
                        {phase.version}
                      </span>
                      <span class='px-3 py-1 rounded-md text-(length:--text-xs) font-bold tracking-[0.08em] uppercase empty:hidden group-data-[stamp=current]:bg-primary group-data-[stamp=current]:text-primary-foreground group-data-[stamp=next]:border group-data-[stamp=next]:border-primary group-data-[stamp=next]:text-primary group-data-[stamp=baseline]:bg-primary group-data-[stamp=baseline]:text-primary-foreground'>
                        {phase.stampLabel}
                      </span>
                      <span class='text-primary font-serif text-[length:clamp(1.25rem,1.9vw,1.7rem)] italic font-[400] group-data-[state=planned]:text-ring'>
                        {phase.theme}
                      </span>
                    </div>
                    <p class='text-muted-foreground text-(length:--text-sm) leading-(--leading-normal) max-w-[560px] mt-3 mb-0'>
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
            <div class='grid grid-cols-[minmax(0,1fr)] gap-5 min-[1121px]:grid-cols-[minmax(0,0.95fr)_minmax(0,0.95fr)_minmax(0,0.72fr)]'>
              <open-artifact-panel class='truth'>
                <span slot='label'>{props.inProductLabel}</span>
                <h2 class='mt-0 mb-4 text-foreground text-(length:--text-2xl) leading-[1.08] tracking-normal'>
                  {props.inProductTitle}
                </h2>
                <ul class='grid gap-2 m-0 ps-5'>
                  {props.inProductItems.map((item) => (
                    <li
                      class='text-muted-foreground text-(length:--text-sm) leading-(--leading-normal)'
                      key={item.key}
                    >
                      {item.value}
                    </li>
                  ))}
                </ul>
              </open-artifact-panel>

              <open-artifact-panel class='truth'>
                <span slot='label'>{props.outScopeLabel}</span>
                <h2 class='mt-0 mb-4 text-foreground text-(length:--text-2xl) leading-[1.08] tracking-normal'>
                  {props.outScopeTitle}
                </h2>
                <ul class='grid gap-2 m-0 ps-5'>
                  {props.outScopeItems.map((item) => (
                    <li
                      class='text-muted-foreground text-(length:--text-sm) leading-(--leading-normal)'
                      key={item.key}
                    >
                      {item.value}
                    </li>
                  ))}
                </ul>
              </open-artifact-panel>

              <open-artifact-panel class='truth'>
                <span slot='label'>{props.siteRuleLabel}</span>
                <h2 class='mt-0 mb-4 text-foreground text-(length:--text-2xl) leading-[1.08] tracking-normal'>
                  {props.siteRuleTitle}
                </h2>
                <p class='text-muted-foreground text-(length:--text-sm) leading-(--leading-normal)'>
                  {props.siteRuleText}
                </p>
              </open-artifact-panel>
            </div>
          </open-section-frame>
        </section>

        <section id='decision-matrix'>
          <open-section-frame>
            <span slot='index'>{props.matrixIndex}</span>
            <span slot='title'>{props.matrixTitle}</span>
            <span slot='copy'>{props.matrixCopy}</span>
            <div class='grid border-t border-t-border'>
              <div class='grid grid-cols-[minmax(0,1fr)] gap-2 py-5 border-b border-b-border min-[641px]:grid-cols-[minmax(132px,0.28fr)_minmax(0,1fr)] min-[641px]:gap-5 last:[border-bottom:0]'>
                <span class='text-primary font-mono text-(length:--text-xs) font-extrabold tracking-normal uppercase'>
                  {props.shipLabel}
                </span>
                <span class='text-muted-foreground text-(length:--text-sm) leading-(--leading-normal)'>
                  {props.shipCopy}
                </span>
              </div>
              <div class='grid grid-cols-[minmax(0,1fr)] gap-2 py-5 border-b border-b-border min-[641px]:grid-cols-[minmax(132px,0.28fr)_minmax(0,1fr)] min-[641px]:gap-5 last:[border-bottom:0]'>
                <span class='text-primary font-mono text-(length:--text-xs) font-extrabold tracking-normal uppercase'>
                  {props.proveLabel}
                </span>
                <span class='text-muted-foreground text-(length:--text-sm) leading-(--leading-normal)'>
                  {props.proveCopy}
                </span>
              </div>
              <div class='grid grid-cols-[minmax(0,1fr)] gap-2 py-5 border-b border-b-border min-[641px]:grid-cols-[minmax(132px,0.28fr)_minmax(0,1fr)] min-[641px]:gap-5 last:[border-bottom:0]'>
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
            <div class='grid grid-cols-[minmax(0,1fr)] gap-5 min-[1121px]:grid-cols-[minmax(0,0.88fr)_minmax(0,1fr)]'>
              <open-artifact-panel>
                <span slot='label'>{props.packageMatrixLabel}</span>
                <span slot='meta'>{props.productBoundaryMeta}</span>
                <open-standards-visual
                  variant='packages'
                  emphasis='high'
                  motion='auto'
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
          class='flex flex-wrap gap-3 w-[min(1180px,calc(100%_-_3rem))] mt-[clamp(4rem,10vh,8rem)] mx-auto mb-0 pb-[clamp(3rem,8vh,6rem)]'
          slot='footer'
        >
          <open-button href='/architecture'>{props.architecture}</open-button>
          <open-button href='/changelog'>{props.changelog}</open-button>
          <open-button href='/guide/deployment'>{props.deployment}</open-button>
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
      // There is no complete-surface published version on the stable line
      // (Router has no 0.43.x; protocol and compiler have no stable release),
      // so COMMON_PUBLISHED_VERSION is null and no timeline row is marked
      // current from registry state.
      const stamp =
        COMMON_PUBLISHED_VERSION !== null && phase.version === COMMON_PUBLISHED_VERSION
          ? 'CURRENT'
          : phase.stamp;
      return {
        key: phase.version,
        rowClass: `tl-row tl-${phase.state}`,
        version: phase.version,
        theme: phase.theme,
        stampClass: stamp ? `stamp stamp-${stamp.toLowerCase()}` : 'stamp',
        stampLabel: stamp ? t.stamps[stamp] : '',
        copy: phase.copy,
        // The alpha-train row carries no hand-written status: its publish-
        // state derives from release-state truth via app/data/version.ts so
        // the roadmap cannot contradict the registry (www check:content-data
        // fails on any literal claim here). Hand-written status remains only
        // for rows registry state cannot know, e.g. the unscheduled RC row.
        status: phase.status ?? prereleasePublishStatus(resolved),
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
      nowCopy: t.nowCopy(REGISTRY_NOTE),
      timelineAria: t.timelineAria,
      rows,
      designRuleTitle: t.designRuleTitle,
      designRuleText: t.designRuleText,
      boundaryIndex: t.boundaryIndex,
      boundaryTitle: t.boundaryTitle,
      boundaryCopy: t.boundaryCopy,
      inProductLabel: t.inProductLabel,
      inProductTitle: t.inProductTitle,
      inProductItems: listItems(t.inProductItems),
      outScopeLabel: t.outScopeLabel,
      outScopeTitle: t.outScopeTitle,
      outScopeItems: listItems(t.outScopeItems),
      siteRuleLabel: t.siteRuleLabel,
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
    };
  },
});
