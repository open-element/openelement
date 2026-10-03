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

import { expect, test } from 'vitest';
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

test('OpenElement is instantiable', () => {
  const el = new OpenElement();
  expect(el).toBeInstanceOf(OpenElement);
});

test('OpenElement exposes base static contract', () => {
  expect(OpenElement.styles).toEqual(undefined);
  expect(typeof OpenElement.registerGlobalStyles).toEqual('function');
  expect(typeof OpenElement.getGlobalStyles).toEqual('function');
  expect(typeof OpenElement._resetGlobalStyles).toEqual('function');
  class LightElement extends OpenElement {
    static override renderMode = 'light' as const;
  }
  expect(LightElement.renderMode).toEqual('light');
});

test('OpenElement without a compiled program fails closed at connect', () => {
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
  expect(error).toBeInstanceOf(OpenElementError);
  expect((error as InstanceType<typeof OpenElementError>).code).toEqual('OE_PROGRAM_MISSING');
});

// ─── Root modes and lifecycle hooks ────────────────────────────────

test('compiled shadow program creates a shadow root and calls onCsrRendered', () => {
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
  expect(el.shadowRoot !== null).toBeTruthy();
  expect(toHtml(el.shadowRoot)).toEqual('<div>shadow</div>');
  expect(csr).toEqual(1);
});

test('compiled light program renders into light DOM and calls onCsrRendered', () => {
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
  expect(toHtml(el)).toEqual(`<${tag}><span>light</span></${tag}>`);
  expect(csr).toEqual(1);
  expect(dsd).toEqual(0);
});

test('compiled program claims serialized DSD and calls onDsdHydrated', () => {
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
  expect(html).toContain('<template shadowrootmode="open">');
  let claimedP: unknown;
  const el = mountSerialized(dom, html, (host) => {
    claimedP = (host as AnyElement).shadowRoot.childNodes[0];
  }) as AnyElement;
  expect(el.shadowRoot.childNodes[0], 'claim keeps node identity').toBe(claimedP);
  expect(dsd).toEqual(1);
  expect(csr).toEqual(0);
});

// ─── Styles ────────────────────────────────────────────────────────

test('compiled element applies static styles via adoptedStyleSheets', () => {
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
  expect(el.shadowRoot.adoptedStyleSheets.length).toEqual(1);
  expect(el.shadowRoot.adoptedStyleSheets[0]).toEqual(sheet);
});

test('registerGlobalStyles applies to new shadow roots and is idempotent', () => {
  const tag = uniqueTag('global-styles');
  OpenElement._resetGlobalStyles();
  const sheet = new StyleSheet();
  sheet.replaceSync('oe-migrated-global { color: blue; }');
  OpenElement.registerGlobalStyles([sheet]);
  OpenElement.registerGlobalStyles([sheet]);
  expect(OpenElement.getGlobalStyles()).toEqual([sheet]);
  defineCompiled({
    tag,
    rootMode: 'shadow-open',
    template: [{ k: 'el', tag: 'div', attrs: [], children: [] }],
    parts: [],
  });
  const el = connect(dom.document.createElement(tag)) as AnyElement;
  expect(el.shadowRoot.adoptedStyleSheets.includes(sheet)).toBeTruthy();
  OpenElement._resetGlobalStyles();
  expect(OpenElement.getGlobalStyles()).toEqual([]);
});

// ─── Theme broadcasts ──────────────────────────────────────────────

test('connected compiled hosts receive and clear data-theme broadcasts', () => {
  const tag = uniqueTag('theme');
  defineCompiled({
    tag,
    template: [{ k: 'el', tag: 'div', attrs: [], children: [] }],
    parts: [],
  });
  const el = connect(dom.document.createElement(tag)) as AnyElement;
  dom.document.documentElement.setAttribute('data-theme', 'dark');
  expect(el.getAttribute('data-theme')).toEqual('dark');
  dom.document.documentElement.removeAttribute('data-theme');
  expect(el.hasAttribute('data-theme')).toEqual(false);
});

test('theme broadcasts skip self-themed hosts and stop after disconnect (#773)', () => {
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
  expect(el.getAttribute('data-theme'), 'host-owned theme wins').toEqual('brand');
  dom.document.body.removeChild(el);
  dom.document.documentElement.setAttribute('data-theme', 'light');
  expect(el.getAttribute('data-theme'), 'disconnected hosts are not broadcast to').toEqual('brand');
  dom.document.documentElement.removeAttribute('data-theme');
});

// ─── Signals, parts, events ────────────────────────────────────────

test('signal-backed property writes update only the subscribed Part', () => {
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
  expect(toHtml(el)).toEqual(`<${tag}><div>v=<!--oe:p0-->a</div></${tag}>`);
  el.label = 'b';
  expect(toHtml(el)).toEqual(`<${tag}><div>v=<!--oe:p0-->b</div></${tag}>`);
});

test('compiled event parts bind instance methods once across reconnect', () => {
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
  expect(calls.length).toEqual(1);
  dom.document.body.removeChild(el);
  connect(el);
  expect((button.listeners.get('click') ?? []).length).toEqual(1);
  button.dispatchEvent({ type: 'click', target: null, currentTarget: null });
  expect(calls.length).toEqual(2);
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

test('compiled properties initialize from attributes via converters', () => {
  const tag = uniqueTag('props-init');
  defineCompiled({ ...PROP_SPEC, tag });
  const el = dom.document.createElement(tag) as AnyElement;
  el.setAttribute('count', '41');
  el.setAttribute('label', 'hello');
  el.setAttribute('disabled', '');
  el.setAttribute('items', '[{"id":"a"}]');
  el.setAttribute('item-count', '3');
  connect(el);
  expect(el.count).toEqual(41);
  expect(el.label).toEqual('hello');
  expect(el.disabled).toEqual(true);
  expect(el.items).toEqual([{ id: 'a' }]);
  expect(el.itemCount).toEqual(3);
});

test('compiled properties react to attribute changes; removal restores defaults', () => {
  const tag = uniqueTag('props-react');
  defineCompiled({ ...PROP_SPEC, tag });
  const el = connect(dom.document.createElement(tag)) as AnyElement;
  el.setAttribute('count', '9');
  expect(el.count).toEqual(9);
  el.setAttribute('count', 'not-a-number');
  expect(el.count, 'NaN converts to 0').toEqual(0);
  el.removeAttribute('label');
  expect(el.label, 'removal restores the compiled default').toEqual('x');
  el.removeAttribute('disabled');
  expect(el.disabled).toEqual(false);
});

test('reflect properties mirror property writes to attributes', () => {
  const tag = uniqueTag('props-reflect');
  defineCompiled({ ...PROP_SPEC, tag });
  const el = connect(dom.document.createElement(tag)) as AnyElement;
  el.count = 7;
  expect(el.getAttribute('count')).toEqual('7');
  el.disabled = true;
  expect(el.getAttribute('disabled')).toEqual('');
  el.disabled = false;
  expect(el.hasAttribute('disabled')).toEqual(false);
  // Removal of a reflected attribute restores the default and re-mirrors it.
  el.count = 12;
  el.removeAttribute('count');
  expect(el.count).toEqual(0);
  expect(el.getAttribute('count')).toEqual('0');
});

test('property-set state survives disconnect→reconnect (#772)', () => {
  const tag = uniqueTag('props-reconnect');
  defineCompiled({ ...PROP_SPEC, tag });
  const el = connect(dom.document.createElement(tag)) as AnyElement;
  el.label = 'kept';
  dom.document.body.removeChild(el);
  connect(el);
  expect(el.label).toEqual('kept');
  // Present attributes re-sync on reconnect.
  el.setAttribute('label', 'from-attr');
  dom.document.body.removeChild(el);
  connect(el);
  expect(el.label).toEqual('from-attr');
});

// ─── formAssociated / params ───────────────────────────────────────

test('compiled element attaches ElementInternals when formAssociated', () => {
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
  expect(attached).toEqual(1);
});

test('compiled element parses the params attribute into reactive params', () => {
  const tag = uniqueTag('params');
  defineCompiled({
    tag,
    template: [{ k: 'el', tag: 'div', attrs: [], children: [] }],
    parts: [],
  });
  const el = dom.document.createElement(tag) as AnyElement;
  el.setAttribute('params', '{"id":"7"}');
  connect(el);
  expect(el.params).toEqual({ id: '7' });
  el.params = { id: '8' };
  expect(el.params).toEqual({ id: '8' });
});

// ─── Lifecycle helpers ─────────────────────────────────────────────

test('_lifecycleSignal aborts on disconnect and re-arms on reconnect', () => {
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
  expect(first !== undefined && !first.aborted).toBeTruthy();
  dom.document.body.removeChild(el);
  expect(first.aborted).toBeTruthy();
  connect(el);
  const second = seen[1];
  expect(second !== undefined).toBeTruthy();
  expect(second).not.toEqual(first);
  expect(!second.aborted).toBeTruthy();
});

test('public signals keep engine semantics for authored effects', async () => {
  const { effect, signal } = await import('@openelement/element');
  const count = signal(0);
  const seen: number[] = [];
  const dispose = effect(() => {
    seen.push(count.value);
  });
  count.value = 2;
  dispose();
  count.value = 3;
  expect(seen).toEqual([0, 2]);
});
