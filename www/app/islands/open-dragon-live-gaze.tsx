/** @jsxImportSource @openelement/element */
/** Native-media mascot admitted through the v0.44 compiled island contract. */
import { defineIslandConfig } from '@openelement/router';
import { element, OpenElement } from '@openelement/element';
import {
  installDragonLiveGaze,
  uninstallDragonLiveGaze,
} from '../site-ui/open-dragon-live-gaze-controller.ts';

export const openElement = defineIslandConfig({ hydrate: 'idle', ssr: true });

/**
 * Presentation is authored as Tailwind utilities on this markup (alpha15
 * utility-first migration); the sheet keeps only the host box, the stage's
 * two entrance/breath animations with their keyframes and reduced-motion
 * opt-out, the two light pseudo-elements, and the mote drift's timing
 * stagger — each with its reason in open-dragon-live-gaze.css.
 *
 * The `live`/`idling` class tokens are toggled at run time by
 * open-dragon-live-gaze-controller.ts (never by the compiler), so the state
 * rules they select are authored on the elements they style as `[.live_&]:`
 * / `[.idling_&]:` utilities.
 */
@element('open-dragon-live-gaze')
export default class DragonLiveGaze extends OpenElement {
  // Rules moved to the linked document stylesheet (www/site-chrome.css).

  override connectedCallback(): void {
    super.connectedCallback();
    installDragonLiveGaze(this);
  }

  override disconnectedCallback(): void {
    uninstallDragonLiveGaze(this);
    super.disconnectedCallback();
  }

  render() {
    return (
      <figure class='stage relative m-0 h-full w-full overflow-hidden bg-(--hero-ink) origin-[46%_56%]'>
        <img
          class='poster absolute inset-0 block h-full w-full object-cover [@media(max-aspect-ratio:4/5)]:object-contain [@media(min-aspect-ratio:21/10)]:object-contain'
          src='https://assets.openelement.org/site/v1/dragon/frames/f27.webp'
          alt='The OpenElement dragon — it turns its head to watch your cursor.'
          crossorigin='anonymous'
          draggable={false}
        />
        <canvas
          class='invisible absolute inset-0 z-1 block h-full w-full [.live_&]:visible'
          aria-hidden='true'
        ></canvas>
        <video
          class='idle-view absolute inset-0 z-2 block h-full w-full object-cover opacity-0 pointer-events-none transition-opacity duration-[280ms] ease-[ease-out] [.idling_&]:opacity-100 [.idling_&]:duration-[750ms]'
          src='https://assets.openelement.org/site/v1/dragon/dragon-idle.mp4'
          crossorigin='anonymous'
          muted
          loop
          playsinline
          preload='none'
          aria-hidden='true'
        ></video>
        <i class='mote absolute z-3 size-[3px] rounded-full bg-[rgba(255,236,200,.55)] blur-[1px] opacity-0 pointer-events-none [&:nth-of-type(1)]:left-[36%] [&:nth-of-type(1)]:top-[26%]'></i>
        <i class='mote absolute z-3 size-[3px] rounded-full bg-[rgba(255,236,200,.55)] blur-[1px] opacity-0 pointer-events-none [&:nth-of-type(2)]:left-[44%] [&:nth-of-type(2)]:top-[40%]'></i>
        <i class='mote absolute z-3 size-[3px] rounded-full bg-[rgba(255,236,200,.55)] blur-[1px] opacity-0 pointer-events-none [&:nth-of-type(3)]:left-[52%] [&:nth-of-type(3)]:top-[22%]'></i>
        <i class='mote absolute z-3 size-[3px] rounded-full bg-[rgba(255,236,200,.55)] blur-[1px] opacity-0 pointer-events-none [&:nth-of-type(4)]:left-[58%] [&:nth-of-type(4)]:top-[48%]'></i>
        <i class='mote absolute z-3 size-[3px] rounded-full bg-[rgba(255,236,200,.55)] blur-[1px] opacity-0 pointer-events-none [&:nth-of-type(5)]:left-[41%] [&:nth-of-type(5)]:top-[55%]'></i>
        <i class='mote absolute z-3 size-[3px] rounded-full bg-[rgba(255,236,200,.55)] blur-[1px] opacity-0 pointer-events-none [&:nth-of-type(6)]:left-[61%] [&:nth-of-type(6)]:top-[33%]'></i>
        <i class='mote absolute z-3 size-[3px] rounded-full bg-[rgba(255,236,200,.55)] blur-[1px] opacity-0 pointer-events-none [&:nth-of-type(7)]:left-[48%] [&:nth-of-type(7)]:top-[18%]'></i>
        <i class='mote absolute z-3 size-[3px] rounded-full bg-[rgba(255,236,200,.55)] blur-[1px] opacity-0 pointer-events-none [&:nth-of-type(8)]:left-[33%] [&:nth-of-type(8)]:top-[44%]'></i>
      </figure>
    );
  }
}
