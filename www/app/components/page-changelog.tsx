import {
  element,
  OpenElement,
  property,
  type TrustedHtml,
  trustedHtml,
} from '@openelement/element';
import '@openelement/ui/open-button';
import '@openelement/site-ui/open-reading-shell.tsx';
import '../islands/open-page-rail.tsx';
import { pageChangelogStyles } from './page-changelog-styles.ts';

interface ChangelogRailItem {
  id: string;
  href: string;
  label: string;
  depth: string;
}

@element('changelog-page')
export default class PageChangelog extends OpenElement {
  static override styles = pageChangelogStyles;

  @property({ reflect: false, attribute: false })
  eyebrow = '';
  @property({ reflect: false, attribute: false })
  pageTitle = '';
  @property({ reflect: false, attribute: false })
  lede = '';
  @property({ reflect: false, attribute: false })
  metaPrefix = '';
  @property({ reflect: false, attribute: false })
  registryNote = '';
  @property({ reflect: false, attribute: false })
  metaSuffix = '';
  @property({ reflect: false, attribute: false })
  railItems: ChangelogRailItem[] = [];
  @property({ reflect: false, attribute: false })
  publishedIntro = '';
  @property({ reflect: false, attribute: false })
  stampCurrent = '';
  @property({ reflect: false, attribute: false })
  regCurrentSummary = '';
  @property({ reflect: false, attribute: false })
  stableHeading = '';
  @property({ reflect: false, attribute: false })
  commonVersionLabel = '';
  @property({ reflect: false, attribute: false })
  stableBody = '';
  @property({ reflect: false, attribute: false })
  withdrawnHeading = '';
  @property({ reflect: false, attribute: false })
  withdrawnBody = '';
  @property({ reflect: false, attribute: false })
  footnote = '';
  @property({ type: Object, reflect: false, attribute: false })
  changelogHtml: TrustedHtml = trustedHtml('');
  @property({ reflect: false, attribute: false })
  roadmapHref = '';
  @property({ reflect: false, attribute: false })
  roadmapLabel = '';
  @property({ reflect: false, attribute: false })
  gettingStartedHref = '';
  @property({ reflect: false, attribute: false })
  gettingStartedLabel = '';

  // Same base-field redeclaration as open-layout: the compiled @property
  // shadows OpenElementConfiguration.locale (SSR injection or the `locale`
  // attribute); tsc's `override` demand is rejected by the compiled grammar.
  @property({ reflect: false })
  // @ts-expect-error compiled @property shadows the optional base field
  locale = 'en';

  render() {
    return (
      <div data-pagefind-body>
        <open-reading-shell meta rail footer locale={this.locale}>
          <div slot='meta'>
            <p class='crumb'>
              <span>Project</span>
              <span class='crumb-sep'>/</span>
              <span class='crumb-current'>{this.eyebrow}</span>
            </p>
            <h1 class='page-title'>{this.pageTitle}</h1>
            <p class='lede'>{this.lede}</p>
            <p class='version-line'>
              {this.metaPrefix} <code>{this.registryNote}</code>
              {this.metaSuffix}
            </p>
          </div>
          <div slot='rail'>
            <open-page-rail items={this.railItems} locale={this.locale}></open-page-rail>
          </div>
          <p id='published'>{this.publishedIntro}</p>
          <div class='register' aria-label='Release register'>
            <div class='reg-row reg-current'>
              <div class='reg-head'>
                <span class='reg-version'>{this.commonVersionLabel}</span>
                <span class='reg-stamp'>{this.stampCurrent}</span>
              </div>
              <p class='reg-summary'>{this.regCurrentSummary}</p>
            </div>
          </div>
          <section id='candidate'>
            <h2>{this.stableHeading}</h2>
            <p>{this.stableBody}</p>
          </section>
          <section id='withdrawn'>
            <h2>{this.withdrawnHeading}</h2>
            <p>{this.withdrawnBody}</p>
          </section>
          <p class='reg-note'>{this.footnote}</p>
          <div
            id='historical'
            class='changelog-content'
            innerHTML={this.changelogHtml}
            trustedHtml
          />
          <div slot='footer' class='nav-row'>
            <open-button variant='ghost' size='sm' href={this.roadmapHref}>
              {this.roadmapLabel}
            </open-button>
            <open-button variant='ghost' size='sm' href={this.gettingStartedHref}>
              {this.gettingStartedLabel}
            </open-button>
          </div>
        </open-reading-shell>
      </div>
    );
  }
}
