/** @jsxImportSource @openelement/element */
/** Private WWW long-form reading shell. */

import { computed, element, OpenElement, property } from '@openelement/element';
import { readingChromeStrings } from './chrome-strings.ts';
import { compiledStyle } from './compiled-style.ts';
import type { ReadingMetadata, ReadingNavigation } from './page-contract.ts';

/** Optional v4 editorial accent rendered in Instrument Serif after the title. */
type ReadingMetadataV4 = ReadingMetadata & { accent?: string };
type ReadingTag = { key: string; label: string };
type CompiledComputed<T> = ReturnType<typeof computed<T>> & T;

@element('open-reading-shell')
export default class OpenReadingShell extends OpenElement {
  static override styles = [compiledStyle(`
  :host{display:block}
  .shell{width:min(1180px,calc(100% - 3rem));margin:auto;padding:clamp(2rem,5vh,4rem) 0 clamp(4rem,9vh,7rem);display:grid;grid-template-columns:minmax(0,1fr);gap:clamp(1.5rem,4vw,3rem)}
  :host([rail]) .shell{grid-template-columns:minmax(0,1fr) 220px}
  .main{min-width:0;max-width:760px;line-height:1.7}
  :host([rail]) .main{max-width:880px}
  :host(:not([rail])) .main{margin-inline:auto}
  .meta{display:none;margin-block-end:var(--size-7);padding-block-end:var(--size-5);border-block-end:1px solid var(--border)}
  :host([meta]) .meta,:host([metadata]) .meta{display:block}
  .breadcrumb{display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--size-2);margin:0 0 var(--size-4);color:var(--text-muted);font-family:var(--font-mono);font-size:var(--font-size-00);font-weight:var(--font-weight-8);letter-spacing:.1em;text-transform:uppercase}
  .breadcrumb a{color:inherit;text-decoration:none}
  .breadcrumb a:hover{color:var(--brand);text-decoration:underline}
  /* No .crumb-sep ink: the 55% tint of --text-muted measured 2.62:1 on the
     light base (2.52:1 dark); the separator carries the breadcrumb's own
     --text-muted (7.74:1 light, 6.09:1 dark) instead. */
  .breadcrumb .crumb-current{color:var(--violet-8)}
  .title{margin:0;color:var(--text-primary);font-family:var(--font-sans);font-size:clamp(2.1rem,4.6vw,3.4rem);font-weight:var(--font-weight-8);letter-spacing:-.035em;line-height:1.05;overflow-wrap:break-word;text-wrap:balance}
  .title-accent{display:block;color:var(--violet-8);font-family:var(--font-serif);font-style:italic;font-weight:400;font-size:calc(1em * 1.08);letter-spacing:-.01em}
  .lede{max-width:640px;margin:var(--size-4) 0 0;color:var(--text-secondary);font-size:clamp(var(--font-size-1),1.4vw,var(--font-size-2));line-height:1.65}
  .meta-row{display:flex;flex-wrap:wrap;gap:var(--size-2);margin:var(--size-4) 0 0;color:var(--text-muted);font-family:var(--font-mono);font-size:var(--font-size-00)}
  .meta-row span{padding:var(--size-1) var(--size-2);border:1px solid var(--border);border-radius:var(--radius-1)}
  .rail{display:none;position:sticky;top:calc(var(--nav-height) + var(--size-6));align-self:start}
  :host([rail]) .rail{display:block}
  .rail-label{margin:0 0 var(--size-3);color:var(--text-muted);font-family:var(--font-mono);font-size:var(--font-size-00);font-weight:var(--font-weight-8);letter-spacing:.14em;text-transform:uppercase}
  .footer{display:none;margin-block-start:var(--size-10);padding-block-start:var(--size-5);border-block-start:1px solid var(--border)}
  :host([footer]) .footer,:host([navigation]) .footer{display:block}
  /* The footer is a rule plus padding, so a pager with no visible link would
     leave an empty 21px bar. Collapse the chrome (not the footer box): the
     pager nav must stay in the accessibility tree, zero-height, exactly as it
     already renders with its links hidden (#page-structure pins this). Both
     :has() forms must stay single-level — nesting :not(:has()) inside :has()
     is an invalid selector and Chromium drops the whole rule. Scoping to
     "> slot > .pager" keeps custom footer slot content (changelog, roadmap)
     untouched. */
  :host([footer]) .footer:has(> slot > .pager):not(:has(> slot > .pager a:not([hidden]))),:host([navigation]) .footer:has(> slot > .pager):not(:has(> slot > .pager a:not([hidden]))){margin-block-start:0;padding-block-start:0;border-block-start:0}
  .pager{display:flex;justify-content:space-between;gap:var(--size-4)}
  .pager a{color:var(--text-muted);font-family:var(--font-mono);font-size:var(--font-size-00);letter-spacing:.04em;text-decoration:none}
  .pager a:hover{color:var(--brand)}
  .pager a:last-child{color:var(--brand);font-weight:var(--font-weight-8);text-align:end}
  @media(max-width:900px){
    .shell,:host([rail]) .shell{grid-template-columns:1fr;width:min(100% - 2rem,760px);padding-block:var(--size-8)}
    .main{max-width:none}
    .title{font-size:clamp(1.8rem,8vw,2.4rem)}
    .rail{position:static;margin-block-start:var(--size-6)}
    .rail-label{display:none}
  }
`)];

  @property({ reflect: true })
  rail = false;
  @property({ reflect: true })
  footer = false;
  @property({ reflect: true })
  meta = false;
  @property({ reflect: false })
  metadata: ReadingMetadataV4 = { breadcrumb: '', title: '' };
  @property({ reflect: false })
  navigation: ReadingNavigation = {};
  @property({ reflect: false })
  previous = '';
  @property({ reflect: false })
  next = '';
  @property({ reflect: false })
  previousLabel = 'Previous';
  @property({ reflect: false })
  nextLabel = 'Next';

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
  hideBreadcrumbLink = computed(() => !(this.metadata?.breadcrumbHref));
  @property({ reflect: false, attribute: false })
  hideBreadcrumbText = computed(() => !!(this.metadata?.breadcrumbHref));
  @property({ reflect: false, attribute: false })
  breadcrumbLabel = computed(() => readingChromeStrings(this.locale).breadcrumb);
  @property({ reflect: false, attribute: false })
  pageTitle = computed(() => this.metadata?.title ?? '');
  @property({ reflect: false, attribute: false })
  accent = computed(() => this.metadata?.accent ?? '');
  @property({ reflect: false, attribute: false })
  lede = computed(() => this.metadata?.lede ?? '');
  @property({ reflect: false, attribute: false })
  date = computed(() => this.metadata?.date ?? '');
  @property({ reflect: false, attribute: false, type: Array })
  tags = computed(() =>
    (this.metadata?.tags ?? []).map((tag) => ({ key: tag, label: tag }))
  ) as CompiledComputed<ReadingTag[]>;
  @property({ reflect: false, attribute: false })
  previousHref = computed(() => this.navigation?.previous?.href ?? this.previous);
  @property({ reflect: false, attribute: false })
  nextHref = computed(() => this.navigation?.next?.href ?? this.next);
  @property({ reflect: false, attribute: false })
  previousText = computed(() => this.navigation?.previous?.label ?? this.previousLabel);
  @property({ reflect: false, attribute: false })
  nextText = computed(() => this.navigation?.next?.label ?? this.nextLabel);
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
                  <a href={this.breadcrumbHref} hidden={this.hideBreadcrumbLink}>{this.breadcrumb}</a>
                  <span hidden={this.hideBreadcrumbText}>{this.breadcrumb}</span>
                  <span class='crumb-sep' aria-hidden='true'>/</span>
                  <span class='crumb-current' aria-current='page'>{this.pageTitle}</span>
                </nav>
                <h1 class='title' data-pagefind-meta='title'>
                  {this.pageTitle}
                  <span class='title-accent'>{this.accent}</span>
                </h1>
                <p class='lede'>{this.lede}</p>
                <p class='meta-row'>
                  <time>{this.date}</time>
                  {this.tags.map((tag) => <span key={tag.key}>{tag.label}</span>)}
                </p>
              </div>
            </slot>
          </header>
          <slot></slot>
          <footer class='footer'>
            <slot name='footer'>
              <nav class='pager' aria-label={this.pageNavigationLabel}>
                <a href={this.previousHref} hidden={this.hidePrevious}>← {this.previousText}</a>
                <a href={this.nextHref} hidden={this.hideNext}>{this.nextText} →</a>
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
