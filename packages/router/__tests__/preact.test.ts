import { assert, assertEquals } from '@std/assert';
import { OpenElement } from '@openelement/element';

// The v0.44 Preact island is a plain autonomous custom element (foreign
// element semantics): it does NOT extend OpenElement, renders into its
// light-DOM host content, and drives Preact from connectedCallback().
//
// The SSR/registration contract is covered by preact-smoke.test.ts; both
// files share the DOM stubs from dom-stubs.ts.

import { definePreactIsland } from '../src/preact.ts';
import { installDomStubs } from './dom-stubs.ts';

/** The lifecycle surface under test (this lib.dom lacks the callbacks). */
type IslandInstance = HTMLElement & {
  connectedCallback(): void;
  disconnectedCallback(): void;
  update(): void;
};

Deno.test('preact bridge has no top-level await and remains synchronously renderable', async () => {
  const source = await Deno.readTextFile(new URL('../src/preact.ts', import.meta.url));
  assertEquals(/^\s*await\s+import\(/m.test(source), false);
  assertEquals(source.includes('= await import('), false);
});

Deno.test('definePreactIsland returns an autonomous foreign element (no OpenElement base)', () => {
  const restore = installDomStubs();
  try {
    const Component = (props: { label: string }) => `<span>${props.label}</span>`;
    const ctor = definePreactIsland('test-client-island', Component as never, {
      props: { label: 'Client' },
    });

    assertEquals(ctor.prototype instanceof OpenElement, false);
    const instance = new ctor() as IslandInstance;
    assertEquals(typeof instance.connectedCallback, 'function');
    assertEquals(typeof instance.disconnectedCallback, 'function');
    assertEquals(typeof instance.update, 'function');
    // The server prerender seam is the class static.
    assertEquals(typeof ctor.renderSsr, 'function');
  } finally {
    restore();
  }
});

Deno.test('definePreactIsland client path activates via connectedCallback into the light host', () => {
  const restore = installDomStubs();
  try {
    const Component = (props: { label: string }) => props.label;
    const ctor = definePreactIsland('test-client-connect', Component as never, {
      props: { label: 'Client' },
    });
    const instance = new ctor() as IslandInstance;
    instance.connectedCallback();
    assertEquals(instance.textContent, 'Client');
    // The light host never grows a shadow root.
    assert('shadowRoot' in instance && instance.shadowRoot === null);
  } finally {
    restore();
  }
});
