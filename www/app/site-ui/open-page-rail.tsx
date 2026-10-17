/** @jsxImportSource @openelement/element */
/** Compiler-owned WWW table of contents. */
import { computed, element, OpenElement, property } from '@openelement/element';
import { readingChromeStrings } from './chrome-strings.ts';
import { installRailScrollspy, uninstallRailScrollspy } from './open-page-rail-controller.ts';

interface RailItem {
  id: string;
  href: string;
  label: string;
  depth: string;
}

@element('open-page-rail')
export default class OpenPageRail extends OpenElement {
  // Rules moved to the linked document stylesheet (www/site-chrome.css).

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
      <div data-pagefind-ignore>
        <div class='hidden min-[901px]:block'>
          <nav class='grid gap-1 [counter-reset:rail-item]' aria-label={this.onThisPage}>
            <a
              class='block py-1 pe-0 ps-3 text-muted-foreground font-mono text-(length:--text-xs) leading-[1.45] no-underline border-s-2 border-s-transparent hover:text-foreground focus-visible:text-foreground data-[depth=3]:ps-5 data-[depth=3]:text-[length:calc(var(--text-xs)*0.94)] aria-[current=location]:text-foreground aria-[current=location]:font-extrabold aria-[current=location]:border-s-primary'
              href='#start'
            >
              {this.overview}
            </a>
            {this.items.map((item) => (
              <a
                key={item.id}
                class='block py-1 pe-0 ps-3 text-muted-foreground font-mono text-(length:--text-xs) leading-[1.45] no-underline border-s-2 border-s-transparent hover:text-foreground focus-visible:text-foreground data-[depth=3]:ps-5 data-[depth=3]:text-[length:calc(var(--text-xs)*0.94)] aria-[current=location]:text-foreground aria-[current=location]:font-extrabold aria-[current=location]:border-s-primary'
                href={item.href}
                data-depth={item.depth}
              >
                {item.label}
              </a>
            ))}
          </nav>
        </div>
        <details class='block min-[901px]:hidden'>
          <summary class='cursor-pointer rounded-lg border border-border bg-(--surface-1) px-4 py-3 font-mono text-(length:--text-xs) font-extrabold tracking-[0.12em] text-foreground uppercase'>
            {this.onThisPage}
          </summary>
          <nav class='grid gap-1 pt-3 [counter-reset:rail-item]' aria-label={this.onThisPage}>
            <a
              class='block py-1 pe-0 ps-3 text-muted-foreground font-mono text-(length:--text-xs) leading-[1.45] no-underline border-s-2 border-s-transparent hover:text-foreground focus-visible:text-foreground data-[depth=3]:ps-5 data-[depth=3]:text-[length:calc(var(--text-xs)*0.94)] aria-[current=location]:text-foreground aria-[current=location]:font-extrabold aria-[current=location]:border-s-primary'
              href='#start'
            >
              {this.overview}
            </a>
            {this.items.map((item) => (
              <a
                key={item.id}
                class='block py-1 pe-0 ps-3 text-muted-foreground font-mono text-(length:--text-xs) leading-[1.45] no-underline border-s-2 border-s-transparent hover:text-foreground focus-visible:text-foreground data-[depth=3]:ps-5 data-[depth=3]:text-[length:calc(var(--text-xs)*0.94)] aria-[current=location]:text-foreground aria-[current=location]:font-extrabold aria-[current=location]:border-s-primary'
                href={item.href}
                data-depth={item.depth}
              >
                {item.label}
              </a>
            ))}
          </nav>
        </details>
      </div>
    );
  }
}
