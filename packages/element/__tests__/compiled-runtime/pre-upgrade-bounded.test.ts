/**
 * pre-upgrade-bounded.test.ts — the pre-hydration capture stays bounded.
 *
 * The facade document capture (ensurePreHydrationClickCapture) carries the
 * declared-island filter: only interactions under a still-pending DECLARED
 * island tag enter the queue (the entry's __tags own the declaration, so
 * undeclared third-party custom elements can never exhaust the bounded
 * queue). Ordinary traffic inside settled islands is skipped, the queue
 * carries a hard capacity cap (fail closed), and every release sweeps
 * detached targets. Covered behavior:
 *   - pending island clicks capture, background clicks do not
 *   - settled-island traffic (same target x N, many distinct targets) adds nothing
 *   - a nested pending island still captures after its outer settled
 *   - a morph-inserted island still captures and replays once
 *   - detached targets are swept on release (never held to page end)
 *   - removal before activation replays nowhere and leaks nothing
 *   - the capacity cap fails closed: pending replays are never evicted
 *   - nested pending replay after outer activation fires exactly once
 *   - 64 undeclared third-party targets add nothing; the declared island
 *     still captures afterwards (no queue exhaustion)
 *   - declared/third-party nesting judges only the declared host
 *   - repeated ensure() calls merge tags without reinstalling listeners
 */

import { assert, assertEquals, assertStrictEquals } from '@std/assert';
import { type FacadeDom, FacadeElement, FacadeEvent, installFacadeDom } from './facade-dom.ts';
import { testProgram } from './test-program.ts';

// The facade captures its HTMLElement base at module evaluation time.
const dom: FacadeDom = installFacadeDom();

const {
  acceptPendingIslandEvent,
  capturePreUpgradeEvents,
  markPreUpgradeIslandSettled,
  releasePreUpgradeEvents,
  MAX_PRE_UPGRADE_CAPTURED_EVENTS,
} = await import('../../src/internal/compiled/runtime.ts');

const { OpenElement, ensurePreHydrationClickCapture, renderDsd } = await import(
  '../../src/index.ts'
);

// deno-lint-ignore no-explicit-any
type AnyElement = any;

function click(): FacadeEvent {
  return new FacadeEvent('click', { bubbles: true, composed: true });
}

/** A connected dash-tagged host with one button child. */
function pendingHost(tag: string): { host: FacadeElement; button: AnyElement } {
  const host = new FacadeElement(tag, dom.document);
  const button = new FacadeElement('button', dom.document);
  host.appendChild(button);
  dom.document.body.appendChild(host);
  return { host, button };
}

function cleanup(...hosts: FacadeElement[]): void {
  for (const host of hosts) {
    if (host.parentNode) host.parentNode.removeChild(host);
  }
}

// ─── Filter: pending captures, background and live traffic do not ───

Deno.test('bounded: pending island clicks capture, background clicks do not', () => {
  const capture = capturePreUpgradeEvents(dom.document as unknown as EventTarget, undefined, {
    accept: acceptPendingIslandEvent,
  });
  try {
    const { host, button } = pendingHost('oe-bounded-pending');
    const plain = new FacadeElement('div', dom.document);
    const plainButton = new FacadeElement('button', dom.document);
    plain.appendChild(plainButton);
    dom.document.body.appendChild(plain);
    try {
      button.dispatchEvent(click());
      assertEquals(capture.events.length, 1, 'a pending island click enters the queue');
      plainButton.dispatchEvent(click());
      assertEquals(capture.events.length, 1, 'background traffic outside any island is skipped');
    } finally {
      cleanup(host, plain);
    }
  } finally {
    capture.stop();
  }
});

Deno.test('bounded: settled-island traffic adds nothing (same target and many targets)', () => {
  const capture = capturePreUpgradeEvents(dom.document as unknown as EventTarget, undefined, {
    accept: acceptPendingIslandEvent,
  });
  try {
    const { host, button } = pendingHost('oe-bounded-settled');
    try {
      markPreUpgradeIslandSettled(host as unknown as object);
      for (let i = 0; i < 10; i++) button.dispatchEvent(click());
      assertEquals(capture.events.length, 0, 'repeated live clicks on one target add nothing');
      for (let i = 0; i < 25; i++) {
        const extra = new FacadeElement('button', dom.document);
        host.appendChild(extra);
        extra.dispatchEvent(click());
      }
      assertEquals(
        capture.events.length,
        0,
        'live clicks across many distinct targets add nothing',
      );
    } finally {
      cleanup(host);
    }
  } finally {
    capture.stop();
  }
});

Deno.test('bounded: a nested pending island still captures after its outer settled', () => {
  const capture = capturePreUpgradeEvents(dom.document as unknown as EventTarget, undefined, {
    accept: acceptPendingIslandEvent,
  });
  try {
    const outer = new FacadeElement('oe-bounded-outer', dom.document);
    const inner = new FacadeElement('oe-bounded-inner', dom.document);
    const button = new FacadeElement('button', dom.document);
    inner.appendChild(button);
    outer.appendChild(inner);
    dom.document.body.appendChild(outer);
    try {
      markPreUpgradeIslandSettled(outer as unknown as object);
      button.dispatchEvent(click());
      assertEquals(capture.events.length, 1, 'the nested pending island still captures');
      assertStrictEquals(capture.events[0].target as unknown, button as unknown);
    } finally {
      cleanup(outer);
    }
  } finally {
    capture.stop();
  }
});

// ─── Retention: detached swept, capacity fails closed ───

Deno.test('bounded: detached targets are swept on release', () => {
  const capture = capturePreUpgradeEvents(dom.document as unknown as EventTarget, undefined, {
    accept: acceptPendingIslandEvent,
  });
  try {
    const first = pendingHost('oe-bounded-gone-a');
    const second = pendingHost('oe-bounded-gone-b');
    first.button.dispatchEvent(click());
    second.button.dispatchEvent(click());
    assertEquals(capture.events.length, 2);
    // Removal / navigation / morph replacement detaches the pending target.
    cleanup(first.host);
    const other = new FacadeElement('div', dom.document);
    try {
      releasePreUpgradeEvents(other as unknown as Node, capture.events);
      assertEquals(capture.events.length, 1, 'the detached record is swept');
      assertStrictEquals(capture.events[0].target as unknown, second.button as unknown);
    } finally {
      cleanup(second.host);
    }
  } finally {
    capture.stop();
  }
});

Deno.test('bounded: the capacity cap fails closed without evicting pending replays', () => {
  assert(MAX_PRE_UPGRADE_CAPTURED_EVENTS >= 16, 'the cap under test must be meaningful');
  const capture = capturePreUpgradeEvents(dom.document as unknown as EventTarget, undefined, {
    accept: acceptPendingIslandEvent,
  });
  const hosts: FacadeElement[] = [];
  try {
    const over = MAX_PRE_UPGRADE_CAPTURED_EVENTS + 10;
    let firstButton: unknown;
    for (let i = 0; i < over; i++) {
      const { host, button } = pendingHost(`oe-bounded-cap-${i}`);
      hosts.push(host);
      if (i === 0) firstButton = button;
      button.dispatchEvent(click());
    }
    assertEquals(
      capture.events.length,
      MAX_PRE_UPGRADE_CAPTURED_EVENTS,
      'the queue never grows past the cap',
    );
    assertStrictEquals(
      capture.events[0].target as unknown,
      firstButton as unknown,
      'overflow drops the newcomer, never an already-pending replay',
    );
    // A repeat event for a retained target still replaces in place.
    (firstButton as AnyElement).dispatchEvent(click());
    assertEquals(capture.events.length, MAX_PRE_UPGRADE_CAPTURED_EVENTS);
  } finally {
    capture.stop();
    cleanup(...hosts);
  }
});

// ─── Facade: nested-late, morph-added, and removed islands ───

function defineCounter(tag: string): void {
  const program = testProgram({
    tag,
    rootMode: 'light',
    template: [{
      k: 'el',
      tag: 'button',
      attrs: [['type', 'button']],
      children: [{ k: 'part', index: 0 }],
    }],
    parts: [
      { k: 'text', index: 0, signal: 'count' },
      {
        k: 'event',
        index: 1,
        event: 'click',
        handler: 'increment',
        action: { kind: 'method', name: 'increment' },
        path: [0],
      },
    ],
    properties: [{
      name: 'count',
      attribute: 'count',
      type: 'number',
      converter: 'number',
      reflect: false,
      default: 0,
    }],
  });
  class BoundedCounter extends OpenElement {
    static __partProgram = program;
    static __compiledProperties = program.metadata.properties;
    static __elementMetadata = program.metadata;
    static observedAttributes = program.metadata.observedAttributes;
    declare count: number;
    increment(): void {
      this.count++;
    }
  }
  dom.registry.define(tag, BoundedCounter as unknown as CustomElementConstructor);
}

interface CounterElement extends FacadeElement {
  count: number;
  increment(): void;
}

function mountSsr(tag: string): { host: FacadeElement; button: AnyElement } {
  // An un-upgraded SSR host: same tag and content nodes as the serialized
  // markup, but a plain element (its chunk has not arrived yet).
  const serialized = renderDsd(tag, {
    componentClass: dom.registry.get(tag) as CustomElementConstructor,
  }).html;
  const host = new FacadeElement(tag, dom.document);
  const match = /<button type="button"><!--oe:p0-->(.*?)<\/button>/.exec(serialized);
  const button = new FacadeElement('button', dom.document);
  button.setAttribute('type', 'button');
  const anchor = dom.document.createComment('oe:p0');
  button.appendChild(anchor);
  button.appendChild(dom.document.createTextNode(match?.[1] ?? '0'));
  host.appendChild(button);
  dom.document.body.appendChild(host);
  return { host, button };
}

function upgradeInPlace(ssrHost: FacadeElement): CounterElement {
  const element = dom.document.createElement(ssrHost.localName) as unknown as CounterElement;
  for (const [name, value] of ssrHost.attributes) {
    (element as unknown as FacadeElement).setAttribute(name, value);
  }
  for (const child of [...ssrHost.childNodes]) {
    (element as unknown as FacadeElement).appendChild(child);
  }
  dom.document.body.insertBefore(element as unknown as FacadeElement, ssrHost);
  dom.document.body.removeChild(ssrHost);
  return element;
}

Deno.test('bounded: a delayed island replays once after another island already settled', () => {
  defineCounter('oe-bounded-early');
  defineCounter('oe-bounded-delayed');
  ensurePreHydrationClickCapture();

  const early = dom.document.createElement('oe-bounded-early') as unknown as CounterElement;
  dom.document.body.appendChild(early as unknown as FacadeElement);
  assertEquals(early.count, 0);

  // The delayed island's chunk arrives after the early island settled.
  const { host, button } = mountSsr('oe-bounded-delayed');
  button.dispatchEvent(click());
  const delayed = upgradeInPlace(host);
  assertEquals(delayed.count, 1, 'the delayed pre-upgrade click still replays exactly once');
  assertEquals(early.count, 0, 'the settled sibling stays silent');
  cleanup(delayed as unknown as FacadeElement, early as unknown as FacadeElement);
});

Deno.test('bounded: a morph-inserted island still captures and replays once', () => {
  defineCounter('oe-bounded-morph');
  ensurePreHydrationClickCapture();

  const first = dom.document.createElement('oe-bounded-morph') as unknown as CounterElement;
  dom.document.body.appendChild(first as unknown as FacadeElement);

  // A navigation morph inserts a brand-new island host afterwards.
  const { host, button } = mountSsr('oe-bounded-morph');
  button.dispatchEvent(click());
  const inserted = upgradeInPlace(host);
  assertEquals(inserted.count, 1, 'the morph-inserted island replays exactly once');
  assertEquals(first.count, 0, 'the pre-existing island stays silent');
  cleanup(inserted as unknown as FacadeElement, first as unknown as FacadeElement);
});

Deno.test('bounded: an island removed before activation replays nowhere', () => {
  defineCounter('oe-bounded-doomed');
  defineCounter('oe-bounded-survivor');
  ensurePreHydrationClickCapture();

  const { host, button } = mountSsr('oe-bounded-doomed');
  button.dispatchEvent(click());
  // Cancelled / removed before its chunk arrives: detached, never upgraded.
  dom.document.body.removeChild(host);

  const { host: survivorHost, button: survivorButton } = mountSsr('oe-bounded-survivor');
  survivorButton.dispatchEvent(click());
  const survivor = upgradeInPlace(survivorHost);
  assertEquals(survivor.count, 1, 'the surviving island still replays exactly once');
  cleanup(survivor as unknown as FacadeElement);
});

// ─── Declared-island scoping: third-party custom elements never queue ───

const THIRD_PARTY_PREFIXES = ['sl', 'md-filled', 'ion', 'vaadin', 'lion', 'fast', 'mui', 't'];

Deno.test('declared: 64 undeclared third-party targets add nothing, the declared island still captures', () => {
  const declared = new Set(['oe-declared-real']);
  const capture = capturePreUpgradeEvents(dom.document as unknown as EventTarget, undefined, {
    accept: (event, target) => acceptPendingIslandEvent(event as Event, target, declared),
  });
  const foreign: FacadeElement[] = [];
  try {
    for (let i = 0; i < MAX_PRE_UPGRADE_CAPTURED_EVENTS; i++) {
      const prefix = THIRD_PARTY_PREFIXES[i % THIRD_PARTY_PREFIXES.length];
      const host = new FacadeElement(`${prefix}-foreign-${i}`, dom.document);
      const button = new FacadeElement('button', dom.document);
      host.appendChild(button);
      dom.document.body.appendChild(host);
      foreign.push(host);
      button.dispatchEvent(click());
    }
    assertEquals(
      capture.events.length,
      0,
      'undeclared third-party custom elements must never enter the pending queue',
    );
    const { host, button } = pendingHost('oe-declared-real');
    try {
      button.dispatchEvent(click());
      assertEquals(capture.events.length, 1, 'the declared delayed island still captures');
      assertStrictEquals(capture.events[0].target as unknown, button as unknown);
    } finally {
      cleanup(host);
    }
    assertEquals(
      capture.events.length,
      1,
      'the real replay was never evicted by foreign pressure',
    );
  } finally {
    capture.stop();
    cleanup(...foreign);
  }
});

Deno.test('declared: nesting with third-party judges only the declared host', () => {
  const declared = new Set(['oe-declared-nested']);
  const accept = (event: unknown, target: unknown): boolean =>
    acceptPendingIslandEvent(event as Event, target as EventTarget, declared);
  const capture = capturePreUpgradeEvents(dom.document as unknown as EventTarget, undefined, {
    accept: accept as (event: Event, target: EventTarget) => boolean,
  });
  try {
    // Declared island inside an undeclared third-party wrapper.
    const wrapper = new FacadeElement('sl-card-wrap', dom.document);
    const inner = new FacadeElement('oe-declared-nested', dom.document);
    const button = new FacadeElement('button', dom.document);
    inner.appendChild(button);
    wrapper.appendChild(inner);
    dom.document.body.appendChild(wrapper);
    try {
      button.dispatchEvent(click());
      assertEquals(
        capture.events.length,
        1,
        'declared inner island captures through foreign wrapper',
      );
    } finally {
      cleanup(wrapper);
    }
    releasePreUpgradeEvents(dom.document.body as unknown as Node, capture.events);

    // Undeclared third-party control inside a declared pending island.
    const outer = new FacadeElement('oe-declared-nested', dom.document);
    const foreign = new FacadeElement('ion-button-inner', dom.document);
    const deep = new FacadeElement('button', dom.document);
    foreign.appendChild(deep);
    outer.appendChild(foreign);
    dom.document.body.appendChild(outer);
    try {
      deep.dispatchEvent(click());
      assertEquals(
        capture.events.length,
        1,
        'foreign control under a declared host still captures',
      );
    } finally {
      cleanup(outer);
    }
  } finally {
    capture.stop();
  }
});

Deno.test('declared: repeated ensure() merges tags without reinstalling listeners', () => {
  defineCounter('oe-merge-a');
  defineCounter('oe-merge-b');
  const listenersOf = (type: string): number =>
    (dom.document as unknown as { listeners: Map<string, unknown[]> }).listeners.get(type)
      ?.length ?? 0;
  ensurePreHydrationClickCapture(dom.document as unknown as EventTarget, ['oe-merge-a']);
  const afterFirst = listenersOf('click');
  ensurePreHydrationClickCapture(dom.document as unknown as EventTarget, ['oe-merge-b']);
  const afterSecond = listenersOf('click');
  assertEquals(
    afterSecond,
    afterFirst,
    'the second ensure() for the same root must not reinstall listeners',
  );

  const first = mountSsr('oe-merge-a');
  first.button.dispatchEvent(click());
  const second = mountSsr('oe-merge-b');
  second.button.dispatchEvent(click());
  const upgradedA = upgradeInPlace(first.host);
  const upgradedB = upgradeInPlace(second.host);
  assertEquals(upgradedA.count, 1, 'first merged tag replays exactly once');
  assertEquals(upgradedB.count, 1, 'second merged tag replays exactly once');
  cleanup(upgradedA as unknown as FacadeElement, upgradedB as unknown as FacadeElement);
});
