/**
 * Shared plumbing for the pre-upgrade capture/replay suites (and the shadow
 * replay suite): the composed click event, the suite cleanup detach, and the
 * connected pending-host factory. Imports only types plus the two classes
 * from facade-dom — no globals are touched at module-eval time, so suites can
 * import it before or after installFacadeDom().
 */
import { FacadeElement, FacadeEvent } from './facade-dom.ts';
import type { FacadeDom } from './facade-dom.ts';

/** A composed, bubbling click dispatched through the fake-DOM event type. */
export function click(): FacadeEvent {
  return new FacadeEvent('click', { bubbles: true, composed: true });
}

/** Detach the given hosts from their parents (suite cleanup). */
export function cleanup(...hosts: FacadeElement[]): void {
  for (const host of hosts) {
    if (host.parentNode) host.parentNode.removeChild(host);
  }
}

// oxlint-disable-next-line no-explicit-any
type AnyElement = any;

/** A connected dash-tagged pending host with one button child. */
export function pendingHost(
  dom: FacadeDom,
  tag: string,
): { host: FacadeElement; button: AnyElement } {
  const host = new FacadeElement(tag, dom.document);
  const button = new FacadeElement('button', dom.document);
  host.appendChild(button);
  dom.document.body.appendChild(host);
  return { host, button };
}
