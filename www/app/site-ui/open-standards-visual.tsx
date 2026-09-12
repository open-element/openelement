/** @jsxImportSource @openelement/element */
/**
 * www/site-ui - open-standards-visual
 *
 * Product-art diagrams for the openElement standards lab website.
 */

import { computed, element, OpenElement, property } from '@openelement/element';
import { openStandardsVisualStyles } from './open-standards-visual-styles.ts';

/** Compiled computed fields expose their derived value through the class facade. */
type CompiledComputed<T> = ReturnType<typeof computed<T>> & T;

@element('open-standards-visual')
export default class OpenStandardsVisual extends OpenElement {
  static override styles = openStandardsVisualStyles;
  @property({ reflect: true })
  variant = 'hero';
  @property({ reflect: true })
  motion = 'auto';
  @property({ reflect: true })
  emphasis = 'normal';
  @property({ reflect: false, attribute: false, type: Number })
  showHero = computed(() => this.variant === 'hero' ? 1 : 0) as CompiledComputed<number>;
  @property({ reflect: false, attribute: false, type: Number })
  showRoutes = computed(() => this.variant === 'routes' ? 1 : 0) as CompiledComputed<number>;
  @property({ reflect: false, attribute: false, type: Number })
  showPackages = computed(() => this.variant === 'packages' ? 1 : 0) as CompiledComputed<number>;
  @property({ reflect: false, attribute: false, type: Number })
  showTokens = computed(() => this.variant === 'tokens' ? 1 : 0) as CompiledComputed<number>;
  @property({ reflect: false, attribute: false })
  visualClass = computed(() =>
    `visual visual--${this.emphasis === 'high' ? 'high' : 'normal'} visual--${
      this.motion === 'off' ? 'still' : 'motion'
    }`
  );

  render() {
    return (
      <div className={this.visualClass}>
        {this.showHero > 0
          ? (
            <div className='hero'>
              <div className='hero__top'>
                <pre className='code'><code>{`export default app({
            routes: './app/routes',
            render: 'declarative-shadow-dom',
            islands: 'interaction-only',
            adapter: 'vite'
            })`}</code></pre>
                <div className='spec' aria-label='Standards sheet'>
                  <div className='spec__row'>
                    <span className='spec__key'>HTML</span>
                    <span className='spec__value'>
                      Declarative Shadow DOM as the first rendering target
                    </span>
                  </div>
                  <div className='spec__row'>
                    <span className='spec__key'>WC</span>
                    <span className='spec__value'>
                      Custom elements own behavior and progressive hydration
                    </span>
                  </div>
                  <div className='spec__row'>
                    <span className='spec__key'>API</span>
                    <span className='spec__value'>
                      Hono endpoints sit beside pages and content routes
                    </span>
                  </div>
                </div>
              </div>
              <div className='pipeline' aria-label='Render pipeline'>
                <div className='stage'>
                  <span className='stage__num'>01</span>
                  <span className='stage__copy'>Route</span>
                </div>
                <div className='stage stage--success'>
                  <span className='stage__num'>02</span>
                  <span className='stage__copy'>Render DSD</span>
                </div>
                <div className='stage'>
                  <span className='stage__num'>03</span>
                  <span className='stage__copy'>Ship HTML</span>
                </div>
                <div className='stage stage--warning'>
                  <span className='stage__num'>04</span>
                  <span className='stage__copy'>Hydrate island</span>
                </div>
                <div className='stage'>
                  <span className='stage__num'>05</span>
                  <span className='stage__copy'>Verify</span>
                </div>
              </div>
            </div>
          )
          : <span hidden aria-hidden='true'></span>}
        {this.showRoutes > 0
          ? (
            <div className='routes' aria-label='Route graph'>
              <div className='route'>
                <span className='route__path'>/</span>
                <span className='route__desc'>homepage lab artifact and product paths</span>
              </div>
              <div className='route'>
                <span className='route__path'>/guide/*</span>
                <span className='route__desc'>
                  build path, configuration, deployment, and production flow
                </span>
              </div>
              <div className='route'>
                <span className='route__path'>/architecture/*</span>
                <span className='route__desc'>
                  package graph, DSD, islands, and standards registry
                </span>
              </div>
              <div className='route'>
                <span className='route__path'>/api</span>
                <span className='route__desc'>public contract index across the product graph</span>
              </div>
            </div>
          )
          : <span hidden aria-hidden='true'></span>}
        {this.showPackages > 0
          ? (
            <div className='packages' aria-label='Package graph'>
              <div className='package package--success'>
                <span className='package__name'>Elements</span>
                <span className='package__desc'>
                  custom elements, DSD rendering, and component contracts
                </span>
              </div>
              <div className='package'>
                <span className='package__name'>UI</span>
                <span className='package__desc'>
                  Open Props primitives used by this website and consumers
                </span>
              </div>
              <div className='package package--warning'>
                <span className='package__name'>Framework</span>
                <span className='package__desc'>
                  routes, layouts, content, islands, i18n, and adapter-vite
                </span>
              </div>
              <div className='package'>
                <span className='package__name'>Protocols</span>
                <span className='package__desc'>
                  public boundary declarations and package compatibility language
                </span>
              </div>
            </div>
          )
          : <span hidden aria-hidden='true'></span>}
        {this.showTokens > 0
          ? (
            <div className='tokens' aria-label='Token board'>
              <div className='token token--surface'>
                <span className='token__swatch'></span>
                <span className='token__name'>--bg-card</span>
                <span className='token__desc'>reading surfaces</span>
              </div>
              <div className='token token--brand'>
                <span className='token__swatch'></span>
                <span className='token__name'>--brand</span>
                <span className='token__desc'>links and primary action</span>
              </div>
              <div className='token token--success'>
                <span className='token__swatch'></span>
                <span className='token__name'>--success</span>
                <span className='token__desc'>standards and shipped state</span>
              </div>
              <div className='token token--warning'>
                <span className='token__swatch'></span>
                <span className='token__name'>--warning</span>
                <span className='token__desc'>planned or directional state</span>
              </div>
              <div className='token token--info'>
                <span className='token__swatch'></span>
                <span className='token__name'>--info</span>
                <span className='token__desc'>reference and API state</span>
              </div>
              <div className='token token--code'>
                <span className='token__swatch'></span>
                <span className='token__name'>--bg-code</span>
                <span className='token__desc'>code and artifact panels</span>
              </div>
            </div>
          )
          : <span hidden aria-hidden='true'></span>}
      </div>
    );
  }
}
