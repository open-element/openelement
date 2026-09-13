import { element, OpenElement, property } from '@openelement/element';
import { pageDocsStyles } from './page-docs-styles.ts';

@element('docs-index')
export default class PageDocs extends OpenElement {
  static override styles = pageDocsStyles;

  @property({ reflect: false, attribute: false })
  sidenote = '';
  @property({ reflect: false, attribute: false })
  eyebrow = '';
  @property({ reflect: false, attribute: false })
  serifLine = '';
  @property({ reflect: false, attribute: false })
  monoLine = '';
  @property({ reflect: false, attribute: false })
  lede = '';
  @property({ reflect: false, attribute: false })
  navLabel = '';
  @property({ reflect: false, attribute: false })
  version = '';
  @property({ reflect: false, attribute: false })
  entrance1Title = '';
  @property({ reflect: false, attribute: false })
  entrance1Copy = '';
  @property({ reflect: false, attribute: false })
  entrance1Href = '';
  @property({ reflect: false, attribute: false })
  entrance2Title = '';
  @property({ reflect: false, attribute: false })
  entrance2Copy = '';
  @property({ reflect: false, attribute: false })
  entrance2Href = '';
  @property({ reflect: false, attribute: false })
  entrance3Title = '';
  @property({ reflect: false, attribute: false })
  entrance3Copy = '';
  @property({ reflect: false, attribute: false })
  entrance3Href = '';
  @property({ reflect: false, attribute: false })
  entrance4Title = '';
  @property({ reflect: false, attribute: false })
  entrance4Copy = '';
  @property({ reflect: false, attribute: false })
  entrance4Href = '';

  render() {
    return (
      <main class='manual'>
        <header class='masthead'>
          <span class='sidenote' aria-hidden='true'>{this.sidenote}</span>
          <div class='masthead-top'>
            <p class='eyebrow'>{this.eyebrow}</p>
            <span class='stamp'>{this.version}</span>
          </div>
          <h1>
            <span class='serif-line'>{this.serifLine}</span>
            <span class='mono-line'>{this.monoLine}</span>
          </h1>
          <p class='lede'>{this.lede}</p>
        </header>
        <nav class='entrances' aria-label={this.navLabel}>
          <a class='entrance' href={this.entrance1Href}>
            <span class='entrance-index' aria-hidden='true'>01</span>
            <div>
              <span class='entrance-title'>{this.entrance1Title}</span>
              <p class='entrance-copy'>{this.entrance1Copy}</p>
            </div>
            <span class='entrance-arrow' aria-hidden='true'>→</span>
          </a>
          <a class='entrance' href={this.entrance2Href}>
            <span class='entrance-index' aria-hidden='true'>02</span>
            <div>
              <span class='entrance-title'>{this.entrance2Title}</span>
              <p class='entrance-copy'>{this.entrance2Copy}</p>
            </div>
            <span class='entrance-arrow' aria-hidden='true'>→</span>
          </a>
          <a class='entrance' href={this.entrance3Href}>
            <span class='entrance-index' aria-hidden='true'>03</span>
            <div>
              <span class='entrance-title'>{this.entrance3Title}</span>
              <p class='entrance-copy'>{this.entrance3Copy}</p>
            </div>
            <span class='entrance-arrow' aria-hidden='true'>→</span>
          </a>
          <a class='entrance' href={this.entrance4Href}>
            <span class='entrance-index' aria-hidden='true'>04</span>
            <div>
              <span class='entrance-title'>{this.entrance4Title}</span>
              <p class='entrance-copy'>{this.entrance4Copy}</p>
            </div>
            <span class='entrance-arrow' aria-hidden='true'>→</span>
          </a>
        </nav>
      </main>
    );
  }
}
