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
 *   - post-hydration clicks fire once and are never re-replayed
 *   - a target removed before hydration fails closed (no replay, no throw)
 *
 * Closed shadow roots hide their internals from outside composedPath() by
 * platform design; those records fail closed at replay (never misdelivered).
 * The harness models browser retargeting for composed events (facade-dom.ts);
 * real-browser coverage lives in tests/e2e/starter-smoke/interaction-matrix.
 */

import { assertEquals, assertStrictEquals } from '@std/assert';
import {
  type FacadeDom,
  FacadeElement,
  FacadeEvent,
  type FacadeShadowRoot,
  installFacadeDom,
  parseHtml,
} from './facade-dom.ts';
import { testProgram } from './test-program.ts';

// The facade captures its HTMLElement base at module evaluation time.
const dom: FacadeDom = installFacadeDom();

const { OpenElement, ensurePreHydrationClickCapture, renderDsd } = await import(
  '../../src/index.ts'
);

// deno-lint-ignore no-explicit-any
type AnyElement = any;

function defineCounter(tag: string, rootMode: 'light' | 'shadow-open'): void {
  const program = testProgram({
    tag,
    rootMode,
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
    first instanceof FacadeElement && first.localName === 'template' &&
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
  const element = dom.document.createElement(
    ssrHost.localName,
  ) as unknown as ShadowCounterElement;
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

function composedClick(): FacadeEvent {
  return new FacadeEvent('click', { bubbles: true, composed: true });
}

function innerButton(ssrHost: FacadeElement): AnyElement {
  const shadow = ssrHost.shadowRoot as unknown as FacadeShadowRoot;
  if (shadow) return (shadow.childNodes[0] as unknown as AnyElement);
  return ssrHost.childNodes[0] as AnyElement;
}

Deno.test('shadow replay: pre-hydration click inside an open island shadow replays exactly once (#942)', () => {
  defineCounter('oe-shadow-replay', 'shadow-open');
  // The generated entry installs capture on the document before any upgrade.
  ensurePreHydrationClickCapture();

  const ssrHost = ssrShadowHost('oe-shadow-replay');
  dom.document.body.appendChild(ssrHost);
  const button = innerButton(ssrHost);
  button.dispatchEvent(composedClick());

  const element = upgradeShadowInPlace(ssrHost);
  assertEquals(element.hydrated, 1);
  assertEquals(element.count, 1, 'the shadow-retargeted click replays exactly once');
  assertStrictEquals(
    (element as unknown as FacadeElement).shadowRoot!.childNodes[0],
    button,
    'in-place activation keeps node identity',
  );

  // Reconnect reclaims; the consumed record never replays again.
  dom.document.body.removeChild(element as unknown as FacadeElement);
  dom.document.body.appendChild(element as unknown as FacadeElement);
  assertEquals(element.count, 1, 'no second replay after the record was consumed');
});

Deno.test('shadow replay: light-DOM island replay still works through the same capture (#942)', () => {
  defineCounter('oe-shadow-replay-light', 'light');
  ensurePreHydrationClickCapture();

  const ssrHost = ssrShadowHost('oe-shadow-replay-light');
  dom.document.body.appendChild(ssrHost);
  const button = innerButton(ssrHost);
  button.dispatchEvent(composedClick());

  const element = upgradeShadowInPlace(ssrHost);
  assertEquals(element.hydrated, 1);
  assertEquals(element.count, 1, 'the light-DOM replay contract still holds');
});

Deno.test('shadow replay: a click never replays into the wrong island (#942)', () => {
  defineCounter('oe-shadow-replay-a', 'shadow-open');
  defineCounter('oe-shadow-replay-b', 'shadow-open');
  ensurePreHydrationClickCapture();

  const hostA = ssrShadowHost('oe-shadow-replay-a');
  const hostB = ssrShadowHost('oe-shadow-replay-b');
  dom.document.body.appendChild(hostA);
  dom.document.body.appendChild(hostB);
  innerButton(hostA).dispatchEvent(composedClick());

  const elementB = upgradeShadowInPlace(hostB);
  assertEquals(elementB.count, 0, 'the unclicked island replays nothing');

  const elementA = upgradeShadowInPlace(hostA);
  assertEquals(elementA.count, 1, 'the clicked island still replays exactly once');
  assertEquals(elementB.count, 0, 'the sibling island stays silent');
});

Deno.test('shadow replay: post-hydration clicks fire once and are never re-replayed (#942)', () => {
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
  assertEquals(element.count, 0);

  const liveButton = (element as unknown as FacadeElement).shadowRoot!.childNodes[0] as AnyElement;
  liveButton.dispatchEvent(composedClick());
  assertEquals(element.count, 1, 'a hydrated click fires exactly once');

  // A later sibling upgrade must not resurrect the live click as a replay.
  const siblingHost = ssrShadowHost('oe-shadow-replay-sibling');
  dom.document.body.appendChild(siblingHost);
  const sibling = upgradeShadowInPlace(siblingHost);
  assertEquals(sibling.count, 0);
  assertEquals(element.count, 1, 'no duplicate replay after a sibling activation');
});

Deno.test('shadow replay: a target removed before hydration fails closed (#942)', () => {
  defineCounter('oe-shadow-replay-removed', 'shadow-open');
  ensurePreHydrationClickCapture();

  const ssrHost = ssrShadowHost('oe-shadow-replay-removed');
  dom.document.body.appendChild(ssrHost);
  const button = innerButton(ssrHost);
  button.dispatchEvent(composedClick());
  // The target leaves the document before its island hydrates.
  (ssrHost.shadowRoot as unknown as FacadeShadowRoot).removeChild(button);

  const element = upgradeShadowInPlace(ssrHost);
  assertEquals(element.count, 0, 'the detached click replays nowhere');
});
