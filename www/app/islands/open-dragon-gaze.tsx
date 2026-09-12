/** @jsxImportSource @openelement/element */
/** Native-media mascot admitted through the v0.44 compiled island contract. */
import { defineIslandConfig } from '@openelement/app';
import { element, OpenElement } from '@openelement/element';
import { compiledStyle } from '../site-ui/compiled-style.ts';

export const openElement = defineIslandConfig({ hydrate: 'idle', ssr: true, dsd: true });

@element('open-dragon-gaze')
export default class DragonGaze extends OpenElement {
  static override styles = [compiledStyle(`
  :host { display: block; }
  .rig { position: relative; margin: 0; aspect-ratio: 939 / 906; }
  .still { position: absolute; inset: 0; z-index: 1; width: 100%; height: 100%; }
  canvas { position: absolute; inset: 0; z-index: 2; width: 100%; height: 100%; display: block; }
  .ground { position: absolute; z-index: 0; left: 14%; right: 8%; bottom: 2.5%; height: 7%; border-radius: 50%; background: radial-gradient(50% 50% at 50% 50%, rgba(64, 52, 42, .26), transparent 70%); filter: blur(5px); }
`)];

  render() {
    return (
      <figure class='rig'>
        <span class='ground' aria-hidden='true'></span>
        <img
          class='still'
          src='/assets/dragon-center.webp'
          width='939'
          height='906'
          alt='The OpenElement dragon.'
          fetchpriority='high'
          decoding='async'
        />
      </figure>
    );
  }
}
