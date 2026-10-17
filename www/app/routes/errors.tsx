/**
 * Error-code reference route (#1414).
 *
 * The table below is a DERIVED artifact (P6): every row is projected from
 * www/app/data/_generated-error-codes.ts, which is rendered from the OEC code
 * literals in packages/<name>/src and the ErrorCode constants in
 * packages/protocol/src/errors.ts. A code the source raises
 * therefore cannot be missing here, and the page cannot restate a code the
 * source no longer has — `www#check:error-codes` (gate:source) fails on drift.
 * Only the surrounding prose is authored.
 */
import { definePage } from '@openelement/router';
import { siteHead } from '#site-ui/head.ts';
import { contentLocale } from '#site-ui/locale.ts';
import '#site-ui/open-reading-shell.tsx';
import '../site-ui/open-section-frame.tsx';
import '../islands/open-page-rail.tsx';
import type { SiteLocale } from '../../site-config.ts';
import { errorCodes } from '../data/_generated-error-codes.ts';
import { sourceLineStamp } from '../data/version.ts';

export const meta = { section: 'Reference', label: 'Error codes', order: 6 };

type Locale = SiteLocale;

/** One diagnostic code row, projected from the generated inventory. */
export interface ErrorCodeItem {
  key: string;
  code: string;
  family: string;
  gloss: string;
  /** Every distinct normalized message the code raises, joined for display. */
  variants: string;
  /** `path:line` of every source call site, joined for display. */
  sites: string;
  runtime: string;
}

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
 * fields are strings: the compiled list Block admits `{item.<field>}` values
 * and elements, not a nested list Block, so the multi-value columns are
 * joined here (the generator already sorted them deterministically).
 */
function projectCodes(locale: Locale): ErrorCodeItem[] {
  const t = content[locale];
  return errorCodes.diagnostics.map((record) => ({
    key: record.code,
    code: record.code,
    family: t.family(record.code, locale),
    gloss: record.summary,
    variants:
      record.messages.length > 1
        ? `${t.variantsLabel(record.messages.length)}: ${record.messages.join(' · ')}`
        : '',
    sites: record.occurrences.map((site) => `${site.path}:${site.line}`).join(' · '),
    runtime: 'false',
  }));
}

/**
 * The error-code reference as a server function page (alpha15 server
 * architecture): the route module's own exported TSX function, lowered by the
 * compiler into a generative HTML constructor. The nested `open-reading-shell`
 * / `open-page-rail` / `open-section-frame` hosts are build-admitted compiled
 * components, so they expand through `__ssr` with their slot children — the
 * same composition the retired class form produced. The page hook class
 * (`page-errors`) is the former component's scoping hook (www/site-chrome.css).
 */
export function PageErrors(props: {
  metadata: { breadcrumb: string; title: string; lede: string };
  railItems: Array<{ id: string; href: string; label: string; depth: string }>;
  locale: string;
  s1Index: string;
  s1Title: string;
  s1Copy: string;
  headCode: string;
  headGloss: string;
  headSites: string;
  codes: Array<{
    key: string;
    code: string;
    family: string;
    gloss: string;
    variants: string;
    sites: string;
    runtime: string;
  }>;
  footnote: string;
  footnoteCheckPre: string;
  footnoteCheckPost: string;
}) {
  return (
    // Without data-pagefind-body the page is absent from the index entirely:
    // pagefind stops indexing every page that lacks the attribute. The shell
    // already renders the one <main> landmark (#main-content).
    <div class='page-errors text-foreground' data-pagefind-body>
      <open-reading-shell rail footer metadata={props.metadata} locale={props.locale}>
        <div slot='rail'>
          <open-page-rail items={props.railItems} locale={props.locale}></open-page-rail>
        </div>
        <open-section-frame>
          <span slot='index'>{props.s1Index}</span>
          <span slot='title'>{props.s1Title}</span>
          <span slot='copy'>{props.s1Copy}</span>
          <div class='border-t border-border' id='error-codes'>
            <div
              class='grid grid-cols-[minmax(0,0.35fr)_minmax(0,1.4fr)_minmax(0,1.25fr)] items-start gap-[clamp(1rem,4vw,3rem)] border-b border-border py-3 text-(length:--font-size-micro) font-bold tracking-[0.18em] text-muted-foreground uppercase max-[1100px]:hidden'
              aria-hidden='true'
            >
              <span>{props.headCode}</span>
              <span>{props.headGloss}</span>
              <span>{props.headSites}</span>
            </div>
            {props.codes.map((code) => (
              <div
                class='grid grid-cols-[minmax(0,0.35fr)_minmax(0,1.4fr)_minmax(0,1.25fr)] items-start gap-[clamp(1rem,4vw,3rem)] border-b border-border py-4 data-[runtime=true]:bg-border/45 max-[1100px]:grid-cols-[minmax(0,1fr)] max-[1100px]:gap-2'
                id={code.code}
                data-runtime={code.runtime}
                key={code.key}
              >
                <div>
                  <span class='inline font-mono text-base font-bold text-primary wrap-anywhere'>
                    {code.code}
                  </span>
                  <span class='mt-1 block text-xs text-muted-foreground wrap-anywhere'>
                    {code.family}
                  </span>
                </div>
                <div>
                  <p class='m-0 text-sm leading-normal text-muted-foreground wrap-anywhere'>
                    {code.gloss}
                  </p>
                  <p class='m-0 text-xs leading-normal text-muted-foreground wrap-anywhere'>
                    {code.variants}
                  </p>
                </div>
                <span class='font-mono text-xs leading-normal text-muted-foreground wrap-anywhere'>
                  {code.sites}
                </span>
              </div>
            ))}
            <footer class='pt-6 text-xs leading-normal text-muted-foreground'>
              <p class='m-0'>{props.footnote}</p>
              <p class='mt-3 mb-0'>
                {props.footnoteCheckPre}
                <code class='text-primary'>pnpm --dir www run check:error-codes</code>
                {props.footnoteCheckPost}
              </p>
            </footer>
          </div>
        </open-section-frame>
      </open-reading-shell>
    </div>
  );
}

export default definePage(PageErrors, {
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
