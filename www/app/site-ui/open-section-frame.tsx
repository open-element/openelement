/** @jsxImportSource @openelement/element */
/** Private WWW section frame for headings and evidence. */

import { element, OpenElement } from '@openelement/element';
import openSectionFrameStyles from './open-section-frame.css';

@element('open-section-frame')
export default class OpenSectionFrame extends OpenElement {
  static override styles = [openSectionFrameStyles];
  render() {
    return (
      <section class='frame'>
        <header class='head'>
          <div>
            <p class='index'>
              <slot name='index'></slot>
            </p>
            <h2 class='title'>
              <slot name='title'></slot>
            </h2>
          </div>
          <p class='copy'>
            <slot name='copy'></slot>
          </p>
        </header>
        <div class='body'>
          <slot></slot>
        </div>
      </section>
    );
  }
}
