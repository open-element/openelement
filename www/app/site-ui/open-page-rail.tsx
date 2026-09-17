/** @jsxImportSource @openelement/element */
/** Compiler-owned WWW table of contents. */
import { computed, element, OpenElement, property } from '@openelement/element';
import { readingChromeStrings } from './chrome-strings.ts';
import { compiledStyle } from './compiled-style.ts';

interface RailItem {
  id: string;
  href: string;
  label: string;
  depth: string;
}

@element('open-page-rail')
export default class OpenPageRail extends OpenElement {
  static override styles = [compiledStyle(`
  :host{display:block}.mobile-outline{display:none}.links{display:grid;gap:var(--size-1);counter-reset:rail-item}a{display:block;padding:var(--size-1) 0 var(--size-1) var(--size-3);color:var(--text-muted);font-family:var(--font-mono);font-size:var(--font-size-00);line-height:1.45;text-decoration:none;border-inline-start:var(--border-size-2) solid transparent}a::before{counter-increment:rail-item;content:"§" counter(rail-item) "  ";color:color-mix(in srgb,var(--text-muted) 70%,transparent)}a[data-depth="3"]{padding-inline-start:var(--size-5);font-size:calc(var(--font-size-00) * .94)}a:hover,a:focus-visible{color:var(--text-primary)}a[aria-current="location"]{color:var(--text-primary);font-weight:var(--font-weight-8);border-inline-start-color:var(--brand)}a[aria-current="location"]::before{color:var(--brand)}@media(max-width:900px){.desktop-outline{display:none}.mobile-outline{display:block}summary{cursor:pointer;color:var(--text-primary);border:var(--border-size-1) solid var(--border);border-radius:var(--radius-2);padding:var(--size-3) var(--size-4);background:var(--surface-1);font-family:var(--font-mono);font-size:var(--font-size-00);font-weight:var(--font-weight-8);letter-spacing:.12em;text-transform:uppercase}.mobile-outline .links{padding-block-start:var(--size-3)}}
`)];

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

  render() {
    return (
      <div class='outline-root' data-pagefind-ignore>
        <div class='desktop-outline'>
          <nav class='links' aria-label={this.onThisPage}>
            <a href='#start'>{this.overview}</a>
            {this.items.map((item) => (
              <a key={item.id} href={item.href} data-depth={item.depth}>{item.label}</a>
            ))}
          </nav>
        </div>
        <details class='mobile-outline'>
          <summary>{this.onThisPage}</summary>
          <nav class='links' aria-label={this.onThisPage}>
            <a href='#start'>{this.overview}</a>
            {this.items.map((item) => (
              <a key={item.id} href={item.href} data-depth={item.depth}>{item.label}</a>
            ))}
          </nav>
        </details>
      </div>
    );
  }
}
