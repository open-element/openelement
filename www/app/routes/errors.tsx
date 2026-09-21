/**
 * Error-code reference route (#1414).
 *
 * The table below is a DERIVED artifact (P6): every row is projected from
 * www/app/data/_generated-error-codes.ts, which is rendered from the OEC code
 * literals in packages/<name>/src and the ErrorCode constants in
 * packages/element/src/internal/protocol/errors.ts. A code the source raises
 * therefore cannot be missing here, and the page cannot restate a code the
 * source no longer has — `www#check:error-codes` (gate:source) fails on drift.
 * Only the surrounding prose is authored.
 */
import { definePage } from '@openelement/router';
import { siteHead } from '@openelement/site-ui/head.ts';
import { contentLocale } from '@openelement/site-ui/locale.ts';
import { errorCodes } from '../data/_generated-error-codes.ts';
import { sourceLineStamp } from '../data/version.ts';
import ErrorsPage, { type ErrorCodeItem } from '../components/page-errors.tsx';

export const meta = { section: 'Reference', label: 'Error codes', order: 6 };

type Locale = 'en' | 'zh';

/**
 * The OEC code families, keyed by the numeric range each occupies. A range
 * with no codes fails the projection below, so a family cannot outlive its
 * codes in the copy.
 */
const families = [
  { prefix: 'OEC90', label: { en: 'compiler grammar', zh: '编译器语法' } },
] as const;

function familyOf(code: string, locale: Locale): string {
  for (const family of families) {
    if (code.startsWith(family.prefix)) return family.label[locale];
  }
  return locale === 'en' ? 'diagnostic' : '诊断';
}

const content = {
  en: {
    headTitle: 'Error codes',
    headDescription:
      'Every openElement error code, with the message each one raises and the exact source call sites — generated from the diagnostics themselves.',
    pageTitle: 'Error codes',
    lede: (v: string) =>
      `The ${v} surface raises ${errorCodes.diagnostics.length} OEC compiler diagnostics plus ${errorCodes.runtime.length} runtime codes. Every row below is rendered from the source that raises it.`,
    s1Index: '01 / code table',
    s1Title: 'The codes, and where they are raised.',
    s1Copy:
      'OEC90xx codes are compiler diagnostics: each one names a grammar rule the compiled element boundary enforces, and each row lists the exact source call sites the build produced it from. Runtime codes are the ErrorCode constants an application can branch on. A code cannot appear in the source without appearing here.',
    headCode: 'Code',
    headGloss: 'Representative message',
    headSites: 'Raised at',
    variantsLabel: (count: number) => `${count} distinct messages`,
    footnote:
      'The gloss is the message the code raises most often; a code with several call-site messages expands to the full list. Source paths are repository-relative.',
    footnoteCheckPre: 'Generated from the diagnostics by ',
    footnoteCheckPost: ', so a new code cannot ship unlisted and a retired one cannot stay listed.',
    family: familyOf,
  },
  zh: {
    headTitle: '错误码',
    headDescription:
      'openElement 的全部错误码：每个码触发的消息，以及它精确的源码调用点——由诊断本身生成。',
    pageTitle: '错误码',
    lede: (v: string) =>
      `${v} 面共有 ${errorCodes.diagnostics.length} 个 OEC 编译器诊断与 ${errorCodes.runtime.length} 个运行时错误码。下表每一行都由触发它的源码渲染而成。`,
    s1Index: '01 / 码表',
    s1Title: '错误码，以及它们被触发的位置。',
    s1Copy:
      'OEC90xx 系列是编译器诊断：每个码对应一条编译元素边界强制执行的语法规则，每一行列出构建产生它的确切源码调用点。运行时错误码是应用可以分支处理的 ErrorCode 常量。码不可能只出现在源码里而不出现在这里。',
    headCode: '错误码',
    headGloss: '代表性消息',
    headSites: '触发位置',
    variantsLabel: (count: number) => `${count} 条不同消息`,
    footnote:
      '摘要取该码触发次数最多的消息；调用点消息不唯一时会展开完整列表。源码路径均为仓库相对路径。',
    footnoteCheckPre: '由 ',
    footnoteCheckPost: ' 从诊断生成，因此新码无法不登记，退役的码也无法留在表上。',
    family: familyOf,
  },
} as const;

/**
 * Project the generated inventory onto the page's fixed row grammar. Row
 * fields are strings: the compiled list Region admits `{item.<field>}` values
 * and elements, not a nested list Region, so the multi-value columns are
 * joined here (the generator already sorted them deterministically).
 */
function projectCodes(locale: Locale): ErrorCodeItem[] {
  const t = content[locale];
  return errorCodes.diagnostics.map((record) => ({
    key: record.code,
    code: record.code,
    family: t.family(record.code, locale),
    gloss: record.summary,
    variants: record.messages.length > 1
      ? `${t.variantsLabel(record.messages.length)}: ${record.messages.join(' · ')}`
      : '',
    sites: record.occurrences.map((site) => `${site.path}:${site.line}`).join(' · '),
    runtime: 'false',
  }));
}

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
    // Runtime codes carry their own declared name/summary; they are projected
    // onto the same row grammar so a reader sees one table, not two.
    const runtimeRows: ErrorCodeItem[] = errorCodes.runtime.map((record) => ({
      key: record.value,
      code: record.value,
      family: resolved === 'en' ? 'runtime' : '运行时',
      gloss: record.summary,
      variants: '',
      sites: record.name,
      runtime: 'true',
    }));
    return {
      metadata: {
        breadcrumb: 'Reference',
        title: t.pageTitle,
        lede: t.lede(sourceLineStamp(resolved)),
      },
      railItems: [{ id: 'error-codes', href: '#error-codes', label: t.headCode, depth: '3' }],
      s1Index: t.s1Index,
      s1Title: t.s1Title,
      s1Copy: t.s1Copy,
      headCode: t.headCode,
      headGloss: t.headGloss,
      headSites: t.headSites,
      codes: [...projectCodes(resolved), ...runtimeRows],
      footnote: t.footnote,
      footnoteCheckPre: t.footnoteCheckPre,
      footnoteCheckPost: t.footnoteCheckPost,
    };
  },
});
