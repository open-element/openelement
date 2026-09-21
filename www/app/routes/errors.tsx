/**
 * `/errors` — the generated error-code reference (#1413 W3).
 *
 * The table is derived, never authored: `www/tools/generate-error-reference.ts`
 * reads every diagnostic code out of the compiler's own `fail(…, 'OEC9xxx', …)`
 * literals plus the element/router error-code maps, and the CI gate
 * (`www#check:errors`, wired into `gate:source`) fails when the generated
 * module drifts or when the source carries a code the catalog does not list.
 * This route only localizes the page chrome and projects the generated rows.
 */
import { definePage } from '@openelement/router';
import { siteHead } from '@openelement/site-ui/head.ts';
import { contentLocale } from '@openelement/site-ui/locale.ts';
import { errorReference } from '../data/_generated-error-reference.ts';
import ErrorsPage, { type ErrorCodeItem } from '../components/page-errors.tsx';

export const meta = { section: 'Reference', label: 'Error Codes', order: 6 };

/** Generated truth: the catalog's own size, never a hand-written number. */
const codeCount = errorReference.codes.length;

type Locale = 'en' | 'zh';

const content = {
  en: {
    headTitle: 'Error Codes',
    headDescription:
      `Every openElement diagnostic code — ${codeCount} codes across the compiler, the authoring API and the runtime — with its phase, severity, representative message and the source that defines it. Generated from the diagnostic definitions; a code in source but not here fails CI.`,
    pageTitle: 'Error Codes',
    lede:
      'One table for every code the framework can raise. Codes are derived from the definitions, so this page cannot drift from the source without failing the build.',
    s1Index: '01 / code table',
    s1Title: 'Every code, classified.',
    s1Copy:
      'Phase names where the failure happens (build, validation, render, ssr); severity separates a hard failure from a reported one. Compiler codes are extracted from the semantic core\u2019s diagnostic call sites; authoring and runtime codes come from the constant maps their throws use. Template placeholders render as \u2026, because the per-site value is data, not part of the definition.',
    headCode: 'Code',
    headFamily: 'Family',
    headPhase: 'Phase',
    headSeverity: 'Severity',
    headMessage: 'Representative message',
    headSource: 'Defined at',
    headSites: 'Sites',
    countLabel: (count: number) => `${count} codes`,
    s2Index: '02 / how to read this',
    s2Title: 'The table is an artifact, not a document.',
    s2Copy: 'Three properties make it trustworthy.',
    footnote: [
      'Generated, never typed. A new diagnostic code lands here first, because the catalog is built from the definitions; hand-writing a row would make the generator stale and the check red.',
      'The enforceable direction is source → catalog. A code the compiler can raise but the catalog does not list fails CI. A catalogued code whose raising site has not landed yet is the documented-first state, and is not a failure.',
      'Phase and severity are derived, not annotated. A code whose family cannot be classified stops the generator instead of shipping with an empty classification column.',
    ],
  },
  zh: {
    headTitle: '错误码',
    headDescription:
      `openElement 的全部诊断码——编译器、创作 API 与运行时共 ${codeCount} 个——含阶段、严重级别、代表性消息与定义它的源码位置。本页由诊断定义生成；源码中有而此处没有的码会让 CI 直接失败。`,
    pageTitle: '错误码',
    lede:
      '框架能抛出的每个码都在这一张表里。表由定义派生，因此在构建失败之前，本页不可能与源码脱节。',
    s1Index: '01 / 码表',
    s1Title: '每一个码，都有分类。',
    s1Copy:
      'phase 指明失败发生的阶段（build、validation、render、ssr）；severity 区分硬失败与已上报的失败。编译器码从语义核心的诊断调用点提取；创作与运行时码来自各自抛错所用的常量表。模板占位符渲染为 \u2026，因为每处的具体取值是数据，不属于定义本身。',
    headCode: '码',
    headFamily: '归属',
    headPhase: '阶段',
    headSeverity: '级别',
    headMessage: '代表性消息',
    headSource: '定义位置',
    headSites: '出现处',
    countLabel: (count: number) => `${count} 个码`,
    s2Index: '02 / 如何阅读',
    s2Title: '这张表是产物，不是文档。',
    s2Copy: '三点让它值得信任。',
    footnote: [
      '生成，绝不手写。新的诊断码会先出现在这里，因为码表由定义构建；手写一行会让生成器过期，检查随即变红。',
      '可执行的方向是「源码 → 码表」。编译器能抛出、而码表未列出的码会让 CI 失败；已登记但抛错点尚未落地的码属于「先文档后实现」，不算失败。',
      'phase 与 severity 是派生的，不是注解。归属无法分类的码会让生成器直接停止，而不是带着空分类列上线。',
    ],
  },
} as const;

export default definePage(ErrorsPage, {
  head({ locale }) {
    const resolved = contentLocale(locale ?? 'en');
    const copy = content[resolved];
    return siteHead({
      route: '/errors',
      locale: resolved,
      title: copy.headTitle,
      description: copy.headDescription,
    });
  },
  props({ locale }) {
    const resolved: Locale = contentLocale(locale ?? 'en');
    const t = content[resolved];
    const codes: ErrorCodeItem[] = errorReference.codes.map((record) => ({
      key: record.anchor,
      anchor: record.anchor,
      code: record.code,
      family: record.family,
      familyClass: 'family',
      phase: record.phase,
      severity: record.severity,
      severityClass: `severity severity-${record.severity}`,
      message: record.message,
      source: record.source.line > 0
        ? `${record.source.path}:${record.source.line}`
        : record.source.path,
      occurrences: String(record.occurrences),
    }));
    return {
      metadata: {
        breadcrumb: 'Reference',
        title: t.pageTitle,
        lede: t.lede,
      },
      railItems: [
        { id: 'error-table', href: '#error-table', label: t.s1Title, depth: '2' },
        { id: 'how-to-read', href: '#how-to-read', label: t.s2Title, depth: '2' },
      ],
      s1Index: t.s1Index,
      s1Title: t.s1Title,
      s1Copy: t.s1Copy,
      headCode: t.headCode,
      headFamily: t.headFamily,
      headPhase: t.headPhase,
      headSeverity: t.headSeverity,
      headMessage: t.headMessage,
      headSource: t.headSource,
      headSites: t.headSites,
      codeCount: t.countLabel(codeCount),
      s2Index: t.s2Index,
      s2Title: t.s2Title,
      s2Copy: t.s2Copy,
      footnote: t.footnote.map((value, index) => ({ key: `note-${index}`, value })),
      codes,
    };
  },
});
