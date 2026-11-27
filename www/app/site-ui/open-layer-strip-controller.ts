/**
 * open-layer-strip-controller — the layer probes' single-select group.
 *
 * The four rows ("All layers" + the three probes) are plain buttons in the page
 * render. This controller owns the three things CSS cannot: one
 * `aria-pressed="true"` at a time, a roving tabindex (one tab stop; arrows move
 * the selection and focus), and the shareable `#layer=dsd|html|hydrate` deep
 * link.
 *
 * Pressing the active probe again, pressing "All layers", or pressing Escape
 * from any row clears the selection and removes the hash from the URL.
 * `history.replaceState` preserves the page, scroll position, and history.
 *
 * Hover is NOT a selection. The page CSS gives a hovered row its own preview
 * treatment; only activation changes state, so a pointer passing over the group
 * can never rewrite what the reader chose (or the shared URL).
 */

/** Probe rows in DOM order; `all` is the explicit no-selection row. */
const LAYER_IDS = ['all', 'html', 'dsd', 'hydrate'] as const;

function selectedLayer(doc: Document): string {
  const params = new URLSearchParams(doc.defaultView?.location.hash.replace(/^#/, '') ?? '');
  const layer = params.get('layer') ?? '';
  return (LAYER_IDS as readonly string[]).includes(layer) && layer !== 'all' ? layer : 'all';
}

export function installLayerStrip(strip: HTMLElement, signal: AbortSignal): void {
  const buttons = Array.from(strip.querySelectorAll<HTMLButtonElement>('.home-layer'));
  if (buttons.length === 0) return;
  const doc = strip.ownerDocument;
  const view = doc.defaultView;

  /** Paint one selection across pressed state, tab stops and the deep link. */
  const apply = (active: HTMLButtonElement | null, options: { focus?: boolean } = {}): void => {
    for (const button of buttons) {
      const pressed = button === active;
      button.setAttribute('aria-pressed', pressed ? 'true' : 'false');
      // Exactly one tab stop: the pressed row. "All layers" is pressed in the
      // no-selection state, so the group never becomes unreachable.
      button.tabIndex = pressed ? 0 : -1;
    }
    if (active && options.focus) active.focus();
    if (!view) return;
    const layer = active?.dataset.layer ?? 'all';
    const currentHash = view.location.hash;
    // "All layers" clears a LAYER hash only: an unrelated anchor the reader
    // arrived with (#begin) is not ours to delete.
    const hasLayerParam = /(?:^#|&)layer=/.test(currentHash);
    const nextHash = layer === 'all' ? (hasLayerParam ? '' : currentHash) : `#layer=${layer}`;
    if (currentHash !== nextHash) {
      // replaceState, never a location write: no navigation, no scroll jump.
      view.history.replaceState(
        view.history.state,
        '',
        `${view.location.pathname}${view.location.search}${nextHash}`,
      );
    }
  };

  const buttonFor = (layer: string): HTMLButtonElement | null =>
    buttons.find((button) => button.dataset.layer === layer) ?? null;

  const onActivate = (event: Event): void => {
    const target = (event.target as Element | null)?.closest('.home-layer');
    if (!(target instanceof HTMLButtonElement) || !strip.contains(target)) return;
    const layer = target.dataset.layer ?? '';
    if (layer === 'all') {
      apply(target);
      return;
    }
    // Pressing the active probe again clears the selection (back to "all").
    const next = target.getAttribute('aria-pressed') === 'true' ? buttonFor('all') : target;
    apply(next);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const current = (event.target as Element | null)?.closest('.home-layer');
    if (!(current instanceof HTMLButtonElement)) return;
    // Escape returns the strip to All layers from any probe and moves focus
    // to the restored tab stop.
    if (event.key === 'Escape') {
      event.preventDefault();
      apply(buttonFor('all'), { focus: true });
      return;
    }
    const index = buttons.indexOf(current);
    if (index < 0) return;
    let next: number;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        next = (index + 1) % buttons.length;
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        next = (index - 1 + buttons.length) % buttons.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = buttons.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    apply(buttons[next] ?? null, { focus: true });
  };

  /** The deep link is the other input: honour it on load and on hashchange. */
  const syncFromHash = (): void => apply(buttonFor(selectedLayer(doc)));

  strip.addEventListener('click', onActivate);
  strip.addEventListener('keydown', onKeyDown);
  view?.addEventListener('hashchange', syncFromHash);
  syncFromHash();

  signal.addEventListener(
    'abort',
    () => {
      strip.removeEventListener('click', onActivate);
      strip.removeEventListener('keydown', onKeyDown);
      view?.removeEventListener('hashchange', syncFromHash);
    },
    { once: true },
  );
}
