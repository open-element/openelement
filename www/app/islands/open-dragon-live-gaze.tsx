/** @jsxImportSource @openelement/element */
/** Native-media mascot admitted through the v0.44 compiled island contract. */
import { defineIslandConfig } from '@openelement/router';
import { element, OpenElement } from '@openelement/element';
import {
  installDragonLiveGaze,
  uninstallDragonLiveGaze,
} from '../site-ui/open-dragon-live-gaze-controller.ts';
import openDragonLiveGazeStyles from './open-dragon-live-gaze.css';

export const openElement = defineIslandConfig({ hydrate: 'idle', ssr: true });

@element('open-dragon-live-gaze')
export default class DragonLiveGaze extends OpenElement {
  static override styles = [openDragonLiveGazeStyles];

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
          src='https://assets.openelement.org/site/v1/dragon/frames/f27.webp'
          alt='The OpenElement dragon — it turns its head to watch your cursor.'
          crossorigin='anonymous'
          draggable={false}
        />
        <canvas class='view' aria-hidden='true'></canvas>
        <video
          class='idle-view'
          src='https://assets.openelement.org/site/v1/dragon/dragon-idle.mp4'
          crossorigin='anonymous'
          muted
          loop
          playsinline
          preload='none'
          aria-hidden='true'
        ></video>
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
