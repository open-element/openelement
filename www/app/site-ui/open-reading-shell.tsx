/** @jsxImportSource @openelement/element */
/** Private WWW long-form reading shell. */

import { computed, element, OpenElement, property } from '@openelement/element';
import { formatFreshnessDate, readingChromeStrings } from './chrome-strings.ts';
import type { ReadingMetadata, ReadingNavigation } from './page-contract.ts';

type ReadingTag = { key: string; label: string };
type CompiledComputed<T> = ReturnType<typeof computed<T>> & T;

@element('open-reading-shell')
export default class OpenReadingShell extends OpenElement {
  // The shell's authored rules and the shared generated-content treatment
  // (article prose) live in the linked document stylesheet
  // (www/site-chrome.css): a function page's render owns no document-style
  // sink, so the document sheet is the one delivery both the static payload
  // and the client read. See the site-chrome.css header.

  @property({ reflect: true })
  rail = false;
  @property({ reflect: true })
  footer = false;
  @property({ reflect: true })
  meta = false;
  @property({ reflect: false })
  metadata: ReadingMetadata = { breadcrumb: '', title: '' };
  @property({ reflect: false })
  navigation: ReadingNavigation = {};
  @property({ reflect: false })
  previous = '';
  @property({ reflect: false })
  next = '';
  @property({ reflect: false })
  previousLabel = '';
  @property({ reflect: false })
  nextLabel = '';

  // Same base-field redeclaration as open-layout: the compiled @property
  // shadows OpenElementConfiguration.locale (SSR injection or the `locale`
  // attribute); tsc's `override` demand is rejected by the compiled grammar.
  @property({ reflect: false })
  // @ts-expect-error compiled @property shadows the optional base field
  locale = 'en';

  @property({ reflect: false, attribute: false })
  breadcrumb = computed(() => this.metadata?.breadcrumb ?? '');
  @property({ reflect: false, attribute: false })
  breadcrumbHref = computed(() => this.metadata?.breadcrumbHref ?? '');
  // Block branches must be fully static (OEC9012), so both breadcrumb forms
  // stay in the tree and toggle through `hidden` like the pager links below.
  @property({ reflect: false, attribute: false })
  hideBreadcrumbLink = computed(() => !this.metadata?.breadcrumbHref);
  @property({ reflect: false, attribute: false })
  hideBreadcrumbText = computed(() => !!this.metadata?.breadcrumbHref);
  @property({ reflect: false, attribute: false })
  breadcrumbLabel = computed(() => readingChromeStrings(this.locale).breadcrumb);
  @property({ reflect: false, attribute: false })
  pageTitle = computed(() => this.metadata?.title ?? '');
  @property({ reflect: false, attribute: false })
  accent = computed(() => this.metadata?.accent ?? '');
  @property({ reflect: false, attribute: false })
  lede = computed(() => this.metadata?.lede ?? '');
  // Source-freshness meta row: version mark + machine-derived update date,
  // both from metadata, folded into one string so fmt and jsx-curly-braces
  // stop fighting over the separator children. Hidden unless both are
  // present so slot-driven pages (blog/changelog/roadmap) keep their own
  // meta.
  @property({ reflect: false, attribute: false })
  hideMetaRow = computed(() => !(this.metadata?.version && this.metadata?.updated));
  @property({ reflect: false, attribute: false })
  freshnessPrefix = computed(
    () =>
      `${readingChromeStrings(this.locale).appliesTo} ${this.metadata?.version ?? ''}${
        readingChromeStrings(this.locale).freshnessSeparator
      }${readingChromeStrings(this.locale).updated} `,
  );
  @property({ reflect: false, attribute: false })
  metaUpdated = computed(() => this.metadata?.updated ?? '');
  @property({ reflect: false, attribute: false })
  metaUpdatedLabel = computed(() => formatFreshnessDate(this.metadata?.updated ?? '', this.locale));
  @property({ reflect: false, attribute: false })
  date = computed(() => this.metadata?.date ?? '');
  @property({ reflect: false, attribute: false, type: Array })
  tags = computed(() =>
    (this.metadata?.tags ?? []).map((tag) => ({ key: tag, label: tag })),
  ) as CompiledComputed<ReadingTag[]>;
  @property({ reflect: false, attribute: false })
  previousHref = computed(() => this.navigation?.previous?.href ?? this.previous);
  @property({ reflect: false, attribute: false })
  nextHref = computed(() => this.navigation?.next?.href ?? this.next);
  @property({ reflect: false, attribute: false })
  previousText = computed(() => this.navigation?.previous?.label ?? this.previousLabel);
  @property({ reflect: false, attribute: false })
  nextText = computed(() => this.navigation?.next?.label ?? this.nextLabel);
  // No route sets the kicker props; fall back to the locale chrome copy so
  // zh pages never show an English Previous/Next.
  @property({ reflect: false, attribute: false })
  previousKicker = computed(() => this.previousLabel || readingChromeStrings(this.locale).previous);
  @property({ reflect: false, attribute: false })
  nextKicker = computed(() => this.nextLabel || readingChromeStrings(this.locale).next);
  @property({ reflect: false, attribute: false })
  hidePrevious = computed(() => !(this.navigation?.previous?.href ?? this.previous));
  @property({ reflect: false, attribute: false })
  hideNext = computed(() => !(this.navigation?.next?.href ?? this.next));
  @property({ reflect: false, attribute: false })
  onThisPage = computed(() => readingChromeStrings(this.locale).onThisPage);
  @property({ reflect: false, attribute: false })
  pageNavigationLabel = computed(() => readingChromeStrings(this.locale).pageNavigation);

  render() {
    return (
      <div class='shell'>
        <article class='main min-w-0 leading-[1.7]'>
          <span id='start' tabindex='-1'></span>
          <header class='meta mb-7 border-b border-border pb-5'>
            <slot name='meta'>
              <div>
                <nav
                  class='m-0 mb-4 flex flex-wrap items-baseline gap-2 font-mono text-(length:--text-xs) font-extrabold tracking-[0.1em] text-muted-foreground uppercase print:hidden!'
                  aria-label={this.breadcrumbLabel}
                >
                  <a
                    class='text-inherit no-underline hover:text-primary hover:underline'
                    href={this.breadcrumbHref}
                    hidden={this.hideBreadcrumbLink}
                  >
                    {this.breadcrumb}
                  </a>
                  <span hidden={this.hideBreadcrumbText}>{this.breadcrumb}</span>
                  <span aria-hidden='true'>{'/'}</span>
                  <span class='text-primary' aria-current='page'>
                    {this.pageTitle}
                  </span>
                </nav>
                <h1
                  class='m-0 font-sans text-(length:--text-2xl) leading-[1.05] font-extrabold tracking-[-0.035em] break-words text-foreground text-balance min-[901px]:text-[clamp(2.1rem,4.6vw,3.4rem)]'
                  data-pagefind-meta='title'
                >
                  {this.pageTitle}
                  <span class='block font-serif text-[calc(1em*1.08)] font-normal italic tracking-[-0.01em] text-primary'>
                    {this.accent}
                  </span>
                </h1>
                <p class='mt-4 mb-0 max-w-[640px] leading-[1.65] text-muted-foreground min-[901px]:text-[clamp(var(--text-base),1.4vw,var(--text-xl))]'>
                  {this.lede}
                </p>
                <p
                  class='mt-3 mb-0 font-mono text-(length:--text-xs) text-muted-foreground'
                  hidden={this.hideMetaRow}
                >
                  <span>{this.freshnessPrefix}</span>
                  <time datetime={this.metaUpdated}>{this.metaUpdatedLabel}</time>
                </p>
                <p class='mt-4 mb-0 flex flex-wrap gap-2 font-mono text-(length:--text-xs) text-muted-foreground'>
                  <time>{this.date}</time>
                  {this.tags.map((tag) => (
                    <span class='rounded-md border border-border px-2 py-1' key={tag.key}>
                      {tag.label}
                    </span>
                  ))}
                </p>
              </div>
            </slot>
          </header>
          <slot></slot>
          <footer class='footer mt-10 border-t border-border pt-5'>
            <slot name='footer'>
              <nav
                class='grid grid-cols-1 gap-4 min-[901px]:grid-cols-2 print:hidden!'
                aria-label={this.pageNavigationLabel}
                data-pager
              >
                <a
                  class='block rounded-lg border border-border px-5 py-4 text-foreground no-underline hover:border-primary'
                  href={this.previousHref}
                  hidden={this.hidePrevious}
                >
                  <span class='mb-1 block font-mono text-(length:--text-xs) tracking-[0.08em] text-muted-foreground uppercase'>
                    ← {this.previousKicker}
                  </span>
                  <span class='block font-bold'>{this.previousText}</span>
                </a>
                <a
                  class='block rounded-lg border border-border px-5 py-4 text-foreground no-underline hover:border-primary min-[901px]:col-start-2 min-[901px]:text-end'
                  href={this.nextHref}
                  hidden={this.hideNext}
                >
                  <span class='mb-1 block font-mono text-(length:--text-xs) tracking-[0.08em] text-muted-foreground uppercase'>
                    {this.nextKicker} →
                  </span>
                  <span class='block font-bold'>{this.nextText}</span>
                </a>
              </nav>
            </slot>
          </footer>
        </article>
        <aside
          class='rail static mt-6 self-start min-[901px]:sticky min-[901px]:top-[calc(var(--nav-height)+1.5rem)] min-[901px]:mt-0 print:hidden!'
          aria-label={this.onThisPage}
          data-pagefind-ignore
        >
          <p class='mt-0 mb-3 hidden font-mono text-(length:--text-xs) font-extrabold tracking-[0.14em] text-muted-foreground uppercase min-[901px]:block'>
            {this.onThisPage}
          </p>
          <slot name='rail'></slot>
        </aside>
      </div>
    );
  }
}
