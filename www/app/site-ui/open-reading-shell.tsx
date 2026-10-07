/** @jsxImportSource @openelement/element */
/** Private WWW long-form reading shell. */

import { computed, element, OpenElement, property } from '@openelement/element';
import { formatFreshnessDate, readingChromeStrings } from './chrome-strings.ts';
import type { ReadingMetadata, ReadingNavigation } from './page-contract.ts';
import openReadingShellStyles from './open-reading-shell.css';

type ReadingTag = { key: string; label: string };
type CompiledComputed<T> = ReturnType<typeof computed<T>> & T;

@element('open-reading-shell')
export default class OpenReadingShell extends OpenElement {
  static override styles = [openReadingShellStyles];

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
  // Region branches must be fully static (OEC9012), so both breadcrumb forms
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
        <article class='main'>
          <span id='start' tabindex='-1'></span>
          <header class='meta'>
            <slot name='meta'>
              <div>
                <nav class='breadcrumb' aria-label={this.breadcrumbLabel}>
                  <a href={this.breadcrumbHref} hidden={this.hideBreadcrumbLink}>
                    {this.breadcrumb}
                  </a>
                  <span hidden={this.hideBreadcrumbText}>{this.breadcrumb}</span>
                  <span class='crumb-sep' aria-hidden='true'>
                    {'/'}
                  </span>
                  <span class='crumb-current' aria-current='page'>
                    {this.pageTitle}
                  </span>
                </nav>
                <h1 class='title' data-pagefind-meta='title'>
                  {this.pageTitle}
                  <span class='title-accent'>{this.accent}</span>
                </h1>
                <p class='lede'>{this.lede}</p>
                <p class='freshness-row' hidden={this.hideMetaRow}>
                  <span>{this.freshnessPrefix}</span>
                  <time datetime={this.metaUpdated}>{this.metaUpdatedLabel}</time>
                </p>
                <p class='meta-row'>
                  <time>{this.date}</time>
                  {this.tags.map((tag) => (
                    <span key={tag.key}>{tag.label}</span>
                  ))}
                </p>
              </div>
            </slot>
          </header>
          <slot></slot>
          <footer class='footer'>
            <slot name='footer'>
              <nav class='pager' aria-label={this.pageNavigationLabel}>
                <a class='pager-card' href={this.previousHref} hidden={this.hidePrevious}>
                  <span class='pager-kicker'>← {this.previousKicker}</span>
                  <span class='pager-title'>{this.previousText}</span>
                </a>
                <a class='pager-card next' href={this.nextHref} hidden={this.hideNext}>
                  <span class='pager-kicker'>{this.nextKicker} →</span>
                  <span class='pager-title'>{this.nextText}</span>
                </a>
              </nav>
            </slot>
          </footer>
        </article>
        <aside class='rail' aria-label={this.onThisPage} data-pagefind-ignore>
          <p class='rail-label'>{this.onThisPage}</p>
          <slot name='rail'></slot>
        </aside>
      </div>
    );
  }
}
