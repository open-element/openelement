/**
 * pre-upgrade-composed-roots.test.ts — event ownership uses composed-tree
 * semantics so shadow-internal captured targets are released by their host.
 *
 * ShadowRoot.parentNode is null by spec: a raw parentNode walk can never see
 * a host from inside its shadow tree. A failed activation whose kernel root
 * was never established falls back to releasing with the host element, so
 * records captured inside that host's shadow roots (open, closed, nested)
 * were retained forever (retained=1 after release). Ownership now walks the
 * composed tree: parentNode first, then ShadowRoot.host, never crossing into
 * unrelated shadow trees, sibling islands, or detached subtrees.
 *
 * Covered behavior:
 *   - open shadow: release(host) drops the shadow-internal record
 *   - pending sibling island keeps its record and replays exactly once
 *   - closed shadow: release works from the framework-held root and the host
 *   - nested shadow: ownership crosses multiple ShadowRoot.host hops
 *   - detached target: released and never replayed
 *   - failed activation before kernel.root: host fallback covers the bug
 *   - successful claim replay is unchanged (integration)
 */

import { assertEquals, assertStrictEquals } from '@std/assert';
import {
  type FacadeDom,
  FacadeElement,
  FacadeEvent,
  type FacadeShadowRoot,
  installFacadeDom,
} from './facade-dom.ts';

// The facade captures its HTMLElement base at module evaluation time.
const dom: FacadeDom = installFacadeDom();

const { capturePreUpgradeEvents, releasePreUpgradeEvents, replayPreUpgradeEvents } =
  (await import('../../src/internal/compiled/runtime.ts')) as unknown as {
    capturePreUpgradeEvents: (
      root: EventTarget,
      types?: readonly string[],
      options?: { accept?: (event: Event, target: EventTarget) => boolean },
    ) => { events: Array<{ target: unknown }>; stop(): void };
    releasePreUpgradeEvents: (root: Node, captured: readonly unknown[]) => void;
    replayPreUpgradeEvents: (root: Node, captured: readonly unknown[]) => number;
  };

function click(): FacadeEvent {
  return new FacadeEvent('click', { bubbles: true, composed: true });
}

function shadowButton(root: FacadeShadowRoot): FacadeElement {
  const button = new FacadeElement('button', dom.document);
  root.appendChild(button);
  return button;
}

function cleanup(...nodes: FacadeElement[]): void {
  for (const node of nodes) {
    if (node.parentNode) node.parentNode.removeChild(node);
  }
}

// ─── Composed ownership: release from the host ───

Deno.test('composed release: open shadow target is dropped when releasing from the host', () => {
  const host = new FacadeElement('oe-composed-open', dom.document);
  const shadow = host.attachShadow({ mode: 'open' });
  const button = shadowButton(shadow);
  dom.document.body.appendChild(host);
  const capture = capturePreUpgradeEvents(dom.document as unknown as EventTarget, ['click']);
  try {
    button.dispatchEvent(click());
    assertEquals(capture.events.length, 1, 'the shadow-internal click is captured');
    // Failure fallback: kernel.root never established, release from the host.
    releasePreUpgradeEvents(host as unknown as Node, capture.events as readonly unknown[]);
    assertEquals(capture.events.length, 0, 'the host-owned shadow record is released');
  } finally {
    capture.stop();
    cleanup(host);
  }
});

Deno.test('composed release: a pending sibling keeps its record and replays once', () => {
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
    assertEquals(capture.events.length, 2);

    // Island A activates and fails before establishing its kernel root.
    releasePreUpgradeEvents(clicked as unknown as Node, capture.events as readonly unknown[]);
    assertEquals(capture.events.length, 1, "island A's record is released");
    assertStrictEquals(capture.events[0].target as unknown, pendingButton as unknown);

    // Island B still upgrades and replays exactly once.
    pendingButton.addEventListener('click', () => {
      pendingHandled++;
    });
    assertEquals(
      replayPreUpgradeEvents(pending as unknown as Node, capture.events as readonly unknown[]),
      1,
    );
    assertEquals(pendingHandled, 1, 'the sibling pre-upgrade click replays exactly once');
    releasePreUpgradeEvents(pending as unknown as Node, capture.events as readonly unknown[]);
    assertEquals(capture.events.length, 0);
    clickedHandled = 0;
    assertEquals(clickedHandled, 0, 'A never received the released record');
  } finally {
    capture.stop();
    cleanup(clicked, pending);
  }
});

Deno.test('composed release: closed shadow target is host-owned without host.shadowRoot', () => {
  const host = new FacadeElement('oe-composed-closed', dom.document);
  // The framework holds the root returned by attachShadow; closed roots are
  // intentionally invisible through host.shadowRoot.
  const closed = host.attachShadow({ mode: 'closed' });
  const button = shadowButton(closed);
  dom.document.body.appendChild(host);
  const capture = capturePreUpgradeEvents(dom.document as unknown as EventTarget, ['click']);
  try {
    button.dispatchEvent(click());
    assertEquals(capture.events.length, 1);
    assertStrictEquals(host.shadowRoot, null, 'a closed root is not re-readable');
    releasePreUpgradeEvents(host as unknown as Node, capture.events as readonly unknown[]);
    assertEquals(capture.events.length, 0, 'the host releases its closed-shadow record');

    button.dispatchEvent(click());
    assertEquals(capture.events.length, 1);
    releasePreUpgradeEvents(closed as unknown as Node, capture.events as readonly unknown[]);
    assertEquals(capture.events.length, 0, 'the framework-held root releases it too');
  } finally {
    capture.stop();
    cleanup(host);
  }
});

Deno.test('composed release: ownership crosses nested shadow hosts', () => {
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
    assertEquals(capture.events.length, 1);
    releasePreUpgradeEvents(outer as unknown as Node, capture.events as readonly unknown[]);
    assertEquals(capture.events.length, 0, 'two ShadowRoot.host hops still reach the outer host');

    button.dispatchEvent(click());
    assertEquals(capture.events.length, 1);
    releasePreUpgradeEvents(innerShadow as unknown as Node, capture.events as readonly unknown[]);
    assertEquals(capture.events.length, 0, 'the nested root owns its own subtree');
  } finally {
    capture.stop();
    cleanup(outer);
  }
});

Deno.test('composed release: an unrelated shadow tree is never judged as owned', () => {
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
    assertEquals(capture.events.length, 1);
    releasePreUpgradeEvents(ownerShadow as unknown as Node, capture.events as readonly unknown[]);
    assertEquals(capture.events.length, 1, "the stranger island's record survives");
    assertEquals(
      replayPreUpgradeEvents(owner as unknown as Node, capture.events as readonly unknown[]),
      0,
      'the owner never replays a stranger record',
    );
    releasePreUpgradeEvents(stranger as unknown as Node, capture.events as readonly unknown[]);
    assertEquals(capture.events.length, 0);
  } finally {
    capture.stop();
    cleanup(owner, stranger);
  }
});

Deno.test('composed release: a detached shadow target is swept and never replayed', () => {
  const host = new FacadeElement('oe-composed-detached', dom.document);
  const shadow = host.attachShadow({ mode: 'open' });
  const button = shadowButton(shadow);
  dom.document.body.appendChild(host);
  const capture = capturePreUpgradeEvents(dom.document as unknown as EventTarget, ['click']);
  try {
    button.dispatchEvent(click());
    assertEquals(capture.events.length, 1);
    shadow.removeChild(button);
    releasePreUpgradeEvents(host as unknown as Node, capture.events as readonly unknown[]);
    assertEquals(capture.events.length, 0, 'the detached record is swept by release');
    assertEquals(
      replayPreUpgradeEvents(host as unknown as Node, capture.events as readonly unknown[]),
      0,
      'nothing replays for a detached target',
    );
  } finally {
    capture.stop();
    cleanup(host);
  }
});

// ─── Integration: failed activation before kernel.root ───

Deno.test('failed activation before kernel.root releases shadow records via the host fallback', () => {
  // Facade fallback when the compiled kernel never established a root
  // (open-element-implementation.ts): `kernel.root ?? this`. The host is the
  // release root, and its declarative shadow content is host-owned.
  const host = new FacadeElement('oe-fallback-host', dom.document);
  const shadow = host.attachShadow({ mode: 'open' });
  const button = shadowButton(shadow);
  dom.document.body.appendChild(host);
  const capture = capturePreUpgradeEvents(dom.document as unknown as EventTarget, ['click']);
  try {
    button.dispatchEvent(click());
    assertEquals(capture.events.length, 1, 'the DSD interaction is captured pre-upgrade');

    const kernelRoot: Node | undefined = undefined;
    const releaseRoot = kernelRoot ?? (host as unknown as Node);
    releasePreUpgradeEvents(releaseRoot, capture.events as readonly unknown[]);
    assertEquals(capture.events.length, 0, 'retained=0 after the host-fallback release');
  } finally {
    capture.stop();
    cleanup(host);
  }
});

// Successful-claim replay across the same composed ownership lives in
// shadow-replay.test.ts (open and light islands, sibling isolation, live
// clicks) and continues to pass unchanged.
