/**
 * @openelement/ui — the copy-feedback reset timer, per host.
 *
 * `open-code-block` shows a transient label (`Copied!` / `Failed`) and resets
 * it after the shared feedback window. The timer is per element and must be
 * re-armed (not stacked) when the user clicks again, and it must not outlive
 * the element's teardown. A WeakMap keyed by the host gives that lifetime
 * without a second state channel: the generated component writes its declared
 * `copyLabel` property, and the property-change callback in the component
 * owns the custom-state and timer bookkeeping.
 */
import { CODE_BLOCK_CONSTANTS } from './component-recipes.ts';

/** The generated element's declared property the reset writes. */
type CopyHost = HTMLElement & { copyLabel: string };

const timers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

/** Arm the reset for `host`, replacing a pending one. */
export function scheduleCopyReset(host: HTMLElement): void {
  cancelCopyReset(host);
  const timer = setTimeout(() => {
    timers.delete(host);
    (host as CopyHost).copyLabel = 'Copy';
  }, CODE_BLOCK_CONSTANTS.copyFeedbackMs);
  timers.set(host, timer);
}

/** Drop a pending reset (teardown, or a transition back to the idle label). */
export function cancelCopyReset(host: HTMLElement): void {
  const timer = timers.get(host);
  if (timer === undefined) return;
  clearTimeout(timer);
  timers.delete(host);
}
