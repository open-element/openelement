/**
 * open-source-overflow — mark a source <pre> that scrolls horizontally.
 *
 * The pre owns the horizontal scroll; the wrapper owns the right-edge fade
 * and the "scroll →" cue. This controller writes only two empty data
 * attributes from measured geometry (`scrollWidth`/`clientWidth`/`scrollLeft`)
 * and re-syncs on scroll, resize and font load. No state is copied; at the
 * end both attributes drop and the CSS removes the affordances.
 */
export function installOverflowCue(host: HTMLElement, target: string): () => void {
  const doc = host.ownerDocument;
  let panel: HTMLElement | null = null;
  let pre: HTMLElement | null = null;
  let observer: ResizeObserver | null = null;
  let disposed = false;

  const sync = () => {
    if (disposed || !panel || !pre) return;
    const overflow = pre.scrollWidth > pre.clientWidth + 1;
    if (!overflow) {
      panel.removeAttribute('data-source-overflow');
      panel.removeAttribute('data-source-end');
      return;
    }
    panel.setAttribute('data-source-overflow', '');
    const atEnd = pre.scrollLeft + pre.clientWidth >= pre.scrollWidth - 1;
    panel.toggleAttribute('data-source-end', atEnd);
  };

  const bind = () => {
    if (disposed) return;
    panel = target ? doc.getElementById(target) : null;
    pre = panel?.querySelector('pre') ?? null;
    if (!panel || !pre) return;
    pre.addEventListener('scroll', sync, { passive: true });
    observer = new ResizeObserver(sync);
    observer.observe(pre);
    sync();
    // Metrics change once the self-hosted faces land; measure the final font,
    // not the fallback.
    doc.fonts?.ready.then(sync, () => {});
  };

  // The toggle is rendered before its target in the editor bar; one macrotask
  // lands the lookup after the surrounding markup is in the document.
  const timer = globalThis.setTimeout(bind, 0);

  return () => {
    disposed = true;
    globalThis.clearTimeout(timer);
    observer?.disconnect();
    pre?.removeEventListener('scroll', sync);
  };
}
