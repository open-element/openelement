/**
 * compiled-runtime/facade-activation.test.ts — activation-mode truth (#1213).
 *
 * The kernel's connect() result owns the claim-vs-fresh decision; the facade
 * derives its lifecycle hooks (onDsdHydrated / onCsrRendered) from that result
 * and never guesses from pre-connect root state. Covered behavior:
 *   - light / open-shadow / closed-shadow roots, DSD claim vs CSR fresh
 *   - closed-root DSD claim fires onDsdHydrated (H3 regression)
 *   - reconnect reclaims and re-fires onDsdHydrated without fresh labeling
 *   - failed claim fires neither hook and releases only its own records
 *   - pre-upgrade replay fires exactly once per element; the element's captured
 *     records are released at its activation decision (M1) while the shared
 *     page-level capture stays installed for pending (delayed/lazy) elements
 *     (#1170), so a late upgrader still receives its replay
 */

import { expect, test } from 'vitest';
import {
  FacadeElement,
  FacadeEvent,
  installFacadeDom,
  mountSerialized,
  parseHtml,
  toHtml,
} from './facade-dom.ts';
import { testProgram } from './test-program.ts';

// The facade captures its HTMLElement base at module evaluation time.
const dom = installFacadeDom();

const { OpenElement, ensurePreHydrationClickCapture, renderDsd } =
  await import('../../src/index.ts');

// oxlint-disable-next-line no-explicit-any
type AnyElement = any;

interface ActivationSpec {
  tag: string;
  rootMode: 'light' | 'shadow-open' | 'shadow-closed';
}

function activationProgram(spec: ActivationSpec) {
  return testProgram({
    tag: spec.tag,
    rootMode: spec.rootMode,
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
}

interface TrackedElement extends FacadeElement {
  count: number;
  hydrated: number;
  rendered: number;
  increment(): void;
}

function defineTracked(spec: ActivationSpec): void {
  const program = activationProgram(spec);
  class TrackedActivation extends OpenElement {
    static __partProgram = program;
    static __compiledProperties = program.metadata.properties;
    static __elementMetadata = program.metadata;
    static observedAttributes = program.metadata.observedAttributes;
    declare count: number;
    hydrated = 0;
    rendered = 0;
    protected override onDsdHydrated(): void {
      this.hydrated++;
    }
    protected override onCsrRendered(): void {
      this.rendered++;
    }
    increment(): void {
      this.count++;
    }
  }
  dom.registry.define(spec.tag, TrackedActivation as unknown as CustomElementConstructor);
}

function connectFresh(tag: string): TrackedElement {
  const element = dom.document.createElement(tag) as unknown as TrackedElement;
  dom.document.body.appendChild(element);
  return element;
}

function mountDsd(tag: string, beforeConnect?: (element: FacadeElement) => void): TrackedElement {
  const serialized = renderDsd(tag, {
    componentClass: dom.registry.get(tag) as CustomElementConstructor,
  }).html;
  return mountSerialized(dom, serialized, beforeConnect) as unknown as TrackedElement;
}

function captureListenerCount(target: AnyElement): number {
  return (target.listeners.get('click') ?? []).filter(
    (listener: { capture: boolean }) => listener.capture,
  ).length;
}

/**
 * An un-upgraded SSR host: same tag, attributes, and content nodes as the
 * serialized markup, but constructed as a plain element (the harness runs the
 * real constructor at document.createElement, so 'in the document but not yet
 * upgraded' is modeled explicitly — the delayed-upgrade e2e contract #1170).
 */
function ssrMarkupHost(tag: string): FacadeElement {
  const serialized = renderDsd(tag, {
    componentClass: dom.registry.get(tag) as CustomElementConstructor,
  }).html;
  const parsedHost = parseHtml(dom.document, serialized).childNodes[0] as FacadeElement;
  const host = new FacadeElement(tag, dom.document);
  for (const [name, value] of parsedHost.attributes) host.setAttribute(name, value);
  for (const child of [...parsedHost.childNodes]) host.appendChild(child);
  return host;
}

/**
 * Delayed upgrade: the very content nodes the capture recorded move into the
 * real element (node identity preserved, as browser upgrade keeps them), then
 * the element replaces the un-upgraded host and connects.
 */
function upgradeInPlace(ssrHost: FacadeElement): TrackedElement {
  const element = dom.document.createElement(ssrHost.localName) as unknown as TrackedElement;
  for (const [name, value] of ssrHost.attributes) element.setAttribute(name, value);
  for (const child of [...ssrHost.childNodes]) {
    (element as unknown as FacadeElement).appendChild(child);
  }
  dom.document.body.insertBefore(element as unknown as FacadeElement, ssrHost);
  dom.document.body.removeChild(ssrHost);
  return element;
}

// ─── Mode truth per root kind ────────────────────────────────────────

test('activation: light DSD claim fires onDsdHydrated only', () => {
  defineTracked({ tag: 'oe-activation-light', rootMode: 'light' });
  let claimedButton: unknown;
  const element = mountDsd('oe-activation-light', (host) => {
    claimedButton = host.childNodes[0];
  });
  expect(element.hydrated).toEqual(1);
  expect(element.rendered).toEqual(0);
  expect(element.childNodes[0], 'claim preserves node identity').toBe(claimedButton);
});

test('activation: fresh activation keeps the shared capture alive for pending elements', () => {
  defineTracked({ tag: 'oe-activation-light-csr', rootMode: 'light' });
  // The generated entry installs capture on the document before upgrade.
  ensurePreHydrationClickCapture();
  expect(captureListenerCount(dom.document)).toEqual(1);
  const element = connectFresh('oe-activation-light-csr');
  expect(element.rendered).toEqual(1);
  expect(element.hydrated).toEqual(0);
  expect(toHtml(element.childNodes[0] as AnyElement)).toEqual(
    '<button type="button"><!--oe:p0-->0</button>',
  );
  expect(
    captureListenerCount(dom.document),
    "the fixed listener set is page-lifetime by design; only this element's records are released",
  ).toEqual(1);
});

test('activation: a late upgrader still replays its pre-upgrade click after another activation', () => {
  defineTracked({ tag: 'oe-activation-early', rootMode: 'light' });
  defineTracked({ tag: 'oe-activation-late', rootMode: 'light' });
  ensurePreHydrationClickCapture();

  // The early island activates while the late island's chunk is still held
  // (the /probe-light e2e shape): its decision must neither disarm the shared
  // capture nor consume records owned by the pending island (#1170).
  connectFresh('oe-activation-early');
  expect(captureListenerCount(dom.document), 'shared capture survives the decision').toEqual(1);

  // Un-upgraded SSR markup sits in the connected document; the document-level
  // capture records the pre-upgrade click.
  const ssrHost = ssrMarkupHost('oe-activation-late');
  dom.document.body.appendChild(ssrHost);
  const button = ssrHost.childNodes[0] as AnyElement;
  button.dispatchEvent(new FacadeEvent('click', { bubbles: true }));

  // The chunk arrives: delayed upgrade claims the same nodes and replays once.
  const element = upgradeInPlace(ssrHost);
  expect(element.hydrated).toEqual(1);
  expect(element.rendered).toEqual(0);
  expect(
    element.count,
    "the pre-upgrade click survives another element's activation and replays exactly once",
  ).toEqual(1);
  expect(element.childNodes[0], 'in-place activation keeps node identity').toBe(button);
});

test('activation: open shadow DSD claim fires onDsdHydrated only', () => {
  defineTracked({ tag: 'oe-activation-open', rootMode: 'shadow-open' });
  let claimedButton: unknown;
  const element = mountDsd('oe-activation-open', (host) => {
    claimedButton = host.shadowRoot!.childNodes[0];
  });
  expect(element.hydrated).toEqual(1);
  expect(element.rendered).toEqual(0);
  expect((element.shadowRoot as unknown as AnyElement).childNodes[0]).toBe(claimedButton);
});

test('activation: open shadow CSR fires onCsrRendered only', () => {
  defineTracked({ tag: 'oe-activation-open-csr', rootMode: 'shadow-open' });
  const element = connectFresh('oe-activation-open-csr');
  expect(element.rendered).toEqual(1);
  expect(element.hydrated).toEqual(0);
  expect(toHtml(element.shadowRoot as unknown as FacadeElement)).toEqual(
    '<button type="button"><!--oe:p0-->0</button>',
  );
});

test('activation: closed shadow DSD claim fires onDsdHydrated (H3)', () => {
  defineTracked({ tag: 'oe-activation-closed', rootMode: 'shadow-closed' });
  let claimedButton: unknown;
  const element = mountDsd('oe-activation-closed', (host) => {
    claimedButton = (host as unknown as { __closedRoot: AnyElement }).__closedRoot.childNodes[0];
  });
  expect(element.hydrated, 'a real closed-root claim is hydration, not fresh render').toEqual(1);
  expect(element.rendered).toEqual(0);
  expect(element.count).toEqual(0);
  // The claimed closed root is live: the pre-existing button runs the handler.
  (claimedButton as AnyElement).dispatchEvent(new FacadeEvent('click', { bubbles: true }));
  expect(element.count).toEqual(1);
});

test('activation: closed shadow CSR fires onCsrRendered only', () => {
  defineTracked({ tag: 'oe-activation-closed-csr', rootMode: 'shadow-closed' });
  const element = connectFresh('oe-activation-closed-csr');
  expect(element.rendered).toEqual(1);
  expect(element.hydrated).toEqual(0);
});

test('activation: reconnect reclaims and re-fires onDsdHydrated without relabeling', () => {
  defineTracked({ tag: 'oe-activation-reconnect', rootMode: 'light' });
  let claimedButton: AnyElement;
  const element = mountDsd('oe-activation-reconnect', (host) => {
    claimedButton = host.childNodes[0] as AnyElement;
  });
  expect(element.hydrated).toEqual(1);
  expect(element.rendered).toEqual(0);

  dom.document.body.removeChild(element);
  dom.document.body.appendChild(element);
  expect(element.hydrated, 'reconnect is a re-claim of the retained content').toEqual(2);
  expect(element.rendered, 'reconnect is never relabeled as fresh').toEqual(0);
  expect(element.childNodes[0], 'reconnect preserves node identity').toBe(claimedButton!);

  claimedButton!.dispatchEvent(new FacadeEvent('click', { bubbles: true }));
  expect(element.count, 'exactly one listener survives the reconnect').toEqual(1);
});

// ─── Pre-upgrade capture lifecycle (M1) ──────────────────────────────

test('activation: pre-upgrade replay fires exactly once, then the element releases its records', () => {
  defineTracked({ tag: 'oe-activation-replay', rootMode: 'light' });
  let button: AnyElement | undefined;
  const element = mountDsd('oe-activation-replay', (host) => {
    ensurePreHydrationClickCapture(host as unknown as EventTarget);
    expect(captureListenerCount(host)).toEqual(1);
    button = host.childNodes[0] as AnyElement;
    button.dispatchEvent(new FacadeEvent('click', { bubbles: true }));
  }) as unknown as TrackedElement;

  expect(element.hydrated).toEqual(1);
  expect(element.rendered).toEqual(0);
  expect(element.count, 'the pre-upgrade click replays exactly once into the claim').toEqual(1);
  expect(
    captureListenerCount(element),
    'the listener set is not the leak: it stays installed; the retained records are released',
  ).toEqual(1);

  // Reconnect reclaims; the released (and consumed) record never replays again.
  dom.document.body.removeChild(element);
  dom.document.body.appendChild(element);
  expect(element.count, 'no second replay after the element released its records').toEqual(1);
  expect(element.hydrated).toEqual(2);
  expect(button !== undefined).toBeTruthy();
});

test('activation: failed claim fires neither hook and releases only its own records', () => {
  defineTracked({ tag: 'oe-activation-failing', rootMode: 'light' });
  defineTracked({ tag: 'oe-activation-recovering', rootMode: 'light' });
  ensurePreHydrationClickCapture();
  expect(captureListenerCount(dom.document)).toEqual(1);

  // A pending sibling island records a click before the failing activation.
  const ssrHost = ssrMarkupHost('oe-activation-recovering');
  dom.document.body.appendChild(ssrHost);
  const pendingButton = ssrHost.childNodes[0] as AnyElement;
  pendingButton.dispatchEvent(new FacadeEvent('click', { bubbles: true }));

  // Drifted content: the program expects a <button>, the DOM carries a <span>.
  const element = dom.document.createElement('oe-activation-failing') as unknown as TrackedElement;
  element.appendChild(dom.document.createElement('span'));
  expect(() => dom.document.body.appendChild(element)).toThrow();

  expect(element.hydrated, 'a failed claim never reports hydration').toEqual(0);
  expect(element.rendered, 'a failed claim is never relabeled as fresh').toEqual(0);
  expect(
    captureListenerCount(dom.document),
    'the shared capture survives a failed activation for pending elements',
  ).toEqual(1);

  // The pending sibling's record was not released or consumed by the failed
  // activation: it upgrades later and replays exactly once.
  const recovered = upgradeInPlace(ssrHost);
  expect(recovered.hydrated).toEqual(1);
  expect(
    recovered.count,
    'the pending record survived the failed activation and replays exactly once',
  ).toEqual(1);
});
