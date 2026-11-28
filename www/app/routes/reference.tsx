/** WWW supported API reference page. */
import { trustedHtml, type TrustedHtml } from '@openelement/element';
import { definePage } from '@openelement/router';
import { siteHead } from '#site-ui/head.ts';
import { normalizeSiteHref, siteHref } from '#site-ui/site-url.ts';
import { contentLocale } from '#site-ui/locale.ts';
import '#site-ui/open-reading-shell.tsx';
import '../site-ui/open-section-frame.tsx';
import '../islands/open-page-rail.tsx';
import '../islands/open-registry-lookup.tsx';
import type { SiteLocale } from '../../site-config.ts';
import { OPENELEMENT_VERSION, sourceLineStamp } from '../data/version.ts';
import { apiReference } from '../data/_generated-api-reference.ts';
import { apiReferencePreview } from '../data/api-reference-previews.ts';

export const meta = { section: 'Reference', label: 'API Reference', order: 5 };

/**
 * Brand casing for generated prose. JSDoc summaries and manifest descriptions
 * arrive from package sources outside this workspace. The public prose uses
 * `openElement`. Normalize the standalone word and preserve exported API
 * names such as `OpenElementOptions`.
 */
const BRAND_PROSE = /(?<![A-Za-z0-9_$])OpenElement(?![A-Za-z0-9_$])/g;

function brandProse(text: string): string {
  // Inline code is an API identifier (`OpenElement` the class), not prose:
  // normalize only the odd/even segments outside backtick spans.
  return text
    .split('`')
    .map((segment, index) =>
      index % 2 === 1 ? segment : segment.replace(BRAND_PROSE, 'openElement'),
    )
    .join('`');
}

/** One generated package record projected onto the registry row grammar. */
export interface ApiPackageItem {
  id: string;
  name: string;
  importPath: string;
  copy: string;
  note1: string;
  note2: string;
  note3: string;
  export1: string;
  export2: string;
  export3: string;
  export4: string;
  export5: string;
  kind: string;
  kindClass: string;
  kindLabel: string;
}

/** One row of the generated config-option table (an each Block item). */
export interface ApiOptionRow {
  key: string;
  name: string;
  type: string;
  required: string;
  defaultValue: string;
  description: string;
}

/** One generated custom-element record with its detail lists inlined. */
export interface ApiElementItem {
  key: string;
  anchor: string;
  tag: string;
  className: string;
  description: string;
  layer: string;
  hydrate: string;
  module: string;
  /** Locale label shown only for manifest status 'experimental'; else empty. */
  status: string;
  attributes: string;
  events: string;
  slots: string;
  cssParts: string;
  attributesLabel: string;
  eventsLabel: string;
  slotsLabel: string;
  partsLabel: string;
}

/** The shell metadata record (breadcrumb/title/lede). */
export interface ApiMetadata {
  breadcrumb: string;
  title: string;
  lede: string;
}

/** The consumer-package count is generated truth, never a hand-written number. */
const packageCount = apiReference.packages.length;

type Locale = SiteLocale;

/**
 * Authored bilingual presentation copy, keyed by generated package id. The
 * inventory itself (packages, subpaths, exports, anchors) is generated from
 * repository truth by tools/generate-api-reference.ts (#1158) — only prose
 * lives here, and the fail-closed projection below refuses a stale key.
 */
type AuthoredPackageCopy = {
  copy: Record<Locale, string>;
  notes: Record<Locale, string[]>;
  kind: 'core' | 'build' | 'optional';
};

const authoredCopy: Record<string, AuthoredPackageCopy> = {
  protocol: {
    copy: {
      en: 'Shared types for compiled templates, rendering, routing, and errors.',
      zh: '编译模板、渲染、路由和错误共用的类型。',
    },
    notes: {
      en: ['Most apps import these types through the router or element package.'],
      zh: ['应用通常从 router 或 element 包导入这些类型。'],
    },
    kind: 'core',
  },
  element: {
    copy: {
      en: 'Renders compiled custom elements and connects their reactive state in the browser.',
      zh: '将组件函数编译为浏览器原生自定义元素后，用这个运行时渲染和运行它们。',
    },
    notes: {
      en: [
        'Write custom elements as component functions with a configuration export.',
        'Import `signal` for reactive state and `StyleSheet` for component styles.',
      ],
      zh: [
        '用组件函数编写自定义元素，并导出其配置。',
        '从包根导入 `signal` 管理响应式状态，用 `StyleSheet` 编写组件样式。',
      ],
    },
    kind: 'core',
  },
  compiler: {
    copy: {
      en: 'Compiles TSX component functions at build time.',
      zh: '在构建时编译 TSX 组件函数。',
    },
    notes: {
      en: [
        'Install it as a development dependency when building components without the router.',
        'You normally drive it through the `@openelement/router` build; the standalone plugin is `@openelement/compiler/vite`.',
      ],
      zh: [
        '不使用 router 构建组件时，将它安装为开发依赖。',
        '通常通过 `@openelement/router` 构建驱动；独立插件在 `@openelement/compiler/vite`。',
      ],
    },
    kind: 'build',
  },
  router: {
    copy: {
      en: 'The application and build surface: pages, routes, islands, request/render semantics, Vite integration, static generation and Nitro output.',
      zh: '应用与构建面：页面、路由、island、请求/渲染语义、Vite 集成、静态生成与 Nitro 输出。',
    },
    notes: {
      en: [
        'Use `definePage` and `defineIslandConfig` for application authoring.',
        'Use `openPipeline()`/`openElement()` from `@openelement/router/vite` or the generated build task for builds.',
        'Plugin ordering, manifests and content scans are router implementation details.',
      ],
      zh: [
        '用 `definePage` 与 `defineIslandConfig` 进行应用创作。',
        '构建使用 `@openelement/router/vite` 的 `openPipeline()`/`openElement()` 或生成的构建任务。',
        '插件顺序、manifest 与内容扫描属于 router 的实现细节。',
      ],
    },
    kind: 'core',
  },
  create: {
    copy: {
      en: 'Creates the starter app and installs its dependencies.',
      zh: '生成起步应用并安装依赖。',
    },
    notes: {
      en: ['Generated projects expose `dev`, `check`, `test`, `build`, `start` and `preview`.'],
      zh: ['生成的项目暴露 `dev`、`check`、`test`、`build`、`start` 与 `preview`。'],
    },
    kind: 'build',
  },
  ui: {
    copy: {
      en: 'Optional ready-to-use custom elements, including buttons, inputs, and dialogs.',
      zh: '可选的现成自定义元素，包括按钮、输入框和对话框。',
    },
    notes: {
      en: [],
      zh: [],
    },
    kind: 'optional',
  },
};

/**
 * Project the generated inventory against the authored copy. A package with
 * no authored copy — or authored copy for a package the truth no longer
 * lists — fails the build instead of silently drifting (#1158).
 */
function projectPackages(): Array<{
  id: string;
  name: string;
  importPath: string;
  supportedSubpaths: readonly string[];
  internalSubpaths: readonly string[];
  authored: AuthoredPackageCopy;
}> {
  const generatedIds = new Set<string>();
  const projected = apiReference.packages.map((pkg) => {
    generatedIds.add(pkg.id);
    const authored = authoredCopy[pkg.id];
    if (!authored) {
      throw new Error(
        `reference: generated package '${pkg.id}' has no authored bilingual copy in www/app/routes/reference.tsx`,
      );
    }
    return {
      id: pkg.id,
      name: pkg.name,
      importPath: pkg.importPath,
      supportedSubpaths: pkg.supportedSubpaths,
      internalSubpaths: pkg.internalSubpaths,
      authored,
    };
  });
  for (const id of Object.keys(authoredCopy)) {
    if (!generatedIds.has(id)) {
      throw new Error(
        `reference: authored copy for '${id}' has no generated package — remove the stale entry`,
      );
    }
  }
  return projected;
}

const kindLabels = {
  en: { core: 'CORE', build: 'BUILD', optional: 'OPTIONAL' },
  zh: { core: '核心', build: '构建', optional: '可选' },
} as const;

const exportTags: Record<string, string> = {
  class: '类',
  const: '常量',
  function: '函数',
  interface: '接口',
  namespace: '命名空间',
  public: '公开',
  type: '类型',
};

// The generator currently lists the first overload. Point directly to the
// function overload in packages/router/src/authoring.ts as well.
const functionPageOverload =
  'https://github.com/open-element/openelement/blob/main/packages/router/src/authoring.ts#L505-L511';

/**
 * Render the generated export inventory as grouped, fixed-height scroll panes:
 * one pane per package, every export row keeping its generated `id` anchor.
 *
 * Why HTML rather than a compiled list: the compiler grammar admits nested
 * elements in a list item template but not a nested list Block, while the
 * reference needs package groups around per-export rows. The export corpus is
 * generated data rendered as trusted HTML at build time (the same innerHTML
 * channel article bodies use), so the grouping is expressible without
 * weakening the page grammar or adding client JavaScript.
 *
 * The panes keep the document short (~4-8k px instead of ~491k px) and every
 * generated search anchor still resolves inside its pane; native fragment
 * navigation scrolls the pane to the target.
 */
function renderReferenceGroupsHtml(
  locale: Locale,
  requiredLabel: string,
  optionalLabel: string,
): string {
  const unit = locale === 'zh' ? '个导出' : 'exports';
  const regionLabel = locale === 'zh' ? '导出列表' : 'export list';
  const signatureLabel = locale === 'zh' ? '签名' : 'signature';
  const continueLabel = locale === 'zh' ? '继续向下阅读' : 'Continue reading';
  const topLabel = locale === 'zh' ? '回到列表开头' : 'Back to list top';
  const browseLabel = locale === 'zh' ? '随页面滚动此列表' : 'Scroll this list with the page';
  const sourceLabel = locale === 'zh' ? '英文源码说明' : 'Source notes';
  const optionsLabel = locale === 'zh' ? '参数选项和源码位置' : 'Options and source location';
  const scopeHint =
    locale === 'zh' ? '↑ ↓ 选择 · Tab 查看 · Esc 返回' : '↑ ↓ Select · Tab inspect · Esc return';
  const escapeHtml = (value: string): string =>
    value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  const formActionsHref = siteHref(
    locale === 'zh'
      ? '/guide/routing-and-data#表单-action'
      : '/guide/routing-and-data#form-actions',
    locale,
  );
  const inlineLink = (href: string, label: string) =>
    `<a class="underline" href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
  const summaryHtml = (summary: string) =>
    escapeHtml(summary)
      .replaceAll(
        '&quot;Form actions&quot; section',
        inlineLink(formActionsHref, '"Form actions" section'),
      )
      .replaceAll(
        'see ProblemDetails.',
        `see ${inlineLink('#api-protocol-root-ProblemDetails', 'ProblemDetails')}.`,
      )
      .replaceAll(
        'See `ActionResult` for',
        `See ${inlineLink('#api-protocol-root-ActionResult', 'ActionResult')} for`,
      );
  const optionLine = (
    options: readonly {
      name: string;
      type: string;
      required: boolean;
      description: string;
    }[],
  ): string =>
    options
      .map((option) => {
        const marker = option.required ? requiredLabel : optionalLabel;
        const description =
          option.description === ''
            ? ''
            : ` — <span lang="en">${escapeHtml(option.description)}</span>`;
        return `${escapeHtml(option.name)}${option.required ? '' : '?'}: ${escapeHtml(option.type)} (${marker})${description}`;
      })
      .join('; ');
  const groups = apiReference.packages
    .map((pkg) => {
      const rows = pkg.subpaths
        .flatMap((subpath) =>
          subpath.exports.map((exported) => {
            const preview = apiReferencePreview(exported, locale);
            const functionLink =
              exported.anchor === 'api-router-root-definePage'
                ? ` ${inlineLink(functionPageOverload, locale === 'zh' ? '查看函数重载' : 'See the function overload')}${locale === 'zh' ? '。' : '.'}`
                : '';
            const notes = preview === exported.summary ? '' : summaryHtml(exported.summary);
            const options = optionLine(exported.options);
            const sourceLocation = `<span class="ref-source">${escapeHtml(exported.source.path)}:${exported.source.line}</span>`;
            const details =
              notes || options
                ? `<details class="ref-detail"><summary class="ref-detail-toggle" data-pagefind-ignore>${notes ? sourceLabel : optionsLabel}</summary>` +
                  (notes ? `<p class="ref-summary" lang="en">${notes}</p>` : '') +
                  (options ? `<p class="ref-options">${options}</p>` : '') +
                  `${sourceLocation}</details>`
                : sourceLocation;
            const tags = [exported.kind, exported.stability]
              .filter(Boolean)
              .map((tag) => (locale === 'zh' ? (exportTags[tag] ?? tag) : tag))
              .join(' · ');
            return (
              `<div class="ref-row" id="${escapeHtml(exported.anchor)}" role="listitem" tabindex="-1" data-lookup-label="${escapeHtml(exported.name)}">` +
              `<div class="ref-row-head">` +
              `<span class="ref-name">${escapeHtml(exported.name)}</span>` +
              (tags === '' ? '' : `<span class="ref-tags">${escapeHtml(tags)}</span>`) +
              `</div>` +
              `<span class="ref-container">${escapeHtml(pkg.name)} · ${escapeHtml(subpath.label)}</span>` +
              (preview ? `<p class="ref-summary">${summaryHtml(preview)}${functionLink}</p>` : '') +
              `<pre class="ref-sig" tabindex="-1" data-sig-label="${escapeHtml(exported.name)} ${signatureLabel}"><code>${escapeHtml(exported.signature)}</code></pre>` +
              details +
              `</div>`
            );
          }),
        )
        .join('');
      const count = pkg.subpaths.reduce((total, subpath) => total + subpath.exports.length, 0);
      const packageHeading = escapeHtml(pkg.name).replace('/', '/<wbr>');
      return (
        `<section class="ref-group" aria-labelledby="ref-${pkg.id}-title" data-ref-package="${escapeHtml(pkg.name)}">` +
        `<div class="ref-group-head">` +
        `<h3 class="ref-group-title" id="ref-${pkg.id}-title">${packageHeading}</h3>` +
        `<span class="ref-group-count">${count} ${unit}</span>` +
        `</div>` +
        `<button type="button" class="ref-browse min-h-11 w-full cursor-pointer px-4 text-start text-sm text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring" ` +
        `data-ref-browse aria-controls="ref-${pkg.id}-exports" aria-describedby="ref-${pkg.id}-title" aria-pressed="false" hidden>${browseLabel}</button>` +
        `<div id="ref-${pkg.id}-exports" class="ref-group-scroll" role="region" tabindex="0" ` +
        `aria-label="${escapeHtml(pkg.name)} — ${regionLabel}" aria-describedby="export-keyboard-hint">` +
        `<div role="list" class="ref-list">${rows}</div>` +
        `</div>` +
        `<div class="border-t border-border bg-muted" data-ref-controls hidden>` +
        `<button type="button" class="min-h-11 w-full cursor-pointer px-4 text-start text-sm font-semibold text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring" ` +
        `aria-controls="ref-${pkg.id}-exports" data-ref-continue data-ref-more="${continueLabel}" data-ref-top="${topLabel}">${continueLabel}</button>` +
        `<p class="m-0 flex flex-wrap justify-between gap-x-2 gap-y-1 px-4 pb-3 text-xs text-muted-foreground"><span>${scopeHint}</span><span data-ref-position></span></p>` +
        `</div>` +
        `</section>`
      );
    })
    .join('');
  return groups;
}

interface GeneratedElementDetail {
  name?: string;
  type?: string;
  description?: string;
  default?: string;
}

/**
 * The application config option table (#1414 item 4), rendered from the type
 * the config entry is checked against. Dotted names come from the generator's
 * one-level descent into nested option bags, so a group's members are rows.
 */
function projectConfigOptions(requiredLabel: string, optionalLabel: string): ApiOptionRow[] {
  return apiReference.configOptions.map((option) => ({
    key: `config-option-${option.name}`,
    name: option.name,
    type: option.type,
    required: option.required ? requiredLabel : optionalLabel,
    defaultValue: option.default === '' ? '' : `= ${option.default}`,
    description: brandProse(option.description),
  }));
}

/** Render one generated detail list (attributes/events/slots/CSS parts) as inline text. */
function detailLine(details: readonly GeneratedElementDetail[]): string {
  return details
    .map((detail) => {
      const name = detail.name === '' ? '(default)' : (detail.name ?? '');
      const type = typeof detail.type === 'string' && detail.type !== '' ? `: ${detail.type}` : '';
      const fallback = typeof detail.default === 'string' ? ` = ${detail.default}` : '';
      const description =
        typeof detail.description === 'string' && detail.description !== ''
          ? ` — ${brandProse(detail.description)}`
          : '';
      return `${name}${type}${fallback}${description}`;
    })
    .join('; ');
}

/** Per-element detail rows from the generated compiler-manifest records. */
function projectElementEntries(labels: {
  attributes: string;
  events: string;
  slots: string;
  parts: string;
  experimental: string;
}): ApiElementItem[] {
  return apiReference.elements.map((element) => ({
    key: element.anchor,
    anchor: element.anchor,
    tag: `<${element.tag}>`,
    className: element.className,
    description: brandProse(element.description),
    layer: element.layer,
    hydrate: element.hydrate,
    module: element.module,
    status: element.status === 'experimental' ? labels.experimental : '',
    attributes: detailLine(element.attributes),
    events: detailLine(element.events),
    slots: detailLine(element.slots),
    cssParts: detailLine(element.cssParts),
    attributesLabel: labels.attributes,
    eventsLabel: labels.events,
    slotsLabel: labels.slots,
    partsLabel: labels.parts,
  }));
}

/** Subpath display labels projected into the fixed chip grammar (5 slots). */
function subpathChips(supportedSubpaths: readonly string[]): string[] {
  const labels = supportedSubpaths.map((subpath) => (subpath === '.' ? 'root' : subpath));
  if (labels.length <= 5) return labels;
  return [...labels.slice(0, 4), `+${labels.length - 4} more`];
}

const content = {
  en: {
    headTitle: 'API Reference',
    headDescription: `The supported openElement API surface: ${packageCount} consumer packages, every documented export and every custom element, generated from repository truth.`,
    pageTitle: 'API Reference',
    lede: (v: string) => `Look up import paths, signatures, and configuration for ${v}.`,
    s1Index: '01 / interface rule',
    s1Title: 'Start with routes and components',
    s1Copy:
      'Use definePage to give a page function its route options. Use defineIslandConfig beside a component function to set its custom element tag and when it becomes interactive.',
    s1Links: [
      { label: 'Build a page and custom element', href: '/guide/getting-started#build-a-page' },
      { label: 'Routing and Data', href: '/guide/routing-and-data' },
    ],
    lookupLabel: 'Find an exported symbol',
    lookupExample: 'definePage',
    lookupHint: 'Enter a name such as definePage, or choose a package to browse its exports.',
    lookupSubmit: 'Find',
    keyboardHint:
      'Use Page Up or Page Down to read and ↑ or ↓ to select an export. Tab reaches long signatures, notes and links. Use ← or → to read across a signature and Esc to return to the list. Turn on “Scroll this list with the page” to browse without a separate scrollbar.',
    s2Index: '02 / supported surface',
    s2Title: `${packageCount} supported packages`,
    s2Copy: 'Check each package’s purpose and supported import paths.',
    headPackage: 'Package',
    headSubpaths: 'Supported subpaths',
    headKind: 'Kind',
    railExports: 'Exports',
    railElements: 'Elements',
    railOptions: 'Config options',
    s3Index: '03 / export reference',
    s3Title: 'Exported symbols',
    s3Copy:
      'Signatures and paths follow the source version shown above. Expand source notes for longer descriptions or additional options.',
    changelogLabel: 'See published versions in the changelog',
    headExport: 'Export',
    headSummary: 'Summary',
    headSource: 'Source',
    s4Index: '04 / element reference',
    s4Title: 'Custom elements from the compiler manifest.',
    s4Copy:
      'Tag, layer, hydration strategy, attributes, events, slots and CSS parts come from the @openelement/ui compiler manifest — the same truth the SSR/claim pipeline validates against.',
    attributesLabel: 'Attributes',
    eventsLabel: 'Events',
    slotsLabel: 'Slots',
    partsLabel: 'CSS parts',
    experimentalLabel: 'experimental',
    s5Index: '05 / config options',
    s5Title: 'The application options type, one row per member.',
    s5Copy:
      'Rendered from the application options type the config entry is checked against, so the table and the real config surface cannot drift. Nested option bags render with dotted names; the type column is the declared type text.',
    headOption: 'Option',
    headOptionType: 'Type',
    headOptionRequired: 'Required',
    requiredLabel: 'required',
    optionalLabel: 'optional',
    footnote: (v: string) =>
      `※ Internal subpaths (router request pipeline, element hydration modules) stay importable for tooling but carry no compatibility promise. The public type surface is explicit — no export-star seams on the ${v} line.`,
    footnoteCheckPre: 'Generated from repository truth by ',
    footnoteCheckPost: " and machine-checked against each package's exports map.",
  },
  zh: {
    headTitle: 'API 参考',
    headDescription: `openElement 受支持的 API 面：${packageCount} 个面向使用者的包、全部记录在案的导出与 Custom Element，由仓库真值生成。`,
    pageTitle: 'API 参考',
    lede: (v: string) => `查阅 ${v} 的导入路径、签名和配置选项。`,
    s1Index: '01 / 接口规则',
    s1Title: '从路由和组件开始',
    s1Copy:
      '用 definePage 为页面函数设置路由选项。在组件函数旁用 defineIslandConfig 声明自定义元素的标签名和启用交互的时机。',
    s1Links: [
      { label: '编写页面和自定义元素', href: '/zh/guide/getting-started#写一个页面' },
      { label: '路由与数据', href: '/zh/guide/routing-and-data' },
    ],
    lookupLabel: '查找导出的符号',
    lookupExample: 'definePage',
    lookupHint: '输入名称（如 definePage），或选择一个包浏览其中的导出项。',
    lookupSubmit: '查找',
    keyboardHint:
      '用 Page Up 或 Page Down 翻页，用 ↑ 或 ↓ 选择导出项。按 Tab 进入长签名、说明或链接，用 ← 或 → 横向阅读签名，按 Esc 返回列表。打开“随页面滚动此列表”可用页面的滚动条浏览。',
    s2Index: '02 / 受支持的产品面',
    s2Title: `${packageCount} 个受支持的包`,
    s2Copy: '查看各个包的用途及受支持的导入路径。',
    headPackage: '包',
    headSubpaths: '受支持的子路径',
    headKind: '类别',
    railExports: '导出',
    railElements: '元素',
    railOptions: '配置选项',
    s3Index: '03 / 导出参考',
    s3Title: '导出的符号',
    s3Copy:
      '签名和路径取自上方标明的源码版本。常用条目提供中文说明，展开即可查阅英文源码摘要和参数选项。',
    changelogLabel: '在更新日志中查看已发布版本',
    headExport: '导出',
    headSummary: '摘要',
    headSource: '来源',
    s4Index: '04 / 元素参考',
    s4Title: '来自编译器 manifest 的 Custom Element。',
    s4Copy:
      '标签、层级、hydration 策略、属性、事件、插槽与 CSS parts 均来自 @openelement/ui 编译器 manifest——SSR/claim 管线校验所依据的同一份真值。',
    attributesLabel: '属性',
    eventsLabel: '事件',
    slotsLabel: '插槽',
    partsLabel: 'CSS parts',
    experimentalLabel: '实验性',
    s5Index: '05 / 配置选项',
    s5Title: '应用选项类型，逐成员一行。',
    s5Copy:
      '由配置入口所校验的应用选项类型渲染而成，因此这张表与真实配置面不可能漂移。嵌套选项组以点号路径呈现；类型列是声明的类型文本。',
    headOption: '选项',
    headOptionType: '类型',
    headOptionRequired: '是否必填',
    requiredLabel: '必填',
    optionalLabel: '可选',
    footnote: (v: string) =>
      `※ 内部子路径（router 请求管线、element hydration 模块）仍可被工具导入，但不携带兼容性承诺。公开类型面是显式的——${v} 线上没有 export-star 缝隙。`,
    footnoteCheckPre: '由 ',
    footnoteCheckPost: ' 从仓库真值生成，并对照每个包的 exports map 做机器校验。',
  },
} as const;

/** The page-reference class scopes rules in site-chrome.css. */
export function ReferencePage(props: {
  metadata: { breadcrumb: string; title: string; lede: string };
  railItems: Array<{ id: string; href: string; label: string; depth: string }>;
  s1Index: string;
  s1Title: string;
  s1Copy: string;
  s1Links: ReadonlyArray<{ label: string; href: string }>;
  lookupLabel: string;
  lookupExample: string;
  lookupHint: string;
  lookupSubmit: string;
  keyboardHint: string;
  jumpLinks: Array<{ label: string; href: string }>;
  s2Index: string;
  s2Title: string;
  s2Copy: string;
  headPackage: string;
  headSubpaths: string;
  headKind: string;
  footnote: string;
  footnoteCheckPre: string;
  footnoteCheckPost: string;
  packages: Array<{
    id: string;
    name: string;
    importPath: string;
    copy: string;
    note1: string;
    note2: string;
    note3: string;
    export1: string;
    export2: string;
    export3: string;
    export4: string;
    export5: string;
    kind: string;
    kindClass: string;
    kindLabel: string;
  }>;
  s3Index: string;
  s3Title: string;
  s3Copy: string;
  changelogLabel: string;
  changelogHref: string;
  headExport: string;
  headSummary: string;
  headSource: string;
  exportsHtml: TrustedHtml;
  s5Index: string;
  s5Title: string;
  s5Copy: string;
  headOption: string;
  headOptionType: string;
  headOptionRequired: string;
  configOptions: Array<{
    key: string;
    name: string;
    type: string;
    required: string;
    defaultValue: string;
    description: string;
  }>;
  s4Index: string;
  s4Title: string;
  s4Copy: string;
  elementEntries: Array<{
    key: string;
    anchor: string;
    tag: string;
    className: string;
    description: string;
    layer: string;
    hydrate: string;
    module: string;
    status: string;
    attributes: string;
    events: string;
    slots: string;
    cssParts: string;
    attributesLabel: string;
    eventsLabel: string;
    slotsLabel: string;
    partsLabel: string;
  }>;
  locale: string;
}) {
  return (
    // Without data-pagefind-body the page is absent from the index entirely:
    // pagefind stops indexing every page that lacks the attribute. The shell
    // already renders the one <main> landmark (#main-content).
    <div class='page-reference text-foreground' data-registry='reference' data-pagefind-body>
      <open-reading-shell meta rail footer metadata={props.metadata} locale={props.locale}>
        <div slot='rail'>
          <open-page-rail items={props.railItems} locale={props.locale}></open-page-rail>
        </div>
        <open-registry-lookup
          label={props.lookupLabel}
          example={props.lookupExample}
          submit={props.lookupSubmit}
          hint={props.lookupHint}
        ></open-registry-lookup>
        <div class='flex flex-wrap gap-x-4 gap-y-2'>
          {props.jumpLinks.map((link) => (
            <a
              class='text-sm text-primary underline underline-offset-4'
              href={link.href}
              key={link.href}
            >
              {link.label}
            </a>
          ))}
        </div>
        <open-section-frame>
          <span slot='index'>{props.s1Index}</span>
          <span slot='title'>{props.s1Title}</span>
          <span slot='copy'>
            {props.s1Copy}
            <span class='mt-2 flex flex-wrap gap-x-3 gap-y-1'>
              {props.s1Links.map((link) => (
                <a
                  class='text-primary no-underline hover:underline'
                  href={link.href}
                  key={link.href}
                >
                  {link.label}
                </a>
              ))}
            </span>
          </span>
        </open-section-frame>
        <open-section-frame>
          <span slot='index'>{props.s2Index}</span>
          <span slot='title'>{props.s2Title}</span>
          <span slot='copy'>{props.s2Copy}</span>
          <div class='border-t border-border'>
            {props.packages.map((pkg) => (
              <article class='pkg-card group' id={pkg.id} data-kind={pkg.kind} key={pkg.id}>
                <div class='pkg-card-head'>
                  <div class='min-w-0'>
                    <h3 class='pkg-card-name group-data-[kind=optional]:text-muted-foreground'>
                      {pkg.name}
                    </h3>
                    <span class='pkg-card-import'>{pkg.importPath}</span>
                  </div>
                  <span class={pkg.kindClass}>{pkg.kindLabel}</span>
                </div>
                <div class='pkg-card-chips'>
                  <span class='pkg-chip empty:hidden'>{pkg.export1}</span>
                  <span class='pkg-chip empty:hidden'>{pkg.export2}</span>
                  <span class='pkg-chip empty:hidden'>{pkg.export3}</span>
                  <span class='pkg-chip empty:hidden'>{pkg.export4}</span>
                  <span class='pkg-chip empty:hidden'>{pkg.export5}</span>
                </div>
                <p class='pkg-card-copy'>{pkg.copy}</p>
                <span class='pkg-card-note empty:hidden'>{pkg.note1}</span>
                <span class='pkg-card-note empty:hidden'>{pkg.note2}</span>
                <span class='pkg-card-note empty:hidden'>{pkg.note3}</span>
              </article>
            ))}
            <footer class='pt-6 text-(length:--text-xs) leading-normal text-muted-foreground'>
              <p class='m-0'>{props.footnote}</p>
              <p class='mt-3 mb-0'>
                {props.footnoteCheckPre}
                <code class='text-primary'>pnpm --dir tools/repo run interface:snapshot</code>
                {props.footnoteCheckPost}
              </p>
            </footer>
          </div>
        </open-section-frame>
        <open-section-frame>
          <span slot='index'>{props.s3Index}</span>
          <span slot='title'>{props.s3Title}</span>
          <span slot='copy'>
            {props.s3Copy}{' '}
            <a class='text-primary underline underline-offset-4' href={props.changelogHref}>
              {props.changelogLabel}
            </a>
          </span>
          <div class='border-t border-border' id='api-reference'>
            <p id='export-keyboard-hint' class='mb-4 max-w-[66ch] text-sm text-muted-foreground'>
              {props.keyboardHint}
            </p>
            <div class='ref-groups' innerHTML={props.exportsHtml} trustedHtml></div>
          </div>
        </open-section-frame>
        <open-section-frame>
          <span slot='index'>{props.s5Index}</span>
          <span slot='title'>{props.s5Title}</span>
          <span slot='copy'>{props.s5Copy}</span>
          <div class='border-t border-border' id='config-options'>
            <div
              class='hidden grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_auto] items-start gap-[clamp(1rem,4vw,3rem)] border-b border-border py-3 text-(length:--font-size-micro) font-bold tracking-[0.18em] text-muted-foreground uppercase min-[1101px]:grid'
              aria-hidden='true'
            >
              <span>{props.headOption}</span>
              <span>{props.headOptionType}</span>
              <span>{props.headOptionRequired}</span>
            </div>
            {props.configOptions.map((option) => (
              <div
                class='grid grid-cols-[minmax(0,1fr)] items-start gap-2 border-b border-border py-4 min-[1101px]:grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)_minmax(0,1.2fr)] min-[1101px]:gap-[clamp(1rem,4vw,3rem)]'
                id={option.key}
                key={option.key}
              >
                <div>
                  <span class='inline text-primary font-mono text-(length:--text-base) font-bold wrap-anywhere'>
                    {option.name}
                  </span>
                  <span class='mt-1 block text-(length:--text-xs) text-muted-foreground wrap-anywhere'>
                    {option.defaultValue}
                  </span>
                </div>
                <div>
                  <code class='mt-2 block font-mono text-(length:--text-xs) leading-snug text-primary wrap-anywhere'>
                    {option.type}
                  </code>
                  <p class='m-0 text-(length:--text-sm) leading-normal text-muted-foreground wrap-anywhere'>
                    {option.description}
                  </p>
                </div>
                <span class='font-mono text-(length:--text-xs) text-muted-foreground wrap-anywhere'>
                  {option.required}
                </span>
              </div>
            ))}
          </div>
        </open-section-frame>
        <open-section-frame>
          <span slot='index'>{props.s4Index}</span>
          <span slot='title'>{props.s4Title}</span>
          <span slot='copy'>{props.s4Copy}</span>
          <div class='border-t border-border' id='element-reference'>
            {props.elementEntries.map((element) => (
              // Compiled list-Block grammar (OEC9013): item children are
              // static text, {element.<field>} values or intrinsic elements —
              // no conditional JSX. Stable rows carry status:'' and the
              // `empty:hidden` utility on the status chip hides it.
              <div
                class='grid grid-cols-[minmax(0,1fr)] items-start gap-2 border-b border-border py-4 min-[1101px]:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)] min-[1101px]:gap-[clamp(1rem,4vw,3rem)]'
                id={element.anchor}
                key={element.key}
              >
                <div>
                  <span class='inline text-primary font-mono text-(length:--text-base) font-bold wrap-anywhere'>
                    {element.tag}
                  </span>
                  <span class='mt-1 block text-(length:--text-xs) text-muted-foreground wrap-anywhere'>
                    {element.className}
                  </span>
                  <span class='me-1 rounded-md bg-border px-2 py-1 text-(length:--text-xs) text-primary empty:hidden'>
                    {element.layer}
                  </span>
                  <span class='me-1 rounded-md bg-border px-2 py-1 text-(length:--text-xs) text-primary empty:hidden'>
                    {element.hydrate}
                  </span>
                  <span class='me-1 rounded-md bg-transparent px-2 py-1 text-(length:--text-xs) text-primary empty:hidden shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-ring)_55%,transparent)]'>
                    {element.status}
                  </span>
                </div>
                <p class='m-0 text-(length:--text-sm) leading-normal text-muted-foreground'>
                  {element.description}
                </p>
                <span class='font-mono text-(length:--text-xs) text-muted-foreground wrap-anywhere'>
                  {element.module}
                </span>
                <div class='col-span-full grid gap-2'>
                  <span class='block text-(length:--text-xs) leading-normal text-muted-foreground wrap-anywhere'>
                    <b class='me-2 font-bold tracking-[0.08em] text-muted-foreground uppercase'>
                      {element.attributesLabel}
                    </b>
                    {element.attributes}
                  </span>
                  <span class='block text-(length:--text-xs) leading-normal text-muted-foreground wrap-anywhere'>
                    <b class='me-2 font-bold tracking-[0.08em] text-muted-foreground uppercase'>
                      {element.eventsLabel}
                    </b>
                    {element.events}
                  </span>
                  <span class='block text-(length:--text-xs) leading-normal text-muted-foreground wrap-anywhere'>
                    <b class='me-2 font-bold tracking-[0.08em] text-muted-foreground uppercase'>
                      {element.slotsLabel}
                    </b>
                    {element.slots}
                  </span>
                  <span class='block text-(length:--text-xs) leading-normal text-muted-foreground wrap-anywhere'>
                    <b class='me-2 font-bold tracking-[0.08em] text-muted-foreground uppercase'>
                      {element.partsLabel}
                    </b>
                    {element.cssParts}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </open-section-frame>
      </open-reading-shell>
    </div>
  );
}

export default definePage(ReferencePage, {
  head({ locale }) {
    const resolved = contentLocale(locale ?? 'en');
    const copy = content[resolved];
    return siteHead({
      route: '/reference',
      locale: resolved,
      title: copy.headTitle,
      description: copy.headDescription,
    });
  },
  props({ locale }) {
    const resolved: Locale = contentLocale(locale ?? 'en');
    const t = content[resolved];
    const kinds = kindLabels[resolved];
    const packages = projectPackages();
    const projectPackage = (pkg: (typeof packages)[number]): ApiPackageItem => {
      const chips = subpathChips(pkg.supportedSubpaths);
      const internal = new Set(pkg.internalSubpaths);
      const chip = (index: number): string => {
        const label = chips[index] ?? '';
        return label && internal.has(label === 'root' ? '.' : label) ? `${label}※` : label;
      };
      return {
        id: pkg.id,
        name: pkg.name,
        importPath: pkg.importPath,
        copy: pkg.authored.copy[resolved],
        note1: pkg.authored.notes[resolved][0] ?? '',
        note2: pkg.authored.notes[resolved][1] ?? '',
        note3: pkg.authored.notes[resolved][2] ?? '',
        export1: chip(0),
        export2: chip(1),
        export3: chip(2),
        export4: chip(3),
        export5: chip(4),
        kind: pkg.authored.kind,
        kindClass: `kind kind-${pkg.authored.kind}`,
        kindLabel: kinds[pkg.authored.kind],
      };
    };
    return {
      metadata: {
        breadcrumb: resolved === 'zh' ? '参考' : 'Reference',
        title: t.pageTitle,
        lede: t.lede(sourceLineStamp(resolved)),
      },
      railItems: [
        ...packages.map((pkg) => ({
          id: pkg.id,
          href: `#${pkg.id}`,
          label: pkg.name,
          depth: '3',
        })),
        { id: 'api-reference', href: '#api-reference', label: t.railExports, depth: '3' },
        { id: 'config-options', href: '#config-options', label: t.railOptions, depth: '3' },
        { id: 'element-reference', href: '#element-reference', label: t.railElements, depth: '3' },
      ],
      s1Index: t.s1Index,
      s1Title: t.s1Title,
      s1Copy: t.s1Copy,
      s1Links: t.s1Links.map((link) => ({ ...link, href: normalizeSiteHref(link.href) })),
      lookupLabel: t.lookupLabel,
      lookupExample: t.lookupExample,
      lookupHint: t.lookupHint,
      lookupSubmit: t.lookupSubmit,
      keyboardHint: t.keyboardHint,
      jumpLinks: [
        { label: t.railExports, href: '#api-reference' },
        { label: t.railOptions, href: '#config-options' },
        { label: t.railElements, href: '#element-reference' },
      ],
      s2Index: t.s2Index,
      s2Title: t.s2Title,
      s2Copy: t.s2Copy,
      headPackage: t.headPackage,
      headSubpaths: t.headSubpaths,
      headKind: t.headKind,
      footnote: t.footnote(OPENELEMENT_VERSION),
      footnoteCheckPre: t.footnoteCheckPre,
      footnoteCheckPost: t.footnoteCheckPost,
      packages: packages.map(projectPackage),
      s3Index: t.s3Index,
      s3Title: t.s3Title,
      s3Copy: t.s3Copy,
      changelogLabel: t.changelogLabel,
      changelogHref: siteHref('/changelog', resolved),
      headExport: t.headExport,
      headSummary: t.headSummary,
      headSource: t.headSource,
      exportsHtml: trustedHtml(
        renderReferenceGroupsHtml(resolved, t.requiredLabel, t.optionalLabel),
      ),
      s5Index: t.s5Index,
      s5Title: t.s5Title,
      s5Copy: t.s5Copy,
      headOption: t.headOption,
      headOptionType: t.headOptionType,
      headOptionRequired: t.headOptionRequired,
      configOptions: projectConfigOptions(t.requiredLabel, t.optionalLabel),
      s4Index: t.s4Index,
      s4Title: t.s4Title,
      s4Copy: t.s4Copy,
      elementEntries: projectElementEntries({
        attributes: t.attributesLabel,
        events: t.eventsLabel,
        slots: t.slotsLabel,
        parts: t.partsLabel,
        experimental: t.experimentalLabel,
      }),
      locale: resolved,
    };
  },
});
