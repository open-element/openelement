/**
 * @openelement/element — OpenElement base class unit tests (0.44 compiled).
 *
 * Migrated from the legacy renderer suite to the compiled Part Program
 * architecture. Covers the surviving user-facing behavior contracts:
 *   - instantiation and base static properties
 *   - shadow DOM default root / light DOM opt-in (program root.kind)
 *   - fresh creation vs. DSD claim (onCsrRendered / onDsdHydrated)
 *   - static styles / adoptedStyleSheets and global styles
 *   - document theme broadcasts
 *   - signal-driven Part updates and event binding
 *   - compiled property contract: attribute init/change/removal, reflection,
 *     boolean and array/object conversion, reconnect state preservation
 *   - formAssociated / ElementInternals
 *   - params attribute parsing
 *
 * Deleted-internals coverage (VNode renderer, binding descriptors, hydration
 * markers, keyed-For reconciliation, renderToDom) is owned by the
 * compiled-runtime/, compiled-server/, and compiled-claim/ suites; the public
 * end-to-end proofs live in compiled-runtime/facade.test.ts.
 *
 * The DOM harness (compiled-runtime/facade-dom.ts) installs browser globals
 * before the package is imported; the facade captures its HTMLElement base
 * class at module evaluation time.
 */

import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertNotEquals,
  assertStrictEquals,
  assertStringIncludes,
} from '@std/assert';
import {
  type FacadeElement,
  installFacadeDom,
  mountSerialized,
  toHtml,
} from './compiled-runtime/facade-dom.ts';
import { testProgram, type TestProgramSpec } from './compiled-runtime/test-program.ts';

const dom = installFacadeDom();

const { OpenElement } = await import('@openelement/element');
const { renderDsd } = await import('@openelement/element');
const { StyleSheet } = await import('@openelement/element');
const { OpenElementError } = await import('../src/internal/core/errors.ts');

let tagCounter = 0;
function uniqueTag(prefix: string): string {
  return `oe-migrated-${prefix}-${++tagCounter}`;
}

type CompiledMembers = Record<string, (this: never, ...args: never[]) => unknown>;

/**
 * Build a compiled facade class the way the 0.44 compiler emits it: compiled
 * statics on a plain OpenElement subclass. Extra members stand in for
 * compiler-copied methods.
 */
function defineCompiled(
  spec: TestProgramSpec,
  members: CompiledMembers = {},
  statics: Record<string, unknown> = {},
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
  for (const [name, value] of Object.entries(members)) {
    (ctor.prototype as Record<string, unknown>)[name] = value;
  }
  for (const [name, value] of Object.entries(statics)) ctor[name] = value;
  dom.registry.define(spec.tag, ctor);
  return ctor;
}

// oxlint-disable-next-line no-explicit-any
type AnyElement = any;

function connect(element: FacadeElement): FacadeElement {
  dom.document.body.appendChild(element);
  return element;
}

// ─── Instantiation and base statics ────────────────────────────────

Deno.test('OpenElement is instantiable', () => {
  const el = new OpenElement();
  assertInstanceOf(el, OpenElement);
});

Deno.test('OpenElement exposes base static contract', () => {
  assertEquals(OpenElement.styles, undefined);
  assertEquals(typeof OpenElement.registerGlobalStyles, 'function');
  assertEquals(typeof OpenElement.getGlobalStyles, 'function');
  assertEquals(typeof OpenElement._resetGlobalStyles, 'function');
  class LightElement extends OpenElement {
    static override renderMode = 'light' as const;
  }
  assertEquals(LightElement.renderMode, 'light');
});

Deno.test('OpenElement without a compiled program fails closed at connect', () => {
  const tag = uniqueTag('uncompiled');
  class Uncompiled extends OpenElement {}
  dom.registry.define(tag, Uncompiled as unknown as CustomElementConstructor);
  const el = dom.document.createElement(tag);
  const error = (() => {
    try {
      dom.document.body.appendChild(el);
      return null;
    } catch (caught) {
      return caught;
    }
  })();
  assertInstanceOf(error, OpenElementError);
  assertEquals((error as InstanceType<typeof OpenElementError>).code, 'OE_PROGRAM_MISSING');
});

// ─── Root modes and lifecycle hooks ────────────────────────────────

Deno.test('compiled shadow program creates a shadow root and calls onCsrRendered', () => {
  const tag = uniqueTag('shadow');
  let csr = 0;
  const ctor = defineCompiled({
    tag,
    rootMode: 'shadow-open',
    template: [{ k: 'el', tag: 'div', attrs: [], children: [{ k: 'text', value: 'shadow' }] }],
    parts: [],
  });
  (ctor.prototype as Record<string, unknown>).onCsrRendered = function () {
    csr++;
  };
  const el = connect(dom.document.createElement(tag)) as AnyElement;
  assert(el.shadowRoot !== null);
  assertEquals(toHtml(el.shadowRoot), '<div>shadow</div>');
  assertEquals(csr, 1);
});

Deno.test('compiled light program renders into light DOM and calls onCsrRendered', () => {
  const tag = uniqueTag('light');
  let csr = 0;
  let dsd = 0;
  const ctor = defineCompiled({
    tag,
    rootMode: 'light',
    template: [{ k: 'el', tag: 'span', attrs: [], children: [{ k: 'text', value: 'light' }] }],
    parts: [],
  });
  (ctor.prototype as Record<string, unknown>).onCsrRendered = function () {
    csr++;
  };
  (ctor.prototype as Record<string, unknown>).onDsdHydrated = function () {
    dsd++;
  };
  const el = connect(dom.document.createElement(tag)) as AnyElement;
  assertEquals(toHtml(el), `<${tag}><span>light</span></${tag}>`);
  assertEquals(csr, 1);
  assertEquals(dsd, 0);
});

Deno.test('compiled program claims serialized DSD and calls onDsdHydrated', () => {
  const tag = uniqueTag('dsd');
  let csr = 0;
  let dsd = 0;
  const ctor = defineCompiled({
    tag,
    rootMode: 'shadow-open',
    template: [{ k: 'el', tag: 'p', attrs: [], children: [{ k: 'text', value: 'claimed' }] }],
    parts: [],
  });
  (ctor.prototype as Record<string, unknown>).onCsrRendered = function () {
    csr++;
  };
  (ctor.prototype as Record<string, unknown>).onDsdHydrated = function () {
    dsd++;
  };
  const html = renderDsd(tag, { componentClass: ctor }).html;
  assertStringIncludes(html, '<template shadowrootmode="open">');
  let claimedP: unknown;
  const el = mountSerialized(dom, html, (host) => {
    claimedP = (host as AnyElement).shadowRoot.childNodes[0];
  }) as AnyElement;
  assertStrictEquals(el.shadowRoot.childNodes[0], claimedP, 'claim keeps node identity');
  assertEquals(dsd, 1);
  assertEquals(csr, 0);
});

// ─── Styles ────────────────────────────────────────────────────────

Deno.test('compiled element applies static styles via adoptedStyleSheets', () => {
  const tag = uniqueTag('styles');
  const sheet = new StyleSheet();
  sheet.replaceSync('oe-migrated-styles { color: red; }');
  defineCompiled(
    {
      tag,
      rootMode: 'shadow-open',
      template: [{ k: 'el', tag: 'div', attrs: [], children: [] }],
      parts: [],
    },
    {},
    { styles: sheet },
  );
  const el = connect(dom.document.createElement(tag)) as AnyElement;
  assertEquals(el.shadowRoot.adoptedStyleSheets.length, 1);
  assertEquals(el.shadowRoot.adoptedStyleSheets[0], sheet);
});

Deno.test('registerGlobalStyles applies to new shadow roots and is idempotent', () => {
  const tag = uniqueTag('global-styles');
  OpenElement._resetGlobalStyles();
  const sheet = new StyleSheet();
  sheet.replaceSync('oe-migrated-global { color: blue; }');
  OpenElement.registerGlobalStyles([sheet]);
  OpenElement.registerGlobalStyles([sheet]);
  assertEquals(OpenElement.getGlobalStyles(), [sheet]);
  defineCompiled({
    tag,
    rootMode: 'shadow-open',
    template: [{ k: 'el', tag: 'div', attrs: [], children: [] }],
    parts: [],
  });
  const el = connect(dom.document.createElement(tag)) as AnyElement;
  assert(el.shadowRoot.adoptedStyleSheets.includes(sheet));
  OpenElement._resetGlobalStyles();
  assertEquals(OpenElement.getGlobalStyles(), []);
});

// ─── Theme broadcasts ──────────────────────────────────────────────

Deno.test('connected compiled hosts receive and clear data-theme broadcasts', () => {
  const tag = uniqueTag('theme');
  defineCompiled({
    tag,
    template: [{ k: 'el', tag: 'div', attrs: [], children: [] }],
    parts: [],
  });
  const el = connect(dom.document.createElement(tag)) as AnyElement;
  dom.document.documentElement.setAttribute('data-theme', 'dark');
  assertEquals(el.getAttribute('data-theme'), 'dark');
  dom.document.documentElement.removeAttribute('data-theme');
  assertEquals(el.hasAttribute('data-theme'), false);
});

Deno.test('theme broadcasts skip self-themed hosts and stop after disconnect (#773)', () => {
  const tag = uniqueTag('theme-self');
  defineCompiled({
    tag,
    template: [{ k: 'el', tag: 'div', attrs: [], children: [] }],
    parts: [],
  });
  const el = dom.document.createElement(tag) as AnyElement;
  el.setAttribute('data-theme', 'brand');
  connect(el);
  dom.document.documentElement.setAttribute('data-theme', 'dark');
  assertEquals(el.getAttribute('data-theme'), 'brand', 'host-owned theme wins');
  dom.document.body.removeChild(el);
  dom.document.documentElement.setAttribute('data-theme', 'light');
  assertEquals(el.getAttribute('data-theme'), 'brand', 'disconnected hosts are not broadcast to');
  dom.document.documentElement.removeAttribute('data-theme');
});

// ─── Signals, parts, events ────────────────────────────────────────

Deno.test('signal-backed property writes update only the subscribed Part', () => {
  const tag = uniqueTag('signal');
  defineCompiled({
    tag,
    template: [
      {
        k: 'el',
        tag: 'div',
        attrs: [],
        children: [
          { k: 'text', value: 'v=' },
          { k: 'part', index: 0 },
        ],
      },
    ],
    parts: [{ k: 'text', index: 0, signal: 'label' }],
    properties: [
      {
        name: 'label',
        attribute: 'label',
        type: 'string',
        converter: 'string',
        reflect: false,
        default: 'a',
      },
    ],
  });
  const el = connect(dom.document.createElement(tag)) as AnyElement;
  assertEquals(toHtml(el), `<${tag}><div>v=<!--oe:p0-->a</div></${tag}>`);
  el.label = 'b';
  assertEquals(toHtml(el), `<${tag}><div>v=<!--oe:p0-->b</div></${tag}>`);
});

Deno.test('compiled event parts bind instance methods once across reconnect', () => {
  const tag = uniqueTag('event');
  const calls: string[] = [];
  defineCompiled(
    {
      tag,
      template: [{ k: 'el', tag: 'button', attrs: [], children: [] }],
      parts: [
        {
          k: 'event',
          index: 0,
          event: 'click',
          handler: 'activate',
          action: { kind: 'method', name: 'activate' },
          path: [0],
        },
      ],
    },
    {
      activate() {
        calls.push('hit');
      },
    },
  );
  const el = connect(dom.document.createElement(tag)) as AnyElement;
  const button = el.childNodes[0];
  button.dispatchEvent({ type: 'click', target: null, currentTarget: null });
  assertEquals(calls.length, 1);
  dom.document.body.removeChild(el);
  connect(el);
  assertEquals((button.listeners.get('click') ?? []).length, 1);
  button.dispatchEvent({ type: 'click', target: null, currentTarget: null });
  assertEquals(calls.length, 2);
});

// ─── Compiled property contract ────────────────────────────────────

const PROP_SPEC: TestProgramSpec = {
  tag: 'oe-migrated-props',
  template: [{ k: 'el', tag: 'div', attrs: [], children: [{ k: 'part', index: 0 }] }],
  parts: [{ k: 'text', index: 0, signal: 'count' }],
  properties: [
    {
      name: 'count',
      attribute: 'count',
      type: 'number',
      converter: 'number',
      reflect: true,
      default: 0,
    },
    {
      name: 'label',
      attribute: 'label',
      type: 'string',
      converter: 'string',
      reflect: false,
      default: 'x',
    },
    {
      name: 'disabled',
      attribute: 'disabled',
      type: 'boolean',
      converter: 'boolean',
      reflect: true,
      default: false,
    },
    {
      name: 'items',
      attribute: 'items',
      type: 'array',
      converter: 'array',
      reflect: false,
      default: [],
    },
    {
      name: 'itemCount',
      attribute: 'item-count',
      type: 'number',
      converter: 'number',
      reflect: false,
      default: 0,
    },
  ],
};

Deno.test('compiled properties initialize from attributes via converters', () => {
  const tag = uniqueTag('props-init');
  defineCompiled({ ...PROP_SPEC, tag });
  const el = dom.document.createElement(tag) as AnyElement;
  el.setAttribute('count', '41');
  el.setAttribute('label', 'hello');
  el.setAttribute('disabled', '');
  el.setAttribute('items', '[{"id":"a"}]');
  el.setAttribute('item-count', '3');
  connect(el);
  assertEquals(el.count, 41);
  assertEquals(el.label, 'hello');
  assertEquals(el.disabled, true);
  assertEquals(el.items, [{ id: 'a' }]);
  assertEquals(el.itemCount, 3);
});

Deno.test('compiled properties react to attribute changes; removal restores defaults', () => {
  const tag = uniqueTag('props-react');
  defineCompiled({ ...PROP_SPEC, tag });
  const el = connect(dom.document.createElement(tag)) as AnyElement;
  el.setAttribute('count', '9');
  assertEquals(el.count, 9);
  el.setAttribute('count', 'not-a-number');
  assertEquals(el.count, 0, 'NaN converts to 0');
  el.removeAttribute('label');
  assertEquals(el.label, 'x', 'removal restores the compiled default');
  el.removeAttribute('disabled');
  assertEquals(el.disabled, false);
});

Deno.test('reflect properties mirror property writes to attributes', () => {
  const tag = uniqueTag('props-reflect');
  defineCompiled({ ...PROP_SPEC, tag });
  const el = connect(dom.document.createElement(tag)) as AnyElement;
  el.count = 7;
  assertEquals(el.getAttribute('count'), '7');
  el.disabled = true;
  assertEquals(el.getAttribute('disabled'), '');
  el.disabled = false;
  assertEquals(el.hasAttribute('disabled'), false);
  // Removal of a reflected attribute restores the default and re-mirrors it.
  el.count = 12;
  el.removeAttribute('count');
  assertEquals(el.count, 0);
  assertEquals(el.getAttribute('count'), '0');
});

Deno.test('property-set state survives disconnect→reconnect (#772)', () => {
  const tag = uniqueTag('props-reconnect');
  defineCompiled({ ...PROP_SPEC, tag });
  const el = connect(dom.document.createElement(tag)) as AnyElement;
  el.label = 'kept';
  dom.document.body.removeChild(el);
  connect(el);
  assertEquals(el.label, 'kept');
  // Present attributes re-sync on reconnect.
  el.setAttribute('label', 'from-attr');
  dom.document.body.removeChild(el);
  connect(el);
  assertEquals(el.label, 'from-attr');
});

// ─── formAssociated / params ───────────────────────────────────────

Deno.test('compiled element attaches ElementInternals when formAssociated', () => {
  const tag = uniqueTag('form');
  let attached = 0;
  const ctor = defineCompiled({
    tag,
    template: [{ k: 'el', tag: 'input', attrs: [], children: [] }],
    parts: [],
  });
  (ctor.prototype as Record<string, unknown>).attachInternals = function () {
    attached++;
    return { setFormValue: () => {}, setValidity: () => {} };
  };
  (ctor as unknown as Record<string, unknown>).formAssociated = true;
  connect(dom.document.createElement(tag));
  assertEquals(attached, 1);
});

Deno.test('compiled element parses the params attribute into reactive params', () => {
  const tag = uniqueTag('params');
  defineCompiled({
    tag,
    template: [{ k: 'el', tag: 'div', attrs: [], children: [] }],
    parts: [],
  });
  const el = dom.document.createElement(tag) as AnyElement;
  el.setAttribute('params', '{"id":"7"}');
  connect(el);
  assertEquals(el.params, { id: '7' });
  el.params = { id: '8' };
  assertEquals(el.params, { id: '8' });
});

// ─── Lifecycle helpers ─────────────────────────────────────────────

Deno.test('_lifecycleSignal aborts on disconnect and re-arms on reconnect', () => {
  const tag = uniqueTag('lifecycle');
  const seen: AbortSignal[] = [];
  const ctor = defineCompiled({
    tag,
    template: [{ k: 'el', tag: 'div', attrs: [], children: [] }],
    parts: [],
  });
  // clientActivate runs on every connect (fresh and claim alike).
  (ctor.prototype as Record<string, unknown>).clientActivate = function (this: {
    _lifecycleSignal(): AbortSignal;
  }) {
    seen.push(this._lifecycleSignal());
  };
  const el = connect(dom.document.createElement(tag));
  const first = seen[0];
  assert(first !== undefined && !first.aborted);
  dom.document.body.removeChild(el);
  assert(first.aborted);
  connect(el);
  const second = seen[1];
  assert(second !== undefined);
  assertNotEquals(second, first);
  assert(!second.aborted);
});

Deno.test('public signals keep engine semantics for authored effects', async () => {
  const { effect, signal } = await import('@openelement/element');
  const count = signal(0);
  const seen: number[] = [];
  const dispose = effect(() => {
    seen.push(count.value);
  });
  count.value = 2;
  dispose();
  count.value = 3;
  assertEquals(seen, [0, 2]);
});
