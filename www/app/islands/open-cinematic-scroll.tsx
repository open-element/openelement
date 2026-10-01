/** @jsxImportSource @openelement/element */
/** One passive coordinator for the Cinematic V2 native scroll timeline. */

import { element, OpenElement } from '@openelement/element';
import { compiledStyle } from '../site-ui/compiled-style.ts';
import { readInstanceState, writeInstanceState } from '@openelement/ui/instance-state';
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ hydrate: 'load', ssr: true });

@element('open-cinematic-scroll')
export default class CinematicScroll extends OpenElement {
  static override styles = [
    compiledStyle(
      `:host{position:absolute;width:1px;height:1px;overflow:hidden;pointer-events:none}`,
    ),
  ];
  override connectedCallback(): void {
    super.connectedCallback();
    const root = this.getRootNode();
    const scope: ShadowRoot | HTMLElement =
      root instanceof ShadowRoot ? root : (this.parentElement ?? document.body);
    const film = scope.querySelector<HTMLElement>('.cinematic-v2');
    if (!film) return;
    const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const update = () => {
      writeInstanceState(this, 'frame', 0);
      const rect = film.getBoundingClientRect();
      const distance = Math.max(1, film.offsetHeight - innerHeight);
      const progress = Math.min(1, Math.max(0, -rect.top / distance));
      film.style.setProperty('--film-progress', String(reduced ? 1 : progress));
      // A longer six-act cadence keeps each transformation legible instead of
      // collapsing the whole composition into the first wheel gesture.
      film.style.setProperty('--scene-progress', String(Math.min(6, progress * 4.2)));
    };
    const schedule = () => {
      const frame = readInstanceState(this, 'frame', () => 0);
      if (!frame) writeInstanceState(this, 'frame', requestAnimationFrame(update));
    };
    const pointer = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || innerWidth < 800) return;
      film.style.setProperty('--pointer-x', String((event.clientX / innerWidth - 0.5) * 2));
      film.style.setProperty('--pointer-y', String((event.clientY / innerHeight - 0.5) * 2));
    };
    addEventListener('scroll', schedule, { passive: true });
    addEventListener('resize', schedule, { passive: true });
    addEventListener('pointermove', pointer, { passive: true });
    update();
    writeInstanceState(this, 'cleanup', () => {
      removeEventListener('scroll', schedule);
      removeEventListener('resize', schedule);
      removeEventListener('pointermove', pointer);
      cancelAnimationFrame(readInstanceState(this, 'frame', () => 0));
    });
  }

  override disconnectedCallback(): void {
    readInstanceState<(() => void) | undefined>(this, 'cleanup', () => undefined)?.();
    writeInstanceState(this, 'cleanup', undefined);
    super.disconnectedCallback();
  }

  render() {
    return <span aria-hidden='true'></span>;
  }
}
