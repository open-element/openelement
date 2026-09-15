/** @jsxImportSource @openelement/element */
/** Private WWW section frame for headings and evidence. */

import { element, OpenElement } from '@openelement/element';
import { compiledStyle } from './compiled-style.ts';

@element('open-section-frame')
export default class OpenSectionFrame extends OpenElement {
  static override styles = [compiledStyle(
    `:host{display:block}.frame{width:min(1180px,calc(100% - 3rem));margin:clamp(4rem,10vh,8rem) auto 0}.head{display:grid;grid-template-columns:minmax(0,.5fr) minmax(0,.5fr);gap:clamp(1.5rem,6vw,6rem);padding-block-end:var(--size-6);border-block-end:1px solid var(--border)}.index{margin:0 0 var(--size-3);font-size:var(--font-size-00);font-weight:var(--font-weight-8);color:var(--brand);text-transform:uppercase}.title{margin:0;font-size:clamp(1.8rem,3.5vw,3.5rem);line-height:.95;letter-spacing:-.05em}.copy{margin:0;align-self:end;color:var(--text-secondary);line-height:1.7}.body{padding-block-start:var(--size-6)}@media(max-width:760px){.frame{width:calc(100% - 2rem)}.head{grid-template-columns:1fr}}`,
  )];
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
