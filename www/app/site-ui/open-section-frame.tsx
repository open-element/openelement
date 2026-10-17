/** @jsxImportSource @openelement/element */
/** Private WWW section frame for headings and evidence. */

import { element, OpenElement } from '@openelement/element';

@element('open-section-frame')
export default class OpenSectionFrame extends OpenElement {
  // Rules moved to the linked document stylesheet (www/site-chrome.css): a
  // function page's render owns no document-style sink, so the linked sheet
  // is the one delivery. See the site-chrome.css header.
  render() {
    return (
      <section class='w-[calc(100%-2rem)] mx-auto mt-[clamp(4rem,10vh,8rem)] min-[761px]:w-[min(1180px,calc(100%-3rem))]'>
        <header class='grid grid-cols-1 gap-[clamp(1.5rem,6vw,6rem)] pb-6 border-b border-border min-[761px]:grid-cols-[minmax(0,0.5fr)_minmax(0,0.5fr)]'>
          <div>
            <p class='mt-0 mb-3 text-(length:--text-xs) font-extrabold text-primary uppercase'>
              <slot name='index'></slot>
            </p>
            <h2 class='m-0 text-balance text-[clamp(1.8rem,3.5vw,3.5rem)] leading-[0.95] tracking-[-0.05em]'>
              <slot name='title'></slot>
            </h2>
          </div>
          <p class='m-0 self-end text-muted-foreground leading-[1.7]'>
            <slot name='copy'></slot>
          </p>
        </header>
        <div class='pt-6'>
          <slot></slot>
        </div>
      </section>
    );
  }
}
