import { definePage } from '@openelement/app';
import { PUBLISHED_PACKAGE_VERSION, PUBLISHED_STABLE_VERSION } from '../data/version.ts';
import { siteHead } from '@openelement/site-ui/head.ts';
import { contentLocale } from '@openelement/site-ui/locale.ts';
import RoadmapPage from '../components/page-roadmap.tsx';

export const meta = { section: '', label: 'Roadmap', order: 10 };
// Strategic anchors: Web Components-native, static-first application framework.

type TimelineEntry = {
  version: string;
  theme: string;
  copy: string;
  state: 'stable' | 'next' | 'planned';
  stamp?: 'CURRENT' | 'NEXT';
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

interface RoadmapListItem {
  key: string;
  value: string;
}

const entries: Record<'en' | 'zh', TimelineEntry[]> = {
  'en': [
    {
      'version': 'v0.44.0-beta.2.1',
      'theme': 'Router foundation and independent Element',
      'copy':
        'Maintain an upstream-traceable URLPatternList fork and prepare generic contributions; unify route resolution; repair SSG and browser navigation boundaries; qualify standalone Element and prerelease tooling.',
      'state': 'next',
      'stamp': 'CURRENT',
      'status': 'prerelease',
    },
    {
      'version': 'v0.44.0-beta.2.2',
      'theme': 'Native and Lit Framework Mode',
      'copy':
        'Use WTR for upstream-aligned browser conformance; prove loader, SSR, client continuation, navigation and actions with Native and Lit; derive a minimal shared protocol and public Document/SEO/search/sitemap metadata; prepare bounded Oxc/TS7 migration experiments. Lit is a support target, not an already-shipped claim.',
      'state': 'planned',
      'stamp': 'NEXT',
      'status': 'planned',
    },
    {
      'version': 'v0.44.0-beta.2.3',
      'theme': 'Dual-mode qualification',
      'copy':
        'Qualify independent packed consumers, runtime/browser matrices, output and resource cleanup; remove qualified duplicate infrastructure, reconcile documentation and record Alpha migration decisions. No deadline waiver or automatic beta.2.4.',
      'state': 'planned',
      'status': 'evidence-gated',
    },
    {
      'version': 'v1.0.0-alpha.1',
      'theme': 'Public Alpha admission',
      'copy':
        'Start real application use with the public baseline: independently consumable Element and Router with Native/Lit application flows. Actively qualify Oxc/TS7 adoption and platform reductions through subsequent Alpha upgrades; APIs may evolve with migration guidance.',
      'state': 'planned',
      'status': 'planned',
    },
    {
      'version': 'v1.0 RC / Stable',
      'theme': 'Separately admitted releases',
      'copy':
        'Freeze contracts and dependencies after Alpha evidence; require at least fourteen days of RC soak, install/upgrade/security qualification and human GO. Element and Router do not mandate a package count.',
      'state': 'planned',
      'status': 'unscheduled',
    },
  ],
  'zh': [
    {
      'version': 'v0.44.0-beta.2.1',
      'theme': 'Router 地基与独立 Element',
      'copy':
        '维护可追溯上游的 URLPatternList fork，准备通用贡献；统一路由决议；修复 SSG 和浏览器导航边界；验证独立 Element 与预发布工具链。',
      'state': 'next',
      'stamp': 'CURRENT',
      'status': '预发布',
    },
    {
      'version': 'v0.44.0-beta.2.2',
      'theme': 'Native 与 Lit Framework Mode',
      'copy':
        '采用便于贡献上游的 WTR 浏览器测试，以 Native 和 Lit 跑通 loader、SSR、客户端接续、导航及 action，提炼最小共享协议和 Document/SEO/search/sitemap 元数据，并完成有界 Oxc/TS7 迁移试验。Lit 是正式支持目标，尚非已交付声明。',
      'state': 'planned',
      'stamp': 'NEXT',
      'status': '规划中',
    },
    {
      'version': 'v0.44.0-beta.2.3',
      'theme': '双模式资格验证',
      'copy':
        '验证独立打包消费者、运行时与浏览器矩阵、产物和资源清理，删除已验证的重复基础设施、同步文档并明确 Alpha 迁移决定。期限不豁免验收，不自动追加 beta.2.4。',
      'state': 'planned',
      'status': '按证据准入',
    },
    {
      'version': 'v1.0.0-alpha.1',
      'theme': '公开 Alpha 准入',
      'copy':
        '从公开基线开始在真实应用中使用可独立消费的 Element 与 Router，验证 Native/Lit 应用流程；后续 Alpha 积极验证 Oxc/TS7 采用和平台替代，接口调整提供迁移说明。',
      'state': 'planned',
      'status': '规划中',
    },
    {
      'version': 'v1.0 RC / Stable',
      'theme': '分别准入',
      'copy':
        'Alpha 证据充分后冻结接口与依赖，完成至少十四天 RC 持续运行及安装、升级、安全验证后取得人工 GO。两个产品不强制两个发布包。',
      'state': 'planned',
      'status': '未定日期',
    },
  ],
};

const content = {
  en: {
    headTitle: 'Roadmap',
    headDescription:
      'The openElement roadmap: the current v0.44 beta line, the stable 0.43 maintenance baseline and the gated path to v1.0.',
    pageTitle: 'Roadmap',
    heroLede:
      'OpenElement roadmap labels describe the public product surface, tied to package truth, docs truth and CI evidence rather than a wish list.',
    railItems:
      '[{"id":"release-line","label":"Release line"},{"id":"product-boundary","label":"Product boundary"},{"id":"decision-matrix","label":"Decision matrix"},{"id":"system-visual","label":"System visual"}]',
    architecture: 'Architecture',
    freezeBadge: 'ADR-0143 — v0.44 alpha active',
    nowTitle: '0.43.3 remains stable while the compiled OpenElement train begins.',
    nowCopy: (version: string) =>
      `${version} is the published stable maintenance line. ADR-0143 explicitly opens the 0.44 alpha line for the compiled Element architecture; the Version Plan owns every numbered alpha and the RC gate.`,
    releaseLineIndex: '01 / release line',
    releaseLineTitle: 'From shipped evidence to v1.0 freeze.',
    releaseLineCopy:
      'The line is deliberately narrow: only claims that can survive docs, package exports and build validation stay visible.',
    timelineAria: 'Roadmap release line',
    stamps: { CURRENT: 'CURRENT', NEXT: 'NEXT' } as Record<'CURRENT' | 'NEXT', string>,
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
      'Preact adapter and Hono API routes via adapter-vite',
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
      'The public website should read like a Web Standards Lab: dark-first, diagrammatic, useful, and grounded in artifacts users can inspect.',
    matrixIndex: '03 / decision matrix',
    matrixTitle: 'Roadmap language stays inside the product boundary.',
    matrixCopy: 'Ship, prove and freeze are evidence states rather than marketing labels.',
    shipLabel: 'Ship',
    shipCopy: 'Only public contracts reflected in docs, generated pages, and package surfaces.',
    proveLabel: 'Prove',
    proveCopy: 'Use CI, build checks, and docs scans as release evidence before expanding claims.',
    freezeLabel: 'Freeze',
    freezeCopy:
      'Move toward v1.0 after the WC fullstack framework and Basic Element line is stable, readable, and boring to verify.',
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
    noGhostsLabel: 'No ghosts',
    noGhostsCopy:
      'Archived Hub-era promises and No webpack-era shortcuts stay out of the current public product line.',
    noFogLabel: 'No fog',
    noFogCopy:
      'Users should understand what is shipped, current, planned, and explicitly out of scope.',
    changelog: 'Changelog',
    deployment: 'Deployment',
  },
  zh: {
    headTitle: '路线图',
    headDescription:
      'openElement 路线图：当前的 v0.44 beta 线、0.43 稳定维护基线，以及通往 v1.0 的门禁路径。',
    pageTitle: 'Roadmap',
    heroLede:
      'OpenElement 的 roadmap 标签描述的是公开产品面，锚定包真相、文档真相与 CI 证据，而不是愿望清单。',
    railItems:
      '[{"id":"release-line","label":"发布线"},{"id":"product-boundary","label":"产品边界"},{"id":"decision-matrix","label":"决策矩阵"},{"id":"system-visual","label":"系统图示"}]',
    architecture: '架构',
    freezeBadge: 'ADR-0143 — v0.44 alpha 执行中',
    nowTitle: '0.43.3 保持稳定，编译型 OpenElement 列车已经启动。',
    nowCopy: (version: string) =>
      `${version} 是已发布的稳定维护线。ADR-0143 已明确开启 0.44 alpha 编译型 Element 架构列车；每个编号 alpha 与 RC 门禁均以 Version Plan 为准。`,
    releaseLineIndex: '01 / 发布线',
    releaseLineTitle: '从已交付证据，到 v1.0 冻结。',
    releaseLineCopy: '这条线刻意收窄：只有经得起文档、包导出与构建验证检验的表述，才会留在这里。',
    timelineAria: 'Roadmap 发布线',
    stamps: { CURRENT: '当前', NEXT: '下一个' } as Record<'CURRENT' | 'NEXT', string>,
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
      'Preact adapter，以及经 adapter-vite 提供的 Hono API 路由',
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
    siteRuleText:
      '公开网站应读起来像一间 Web Standards Lab：深色优先、图示化、有用，并立足于用户可以检查的真实产物。',
    matrixIndex: '03 / 决策矩阵',
    matrixTitle: 'Roadmap 语言不越过产品边界。',
    matrixCopy: 'Ship、prove 与 freeze 是证据状态，不是营销标签。',
    shipLabel: 'Ship',
    shipCopy: '只有反映在文档、生成页面与包能力面上的公开契约。',
    proveLabel: 'Prove',
    proveCopy: '在扩大宣称之前，以 CI、构建检查与文档扫描作为发布证据。',
    freezeLabel: 'Freeze',
    freezeCopy: '当 WC 全栈框架与 Basic Element 线稳定、可读、验证起来平淡无奇之后，再迈向 v1.0。',
    visualIndex: '04 / 系统图示',
    visualTitle: '包图是发布产物的一部分。',
    visualCopy: '已发布的包归属与公开架构必须保持机械一致。',
    packageMatrixLabel: '包矩阵',
    productBoundaryMeta: '产品边界',
    releaseDisciplineLabel: '发布纪律',
    v10PostureMeta: 'v1.0 姿态',
    noDriftLabel: '不漂移',
    noDriftCopy: '营销语言、文档、包导出与 CI 门禁必须一致。',
    noGhostsLabel: '无幽灵',
    noGhostsCopy: '已归档的 Hub 时代承诺与 webpack 时代的捷径，一律留在当前公开产品线之外。',
    noFogLabel: '无迷雾',
    noFogCopy: '用户应能看懂什么是已发布、当前、规划中，以及明确排除在范围之外的。',
    changelog: '更新日志',
    deployment: '部署',
  },
};

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
    const timeline: RoadmapTimelineItem[] = entries[resolved].map((phase) => {
      // The current-line stamp follows the bump-maintained anchor
      // (PUBLISHED_PACKAGE_VERSION) so a release bump re-marks the timeline
      // without manual edits.
      const stamp = phase.version === PUBLISHED_PACKAGE_VERSION ? 'CURRENT' : phase.stamp;
      return {
        key: phase.version,
        rowClass: `tl-row tl-${phase.state}`,
        version: phase.version,
        theme: phase.theme,
        stampClass: stamp ? `stamp stamp-${stamp.toLowerCase()}` : 'stamp',
        stampLabel: stamp ? t.stamps[stamp] : '',
        copy: phase.copy,
        status: phase.status ?? '',
      };
    });
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
      nowCopy: t.nowCopy(PUBLISHED_STABLE_VERSION),
      timelineAria: t.timelineAria,
      timeline,
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
    };
  },
});
