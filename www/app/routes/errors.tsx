/** The diagnostics registry projects the generated compiler and runtime code lists. */
import { definePage } from '@openelement/router';
import { recoveryFor, recoveryGuides } from '#site-ui/error-recovery.ts';
import { siteHead } from '#site-ui/head.ts';
import { contentLocale } from '#site-ui/locale.ts';
import { siteHref } from '#site-ui/site-url.ts';
import '#site-ui/open-reading-shell.tsx';
import '../islands/open-page-rail.tsx';
import '../islands/open-registry-lookup.tsx';
import { errorCodes } from '../data/_generated-error-codes.ts';
import { sourceLineStamp } from '../data/version.ts';

export const meta = { section: 'Reference', label: 'Error codes', order: 6 };

const compilerGrammarPrefix = 'OEC90';

const content = {
  en: {
    title: 'Error codes',
    headDescription: 'Look up openElement compiler diagnostics and runtime error codes.',
    breadcrumb: 'Reference',
    lede: (version: string) =>
      `Paste a code or a line from your build or runtime log. This registry documents the ${version} source.`,
    lookupLabel: 'Find an error code',
    lookupSubmit: 'Go to code',
    compilerTitle: 'Compiler diagnostics',
    compilerHelp:
      'Start with the first error that names a source file. Use its file, line, column, and full message to locate the failing code. The diagnostic envelope also includes a hint when the producer provides one.',
    runtimeTitle: 'Runtime and framework error codes',
    runtimeHelp:
      'Use the full message and stack trace to find the failing call. The source declaration identifies the code. The check below points to the affected part of the framework.',
    messageLabel: 'What it means',
    sourceSummaryLabel: '',
    grammarLabel: 'Compiler grammar',
    detailsLabel: 'Message variants and source locations',
    sourceDetailsLabel: 'Compiler source locations',
    locationsLabel: 'Locations in the source checkout',
    nextStepLabel: 'What to check',
    declarationLabel: 'Source declaration on GitHub',
    lookupAgain: 'Back to error lookup',
  },
  zh: {
    title: '错误码',
    headDescription: '查询 openElement 的编译器诊断和运行时错误码。',
    breadcrumb: '参考',
    lede: (version: string) => `粘贴错误码或一行构建或运行时日志。本清单对应源码版本 ${version}。`,
    lookupLabel: '查找错误码',
    lookupSubmit: '跳到错误码',
    compilerTitle: '编译器诊断',
    compilerHelp:
      '先查看第一条标明源文件的错误。根据文件、行列和完整消息定位出错的代码。若诊断的生成方提供了提示，诊断信封也会包含该提示。',
    runtimeTitle: '运行时和框架错误码',
    runtimeHelp: '根据完整消息和堆栈定位失败的调用。部分源码摘要保留英文，每条均附有中文检查步骤。',
    messageLabel: '含义',
    sourceSummaryLabel: '英文源码摘要',
    grammarLabel: '编译器语法',
    detailsLabel: '英文消息变体和源码位置',
    sourceDetailsLabel: '编译器源码位置',
    locationsLabel: '源码检出中的位置',
    nextStepLabel: '检查步骤',
    declarationLabel: '在 GitHub 查看源码声明',
    lookupAgain: '返回错误码查找',
  },
} as const;

export function PageErrors(props: {
  metadata: { breadcrumb: string; title: string; lede: string };
  railItems: Array<{ id: string; href: string; label: string; depth: string }>;
  locale: string;
  lookupLabel: string;
  lookupSubmit: string;
  lookupExample: string;
  compilerTitle: string;
  compilerHelp: string;
  runtimeTitle: string;
  runtimeHelp: string;
  handlingHref: string;
  handlingLink: string;
  diagnostics: Array<{
    code: string;
    anchor: string;
    message: string;
    variants: string;
    sites: string;
    family: string;
    messageLabel: string;
    messageLang: string;
    nextStep: string;
    nextStepLabel: string;
    guideHref: string;
    guideLabel: string;
    detailsLabel: string;
    locationsLabel: string;
  }>;
  runtimeCodes: Array<{
    code: string;
    anchor: string;
    constant: string;
    description: string;
    descriptionLang: string;
    descriptionHidden: boolean;
    sourceSummaryLabel: string;
    sourceSummaryHidden: boolean;
    declarationHref: string;
    declarationLabel: string;
    lookupAgain: string;
    nextStep: string;
    nextStepLabel: string;
    guideHref: string;
    guideLabel: string;
  }>;
}) {
  return (
    <div class='page-errors text-foreground' data-registry='errors' data-pagefind-body>
      <open-reading-shell meta rail metadata={props.metadata} locale={props.locale}>
        <div slot='rail'>
          <open-page-rail items={props.railItems} locale={props.locale}></open-page-rail>
        </div>
        <div id='error-lookup' class='scroll-mt-[calc(var(--nav-height)+1rem)]' tabindex='-1'>
          <open-registry-lookup
            label={props.lookupLabel}
            example={props.lookupExample}
            submit={props.lookupSubmit}
          ></open-registry-lookup>
          <p class='mt-0 mb-8 text-sm'>
            <a class='text-primary underline underline-offset-4' href={props.handlingHref}>
              {props.handlingLink}
            </a>
          </p>
        </div>
        <section
          id='error-codes'
          class='mb-12 scroll-mt-[calc(var(--nav-height)+1rem)]'
          aria-labelledby='compiler-codes-heading'
        >
          <h2 id='compiler-codes-heading' class='m-0 text-2xl font-bold'>
            {props.compilerTitle}
          </h2>
          <p class='mt-2 mb-4 max-w-[68ch] text-sm text-muted-foreground'>{props.compilerHelp}</p>
          {props.diagnostics.map((code) => (
            <article
              id={code.code}
              data-lookup-label={code.code}
              tabindex='-1'
              class='scroll-mt-[calc(var(--nav-height)+1rem)] border-t border-border py-4 outline-offset-4 target:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring'
              key={code.code}
            >
              <h3 class='m-0 font-mono text-base font-bold wrap-anywhere'>
                <a class='text-primary underline underline-offset-4' href={code.anchor}>
                  {code.code}
                </a>
              </h3>
              <p class='mt-1 mb-0 text-xs text-muted-foreground empty:hidden'>{code.family}</p>
              <dl class='my-2 max-w-[68ch] text-sm wrap-anywhere has-[dd:empty]:hidden'>
                <dt class='font-semibold'>{code.messageLabel}</dt>
                <dd class='m-0 text-muted-foreground' lang={code.messageLang}>
                  {code.message}
                </dd>
              </dl>
              <dl class='my-2 max-w-[68ch] text-sm wrap-anywhere has-[dd:empty]:hidden'>
                <dt class='font-semibold'>{code.nextStepLabel}</dt>
                <dd class='m-0 text-muted-foreground'>
                  <p class='m-0'>{code.nextStep}</p>
                  <a class='text-primary underline underline-offset-4' href={code.guideHref}>
                    {code.guideLabel}
                  </a>
                </dd>
              </dl>
              <details class='mt-2 text-sm wrap-anywhere'>
                <summary class='w-fit cursor-pointer py-1 text-primary'>
                  {code.detailsLabel}
                </summary>
                <p
                  class='mt-2 mb-0 whitespace-pre-line text-muted-foreground empty:hidden'
                  lang='en'
                >
                  {code.variants}
                </p>
                <dl class='mt-4 mb-0'>
                  <dt class='font-semibold'>{code.locationsLabel}</dt>
                  <dd class='m-0 font-mono text-xs whitespace-pre-line text-muted-foreground'>
                    {code.sites}
                  </dd>
                </dl>
              </details>
            </article>
          ))}
        </section>
        <section
          id='runtime-codes'
          class='scroll-mt-[calc(var(--nav-height)+1rem)]'
          aria-labelledby='runtime-codes-heading'
        >
          <h2 id='runtime-codes-heading' class='m-0 text-2xl font-bold'>
            {props.runtimeTitle}
          </h2>
          <p class='mt-2 mb-4 max-w-[68ch] text-sm text-muted-foreground'>{props.runtimeHelp}</p>
          {props.runtimeCodes.map((code) => (
            <article
              id={code.code}
              data-lookup-label={code.code}
              tabindex='-1'
              class='scroll-mt-[calc(var(--nav-height)+1rem)] border-t border-border py-4 outline-offset-4 target:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring'
              key={code.code}
            >
              <h3 class='m-0 font-mono text-base font-bold wrap-anywhere'>
                <a class='text-primary underline underline-offset-4' href={code.anchor}>
                  {code.code}
                </a>
              </h3>
              <p
                class='mt-2 mb-0 max-w-[68ch] text-sm text-muted-foreground'
                lang={code.descriptionLang}
                hidden={code.descriptionHidden}
              >
                <span
                  class='me-2 text-xs font-semibold whitespace-nowrap'
                  lang='zh'
                  data-source-summary-label
                  hidden={code.sourceSummaryHidden}
                >
                  {code.sourceSummaryLabel}
                </span>
                {code.description}
              </p>
              <dl class='my-2 max-w-[68ch] text-sm wrap-anywhere has-[dd:empty]:hidden'>
                <dt class='font-semibold'>{code.nextStepLabel}</dt>
                <dd class='m-0 text-muted-foreground'>
                  <p class='m-0'>{code.nextStep}</p>
                  <a class='text-primary underline underline-offset-4' href={code.guideHref}>
                    {code.guideLabel}
                  </a>
                </dd>
              </dl>
              <p class='mt-2 mb-0 font-mono text-xs text-muted-foreground wrap-anywhere'>
                {code.constant}
              </p>
              <p class='mt-2 mb-0 flex flex-wrap gap-x-4 gap-y-1 text-sm'>
                <a class='text-primary underline underline-offset-4' href={code.declarationHref}>
                  {code.declarationLabel}
                </a>
                <a class='text-primary underline underline-offset-4' href='#error-lookup'>
                  {code.lookupAgain}
                </a>
              </p>
            </article>
          ))}
        </section>
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
      title: copy.title,
      description: copy.headDescription,
    });
  },
  props({ locale }) {
    const resolved = contentLocale(locale ?? 'en');
    const copy = content[resolved];
    return {
      ...copy,
      lookupExample: `[${errorCodes.diagnostics[0]?.code ?? ''}]`,
      metadata: {
        breadcrumb: copy.breadcrumb,
        title: copy.title,
        lede: copy.lede(sourceLineStamp(resolved)),
      },
      railItems: [
        { id: 'error-codes', href: '#error-codes', label: copy.compilerTitle, depth: '3' },
        { id: 'runtime-codes', href: '#runtime-codes', label: copy.runtimeTitle, depth: '3' },
      ],
      diagnostics: errorCodes.diagnostics.map((record) => {
        // The parser passes through a TypeScript message specific to the input.
        // Generated source excerpts for this code are expressions, not messages.
        const fromTypeScriptParser = record.occurrences.some(
          (site) =>
            site.path.endsWith('/semantic-core/compiler-diagnostics.ts') &&
            site.message === 'diagnosticMessage(…)',
        );
        const help = recoveryFor(record.code, 'compiler', resolved);
        const variants = fromTypeScriptParser ? '' : record.messages.join('\n');
        return {
          code: record.code,
          anchor: `#${record.code}`,
          message: help.meaning || record.summary,
          messageLabel: help.meaning
            ? copy.messageLabel
            : copy.sourceSummaryLabel || copy.messageLabel,
          messageLang: help.meaning ? resolved : 'en',
          nextStep: help.nextStep,
          nextStepLabel: copy.nextStepLabel,
          guideHref: siteHref(help.guide.href, resolved),
          guideLabel: help.guide.label,
          detailsLabel: variants ? copy.detailsLabel : copy.sourceDetailsLabel,
          locationsLabel: copy.locationsLabel,
          variants,
          sites: record.occurrences.map((site) => `${site.path}:${site.line}`).join('\n'),
          family: record.code.startsWith(compilerGrammarPrefix) ? copy.grammarLabel : '',
        };
      }),
      runtimeCodes: errorCodes.runtime.map((record) => {
        const help = recoveryFor(record.value, record.family, resolved);
        const description = help.meaning || record.summary.replaceAll('`', '');
        const showSourceSummary = resolved === 'zh' && !help.meaning && !!description;
        return {
          code: record.value,
          anchor: `#${record.value}`,
          constant: `${record.family}.${record.name}`,
          description,
          descriptionLang: help.meaning ? resolved : 'en',
          descriptionHidden: !description,
          sourceSummaryLabel: showSourceSummary ? copy.sourceSummaryLabel : '',
          sourceSummaryHidden: !showSourceSummary,
          declarationHref: `https://github.com/open-element/openelement/blob/main/${record.path}#L${record.line}`,
          declarationLabel: copy.declarationLabel,
          lookupAgain: copy.lookupAgain,
          nextStep: help.nextStep,
          nextStepLabel: copy.nextStepLabel,
          guideHref: siteHref(help.guide.href, resolved),
          guideLabel: help.guide.label,
        };
      }),
      handlingHref: siteHref(recoveryGuides.envelope[resolved].href, resolved),
      handlingLink: recoveryGuides.envelope[resolved].label,
      locale: resolved,
    };
  },
});
