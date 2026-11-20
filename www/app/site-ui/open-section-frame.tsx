/** @jsxImportSource @openelement/element */
/** Private WWW section frame for headings and evidence. */

import { defineIslandConfig } from '@openelement/router';

/**
 * Authored identity for a page-local component.
 *
 * `app/site-ui/` is neither the islands directory (whose tag is the file path's
 * convention) nor a package (whose tag is its manifest declaration), so this
 * module has no tag source at all unless it declares one. `tag` is that authored
 * fact: it is what admits the module to the generated-element lane. The emitted
 * descriptor still takes its tag from the host's site fact, so a committed
 * element and its registration cannot disagree.
 *
 * `root: 'light'` is the ROOT this component already had. The class lane
 * rendered it in the document tree, `www/site-chrome.css` selects
 * `open-section-frame > section` there (and the roadmap page's scoped rhythm
 * rules), and the built page carries `data-oe-light`. Declaring `shadow` would
 * be a behaviour change dressed as a migration.
 */
export const openElement = defineIslandConfig({
  root: 'light',
  tag: 'open-section-frame',
});

/**
 * Rules moved to the linked document stylesheet (www/site-chrome.css): a
 * function page's render owns no document-style sink, so the linked sheet
 * is the one delivery. See the site-chrome.css header.
 *
 * The component declares no property rows: the heading, the index line and the
 * body all arrive through the `index`, `title` and `copy` named slots plus the
 * default slot, so there is no reactive surface to bind.
 */
function OpenSectionFrame() {
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

export default OpenSectionFrame;
