/** @jsxImportSource @openelement/element */
/** Native-media mascot admitted through the v0.44 compiled island contract. */
import { defineIslandConfig } from '@openelement/app';
import { element, OpenElement } from '@openelement/element';
import { compiledStyle } from '../site-ui/compiled-style.ts';
import {
  installDragonLiveGaze,
  uninstallDragonLiveGaze,
} from '../site-ui/open-dragon-live-gaze-controller.ts';

export const openElement = defineIslandConfig({ hydrate: 'idle', ssr: true, dsd: true });

@element('open-dragon-live-gaze')
export default class DragonLiveGaze extends OpenElement {
  static override styles = [compiledStyle(`
  :host { display: block; width: 100%; height: 100%; }
  .stage {
    position: relative; margin: 0; width: 100%; height: 100%;
    background: var(--hero-ink); overflow: hidden; transform-origin: 46% 56%;
    animation: dragon-enter 2.2s cubic-bezier(.22,.61,.21,1) both, dragon-breathe 6.5s ease-in-out 2.3s infinite alternate;
  }
  /* Emerge from the dark — a slow settle, not a fade-in. */
  @keyframes dragon-enter { from { opacity: 0; transform: scale(1.05); } to { opacity: 1; transform: scale(1); } }
  /* A tiny, slow breath — felt more than seen. */
  @keyframes dragon-breathe {
    from { transform: scale(1) translateY(0); }
    to { transform: scale(1.016) translateY(-0.4%); }
  }
  .poster, .view, .idle-view { position: absolute; inset: 0; display: block; width: 100%; height: 100%; }
  .poster { object-fit: cover; }
  .view { visibility: hidden; z-index: 1; }
  .stage.live .view { visibility: visible; }
  .idle-view {
    z-index: 2; object-fit: cover; opacity: 0; pointer-events: none;
    transition: opacity .28s ease-out;
  }
  .stage.idling .idle-view { opacity: 1; transition-duration: .75s; }
  .stage::before, .stage::after { content: ""; position: absolute; inset: 0; z-index: 3; pointer-events: none; }
  /* A faint warm pool on the floor — grounds the creature on the black. */
  .stage::before { background: radial-gradient(34% 9% at 50% 83%, rgba(255,224,178,.07), transparent 72%); }
  /* Studio key light: a soft warm wash that leans a few percent toward the
     dragon's gaze — as if the viewer's attention were the light source. */
  .stage::after { background: radial-gradient(58% 46% at calc(46% + (var(--gaze, .5) - .5) * 14%) 36%, rgba(255,238,208,.09), transparent 70%); }
  /* Dust motes drifting through the key light — almost subliminal. */
  .mote {
    position: absolute; z-index: 3; width: 3px; height: 3px; border-radius: 50%;
    background: rgba(255,236,200,.55); filter: blur(1px); opacity: 0; pointer-events: none;
    animation: mote-drift 15s ease-in-out infinite;
  }
  .mote:nth-of-type(1) { left: 36%; top: 26%; animation-delay: -2s; animation-duration: 17s; }
  .mote:nth-of-type(2) { left: 44%; top: 40%; animation-delay: -7s; }
  .mote:nth-of-type(3) { left: 52%; top: 22%; animation-delay: -4s; animation-duration: 13s; }
  .mote:nth-of-type(4) { left: 58%; top: 48%; animation-delay: -11s; animation-duration: 18s; }
  .mote:nth-of-type(5) { left: 41%; top: 55%; animation-delay: -9s; animation-duration: 14s; }
  .mote:nth-of-type(6) { left: 61%; top: 33%; animation-delay: -5s; animation-duration: 16s; }
  .mote:nth-of-type(7) { left: 48%; top: 18%; animation-delay: -13s; animation-duration: 19s; }
  .mote:nth-of-type(8) { left: 33%; top: 44%; animation-delay: -1s; animation-duration: 12s; }
  @keyframes mote-drift {
    0%, 100% { transform: translate(0, 0); opacity: 0; }
    18% { opacity: .26; }
    50% { transform: translate(2.4rem, -3.2rem); opacity: .16; }
    82% { opacity: .22; }
  }
  /* Extreme ratios: cover would amputate horns or tail — contain instead;
     the letterbox is pure black on a pure black stage, i.e. invisible. */
  @media (max-aspect-ratio: 4/5), (min-aspect-ratio: 21/10) {
    .poster, .idle-view { object-fit: contain; }
  }
  @media (prefers-reduced-motion: reduce) { .stage { animation: none; } .mote { animation: none; opacity: 0; } }
`)];

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
      <figure class='stage'>
        <img
          class='poster'
          src='/assets/dragon-frames/f27.webp'
          alt='The OpenElement dragon — it turns its head to watch your cursor.'
          draggable={false}
        />
        <canvas class='view' aria-hidden='true'></canvas>
        <video
          class='idle-view'
          src='/assets/dragon-idle.mp4'
          muted
          loop
          playsinline
          preload='none'
          aria-hidden='true'
        >
        </video>
        <i class='mote'></i>
        <i class='mote'></i>
        <i class='mote'></i>
        <i class='mote'></i>
        <i class='mote'></i>
        <i class='mote'></i>
        <i class='mote'></i>
        <i class='mote'></i>
      </figure>
    );
  }
}
