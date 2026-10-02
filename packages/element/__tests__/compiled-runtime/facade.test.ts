/**
 * compiled-runtime/facade.test.ts — public OpenElement facade end-to-end.
 *
 * Proves the 0.44 public class against the REAL compiler artifact: the class
 * below carries the frozen expected-program.json Part Program emitted by the
 * adapter compiler for the counter fixture (the same cross-package fixture
 * compiled-part-program-v1.test.ts consumes — adapter src is never
 * imported). Covered behavior:
 *   - fresh connect renders the program (text/prop/event/when/each parts)
 *   - attribute -> property conversion and property -> attribute reflection
 *   - signal writes update only the subscribed Parts/Regions
 *   - event handler wiring; reconnect never duplicates listeners
 *   - claim from serialized HTML preserves node identity (no re-allocation)
 *   - pre-upgrade capture + claim replay bootstrap
 *   - fail-closed diagnostics (OE_PROGRAM_MISSING / OE_HANDLER_MISSING /
 *     OE_JSX_OUTSIDE_COMPILER)
 */

import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../../tests/lib/vitest-asserts.ts';
import { FacadeEvent, installFacadeDom, mountSerialized, toHtml } from './facade-dom.ts';
import { testProgram } from './test-program.ts';

// The facade captures its HTMLElement base at module evaluation time.
const dom = installFacadeDom();

const { OpenElement, ErrorBoundary, ensurePreHydrationClickCapture, renderDsd } =
  await import('../../src/index.ts');
const { jsx } = await import('../../src/jsx-runtime.ts');
type BoundaryInstance = InstanceType<typeof ErrorBoundary>;
const { OpenElementError } = await import('../../src/internal/core/errors.ts');

const FIXTURE_PROGRAM = JSON.parse(
  await readFile(
    new URL('../../__fixtures__/compiled-element-v1/expected-program.json', import.meta.url),
    'utf8',
  ),
);

/** The counter fixture as the adapter compiler emits it (statics verbatim). */
class ProgramCounter extends OpenElement {
  static __partProgram = FIXTURE_PROGRAM;
  static __compiledProperties = FIXTURE_PROGRAM.metadata.properties;
  static __elementMetadata = FIXTURE_PROGRAM.metadata;
  static observedAttributes = FIXTURE_PROGRAM.metadata.observedAttributes;

  declare count: number;
  declare label: string;
  declare items: Array<{ id: string; text: string }>;

  increment(): void {
    this.count++;
  }
}
dom.registry.define('oe-program-counter', ProgramCounter);

function freshCounter(attrs: Record<string, string> = {}): InstanceType<typeof ProgramCounter> & {
  childNodes: unknown[];
} {
  const element = dom.document.createElement('oe-program-counter') as unknown as InstanceType<
    typeof ProgramCounter
  > & { childNodes: unknown[] };
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
  dom.document.body.appendChild(element as never);
  return element;
}

// oxlint-disable-next-line no-explicit-any
type AnyElement = any;

function shadowOf(element: AnyElement): AnyElement {
  return element.shadowRoot ?? element;
}

test('facade: fresh connect renders the compiled program end to end', () => {
  const element = freshCounter() as AnyElement;
  expect(element.count).toEqual(0);
  expect(element.label).toEqual('ready');
  expect(toHtml(shadowOf(element).childNodes[0])).toEqual(
    '<div class="proof">' +
      '<h1>Count: <!--oe:p0-->0</h1>' +
      '<input value="ready">' +
      '<button type="button">+</button>' +
      '<!--oe:p3--><p class="parity">zero</p><!--oe:/p3-->' +
      '<ul><!--oe:p4--><li>alpha</li><li>beta</li><!--oe:/p4--></ul>' +
      '</div>',
  );
});

test('facade: attribute writes convert and drive Parts and Regions', () => {
  const element = freshCounter() as AnyElement;
  element.setAttribute('count', '5');
  expect(element.count).toEqual(5);
  expect(toHtml(shadowOf(element))).toContain('<h1>Count: <!--oe:p0-->5</h1>');
  expect(toHtml(shadowOf(element))).toContain('<p class="parity">positive</p>');
});

test('facade: reflect properties mirror post-connect writes to attributes', () => {
  const element = freshCounter() as AnyElement;
  element.count = 7;
  expect(element.getAttribute('count')).toEqual('7');
  // The mirrored attribute does not re-enter the property (no loop).
  expect(element.count).toEqual(7);
  // label does not reflect.
  element.label = 'changed';
  expect(element.getAttribute('label')).toEqual(null);
  expect((shadowOf(element).childNodes[0].childNodes[1] as AnyElement).value).toEqual('changed');
});

test('facade: SSR-delivered attributes win at connect; defaults restore on removal', () => {
  const element = freshCounter({ count: '41' }) as AnyElement;
  expect(element.count).toEqual(41);
  expect(toHtml(shadowOf(element))).toContain('<h1>Count: <!--oe:p0-->41</h1>');
  element.removeAttribute('count');
  // Removal restores the compiled default and the reflect mirror re-appears.
  expect(element.count).toEqual(0);
  expect(element.getAttribute('count')).toEqual('0');
});

test('facade: event handlers wire to instance methods and survive reconnect once', () => {
  const element = freshCounter() as AnyElement;
  const button = () => shadowOf(element).childNodes[0].childNodes[2] as AnyElement;
  const listenerCount = () => (button().listeners.get('click') ?? []).length;

  expect(listenerCount()).toEqual(1);
  button().dispatchEvent(new FacadeEvent('click'));
  expect(element.count).toEqual(1);
  expect(toHtml(shadowOf(element))).toContain('<p class="parity">positive</p>');

  dom.document.body.removeChild(element);
  expect(listenerCount(), 'disconnect removes the listener').toEqual(0);
  dom.document.body.appendChild(element);
  expect(listenerCount(), 'reconnect adds exactly one listener').toEqual(1);
  button().dispatchEvent(new FacadeEvent('click'));
  expect(element.count, 'one dispatch fires the handler exactly once').toEqual(2);
});

test('facade: claim from serialized HTML preserves node identity', () => {
  const serialized = renderDsd('oe-program-counter', {
    componentClass: ProgramCounter as unknown as CustomElementConstructor,
    props: { count: 3 },
  }).html;
  expect(serialized).toContain('<oe-program-counter count="3" data-oe-light>');

  let claimedDiv: unknown;
  let claimedH1: unknown;
  let claimedButton: unknown;
  const element = mountSerialized(dom, serialized, (host) => {
    claimedDiv = host.childNodes[0];
    claimedH1 = (claimedDiv as AnyElement).childNodes[0];
    claimedButton = (claimedDiv as AnyElement).childNodes[2];
  }) as AnyElement;

  expect(element.childNodes[0], 'claim does not re-allocate the root').toBe(claimedDiv);
  expect((element.childNodes[0] as AnyElement).childNodes[0]).toBe(claimedH1);
  expect((element.childNodes[0] as AnyElement).childNodes[2]).toBe(claimedButton);
  expect(element.count).toEqual(3);
  expect(toHtml(element)).toContain('<p class="parity">positive</p>');

  // The claimed DOM is live: handler + parts activate on the existing nodes.
  (claimedButton as AnyElement).dispatchEvent(new FacadeEvent('click'));
  expect(element.count).toEqual(4);
  expect(toHtml(element)).toContain('<h1>Count: <!--oe:p0-->4</h1>');
});

test('facade: pre-upgrade capture replays one click after claim', () => {
  const serialized = renderDsd('oe-program-counter', {
    componentClass: ProgramCounter as unknown as CustomElementConstructor,
  }).html;

  // The generated client entry installs capture on an owning root before
  // upgrade; a click inside the serialized-but-not-yet-claimed subtree is
  // recorded and replayed by the claim path.
  let button: AnyElement | undefined;
  const element = mountSerialized(dom, serialized, (host) => {
    ensurePreHydrationClickCapture(host as unknown as EventTarget);
    button = (host.childNodes[0] as AnyElement).childNodes[2];
    button.dispatchEvent(new FacadeEvent('click', { bubbles: true }));
    expect((host as AnyElement).count, 'no handler runs before upgrade').toEqual(0);
  }) as AnyElement;

  expect(button !== undefined).toBeTruthy();
  expect(element.count, 'the pre-upgrade click replays into the claimed handler').toEqual(1);
  // Replay is bounded: a second claim cycle does not re-fire the consumed event.
  dom.document.body.removeChild(element);
  dom.document.body.appendChild(element);
  expect(element.count).toEqual(1);
});

test('facade: uncompiled classes fail closed at connect (OE_PROGRAM_MISSING)', () => {
  class BareElement extends OpenElement {}
  dom.registry.define('oe-bare-element', BareElement as unknown as CustomElementConstructor);
  const element = dom.document.createElement('oe-bare-element');
  const error = assertThrowsIncludes(
    () => dom.document.body.appendChild(element),
    OpenElementError,
  );
  expect(error.code).toEqual('OE_PROGRAM_MISSING');
  expect(error.message).toContain('BareElement');
  expect(error.message).toContain('open:compiled-element');
});

test('facade: a program-referenced handler missing on the instance fails closed', () => {
  class Handlerless extends OpenElement {
    static __partProgram = FIXTURE_PROGRAM;
    static __compiledProperties = FIXTURE_PROGRAM.metadata.properties;
    static __elementMetadata = FIXTURE_PROGRAM.metadata;
    static observedAttributes = FIXTURE_PROGRAM.metadata.observedAttributes;
  }
  const error = assertThrowsIncludes(
    () => new (Handlerless as unknown as new () => unknown)(),
    OpenElementError,
  );
  expect(error.code).toEqual('OE_HANDLER_MISSING');
  expect(error.message).toContain('"increment"');
});

test('facade: the runtime JSX factory fails closed outside the compiler', () => {
  const error = assertThrowsIncludes(() => jsx('div', {}), OpenElementError);
  expect(error.code).toEqual('OE_JSX_OUTSIDE_COMPILER');
  expect(error.message).toContain('compiler pipeline');
});

test('facade: renderDsd fails closed for uncompiled classes', () => {
  class LegacyClass {}
  const error = assertThrowsIncludes(
    () =>
      renderDsd('oe-legacy', {
        componentClass: LegacyClass as unknown as CustomElementConstructor,
      }),
    OpenElementError,
  );
  expect(error.code).toEqual('OE_PROGRAM_MISSING');
  expect(error.message).toContain('oe-legacy');
});

test('facade: renderDsd serializes shadow programs per the program root kind', () => {
  const shadowProgram = testProgram({
    tag: 'oe-facade-shadow',
    rootMode: 'shadow-open',
    template: [
      {
        k: 'el',
        tag: 'span',
        attrs: [],
        children: [{ k: 'part', index: 0 }],
      },
    ],
    parts: [{ k: 'text', index: 0, signal: 'label' }],
    properties: [
      {
        name: 'label',
        attribute: 'label',
        type: 'string',
        converter: 'string',
        reflect: true,
        default: 'idle',
      },
    ],
  });

  class ShadowElement extends OpenElement {
    static __partProgram = shadowProgram;
    static __compiledProperties = shadowProgram.metadata.properties;
    static __elementMetadata = shadowProgram.metadata;
    static observedAttributes = shadowProgram.metadata.observedAttributes;
    declare label: string;
  }
  dom.registry.define('oe-facade-shadow', ShadowElement as unknown as CustomElementConstructor);

  const html = renderDsd('oe-facade-shadow', {
    componentClass: ShadowElement as unknown as CustomElementConstructor,
    props: { label: 'live' },
  }).html;
  expect(html).toEqual(
    '<oe-facade-shadow label="live"><template shadowrootmode="open">' +
      '<span><!--oe:p0-->live</span>' +
      '</template></oe-facade-shadow>',
  );

  // Claim the DSD output; the shadow content stays node-identical.
  let claimedSpan: unknown;
  const element = mountSerialized(dom, html, (host) => {
    claimedSpan = host.shadowRoot!.childNodes[0];
  });
  expect((element.shadowRoot as unknown as AnyElement).childNodes[0]).toBe(claimedSpan);
  expect((element as AnyElement).label).toEqual('live');
});

test('facade: style Parts kebab-case camelCase declaration keys (#1056)', () => {
  const program = testProgram({
    tag: 'oe-facade-style',
    template: [{ k: 'el', tag: 'div', attrs: [], children: [] }],
    parts: [{ k: 'style', index: 0, signal: 'theme', path: [0] }],
    properties: [
      {
        name: 'theme',
        attribute: null,
        type: 'object',
        converter: 'object',
        reflect: false,
        default: {},
      },
    ],
  });
  class StyleElement extends OpenElement {
    static __partProgram = program;
    static __compiledProperties = program.metadata.properties;
    static __elementMetadata = program.metadata;
    declare theme: Record<string, string>;
  }
  dom.registry.define('oe-facade-style', StyleElement as unknown as CustomElementConstructor);
  const element = dom.document.createElement('oe-facade-style');
  dom.document.body.appendChild(element);
  (element as AnyElement).theme = { backgroundColor: 'red', 'font-size': '12px' };
  const div = element.childNodes[0] as AnyElement;
  expect(div.getAttribute('style')).toEqual('background-color:red;font-size:12px');
});

test('facade: ErrorBoundary exposes kernel-backed state and retry/reset', () => {
  const program = testProgram({
    tag: 'oe-facade-boundary',
    template: [{ k: 'el', tag: 'div', attrs: [], children: [{ k: 'text', value: 'ok' }] }],
    parts: [],
  });
  class BoundaryElement extends ErrorBoundary {
    static __partProgram = program;
    static __compiledProperties = program.metadata.properties;
    static __elementMetadata = program.metadata;
  }
  dom.registry.define('oe-facade-boundary', BoundaryElement as unknown as CustomElementConstructor);
  const element = dom.document.createElement('oe-facade-boundary') as unknown as BoundaryInstance;
  dom.document.body.appendChild(element as never);

  expect(element.hasError).toEqual(false);
  element.catchError(new Error('boom'));
  expect(element.hasError).toEqual(true);
  expect(element.error?.message).toEqual('boom');

  element.retry();
  expect(element.hasError).toEqual(false);
  expect(element.retryCount).toEqual(1);

  element.catchError(new Error('again'));
  element.reset();
  expect(element.hasError).toEqual(false);
  expect(element.retryCount).toEqual(0);
});

test('facade: the kernel captures connect-time failures into the boundary service', () => {
  const program = testProgram({
    tag: 'oe-facade-failing',
    template: [{ k: 'el', tag: 'div', attrs: [], children: [{ k: 'part', index: 0 }] }],
    parts: [{ k: 'text', index: 0, signal: 'label' }],
    properties: [
      {
        name: 'label',
        attribute: 'label',
        type: 'string',
        converter: 'string',
        reflect: false,
        default: 'x',
      },
    ],
  });
  class FailingBoundary extends ErrorBoundary {
    static __partProgram = program;
    static __compiledProperties = program.metadata.properties;
    static __elementMetadata = program.metadata;
    static observedAttributes = program.metadata.observedAttributes;
    declare label: string;
  }
  dom.registry.define('oe-facade-failing', FailingBoundary as unknown as CustomElementConstructor);

  // Serialized output drifted (wrong text) so the claim fails; the kernel
  // captures the error into the same service the public boundary exposes.
  const element = dom.document.createElement('oe-facade-failing') as unknown as BoundaryInstance & {
    childNodes: unknown[];
  };
  const drifted = dom.document.createElement('div');
  drifted.appendChild(dom.document.createTextNode('drifted'));
  (element as unknown as AnyElement).appendChild(drifted);
  assertThrowsIncludes(() => dom.document.body.appendChild(element as never));
  expect(element.hasError).toEqual(true);
  expect(element.error).toBeInstanceOf(OpenElementError);
});
