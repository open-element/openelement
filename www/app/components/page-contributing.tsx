/**
 * Contributing page element. The route owns request/locale projection; this
 * module owns only the compiled page structure and its declared properties.
 */
import { element, OpenElement, property } from '@openelement/element';
import '@openelement/ui/open-code-block';
import '@openelement/ui/open-button';
import { pageContributingStyles } from './page-contributing-styles.ts';

interface ReleaseItem {
  id: string;
  before: string;
  code1: string;
  middle1: string;
  code2: string;
  middle2: string;
  code3: string;
  after: string;
}

interface ChecklistItem {
  id: string;
  checkboxClass: string;
  mark: string;
  text: string;
}

interface HelpRow {
  id: string;
  index: string;
  title: string;
  copy: string;
}

@element('contributing-page', { root: 'shadow-open' })
export default class PageContributing extends OpenElement {
  static override styles = pageContributingStyles;

  @property({ reflect: false, attribute: false })
  eyebrow = '';
  @property({ reflect: false, attribute: false })
  monoLine = '';
  @property({ reflect: false, attribute: false })
  serifLine = '';
  @property({ reflect: false, attribute: false })
  lede = '';
  @property({ reflect: false, attribute: false })
  setupAriaLabel = '';
  @property({ reflect: false, attribute: false })
  setupLabel = '';
  @property({ reflect: false, attribute: false })
  setupCopyBefore = '';
  @property({ reflect: false, attribute: false })
  setupCopyVite = '';
  @property({ reflect: false, attribute: false })
  setupCopyBetween = '';
  @property({ reflect: false, attribute: false })
  setupCopyNpm = '';
  @property({ reflect: false, attribute: false })
  setupCopyAnd = '';
  @property({ reflect: false, attribute: false })
  setupCopyNpx = '';
  @property({ reflect: false, attribute: false })
  setupCopyAfter = '';
  @property({ reflect: false, attribute: false })
  releaseLabel = '';
  @property({ reflect: false, attribute: false })
  releaseItems: ReleaseItem[] = [];
  @property({ reflect: false, attribute: false })
  beforePrLabel = '';
  @property({ reflect: false, attribute: false })
  checklist: ChecklistItem[] = [];
  @property({ reflect: false, attribute: false })
  layeringCopy = '';
  @property({ reflect: false, attribute: false })
  helpLabel = '';
  @property({ reflect: false, attribute: false })
  helpRows: HelpRow[] = [];
  @property({ reflect: false, attribute: false })
  calloutLabel = '';
  @property({ reflect: false, attribute: false })
  calloutIntro = '';
  @property({ reflect: false, attribute: false })
  discussionsLabel = '';
  @property({ reflect: false, attribute: false })
  discussionsHref = '';
  @property({ reflect: false, attribute: false })
  calloutBetween = '';
  @property({ reflect: false, attribute: false })
  issuesLabel = '';
  @property({ reflect: false, attribute: false })
  issuesHref = '';
  @property({ reflect: false, attribute: false })
  calloutAfter = '';
  @property({ reflect: false, attribute: false })
  changelogLabel = '';
  @property({ reflect: false, attribute: false })
  changelogHref = '';
  @property({ reflect: false, attribute: false })
  roadmapLabel = '';
  @property({ reflect: false, attribute: false })
  roadmapHref = '';

  render() {
    return (
      <main class='contribute'>
        <header class='masthead'>
          <p class='eyebrow'>{this.eyebrow}</p>
          <h1>
            <span class='mono-line'>{this.monoLine}</span>
            <span class='serif-line'>{this.serifLine}</span>
          </h1>
          <p class='lede'>{this.lede}</p>
        </header>

        <section class='setup' aria-label={this.setupAriaLabel}>
          <div class='setup-col'>
            <p class='section-label'>{this.setupLabel}</p>
            <open-code-block>
              <pre><code>{`git clone https://github.com/open-element/openelement.git
cd openelement
deno install
deno task test
deno task dev`}</code></pre>
            </open-code-block>
            <p class='setup-copy'>
              {this.setupCopyBefore}
              <span class='inline-code'>{this.setupCopyVite}</span>
              {this.setupCopyBetween}
              <span class='inline-code'>{this.setupCopyNpm}</span>
              {this.setupCopyAnd}
              <span class='inline-code'>{this.setupCopyNpx}</span>
              {this.setupCopyAfter}
            </p>
            <p class='section-label'>{this.releaseLabel}</p>
            <ol class='release'>
              {this.releaseItems.map((item) => (
                <li key={item.id}>
                  <span>
                    {item.before}
                    <span class='inline-code'>{item.code1}</span>
                    {item.middle1}
                    <span class='inline-code'>{item.code2}</span>
                    {item.middle2}
                    <span class='inline-code'>{item.code3}</span>
                    {item.after}
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <div class='setup-col'>
            <p class='section-label'>{this.beforePrLabel}</p>
            <ul class='checklist'>
              {this.checklist.map((item) => (
                <li key={item.id}>
                  <span class={item.checkboxClass} aria-hidden='true'>{item.mark}</span>
                  <span>{item.text}</span>
                </li>
              ))}
            </ul>
            <p class='setup-copy'>{this.layeringCopy}</p>
          </div>
        </section>

        <section class='help' aria-label={this.helpLabel}>
          <p class='section-label help-header'>{this.helpLabel}</p>
          {this.helpRows.map((item) => (
            <div class='help-row' key={item.id}>
              <span class='help-index' aria-hidden='true'>{item.index}</span>
              <span class='help-title'>{item.title}</span>
              <p class='help-copy'>{item.copy}</p>
            </div>
          ))}
        </section>

        <aside class='callout'>
          <p class='callout-label'>{this.calloutLabel}</p>
          <p>
            <span>{this.calloutIntro}</span>
            <a href={this.discussionsHref}>{this.discussionsLabel}</a>
            <span>{this.calloutBetween}</span>
            <a href={this.issuesHref}>{this.issuesLabel}</a>
            <span>{this.calloutAfter}</span>
          </p>
        </aside>

        <div class='nav-row'>
          <open-button variant='ghost' size='sm' href={this.changelogHref}>
            {this.changelogLabel}
          </open-button>
          <open-button variant='ghost' size='sm' href={this.roadmapHref}>
            {this.roadmapLabel}
          </open-button>
        </div>
      </main>
    );
  }
}
