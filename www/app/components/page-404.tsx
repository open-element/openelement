import { element, OpenElement, property } from '@openelement/element';
import '@openelement/ui/open-button';
import { page404Styles } from './page-404-styles.ts';

@element('el-404')
export default class Page404 extends OpenElement {
  static override styles = page404Styles;

  @property({ reflect: false, attribute: false })
  serifLine = '';

  @property({ reflect: false, attribute: false })
  lede = '';

  @property({ reflect: false, attribute: false })
  backHome = '';

  @property({ reflect: false, attribute: false })
  readDocs = '';

  @property({ reflect: false, attribute: false })
  homeHref = '/';

  @property({ reflect: false, attribute: false })
  docsHref = '/docs';

  @property({ reflect: false, attribute: false })
  marqueeText = '';

  render() {
    return (
      <main class='notfound'>
        <section class='stage'>
          <h1 class='code' aria-label='404'>
            <span aria-hidden='true'>4</span>
            <span class='solid' aria-hidden='true'>0</span>
            <span aria-hidden='true'>4</span>
          </h1>
          <p class='serif-line'>{this.serifLine}</p>
          <p class='lede'>{this.lede}</p>
          <div class='actions'>
            <open-button variant='primary' href={this.homeHref}>
              {this.backHome}
            </open-button>
            <open-button href={this.docsHref}>
              {this.readDocs}
            </open-button>
          </div>
        </section>
        <div class='marquee' aria-hidden='true'>
          <span>{this.marqueeText}</span>
        </div>
      </main>
    );
  }
}
