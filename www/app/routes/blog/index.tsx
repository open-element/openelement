import { definePage } from '@openelement/router';
import { blogCopy, blogPath, formatBlogDate, siteUpdate } from '../../data/blog.ts';
import { siteHead } from '#site-ui/head.ts';
import { contentLocale } from '#site-ui/locale.ts';
import { siteHref } from '#site-ui/site-url.ts';

export function BlogIndexPage(props: {
  title: string;
  description: string;
  articleTitle: string;
  articleSummary: string;
  articleHref: string;
  published: string;
  publishedLabel: string;
  releaseNotes: string;
  releaseNotesHref: string;
}) {
  return (
    <section class='mx-auto w-full max-w-[49rem] px-5 pt-10 pb-20 sm:px-8 sm:pt-16'>
      <div data-pagefind-body>
        <header class='pb-8 sm:pb-11'>
          <h1 class='text-4xl leading-tight font-semibold tracking-[-0.03em] text-foreground sm:text-5xl'>
            {props.title}
          </h1>
          <p class='mt-4 max-w-[50ch] text-base leading-relaxed text-(--site-ink-soft)'>
            {props.description}
          </p>
        </header>
        <article
          class='grid gap-2 border-y border-(--site-hairline) py-6 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-6'
          data-pagefind-ignore
        >
          <time
            datetime={props.published}
            class='pt-1 font-mono text-sm tabular-nums text-(--site-muted)'
          >
            {props.publishedLabel}
          </time>
          <div>
            <h2 class='text-xl leading-tight font-semibold tracking-[-0.015em] text-foreground sm:text-2xl'>
              <a
                href={props.articleHref}
                class='inline-flex items-center underline decoration-(--site-hairline-strong) underline-offset-4 hover:decoration-current max-sm:min-h-11 any-pointer-coarse:min-h-11'
              >
                {props.articleTitle}
              </a>
            </h2>
            <p class='mt-2 max-w-[55ch] text-base leading-relaxed text-(--site-ink-soft)'>
              {props.articleSummary}
            </p>
          </div>
        </article>
      </div>
      <p class='mt-7 text-sm' data-pagefind-ignore>
        <a
          href={props.releaseNotesHref}
          class='inline-flex min-h-8 items-center text-foreground underline decoration-(--site-hairline-strong) underline-offset-4 hover:decoration-current max-sm:min-h-11 any-pointer-coarse:min-h-11'
        >
          {props.releaseNotes}
        </a>
      </p>
    </section>
  );
}

export default definePage(BlogIndexPage, {
  head: ({ locale }) => {
    const copy = blogCopy[contentLocale(locale ?? 'en')];
    return siteHead({ route: blogPath, locale, title: copy.title, description: copy.description });
  },
  props({ locale }) {
    const language = contentLocale(locale ?? 'en');
    const article = siteUpdate[language];
    return {
      ...blogCopy[language],
      articleTitle: article.title,
      articleSummary: article.summary,
      articleHref: siteHref(siteUpdate.path, language),
      published: siteUpdate.published,
      publishedLabel: formatBlogDate(siteUpdate.published, language),
      releaseNotesHref: siteHref('/changelog', language),
    };
  },
});
