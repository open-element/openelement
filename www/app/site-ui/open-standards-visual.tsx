/** @jsxImportSource @openelement/element */
/**
 * www/app/site-ui - open-standards-visual
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
  variant = 'packages';
  @property({ reflect: true })
  motion = 'auto';
  @property({ reflect: true })
  emphasis = 'normal';
  @property({ reflect: false, attribute: false, type: Number })
  showPackages = computed(() => (this.variant === 'packages' ? 1 : 0)) as CompiledComputed<number>;
  @property({ reflect: false, attribute: false })
  visualClass = computed(
    () =>
      `visual visual--${this.emphasis === 'high' ? 'high' : 'normal'} visual--${
        this.motion === 'off' ? 'still' : 'motion'
      }`,
  );

  render() {
    return (
      <div className={this.visualClass}>
        {this.showPackages > 0 ? (
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
                routes, layouts, content, islands, i18n, and router build
              </span>
            </div>
            <div className='package'>
              <span className='package__name'>Protocols</span>
              <span className='package__desc'>
                public boundary declarations and package compatibility language
              </span>
            </div>
          </div>
        ) : (
          <span hidden aria-hidden='true'></span>
        )}
      </div>
    );
  }
}
