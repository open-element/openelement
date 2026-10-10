/**
 * compiled-runtime/shadow-replay.test.ts — pre-hydration replay across
 * shadow boundaries (#942).
 *
 * A document-level capture listener observes a RETARGETED event.target (the
 * outer host) when the interaction originates inside an open shadow root.
 * The capture resolves the original target through composedPath()[0], so the
 * claiming island's isInsideRoot check sees the true target and replays
 * exactly once. Covered behavior:
 *   - shadow-open island: pre-hydration click replays exactly once
 *   - light-DOM island: the pre-existing replay contract still holds
 *   - two pending islands: a click never replays into the wrong island
 *   - nested pending islands: whichever island activates first, the inner
 *     island's record survives to replay after the INNER hydration (both
 *     islands hydrate from one deferred callback, so module resolution — not
 *     document order — decides which host claims first; the outer activation
 *     must not dispatch, consume, or release the inner's pending record into a
 *     tree whose handlers are not attached yet)
 *   - post-hydration clicks fire once and are never re-replayed
 *   - a target removed before hydration fails closed (no replay, no throw)
 *
 * Closed shadow roots hide their internals from outside composedPath() by
 * platform design; those records fail closed at replay (never misdelivered).
 * The harness models browser retargeting for composed events (facade-dom.ts);
 * real-browser coverage lives in tests/e2e/starter-smoke/interaction-matrix.
 */

import { expect, test } from 'vitest';
import {
  type FacadeDom,
  FacadeElement,
  type FacadeShadowRoot,
  installFacadeDom,
  parseHtml,
} from './facade-dom.ts';
import { click as composedClick } from './pre-upgrade-helpers.ts';
import { testProgram } from './test-program.ts';

// The facade captures its HTMLElement base at module evaluation time.
const dom: FacadeDom = installFacadeDom();

const { OpenElement, ensurePreHydrationClickCapture, renderDsd } =
  await import('../../src/index.ts');

// oxlint-disable-next-line no-explicit-any
type AnyElement = any;

function defineCounter(tag: string, rootMode: 'light' | 'shadow-open'): void {
  const program = testProgram({
    tag,
    rootMode,
    template: [
      {
        k: 'el',
        tag: 'button',
        attrs: [['type', 'button']],
        children: [{ k: 'part', index: 0 }],
      },
    ],
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
    properties: [
      {
        name: 'count',
        attribute: 'count',
        type: 'number',
        converter: 'number',
        reflect: false,
        default: 0,
      },
    ],
  });
  class ShadowCounter extends OpenElement {
    static __partProgram = program;
    static __compiledProperties = program.metadata.properties;
    static __elementMetadata = program.metadata;
    static observedAttributes = program.metadata.observedAttributes;
    declare count: number;
    hydrated = 0;
    protected override onDsdHydrated(): void {
      this.hydrated++;
    }
    increment(): void {
      this.count++;
    }
  }
  dom.registry.define(tag, ShadowCounter as unknown as CustomElementConstructor);
}

interface ShadowCounterElement extends FacadeElement {
  count: number;
  hydrated: number;
  increment(): void;
}

/**
 * An un-upgraded SSR host preserving declarative shadow content: the same
 * nodes the browser holds before the island chunk arrives. Real clicks are
 * composed, so the harness retargets them for document-level listeners while
 * composedPath() keeps reporting the true target (#942).
 */
function ssrShadowHost(tag: string): FacadeElement {
  const serialized = renderDsd(tag, {
    componentClass: dom.registry.get(tag) as CustomElementConstructor,
  }).html;
  const parsedHost = parseHtml(dom.document, serialized).childNodes[0] as FacadeElement;
  const host = new FacadeElement(tag, dom.document);
  for (const [name, value] of parsedHost.attributes) host.setAttribute(name, value);
  const first = parsedHost.childNodes[0];
  if (
    first instanceof FacadeElement &&
    first.localName === 'template' &&
    first.hasAttribute('shadowrootmode')
  ) {
    const root = host.attachShadow({ mode: 'open' });
    for (const child of [...first.childNodes]) root.appendChild(child);
  } else {
    for (const child of [...parsedHost.childNodes]) host.appendChild(child);
  }
  return host;
}

/** Delayed upgrade: the recorded nodes move into the real element pre-connect. */
function upgradeShadowInPlace(ssrHost: FacadeElement): ShadowCounterElement {
  const element = dom.document.createElement(ssrHost.localName) as unknown as ShadowCounterElement;
  for (const [name, value] of ssrHost.attributes) {
    (element as unknown as FacadeElement).setAttribute(name, value);
  }
  const ssrShadow = ssrHost.shadowRoot;
  if (ssrShadow) {
    const root = (element as unknown as FacadeElement).attachShadow({ mode: 'open' });
    for (const child of [...ssrShadow.childNodes]) root.appendChild(child);
  } else {
    for (const child of [...(ssrHost as unknown as FacadeElement).childNodes]) {
      (element as unknown as FacadeElement).appendChild(child);
    }
  }
  dom.document.body.insertBefore(element as unknown as FacadeElement, ssrHost);
  dom.document.body.removeChild(ssrHost);
  return element;
}

function innerButton(ssrHost: FacadeElement): AnyElement {
  const shadow = ssrHost.shadowRoot as unknown as FacadeShadowRoot;
  if (shadow) return shadow.childNodes[0] as unknown as AnyElement;
  return ssrHost.childNodes[0] as AnyElement;
}

test('shadow replay: pre-hydration click inside an open island shadow replays exactly once (#942)', () => {
  defineCounter('oe-shadow-replay', 'shadow-open');
  // The generated entry installs capture on the document before any upgrade.
  ensurePreHydrationClickCapture();

  const ssrHost = ssrShadowHost('oe-shadow-replay');
  dom.document.body.appendChild(ssrHost);
  const button = innerButton(ssrHost);
  button.dispatchEvent(composedClick());

  const element = upgradeShadowInPlace(ssrHost);
  expect(element.hydrated).toEqual(1);
  expect(element.count, 'the shadow-retargeted click replays exactly once').toEqual(1);
  expect(
    (element as unknown as FacadeElement).shadowRoot!.childNodes[0],
    'in-place activation keeps node identity',
  ).toBe(button);

  // Reconnect reclaims; the consumed record never replays again.
  dom.document.body.removeChild(element as unknown as FacadeElement);
  dom.document.body.appendChild(element as unknown as FacadeElement);
  expect(element.count, 'no second replay after the record was consumed').toEqual(1);
});

test('shadow replay: light-DOM island replay still works through the same capture (#942)', () => {
  defineCounter('oe-shadow-replay-light', 'light');
  ensurePreHydrationClickCapture();

  const ssrHost = ssrShadowHost('oe-shadow-replay-light');
  dom.document.body.appendChild(ssrHost);
  const button = innerButton(ssrHost);
  button.dispatchEvent(composedClick());

  const element = upgradeShadowInPlace(ssrHost);
  expect(element.hydrated).toEqual(1);
  expect(element.count, 'the light-DOM replay contract still holds').toEqual(1);
});

test('shadow replay: a click never replays into the wrong island (#942)', () => {
  defineCounter('oe-shadow-replay-a', 'shadow-open');
  defineCounter('oe-shadow-replay-b', 'shadow-open');
  ensurePreHydrationClickCapture();

  const hostA = ssrShadowHost('oe-shadow-replay-a');
  const hostB = ssrShadowHost('oe-shadow-replay-b');
  dom.document.body.appendChild(hostA);
  dom.document.body.appendChild(hostB);
  innerButton(hostA).dispatchEvent(composedClick());

  const elementB = upgradeShadowInPlace(hostB);
  expect(elementB.count, 'the unclicked island replays nothing').toEqual(0);

  const elementA = upgradeShadowInPlace(hostA);
  expect(elementA.count, 'the clicked island still replays exactly once').toEqual(1);
  expect(elementB.count, 'the sibling island stays silent').toEqual(0);
});

/**
 * Nested-island fixture: the outer island's compiled shadow tree contains the
 * inner island's host as a plain template child (claimed by tag while the
 * inner element is still un-upgraded), and the capture carries BOTH declared
 * tags — the generated entry's form, unlike the no-tag legacy calls above.
 */
interface NestedOuterElement extends FacadeElement {
  hydrated: number;
}

function defineNestedOuter(tag: string, innerTag: string): void {
  const program = testProgram({
    tag,
    rootMode: 'shadow-open',
    template: [{ k: 'el', tag: innerTag }],
    parts: [],
  });
  class NestedOuter extends OpenElement {
    static __partProgram = program;
    static __compiledProperties = program.metadata.properties;
    static __elementMetadata = program.metadata;
    static observedAttributes = program.metadata.observedAttributes;
    hydrated = 0;
    protected override onDsdHydrated(): void {
      this.hydrated++;
    }
  }
  dom.registry.define(tag, NestedOuter as unknown as CustomElementConstructor);
}

/** The un-upgraded inner host inside the outer SSR host's declarative shadow. */
function nestedFixture(
  outerTag: string,
  innerTag: string,
): {
  outerHost: FacadeElement;
  innerHost: FacadeElement;
} {
  const innerHost = ssrShadowHost(innerTag);
  const outerHost = new FacadeElement(outerTag, dom.document);
  const outerRoot = outerHost.attachShadow({ mode: 'open' });
  outerRoot.appendChild(innerHost);
  dom.document.body.appendChild(outerHost);
  return { outerHost, innerHost };
}

/** Delayed upgrade INSIDE a shadow root (upgradeShadowInPlace assumes body). */
function upgradeWithin(parent: FacadeShadowRoot, ssrHost: FacadeElement): AnyElement {
  const element = dom.document.createElement(ssrHost.localName);
  for (const [name, value] of ssrHost.attributes) {
    (element as unknown as FacadeElement).setAttribute(name, value);
  }
  const root = (element as unknown as FacadeElement).attachShadow({ mode: 'open' });
  for (const child of [...ssrHost.shadowRoot!.childNodes]) root.appendChild(child);
  parent.insertBefore(element, ssrHost);
  parent.removeChild(ssrHost);
  return element;
}

test('shadow replay: outer island activating first leaves the inner pending record for the inner hydration (#942 nested)', () => {
  const innerTag = 'oe-nested-outer-first-inner';
  const outerTag = 'oe-nested-outer-first-outer';
  defineCounter(innerTag, 'shadow-open');
  defineNestedOuter(outerTag, innerTag);
  // The generated entry declares every island tag before any upgrade.
  ensurePreHydrationClickCapture(dom.document, [outerTag, innerTag]);

  const { outerHost, innerHost } = nestedFixture(outerTag, innerTag);
  innerButton(innerHost).dispatchEvent(composedClick());

  // The outer island's chunk wins the hydration race: it upgrades while the
  // inner host is still un-upgraded. Its activation must not adopt (replay +
  // consume + release) the record that belongs to the pending inner island.
  const outer = upgradeShadowInPlace(outerHost) as unknown as NestedOuterElement;
  expect(outer.hydrated, 'the outer island still claims its own tree').toEqual(1);

  const innerSsrHost = outer.shadowRoot!.childNodes[0] as unknown as FacadeElement;
  const inner = upgradeWithin(
    outer.shadowRoot as unknown as FacadeShadowRoot,
    innerSsrHost,
  ) as unknown as ShadowCounterElement;
  expect(inner.hydrated, 'the inner island claims after its own upgrade').toEqual(1);
  expect(inner.count, 'the pre-hydration click replays at the inner hydration').toEqual(1);
  expect(outer.hydrated, 'the outer activation ran exactly once').toEqual(1);
});

test('shadow replay: inner island activating first keeps the replay exactly once when the outer follows (#942 nested)', () => {
  const innerTag = 'oe-nested-inner-first-inner';
  const outerTag = 'oe-nested-inner-first-outer';
  defineCounter(innerTag, 'shadow-open');
  defineNestedOuter(outerTag, innerTag);
  ensurePreHydrationClickCapture(dom.document, [outerTag, innerTag]);

  const { outerHost, innerHost } = nestedFixture(outerTag, innerTag);
  innerButton(innerHost).dispatchEvent(composedClick());

  // The inner island's chunk wins instead: it upgrades inside the still
  // un-upgraded outer SSR host, replays its record, and the later outer
  // activation must not re-replay it.
  const outerRoot = outerHost.shadowRoot as unknown as FacadeShadowRoot;
  const inner = upgradeWithin(outerRoot, innerHost) as unknown as ShadowCounterElement;
  expect(inner.count, 'the inner-first order replays exactly once').toEqual(1);

  const outer = upgradeShadowInPlace(outerHost) as unknown as NestedOuterElement;
  expect(outer.hydrated, 'the outer island claims after its own upgrade').toEqual(1);
  expect(inner.count, 'the consumed record never replays again').toEqual(1);
});

test('shadow replay: post-hydration clicks fire once and are never re-replayed (#942)', () => {
  defineCounter('oe-shadow-replay-live', 'shadow-open');
  defineCounter('oe-shadow-replay-sibling', 'shadow-open');
  ensurePreHydrationClickCapture();

  const element = upgradeShadowInPlace(
    (() => {
      const host = ssrShadowHost('oe-shadow-replay-live');
      dom.document.body.appendChild(host);
      return host;
    })(),
  );
  expect(element.count).toEqual(0);

  const liveButton = (element as unknown as FacadeElement).shadowRoot!.childNodes[0] as AnyElement;
  liveButton.dispatchEvent(composedClick());
  expect(element.count, 'a hydrated click fires exactly once').toEqual(1);

  // A later sibling upgrade must not resurrect the live click as a replay.
  const siblingHost = ssrShadowHost('oe-shadow-replay-sibling');
  dom.document.body.appendChild(siblingHost);
  const sibling = upgradeShadowInPlace(siblingHost);
  expect(sibling.count).toEqual(0);
  expect(element.count, 'no duplicate replay after a sibling activation').toEqual(1);
});

test('shadow replay: a target removed before hydration fails closed (#942)', () => {
  defineCounter('oe-shadow-replay-removed', 'shadow-open');
  ensurePreHydrationClickCapture();

  const ssrHost = ssrShadowHost('oe-shadow-replay-removed');
  dom.document.body.appendChild(ssrHost);
  const button = innerButton(ssrHost);
  button.dispatchEvent(composedClick());
  // The target leaves the document before its island hydrates.
  (ssrHost.shadowRoot as unknown as FacadeShadowRoot).removeChild(button);

  const element = upgradeShadowInPlace(ssrHost);
  expect(element.count, 'the detached click replays nowhere').toEqual(0);
});
