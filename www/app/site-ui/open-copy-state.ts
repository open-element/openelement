/**
 * open-copy-state — the copy chip's idle-return timer.
 *
 * Kept outside the island module because the generated lane admits imported
 * functions as event-handler bindings but not module-local function
 * declarations. One WeakMap keys the timer by the rendered wrapper, so the
 * two copy controls on the homepage never cancel each other.
 */

const idleTimers = new WeakMap<Element, ReturnType<typeof globalThis.setTimeout>>();

/**
 * Dismiss a visible copy failure and clear its status. Return focus to the
 * copy trigger before the dismiss button disappears.
 */
export function dismissCopyFailure(event: Event): void {
  const button = event.currentTarget as HTMLButtonElement;
  const wrap = button.closest('.home-copy-wrap');
  const status = wrap?.querySelector('.home-copy-status');
  wrap?.querySelector<HTMLButtonElement>('.home-copy')?.focus({ preventScroll: true });
  if (status) status.textContent = '';
  wrap?.setAttribute('data-state', 'idle');
}

/** Cancel any pending idle return and put the visible label back now. */
export function returnToIdle(wrap: Element | null, button: HTMLButtonElement, label: string): void {
  if (!wrap) return;
  const prior = idleTimers.get(wrap);
  if (prior !== undefined) globalThis.clearTimeout(prior);
  idleTimers.delete(wrap);
  button.textContent = label;
  wrap.setAttribute('data-state', 'idle');
}

/** Put the visible label back after ~2s; the live region keeps the receipt. */
export function scheduleIdleLabel(
  wrap: Element | null,
  button: HTMLButtonElement,
  label: string,
): void {
  if (!wrap) return;
  const prior = idleTimers.get(wrap);
  if (prior !== undefined) globalThis.clearTimeout(prior);
  const timer = globalThis.setTimeout(() => {
    button.textContent = label;
    wrap.setAttribute('data-state', 'idle');
    idleTimers.delete(wrap);
  }, 2000);
  idleTimers.set(wrap, timer);
}
