import { definePage } from '@openelement/router';
import { blogCopy, blogPath, formatBlogDate, siteUpdate } from '../../data/blog.ts';
import { siteHead } from '#site-ui/head.ts';
import { contentLocale } from '#site-ui/locale.ts';
import { siteHref } from '#site-ui/site-url.ts';

export function BlogSiteUpdatePage(props: {
  title: string;
  summary: string;
  docsTitle: string;
  docsCopy: string;
  docsLink: string;
  lookupTitle: string;
  referenceCopy: string;
  referenceLink: string;
  errorsCopy: string;
  errorsLink: string;
  themeTitle: string;
  themeCopy: string;
  blogLabel: string;
  backToBlog: string;
  blogHref: string;
  published: string;
  publishedLabel: string;
  docsHref: string;
  referenceHref: string;
  errorsHref: string;
}) {
  return (
    <article
      class='mx-auto w-full max-w-[44rem] px-5 pt-10 pb-20 sm:px-8 sm:pt-16'
      data-pagefind-body
    >
      <header class='border-b border-(--site-hairline) pb-5 sm:pb-6'>
        <a
          href={props.blogHref}
          class='inline-flex min-h-8 items-center text-sm text-(--site-muted) underline decoration-(--site-hairline-strong) underline-offset-4 hover:text-foreground hover:decoration-current max-sm:min-h-11 any-pointer-coarse:min-h-11'
          data-pagefind-ignore
        >
          {props.blogLabel}
        </a>
        <h1 class='mt-3 text-4xl leading-tight font-semibold tracking-[-0.03em] text-foreground sm:text-[2.75rem]'>
          {props.title}
        </h1>
        <p class='mt-4 text-base leading-relaxed text-(--site-ink-soft) sm:text-lg'>
          {props.summary}
        </p>
        <time
          datetime={props.published}
          class='mt-4 block font-mono text-sm tabular-nums text-(--site-muted)'
        >
          {props.publishedLabel}
        </time>
      </header>
      <div class='article-content mt-6'>
        <h2>{props.docsTitle}</h2>
        <p>{props.docsCopy}</p>
        <p>
          <a
            href={props.docsHref}
            class='inline-flex min-h-8 items-center max-sm:min-h-11 any-pointer-coarse:min-h-11'
          >
            {props.docsLink}
          </a>
        </p>
        <h2>{props.lookupTitle}</h2>
        <p>{props.referenceCopy}</p>
        <p>
          <a
            href={props.referenceHref}
            class='inline-flex min-h-8 items-center max-sm:min-h-11 any-pointer-coarse:min-h-11'
          >
            {props.referenceLink}
          </a>
        </p>
        <p>{props.errorsCopy}</p>
        <p>
          <a
            href={props.errorsHref}
            class='inline-flex min-h-8 items-center max-sm:min-h-11 any-pointer-coarse:min-h-11'
          >
            {props.errorsLink}
          </a>
        </p>
        <h2>{props.themeTitle}</h2>
        <p>{props.themeCopy}</p>
      </div>
      <footer class='mt-8 border-t border-(--site-hairline) pt-4' data-pagefind-ignore>
        <a
          href={props.blogHref}
          class='inline-flex min-h-8 items-center text-sm text-(--site-muted) underline decoration-(--site-hairline-strong) underline-offset-4 hover:text-foreground hover:decoration-current max-sm:min-h-11 any-pointer-coarse:min-h-11'
        >
          {props.backToBlog}
        </a>
      </footer>
    </article>
  );
}

export default definePage(BlogSiteUpdatePage, {
  head: ({ locale }) => {
    const article = siteUpdate[contentLocale(locale ?? 'en')];
    return siteHead({
      route: siteUpdate.path,
      locale,
      title: article.title,
      description: article.summary,
    });
  },
  props({ locale }) {
    const language = contentLocale(locale ?? 'en');
    return {
      ...siteUpdate[language],
      blogLabel: blogCopy[language].title,
      backToBlog: language === 'zh' ? '返回博客' : 'Back to Blog',
      blogHref: siteHref(blogPath, language),
      published: siteUpdate.published,
      publishedLabel: formatBlogDate(siteUpdate.published, language),
      docsHref: siteHref('/docs', language),
      referenceHref: siteHref('/reference', language),
      errorsHref: siteHref('/errors', language),
    };
  },
});
