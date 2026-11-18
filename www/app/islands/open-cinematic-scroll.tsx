/** @jsxImportSource @openelement/element */
/** One passive coordinator for the Cinematic V2 native scroll timeline. */

import { defineIslandConfig } from '@openelement/router';
import { onConnect, onDispose } from '@openelement/element/lifecycle';
import { readInstanceState, writeInstanceState } from '@openelement/ui/instance-state';

export const openElement = defineIslandConfig({ hydrate: 'load', ssr: true });

/**
 * The scroll-timeline coordinator: it reads the sibling `.cinematic-v2` film
 * once, then drives two custom properties from passive window listeners. The
 * generated lane hands it the host; all bookkeeping stays host-keyed exactly as
 * in the class lane, and `env.signal` (the CONNECTION-lifetime channel) is where
 * a disconnect releases the listeners.
 */
function OpenCinematicScroll() {
  onConnect((env) => {
    // The connect hook runs before the template mounts and before the sibling
    // film is queryable: defer one frame.
    const host = env.host;
    const frame = globalThis.requestAnimationFrame(() => {
      const root = host.getRootNode();
      const scope: ShadowRoot | HTMLElement =
        root instanceof globalThis.ShadowRoot
          ? root
          : (host.parentElement ?? globalThis.document.body);
      const film = scope.querySelector<HTMLElement>('.cinematic-v2');
      if (!film) return;
      const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const update = (): void => {
        writeInstanceState(host, 'frame', 0);
        const rect = film.getBoundingClientRect();
        const distance = Math.max(1, film.offsetHeight - globalThis.innerHeight);
        const progress = Math.min(1, Math.max(0, -rect.top / distance));
        film.style.setProperty('--film-progress', String(reduced ? 1 : progress));
        film.style.setProperty('--scene-progress', String(Math.min(6, progress * 4.2)));
      };
      const schedule = (): void => {
        const pending = readInstanceState(host, 'frame', () => 0);
        if (!pending) {
          writeInstanceState(host, 'frame', globalThis.requestAnimationFrame(update));
        }
      };
      const pointer = (event: PointerEvent): void => {
        if (event.pointerType !== 'mouse' || globalThis.innerWidth < 800) return;
        film.style.setProperty(
          '--pointer-x',
          String((event.clientX / globalThis.innerWidth - 0.5) * 2),
        );
        film.style.setProperty(
          '--pointer-y',
          String((event.clientY / globalThis.innerHeight - 0.5) * 2),
        );
      };
      globalThis.addEventListener('scroll', schedule, { passive: true });
      globalThis.addEventListener('resize', schedule, { passive: true });
      globalThis.addEventListener('pointermove', pointer, { passive: true });
      update();
      writeInstanceState(host, 'cleanup', () => {
        globalThis.removeEventListener('scroll', schedule);
        globalThis.removeEventListener('resize', schedule);
        globalThis.removeEventListener('pointermove', pointer);
        globalThis.cancelAnimationFrame(readInstanceState(host, 'frame', () => 0));
      });
    });
    writeInstanceState(host, 'pendingFrame', frame);
    env.signal.addEventListener(
      'abort',
      () => {
        globalThis.cancelAnimationFrame(readInstanceState(host, 'pendingFrame', () => 0));
        readInstanceState<(() => void) | undefined>(host, 'cleanup', () => undefined)?.();
        writeInstanceState(host, 'cleanup', undefined);
      },
      { once: true },
    );
  });
  onDispose((env) => {
    const host = env.host;
    globalThis.cancelAnimationFrame(readInstanceState(host, 'pendingFrame', () => 0));
    readInstanceState<(() => void) | undefined>(host, 'cleanup', () => undefined)?.();
    writeInstanceState(host, 'cleanup', undefined);
  });

  return <span aria-hidden='true'></span>;
}

export default OpenCinematicScroll;
