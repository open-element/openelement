/**
 * @openelement/element — light-mode in-place activation (ADR-0142, #1148),
 * restated over the compiled Part Program architecture (0.44).
 *
 * The contract is now owned by the compiled claim path: a light-root host
 * whose light subtree was server-rendered is claimed in place — node
 * identity, form values, and pre-upgrade event targets survive — while
 * structural drift fails closed with a structured PartProgramClaimError
 * (no binding is ever attempted against misaligned DOM; there is no
 * clear-and-render fallback in the compiled architecture).
 *
 * Kernel-level coverage lives in compiled-runtime/kernel.test.ts and
 * compiled-claim/compiled-claim.test.ts; this file pins the PUBLIC facade
 * behavior for light-mode OpenElement hosts.
 *
 * The DOM harness (compiled-runtime/facade-dom.ts) installs browser globals
 * before the package is imported.
 */

import { assert, assertEquals, assertStrictEquals, assertStringIncludes } from '@std/assert';
import {
  FacadeEvent,
  installFacadeDom,
  mountSerialized,
  parseHtml,
  toHtml,
} from './compiled-runtime/facade-dom.ts';
import { testProgram } from './compiled-runtime/test-program.ts';

const dom = installFacadeDom();

const { OpenElement, renderDsd } = await import('@openelement/element');
const { PartProgramClaimError } = await import('../src/internal/compiled/runtime.ts');

// oxlint-disable-next-line no-explicit-any
type AnyElement = any;

let tagCounter = 0;
function uniqueTag(prefix: string): string {
  return `oe-light-${prefix}-${++tagCounter}`;
}

const LIGHT_PROGRAM = {
  template: [
    {
      k: 'el' as const,
      tag: 'button',
      attrs: [['type', 'button']] as Array<[string, string]>,
      children: [
        { k: 'text' as const, value: 'count: ' },
        { k: 'part' as const, index: 0 },
      ],
    },
  ],
  parts: [
    { k: 'text' as const, index: 0, signal: 'count' },
    {
      k: 'event' as const,
      index: 1,
      event: 'click',
      handler: 'increment',
      action: { kind: 'method' as const, name: 'increment' },
      path: [0],
    },
  ],
  properties: [
    {
      name: 'count',
      attribute: 'count',
      type: 'number' as const,
      converter: 'number' as const,
      reflect: true,
      default: 0,
    },
  ],
};

function defineLightCounter(tag: string): CustomElementConstructor {
  const program = testProgram({ tag, rootMode: 'light', ...LIGHT_PROGRAM });
  const ctor = class extends OpenElement {
    increment(this: AnyElement): void {
      this.count++;
    }
  } as unknown as CustomElementConstructor & Record<string, unknown>;
  ctor.__partProgram = program;
  ctor.__compiledProperties = program.metadata.properties;
  ctor.__elementMetadata = program.metadata;
  ctor.observedAttributes = program.metadata.observedAttributes;
  dom.registry.define(tag, ctor);
  return ctor;
}

Deno.test('light activation claims the serialized subtree in place (node identity kept)', () => {
  const tag = uniqueTag('claim');
  const ctor = defineLightCounter(tag);
  const html = renderDsd(tag, { componentClass: ctor, props: { count: 2 } }).html;
  assertStringIncludes(html, `<${tag} count="2"`);

  let button: AnyElement | undefined;
  let countText: AnyElement | undefined;
  const el = mountSerialized(dom, html, (host) => {
    button = host.childNodes[0];
    // children: text 'count: ', <!--oe:p0--> anchor, then the value text node.
    countText = button.childNodes[2];
  }) as AnyElement;

  assertStrictEquals(el.childNodes[0], button, 'the SSR button is claimed, not replaced');
  assertStrictEquals(button.childNodes[2], countText, 'the SSR text node is claimed');
  assertEquals(el.count, 2);

  // Activation is live on the existing nodes.
  button.dispatchEvent(new FacadeEvent('click'));
  assertEquals(el.count, 3);
  assertEquals(countText.data, '3');
});

Deno.test('light activation drift fails closed with a structured claim mismatch', () => {
  const tag = uniqueTag('drift');
  const ctor = defineLightCounter(tag);
  void ctor;

  const el = dom.document.createElement(tag) as AnyElement;
  el.setAttribute('count', '2');
  // Drifted content: the text Part anchor is missing.
  const parsed = parseHtml(dom.document, '<button type="button">count: <!--bad-->2</button>');
  for (const child of [...parsed.childNodes]) el.appendChild(child);

  let thrown: unknown;
  try {
    dom.document.body.appendChild(el);
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof PartProgramClaimError, 'claim drift throws the structured diagnostic');
  assertStringIncludes((thrown as Error).message, 'oe:p0');
  // No binding was attempted against the misaligned DOM.
  (el.childNodes[0] as AnyElement).dispatchEvent(new FacadeEvent('click'));
  assertEquals(el.count, 2, 'the handler never activated');
});

Deno.test('light host without serialized content renders fresh (empty root)', () => {
  const tag = uniqueTag('fresh');
  const ctor = defineLightCounter(tag);
  void ctor;
  const el = dom.document.createElement(tag) as AnyElement;
  dom.document.body.appendChild(el);
  assertEquals(toHtml(el), `<${tag}><button type="button">count: <!--oe:p0-->0</button></${tag}>`);
});

Deno.test('light reconnect re-activates in place without duplicate listeners', () => {
  const tag = uniqueTag('reconnect');
  const ctor = defineLightCounter(tag);
  const html = renderDsd(tag, { componentClass: ctor, props: { count: 1 } }).html;

  let button: AnyElement | undefined;
  const el = mountSerialized(dom, html, (host) => {
    button = host.childNodes[0];
  }) as AnyElement;
  const listenerCount = () => (button.listeners.get('click') ?? []).length;
  assertEquals(listenerCount(), 1);

  dom.document.body.removeChild(el);
  assertEquals(listenerCount(), 0);
  dom.document.body.appendChild(el);
  assertStrictEquals(el.childNodes[0], button, 'reconnect re-claims the same DOM');
  assertEquals(listenerCount(), 1, 'no duplicate listener');
  assertEquals(el.count, 1, 'state survives the disconnect→reconnect cycle');
  button.dispatchEvent(new FacadeEvent('click'));
  assertEquals(el.count, 2);
});

Deno.test('nested light hosts claim in their own scopes', () => {
  const outerTag = uniqueTag('outer');
  const innerTag = uniqueTag('inner');

  // The inner host is static (no dynamic parts). The parent declares only the
  // custom-element host; SSG expands its independently-owned light subtree.
  const innerProgram = testProgram({
    tag: innerTag,
    rootMode: 'light',
    template: [{ k: 'el', tag: 'em', attrs: [], children: [{ k: 'text', value: 'inner' }] }],
    parts: [],
  });
  const innerCtor = class extends OpenElement {} as unknown as CustomElementConstructor &
    Record<string, unknown>;
  innerCtor.__partProgram = innerProgram;
  innerCtor.__compiledProperties = innerProgram.metadata.properties;
  innerCtor.__elementMetadata = innerProgram.metadata;
  dom.registry.define(innerTag, innerCtor);

  const outerProgram = testProgram({
    tag: outerTag,
    rootMode: 'light',
    template: [
      {
        k: 'el',
        tag: 'section',
        attrs: [],
        children: [
          {
            k: 'el',
            tag: innerTag,
            attrs: [],
            children: [],
          },
        ],
      },
    ],
    parts: [],
  });
  const outerCtor = class extends OpenElement {} as unknown as CustomElementConstructor &
    Record<string, unknown>;
  outerCtor.__partProgram = outerProgram;
  outerCtor.__compiledProperties = outerProgram.metadata.properties;
  outerCtor.__elementMetadata = outerProgram.metadata;
  dom.registry.define(outerTag, outerCtor);

  // Serialize the inner host on its own, then nest it inside the outer
  // host's serialized content — the shape the server pipeline emits.
  const innerHtml = renderDsd(innerTag, { componentClass: innerCtor }).html;
  const outerHtml = `<${outerTag}><section>${innerHtml}</section></${outerTag}>`;

  let innerEm: unknown;
  const outerEl = mountSerialized(dom, outerHtml, (host) => {
    innerEm = (host.childNodes[0] as AnyElement).childNodes[0].childNodes[0];
  }) as AnyElement;
  const innerEl = outerEl.childNodes[0].childNodes[0];

  // Both claims are read-only: the inner host re-walks the same nodes when it
  // connects (child connect follows the parent's), preserving identity.
  assertStrictEquals(innerEl.childNodes[0], innerEm, 'nested claim preserves node identity');
  assertEquals(toHtml(innerEl), `<${innerTag} data-oe-light=""><em>inner</em></${innerTag}>`);
});
