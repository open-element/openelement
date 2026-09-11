/**
 * @openelement/router — Preact island smoke test (v0.44 foreign-element
 * contract).
 *
 * Proves the Preact island bridge works end-to-end:
 *   1. renderSsr() prerenders the component to light-DOM content HTML
 *   2. Props are passed from the island options
 *   3. Props are collected from element attributes
 *   4. State changes are reflected through the imperative update() seam
 *   5. connectedCallback() renders/hydrates the light host (no shadow root)
 *   6. disconnectedCallback() unmounts through the Preact owner (deferred)
 *
 * This test is the alpha.4 Preact Island Proof gate, rebased onto the 0.44
 * zero-OpenElement-runtime bridge (ADR-0143).
 */

import { assertEquals, assertStringIncludes } from '@std/assert';
import { signal } from '@openelement/element';
import { h } from 'preact';
import { useLayoutEffect } from 'preact/hooks';
import { definePreactIsland, type PreactIslandOptions } from '../src/preact.ts';
import { installDomStubs, StubNode, suppressDocument } from './dom-stubs.ts';

/** The lifecycle surface under test (this lib.dom lacks the callbacks). */
type IslandInstance = HTMLElement & {
  connectedCallback(): void;
  disconnectedCallback(): void;
  update(): void;
};

// ─── Tests ─────────────────────────────────────────────────────────

Deno.test('Preact island smoke: DOM stub tracks parentNode and insertion order', () => {
  const parent = new StubNode();
  const first = new StubNode() as unknown as Node;
  const second = new StubNode() as unknown as Node;
  const inserted = new StubNode() as unknown as Node;

  parent.appendChild(first);
  parent.appendChild(second);
  parent.insertBefore(inserted, second);

  assertEquals(parent.childNodes, [first, inserted, second]);
  assertEquals(
    (inserted as unknown as { parentNode: StubNode | null }).parentNode,
    parent,
  );

  parent.removeChild(inserted);
  assertEquals(parent.childNodes, [first, second]);
  assertEquals(
    (inserted as unknown as { parentNode: StubNode | null }).parentNode,
    null,
  );

  let threw = false;
  try {
    parent.removeChild(inserted);
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

// ── 1. renderSsr prerenders the component to light-DOM content HTML ──

Deno.test('Preact island smoke: renderSsr renders a simple component', () => {
  const restore = installDomStubs();
  const restoreDoc = suppressDocument();
  try {
    const Component = () => h('p', null, 'Hello openElement');
    const ctor = definePreactIsland('test-smoke-simple', Component as never);

    const html = ctor.renderSsr();
    assertStringIncludes(html, 'Hello openElement');
    assertStringIncludes(html, '<p>');
  } finally {
    restoreDoc();
    restore();
  }
});

Deno.test('Preact island smoke: renderSsr renders nested Preact components', () => {
  const restore = installDomStubs();
  const restoreDoc = suppressDocument();
  try {
    const Inner = ({ text }: { text: string }) => h('span', { class: 'inner' }, text);
    const Outer = () => h('div', null, h(Inner, { text: 'nested' }));
    const ctor = definePreactIsland('test-nested', Outer as never);

    const html = ctor.renderSsr();
    assertStringIncludes(html, 'nested');
    assertStringIncludes(html, 'inner');
  } finally {
    restoreDoc();
    restore();
  }
});

// ── 2. Preact component receives props from the island options ──

Deno.test('Preact island smoke: renderSsr passes props from options', () => {
  const restore = installDomStubs();
  const restoreDoc = suppressDocument();
  try {
    const Component = (props: { greeting: string; name: string }) =>
      h('p', null, `${props.greeting}, ${props.name}!`);
    const ctor = definePreactIsland('test-props-options', Component as never, {
      props: { greeting: 'Hi', name: 'World' },
    });

    assertStringIncludes(ctor.renderSsr(), 'Hi, World!');
  } finally {
    restoreDoc();
    restore();
  }
});

// ── 3. Props are collected from element attributes ──

Deno.test('Preact island smoke: client render collects attributes as props', () => {
  const restore = installDomStubs();
  try {
    const Component = (props: { label?: string }) => h('p', null, `label=${props.label}`);
    const ctor = definePreactIsland('test-props-attrs', Component as never);
    const instance = new ctor() as IslandInstance;
    instance.setAttribute('label', 'from-attr');

    instance.connectedCallback();
    assertStringIncludes(instance.textContent, 'label=from-attr');
  } finally {
    restore();
  }
});

Deno.test('Preact island smoke: attributes override the static options props', () => {
  const restore = installDomStubs();
  try {
    const Component = (props: { greeting?: string; name?: string }) =>
      h('p', null, `${props.greeting}, ${props.name}!`);
    const ctor = definePreactIsland('test-props-merge', Component as never, {
      props: { greeting: 'Hi', name: 'World' } as never,
    });
    const instance = new ctor() as IslandInstance;
    instance.setAttribute('name', 'Attribute');

    instance.connectedCallback();
    assertStringIncludes(instance.textContent, 'Hi, Attribute!');
  } finally {
    restore();
  }
});

// ── 4. Signal state changes are reflected through update() ──

Deno.test('Preact island smoke: signal state changes re-render through update()', () => {
  const restore = installDomStubs();
  try {
    const count = signal(0);
    const Component = (props: { count: { value: number } }) =>
      h('p', null, `count=${props.count.value}`);
    const options: PreactIslandOptions = { props: { count } };
    const ctor = definePreactIsland('test-signal-update', Component as never, options);
    const instance = new ctor() as IslandInstance;

    instance.connectedCallback();
    assertStringIncludes(instance.textContent, 'count=0');

    count.value = 3;
    instance.update();
    assertStringIncludes(instance.textContent, 'count=3');
  } finally {
    restore();
  }
});

// ── 5. connectedCallback renders into the light host (no shadow root) ──

Deno.test('Preact island smoke: client activation renders into the light host', () => {
  const restore = installDomStubs();
  try {
    const Component = () => h('div', { class: 'client-root' }, 'activated');
    const ctor = definePreactIsland('test-client-root', Component as never);
    const instance = new ctor() as IslandInstance;

    instance.connectedCallback();

    assertEquals(instance.shadowRoot, null);
    assertEquals(instance.childNodes.length, 1);
    assertStringIncludes(instance.textContent, 'activated');
  } finally {
    restore();
  }
});

// ── 6. disconnectedCallback unmounts through the Preact owner ──

Deno.test('Preact island smoke: disconnect unmounts after a microtask', async () => {
  const restore = installDomStubs();
  try {
    let starts = 0;
    let cleanups = 0;
    const Component = () => {
      useLayoutEffect(() => {
        starts++;
        return () => cleanups++;
      }, []);
      return h('p', null, 'mounted');
    };
    const ctor = definePreactIsland('test-dismount', Component as never);
    const instance = new ctor() as IslandInstance;

    instance.connectedCallback();
    assertEquals(starts, 1);
    assertStringIncludes(instance.textContent, 'mounted');

    // Simulate the real detach (the stub element reports isConnected=true
    // otherwise): the deferred teardown must observe the disconnected state.
    const connected = false;
    Object.defineProperty(instance, 'isConnected', {
      configurable: true,
      get: () => connected,
    });
    instance.disconnectedCallback();
    // Deferred teardown: nothing runs synchronously.
    assertEquals(cleanups, 0);
    await Promise.resolve();
    await Promise.resolve();
    assertEquals(cleanups, 1);
    assertEquals(instance.childNodes.length, 0);
  } finally {
    restore();
  }
});
