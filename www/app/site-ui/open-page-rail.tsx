/** @jsxImportSource @openelement/element */
/** Compiler-owned WWW table of contents. */
import { computed, element, OpenElement, property } from '@openelement/element';
import { readingChromeStrings } from './chrome-strings.ts';
import { installRailScrollspy, uninstallRailScrollspy } from './open-page-rail-controller.ts';
import openPageRailStyles from './open-page-rail.css';

interface RailItem {
  id: string;
  href: string;
  label: string;
  depth: string;
}

@element('open-page-rail')
export default class OpenPageRail extends OpenElement {
  static override styles = [openPageRailStyles];

  @property({ reflect: false })
  items: RailItem[] = [];

  // Same base-field redeclaration as open-layout: the compiled @property
  // shadows OpenElementConfiguration.locale (SSR injection or the `locale`
  // attribute); tsc's `override` demand is rejected by the compiled grammar.
  @property({ reflect: false })
  // @ts-expect-error compiled @property shadows the optional base field
  locale = 'en';

  @property({ reflect: false, attribute: false })
  onThisPage = computed(() => readingChromeStrings(this.locale).onThisPage);

  @property({ reflect: false, attribute: false })
  overview = computed(() => readingChromeStrings(this.locale).overview);

  override connectedCallback(): void {
    super.connectedCallback();
    installRailScrollspy(this);
  }

  override disconnectedCallback(): void {
    uninstallRailScrollspy(this);
    super.disconnectedCallback();
  }

  render() {
    return (
      <div class='outline-root' data-pagefind-ignore>
        <div class='desktop-outline'>
          <nav class='links' aria-label={this.onThisPage}>
            <a href='#start'>{this.overview}</a>
            {this.items.map((item) => (
              <a key={item.id} href={item.href} data-depth={item.depth}>
                {item.label}
              </a>
            ))}
          </nav>
        </div>
        <details class='mobile-outline'>
          <summary>{this.onThisPage}</summary>
          <nav class='links' aria-label={this.onThisPage}>
            <a href='#start'>{this.overview}</a>
            {this.items.map((item) => (
              <a key={item.id} href={item.href} data-depth={item.depth}>
                {item.label}
              </a>
            ))}
          </nav>
        </details>
      </div>
    );
  }
}
