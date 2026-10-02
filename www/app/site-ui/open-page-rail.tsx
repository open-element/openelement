/** @jsxImportSource @openelement/element */
/** Compiler-owned WWW table of contents. */
import { computed, element, OpenElement, property } from '@openelement/element';
import { readingChromeStrings } from './chrome-strings.ts';
import { installRailScrollspy, uninstallRailScrollspy } from './open-page-rail-controller.ts';
import { compiledStyle } from './compiled-style.ts';

interface RailItem {
  id: string;
  href: string;
  label: string;
  depth: string;
}

@element('open-page-rail')
export default class OpenPageRail extends OpenElement {
  static override styles = [
    compiledStyle(`
  :host{display:block}.mobile-outline{display:none}.links{display:grid;gap:calc(var(--spacing) * 1);counter-reset:rail-item}a{display:block;padding:calc(var(--spacing) * 1) 0 calc(var(--spacing) * 1) calc(var(--spacing) * 3);color:var(--color-muted-foreground);font-family:var(--font-mono);font-size:var(--text-xs);line-height:1.45;text-decoration:none;border-inline-start:2px solid transparent}a::before{counter-increment:rail-item;content:"§" counter(rail-item) "  ";color:color-mix(in srgb,var(--color-muted-foreground) 70%,transparent)}a[data-depth="3"]{padding-inline-start:calc(var(--spacing) * 5);font-size:calc(var(--text-xs) * .94)}a:hover,a:focus-visible{color:var(--color-foreground)}a[aria-current="location"]{color:var(--color-foreground);font-weight:var(--font-weight-extrabold);border-inline-start-color:var(--color-primary)}a[aria-current="location"]::before{color:var(--color-primary)}@media(max-width:900px){.desktop-outline{display:none}.mobile-outline{display:block}summary{cursor:pointer;color:var(--color-foreground);border:1px solid var(--color-border);border-radius:var(--radius-lg);padding:calc(var(--spacing) * 3) calc(var(--spacing) * 4);background:var(--surface-1);font-family:var(--font-mono);font-size:var(--text-xs);font-weight:var(--font-weight-extrabold);letter-spacing:.12em;text-transform:uppercase}.mobile-outline .links{padding-block-start:calc(var(--spacing) * 3)}}
`),
  ];

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
