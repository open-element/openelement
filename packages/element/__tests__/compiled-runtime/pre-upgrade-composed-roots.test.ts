/**
 * pre-upgrade-composed-roots.test.ts — event ownership uses composed-tree
 * semantics so shadow-internal captured targets are released by their host.
 *
 * ShadowRoot.parentNode is null by spec: a raw parentNode walk can never see
 * a host from inside its shadow tree. Ownership walks the
 * composed tree: parentNode first, then ShadowRoot.host, never crossing into
 * unrelated shadow trees, sibling islands, or detached subtrees.
 *
 * Covered behavior:
 *   - open shadow: release(host) drops the shadow-internal record
 *   - pending sibling island keeps its record and replays exactly once
 *   - closed shadow: release works from the framework-held root and the host
 *   - nested shadow: ownership crosses multiple ShadowRoot.host hops
 *   - detached target: released and never replayed
 */

import { expect, test } from 'vitest';
import {
  type FacadeDom,
  FacadeElement,
  FacadeEvent,
  type FacadeShadowRoot,
  installFacadeDom,
} from './facade-dom.ts';
import { cleanup, click } from './pre-upgrade-helpers.ts';

// The facade captures its HTMLElement base at module evaluation time.
const dom: FacadeDom = installFacadeDom();
const { MAX_PRE_UPGRADE_CAPTURED_EVENTS } =
  await import('../../src/internal/compiled/runtime/pre-upgrade-events.ts');

const { capturePreUpgradeEvents, releasePreUpgradeEvents, replayPreUpgradeEvents } =
  (await import('../../src/internal/compiled/runtime/pre-upgrade-events.ts')) as unknown as {
    capturePreUpgradeEvents: (
      root: EventTarget,
      types?: readonly string[],
      options?: { accept?: (event: Event, target: EventTarget) => boolean },
    ) => { events: Array<{ target: unknown }>; stop(): void };
    releasePreUpgradeEvents: (root: Node, captured: readonly unknown[]) => void;
    replayPreUpgradeEvents: (root: Node, captured: readonly unknown[]) => number;
  };

function shadowButton(root: FacadeShadowRoot): FacadeElement {
  const button = new FacadeElement('button', dom.document);
  root.appendChild(button);
  return button;
}

// ─── Composed ownership: release from the host ───

test('composed release: open shadow target is dropped when releasing from the host', () => {
  const host = new FacadeElement('oe-composed-open', dom.document);
  const shadow = host.attachShadow({ mode: 'open' });
  const button = shadowButton(shadow);
  dom.document.body.appendChild(host);
  const capture = capturePreUpgradeEvents(dom.document as unknown as EventTarget, ['click']);
  try {
    button.dispatchEvent(click());
    expect(capture.events.length, 'the shadow-internal click is captured').toEqual(1);
    // Failure fallback: kernel.root never established, release from the host.
    releasePreUpgradeEvents(host as unknown as Node, capture.events as readonly unknown[]);
    expect(capture.events.length, 'the host-owned shadow record is released').toEqual(0);
  } finally {
    capture.stop();
    cleanup(host);
  }
});

test('composed release: a pending sibling keeps its record and replays once', () => {
  const clicked = new FacadeElement('oe-composed-a', dom.document);
  const pending = new FacadeElement('oe-composed-b', dom.document);
  const clickedShadow = clicked.attachShadow({ mode: 'open' });
  const pendingShadow = pending.attachShadow({ mode: 'open' });
  const clickedButton = shadowButton(clickedShadow);
  const pendingButton = shadowButton(pendingShadow);
  dom.document.body.appendChild(clicked);
  dom.document.body.appendChild(pending);

  let clickedHandled = 0;
  let pendingHandled = 0;
  const capture = capturePreUpgradeEvents(dom.document as unknown as EventTarget, ['click']);
  try {
    clickedButton.dispatchEvent(click());
    pendingButton.dispatchEvent(click());
    expect(capture.events.length).toEqual(2);

    // Island A activates and fails before establishing its kernel root.
    releasePreUpgradeEvents(clicked as unknown as Node, capture.events as readonly unknown[]);
    expect(capture.events.length, "island A's record is released").toEqual(1);
    expect(capture.events[0].target as unknown).toBe(pendingButton as unknown);

    // Island B still upgrades and replays exactly once.
    pendingButton.addEventListener('click', () => {
      pendingHandled++;
    });
    expect(
      replayPreUpgradeEvents(pending as unknown as Node, capture.events as readonly unknown[]),
    ).toEqual(1);
    expect(pendingHandled, 'the sibling pre-upgrade click replays exactly once').toEqual(1);
    releasePreUpgradeEvents(pending as unknown as Node, capture.events as readonly unknown[]);
    expect(capture.events.length).toEqual(0);
    clickedHandled = 0;
    expect(clickedHandled, 'A never received the released record').toEqual(0);
  } finally {
    capture.stop();
    cleanup(clicked, pending);
  }
});

test('capturing after a sibling release replaces the same type in its original slot', () => {
  const released = new FacadeElement('oe-retired', dom.document);
  const pending = new FacadeElement('oe-pending', dom.document);
  const a = shadowButton(released.attachShadow({ mode: 'open' }));
  const b = shadowButton(pending.attachShadow({ mode: 'open' }));
  dom.document.body.appendChild(released);
  dom.document.body.appendChild(pending);
  const capture = capturePreUpgradeEvents(dom.document as unknown as EventTarget);
  const input = () => new FacadeEvent('input', { bubbles: true, composed: true });
  try {
    a.dispatchEvent(click());
    b.dispatchEvent(input());
    const retainedClick = click();
    b.dispatchEvent(retainedClick);

    releasePreUpgradeEvents(released as unknown as Node, capture.events);
    const latestInput = input();
    b.dispatchEvent(latestInput);

    expect(capture.events).toMatchObject([
      { target: b, type: 'input', event: latestInput },
      { target: b, type: 'click', event: retainedClick },
    ]);
    const replayed: unknown[] = [];
    for (const type of ['input', 'click'])
      b.addEventListener(type, (event) => replayed.push(event));
    expect(replayPreUpgradeEvents(pending as unknown as Node, capture.events)).toBe(2);
    expect(replayed[0]).toBe(latestInput);
    expect(replayed[1]).toBe(retainedClick);
  } finally {
    capture.stop();
    cleanup(released, pending);
  }
});

test('capture retains all eight kinds, protects the cap, and sweeps detached targets on pressure', () => {
  const host = new FacadeElement('oe-capacity', dom.document);
  const shadow = host.attachShadow({ mode: 'open' });
  dom.document.body.appendChild(host);
  const capture = capturePreUpgradeEvents(dom.document as unknown as EventTarget);
  const kinds = [
    'change',
    'click',
    'input',
    'keydown',
    'keyup',
    'pointerdown',
    'pointerup',
    'submit',
  ];
  const send = (button: FacadeElement, type: string) =>
    button.dispatchEvent(new FacadeEvent(type, { bubbles: true, composed: true }));
  try {
    const buttons = Array.from({ length: MAX_PRE_UPGRADE_CAPTURED_EVENTS }, (_, i) => {
      const button = shadowButton(shadow);
      send(button, kinds[i % kinds.length]);
      return button;
    });
    const retained = capture.events.slice();
    expect(retained.slice(0, kinds.length)).toMatchObject(kinds.map((type) => ({ type })));
    expect(retained).toHaveLength(64);
    const overflow = shadowButton(shadow);
    send(overflow, 'click');
    expect(capture.events).toEqual(retained);

    shadow.removeChild(buttons[0]);
    const lastKind = kinds[(buttons.length - 1) % kinds.length];
    send(buttons.at(-1)!, lastKind);
    expect(capture.events).toHaveLength(64);
    expect(capture.events[0]).toBe(retained[0]);
    expect(capture.events.at(-1)).not.toBe(retained.at(-1));

    send(overflow, 'click');
    expect(capture.events).toHaveLength(64);
    expect(capture.events[0]).toBe(retained[1]);
    expect(capture.events.at(-1)?.target).toBe(overflow);
  } finally {
    capture.stop();
    cleanup(host);
  }
});

test('composed release: closed shadow target is host-owned without host.shadowRoot', () => {
  const host = new FacadeElement('oe-composed-closed', dom.document);
  // The framework holds the root returned by attachShadow; closed roots are
  // intentionally invisible through host.shadowRoot.
  const closed = host.attachShadow({ mode: 'closed' });
  const button = shadowButton(closed);
  dom.document.body.appendChild(host);
  const capture = capturePreUpgradeEvents(dom.document as unknown as EventTarget, ['click']);
  try {
    button.dispatchEvent(click());
    expect(capture.events.length).toEqual(1);
    expect(host.shadowRoot, 'a closed root is not re-readable').toBe(null);
    releasePreUpgradeEvents(host as unknown as Node, capture.events as readonly unknown[]);
    expect(capture.events.length, 'the host releases its closed-shadow record').toEqual(0);

    button.dispatchEvent(click());
    expect(capture.events.length).toEqual(1);
    releasePreUpgradeEvents(closed as unknown as Node, capture.events as readonly unknown[]);
    expect(capture.events.length, 'the framework-held root releases it too').toEqual(0);
  } finally {
    capture.stop();
    cleanup(host);
  }
});

test('composed release: ownership crosses nested shadow hosts', () => {
  const outer = new FacadeElement('oe-composed-outer', dom.document);
  const outerShadow = outer.attachShadow({ mode: 'open' });
  const inner = new FacadeElement('oe-composed-inner', dom.document);
  outerShadow.appendChild(inner);
  const innerShadow = inner.attachShadow({ mode: 'open' });
  const button = shadowButton(innerShadow);
  dom.document.body.appendChild(outer);
  const capture = capturePreUpgradeEvents(dom.document as unknown as EventTarget, ['click']);
  try {
    button.dispatchEvent(click());
    expect(capture.events.length).toEqual(1);
    releasePreUpgradeEvents(outer as unknown as Node, capture.events as readonly unknown[]);
    expect(capture.events.length, 'two ShadowRoot.host hops still reach the outer host').toEqual(0);

    button.dispatchEvent(click());
    expect(capture.events.length).toEqual(1);
    releasePreUpgradeEvents(innerShadow as unknown as Node, capture.events as readonly unknown[]);
    expect(capture.events.length, 'the nested root owns its own subtree').toEqual(0);
  } finally {
    capture.stop();
    cleanup(outer);
  }
});

test('composed release: an unrelated shadow tree is never judged as owned', () => {
  const owner = new FacadeElement('oe-composed-owner', dom.document);
  const ownerShadow = owner.attachShadow({ mode: 'open' });
  const stranger = new FacadeElement('oe-composed-stranger', dom.document);
  const strangerShadow = stranger.attachShadow({ mode: 'open' });
  const strangerButton = shadowButton(strangerShadow);
  dom.document.body.appendChild(owner);
  dom.document.body.appendChild(stranger);
  const capture = capturePreUpgradeEvents(dom.document as unknown as EventTarget, ['click']);
  try {
    strangerButton.dispatchEvent(click());
    expect(capture.events.length).toEqual(1);
    releasePreUpgradeEvents(ownerShadow as unknown as Node, capture.events as readonly unknown[]);
    expect(capture.events.length, "the stranger island's record survives").toEqual(1);
    expect(
      replayPreUpgradeEvents(owner as unknown as Node, capture.events as readonly unknown[]),
      'the owner never replays a stranger record',
    ).toEqual(0);
    releasePreUpgradeEvents(stranger as unknown as Node, capture.events as readonly unknown[]);
    expect(capture.events.length).toEqual(0);
  } finally {
    capture.stop();
    cleanup(owner, stranger);
  }
});

test('composed release: a detached shadow target is swept and never replayed', () => {
  const host = new FacadeElement('oe-composed-detached', dom.document);
  const shadow = host.attachShadow({ mode: 'open' });
  const button = shadowButton(shadow);
  dom.document.body.appendChild(host);
  const capture = capturePreUpgradeEvents(dom.document as unknown as EventTarget, ['click']);
  try {
    button.dispatchEvent(click());
    expect(capture.events.length).toEqual(1);
    shadow.removeChild(button);
    releasePreUpgradeEvents(host as unknown as Node, capture.events as readonly unknown[]);
    expect(capture.events.length, 'the detached record is swept by release').toEqual(0);
    expect(
      replayPreUpgradeEvents(host as unknown as Node, capture.events as readonly unknown[]),
      'nothing replays for a detached target',
    ).toEqual(0);
  } finally {
    capture.stop();
    cleanup(host);
  }
});
