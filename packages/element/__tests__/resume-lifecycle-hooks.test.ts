/**
 * Reconnect lifecycle-hook semantics (post-K architecture integration).
 *
 * ADR-0142 fixes the contract these cases pin: `onDsdHydrated()` is
 * shadow/DSD-only, a light/CSR connection fires `onCsrRendered()` on every
 * activation, and `clientActivate()` runs on every successful connection.
 * Before the reconnect path was split from the claim path, a CSR-created
 * component reported its reconnect as an internal `claim`, so a moved CSR
 * element fired the DSD-only hook — the defect this suite pins shut.
 *
 * What each activation must be:
 *   - first fresh CSR      → onCsrRendered, then clientActivate
 *   - first DSD claim      → onDsdHydrated, then clientActivate
 *   - CSR → reconnect      → onCsrRendered again (never the DSD hook)
 *   - DSD → reconnect      → onDsdHydrated again, with no duplicated listeners
 *   - repeated moves       → one hook + one clientActivate per activation
 *   - failed reconnect     → no hook, no clientActivate, DOM untouched
 */
import { expect, test } from 'vitest';
import {
  type FacadeElement,
  installFacadeDom,
  mountSerialized,
  toHtml,
} from './compiled-runtime/facade-dom.ts';
import { testProgram, type TestProgramSpec } from './compiled-runtime/test-program.ts';

const dom = installFacadeDom();
const { OpenElement, renderToString } = await import('@openelement/element');

let tagCounter = 0;
function uniqueTag(prefix: string): string {
  return `oe-lifecycle-${prefix}-${++tagCounter}`;
}

interface Hooks {
  csr: number;
  dsd: number;
  activate: number;
}

function defineProgrammed(
  spec: TestProgramSpec,
  hooks: Hooks,
  members: Record<string, unknown> = {},
): CustomElementConstructor {
  const program = testProgram(spec);
  const ctor = class extends OpenElement {} as unknown as CustomElementConstructor &
    Record<string, unknown>;
  ctor.__partProgram = program;
  ctor.__compiledProperties = program.metadata.properties;
  ctor.__elementMetadata = program.metadata;
  if (program.metadata.observedAttributes.length > 0) {
    ctor.observedAttributes = program.metadata.observedAttributes;
  }
  const prototype = ctor.prototype as Record<string, unknown>;
  prototype.onCsrRendered = function () {
    hooks.csr++;
  };
  prototype.onDsdHydrated = function () {
    hooks.dsd++;
  };
  prototype.clientActivate = function () {
    hooks.activate++;
  };
  for (const [name, value] of Object.entries(members)) prototype[name] = value;
  dom.registry.define(spec.tag, ctor);
  return ctor;
}

/**
 * A claim-safe program for the DSD cases: static structure plus one event
 * Part. A dynamic value Part would need the compiler's emitted `static props`
 * default for the SSR seed to match at claim time, which is the compiled
 * class's job — the claim+Part path is covered by the hydration suites.
 */
const DSD_PROGRAM = (tag: string): TestProgramSpec => ({
  tag,
  rootMode: 'shadow-open',
  template: [
    {
      k: 'el',
      tag: 'div',
      attrs: [],
      children: [
        { k: 'el', tag: 'button', attrs: [], children: [{ k: 'text', value: '+' }] },
        { k: 'text', value: 'claimed' },
      ],
    },
  ],
  parts: [
    {
      k: 'event',
      index: 0,
      event: 'click',
      handler: 'bump',
      action: { kind: 'method', name: 'bump' },
      path: [0, 0],
    },
  ],
});

/** The compiled event Part dispatches into this method; it must exist. */
const BUMP = {
  bump(this: { message?: string }) {
    if (typeof this.message === 'string') this.message = 'bumped';
  },
};

const CLICK_PROGRAM = (tag: string, root: 'light' | 'shadow-open'): TestProgramSpec => ({
  tag,
  rootMode: root,
  template: [
    {
      k: 'el',
      tag: 'div',
      attrs: [],
      children: [
        { k: 'el', tag: 'button', attrs: [], children: [{ k: 'text', value: '+' }] },
        { k: 'part', index: 0 },
        { k: 'text', value: '-' },
      ],
    },
  ],
  parts: [
    { k: 'text', index: 0, signal: 'message' },
    {
      k: 'event',
      index: 1,
      event: 'click',
      handler: 'bump',
      action: { kind: 'method', name: 'bump' },
      path: [0, 0],
    },
  ],
  properties: [
    {
      name: 'message',
      attribute: null,
      type: 'string',
      converter: 'string',
      reflect: false,
      default: 'a',
    },
  ],
});

/** Serialize a host's own children (the program's tree, without the host tag). */
function childrenHtml(host: FacadeElement): string {
  return host.childNodes.map((node) => toHtml(node as never)).join('');
}

function buttonOf(host: FacadeElement): { listeners?: Map<string, unknown[]> } | null {
  const root = host.shadowRoot ?? host;
  const first = root.childNodes[0] as FacadeElement | undefined;
  return (first?.childNodes?.[0] as { listeners?: Map<string, unknown[]> }) ?? null;
}

function listenerCount(host: FacadeElement): number {
  return buttonOf(host)?.listeners?.get('click')?.length ?? -1;
}

test('first fresh CSR activation fires onCsrRendered and clientActivate once', () => {
  const tag = uniqueTag('fresh');
  const hooks: Hooks = { csr: 0, dsd: 0, activate: 0 };
  defineProgrammed(CLICK_PROGRAM(tag, 'light'), hooks, BUMP);
  const el = dom.document.createElement(tag) as FacadeElement;
  dom.document.body.appendChild(el);
  expect(hooks).toEqual({ csr: 1, dsd: 0, activate: 1 });
  expect(childrenHtml(el)).toBe('<div><button>+</button><!--oe:p0-->a-</div>');
});

test('first DSD claim fires onDsdHydrated and clientActivate once', () => {
  const tag = uniqueTag('dsd');
  const hooks: Hooks = { csr: 0, dsd: 0, activate: 0 };
  const ctor = defineProgrammed(DSD_PROGRAM(tag), hooks, BUMP);
  const html = renderToString(tag, { componentClass: ctor });
  const el = mountSerialized(dom, html) as FacadeElement;
  expect(hooks).toEqual({ csr: 0, dsd: 1, activate: 1 });
  expect(listenerCount(el), 'the claimed button carries exactly one listener').toBe(1);
});

test('a CSR reconnect fires onCsrRendered again — never the DSD-only hook', () => {
  const tag = uniqueTag('csr-resume');
  const hooks: Hooks = { csr: 0, dsd: 0, activate: 0 };
  defineProgrammed(CLICK_PROGRAM(tag, 'light'), hooks, BUMP);
  const el = dom.document.createElement(tag) as FacadeElement;
  dom.document.body.appendChild(el);
  const buttonNode = buttonOf(el);
  const textNode = el.childNodes[0]?.childNodes?.[2];

  dom.document.body.removeChild(el);
  dom.document.body.appendChild(el);

  expect(hooks, 'the reconnect is an activation of the same CSR instance').toEqual({
    csr: 2,
    dsd: 0,
    activate: 2,
  });
  expect(el.childNodes[0]?.childNodes?.[2], 'the value node keeps its identity').toBe(textNode);
  expect(buttonOf(el), 'so does the button').toBe(buttonNode);
  expect(listenerCount(el), 'no duplicated listener').toBe(1);
});

test('a DSD reconnect fires onDsdHydrated again and keeps one listener', () => {
  const tag = uniqueTag('dsd-resume');
  const hooks: Hooks = { csr: 0, dsd: 0, activate: 0 };
  const ctor = defineProgrammed(DSD_PROGRAM(tag), hooks, BUMP);
  const html = renderToString(tag, { componentClass: ctor });
  const el = mountSerialized(dom, html) as FacadeElement;
  const before = el.shadowRoot?.childNodes[0];

  dom.document.body.removeChild(el);
  dom.document.body.appendChild(el);

  expect(hooks).toEqual({ csr: 0, dsd: 2, activate: 2 });
  expect(el.shadowRoot?.childNodes[0], 'the claimed range keeps its identity').toBe(before);
  expect(listenerCount(el), 'the resumed listener is the only one').toBe(1);
});

test('repeated moves fire one activation per connection and never duplicate listeners', () => {
  const tag = uniqueTag('moves');
  const hooks: Hooks = { csr: 0, dsd: 0, activate: 0 };
  defineProgrammed(CLICK_PROGRAM(tag, 'light'), hooks, BUMP);
  const el = dom.document.createElement(tag) as FacadeElement;
  dom.document.body.appendChild(el);
  for (let move = 0; move < 3; move++) {
    dom.document.body.removeChild(el);
    dom.document.body.appendChild(el);
    expect(listenerCount(el), `move ${move + 1} keeps exactly one listener`).toBe(1);
  }
  expect(hooks).toEqual({ csr: 4, dsd: 0, activate: 4 });
});

test('a failed reconnect fires no hook and leaves the DOM untouched', () => {
  const tag = uniqueTag('failed');
  const hooks: Hooks = { csr: 0, dsd: 0, activate: 0 };
  defineProgrammed(CLICK_PROGRAM(tag, 'light'), hooks, BUMP);
  const el = dom.document.createElement(tag) as FacadeElement;
  dom.document.body.appendChild(el);
  const before = childrenHtml(el);

  dom.document.body.removeChild(el);
  // Structural damage: the program's element is detached (kept for repair).
  const programElement = el.childNodes[0];
  el.removeChild(programElement);
  const damaged = childrenHtml(el);

  let error: unknown;
  try {
    dom.document.body.appendChild(el);
  } catch (caught) {
    error = caught;
  }
  expect(error, 'the reconnect fails closed').toBeInstanceOf(Error);
  expect((error as Error).message).toContain('missing child');
  expect(hooks, 'a failed activation reports no hook').toEqual({ csr: 1, dsd: 0, activate: 1 });
  expect(childrenHtml(el), 'nothing was partially reconciled').toBe(damaged);
  expect(damaged).not.toBe(before);

  // A failed connect leaves the host connected: disconnect before repairing,
  // then the restored node lets the same instance resume.
  dom.document.body.removeChild(el);
  el.appendChild(programElement);
  dom.document.body.appendChild(el);
  expect(hooks).toEqual({ csr: 2, dsd: 0, activate: 2 });
});
